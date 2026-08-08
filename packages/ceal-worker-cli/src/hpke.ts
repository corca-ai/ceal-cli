import {
	createCipheriv,
	createDecipheriv,
	createHmac,
	createPrivateKey,
	createPublicKey,
	diffieHellman,
	generateKeyPairSync,
} from "node:crypto";

// RFC 9180 HPKE, base mode, for exactly one cipher suite:
//
//   DHKEM(X25519, HKDF-SHA256) / HKDF-SHA256 / AES-256-GCM
//   kem_id 0x0020, kdf_id 0x0001, aead_id 0x0002
//
// which is what `CEAL_DEVICE_ENROLLMENT_HPKE_SUITE` names. The Gateway seals a
// device-enrollment delivery to a public key this client generated, and only
// this client can open it. That is the whole reason the flow can hand a session
// to a device the Gateway has never authenticated: possession of the private
// key is the device's only identity, so the credential is never plaintext on
// any hop, in any log, or in front of any operator.
//
// Node 22 ships every primitive this needs — X25519 key agreement, HMAC-SHA256,
// AES-256-GCM — and no HPKE. The composition is written here rather than taken
// from a dependency because the shipped worker is a signed single-file binary
// whose entire bundled runtime dependency set is one package (`yaml`), and this
// is the narrow half of RFC 9180: one suite, base mode, single-shot.
//
// Writing cipher composition by hand is only defensible if it is proven against
// the published vectors rather than against itself, and a round-trip test
// proves nothing here — a consistently wrong key schedule round-trips
// perfectly and fails only against the real Gateway. `test/hpke.test.mjs`
// therefore opens the CFRG committed vector for this exact suite, and the
// interop counterpart it must match is the Gateway's own module
// (`scripts/agent-runtime/gateway-device-enrollment-hpke.mjs` in corca-ai/ceal,
// which composes the same suite out of `@hpke/core`).
//
// Deliberately absent: PSK and auth modes, every other suite, multi-message
// contexts, and the exporter interface. Each is a branch this client has no
// caller for, and an unused crypto branch is one nothing would notice breaking.

const KEM_ID = 0x0020;
const KDF_ID = 0x0001;
const AEAD_ID = 0x0002;
const MODE_BASE = 0x00;

// Suite parameters. Named rather than inlined so a reader can check them
// against RFC 9180 §7 without counting bytes in an expression.
const N_SECRET = 32;
const N_KEY = 32;
const N_NONCE = 12;
const N_TAG = 16;
const N_PUBLIC_KEY = 32;
const N_PRIVATE_KEY = 32;
const HASH = "sha256";
const N_HASH = 32;

const HPKE_VERSION = Buffer.from("HPKE-v1", "utf8");
const SUITE_ID = Buffer.concat([Buffer.from("HPKE", "utf8"), i2osp(KEM_ID, 2), i2osp(KDF_ID, 2), i2osp(AEAD_ID, 2)]);
const KEM_SUITE_ID = Buffer.concat([Buffer.from("KEM", "utf8"), i2osp(KEM_ID, 2)]);

// X25519 keys cross this boundary as raw 32-byte values, because that is what
// the Protocol's `raw_32_byte_base64url` encoding carries and what the Gateway
// serializes. Node's key API speaks DER, so these are the two fixed prefixes
// that wrap a raw key into the minimal SPKI/PKCS#8 document for id-X25519
// (OID 1.3.101.110). They are constant for this curve: no length in either
// document varies once the key size is fixed.
const X25519_SPKI_PREFIX = Buffer.from("302a300506032b656e032100", "hex");
const X25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b656e04220420", "hex");

export class CealHpkeError extends Error {
	readonly code: string;
	constructor(code: string, message: string) {
		super(message);
		this.name = "CealHpkeError";
		this.code = code;
	}
}

export interface CealHpkeKeyPair {
	/** Raw 32-byte X25519 private key. Never leaves this process. */
	privateKey: Uint8Array;
	/** Raw 32-byte X25519 public key, the value sent to the Gateway. */
	publicKey: Uint8Array;
}

export interface CealHpkeSealed {
	/** The KEM encapsulated key: a raw 32-byte ephemeral X25519 public key. */
	enc: Uint8Array;
	/** AES-256-GCM ciphertext with its 16-byte tag appended, as RFC 9180 defines it. */
	ciphertext: Uint8Array;
}

export function generateCealHpkeKeyPair(): CealHpkeKeyPair {
	// Exported straight off the generated key objects. Re-wrapping them through
	// createPublicKey/createPrivateKey looks harmless and is not: those accept a
	// private key object to derive from, and hand back an argument error for a
	// public one.
	const pair = generateKeyPairSync("x25519");
	const publicKey = pair.publicKey.export({ type: "spki", format: "der" }).subarray(X25519_SPKI_PREFIX.length);
	const privateKey = pair.privateKey.export({ type: "pkcs8", format: "der" }).subarray(X25519_PKCS8_PREFIX.length);
	if (publicKey.length !== N_PUBLIC_KEY || privateKey.length !== N_PRIVATE_KEY) {
		throw new CealHpkeError("hpke_key_generation_failed", "Generated X25519 key material is not the expected raw size.");
	}
	return { privateKey: new Uint8Array(privateKey), publicKey: new Uint8Array(publicKey) };
}

/**
 * Opens one sealed single-shot message. This is the direction the client needs:
 * the Gateway is always the sender.
 *
 * Every failure — malformed key, malformed encapsulation, wrong recipient,
 * altered `info`, altered `aad`, altered ciphertext, truncated tag — arrives as
 * one `hpke_open_failed`. Distinguishing them would tell an attacker which of
 * their guesses was closer, and the caller's recovery is identical in all of
 * them: treat the delivery as invalid and do not persist a session.
 */
export function openCealHpkeMessage(options: {
	recipientPrivateKey: Uint8Array;
	enc: Uint8Array;
	ciphertext: Uint8Array;
	info: Uint8Array;
	aad: Uint8Array;
}): Uint8Array {
	const recipientPrivateKey = requireRawKey(options.recipientPrivateKey, N_PRIVATE_KEY, "hpke_invalid_recipient_key");
	const enc = requireRawKey(options.enc, N_PUBLIC_KEY, "hpke_invalid_encapsulated_key");
	if (!(options.ciphertext instanceof Uint8Array) || options.ciphertext.length <= N_TAG) {
		throw new CealHpkeError("hpke_open_failed", "Sealed message is shorter than an authentication tag.");
	}
	const sharedSecret = decapsulate(enc, recipientPrivateKey);
	const schedule = keySchedule(sharedSecret, options.info);
	return openAead(schedule, options.ciphertext, options.aad);
}

/**
 * Seals one single-shot message. The client never does this in the enrollment
 * flow — the Gateway is the sender — but the vector suite needs a sender to
 * prove that a message this code seals is one it also opens, and a Gateway
 * counterpart cannot be stood up inside a unit test.
 *
 * @testOnly
 */
export function sealCealHpkeMessage(options: {
	recipientPublicKey: Uint8Array;
	plaintext: Uint8Array;
	info: Uint8Array;
	aad: Uint8Array;
}): CealHpkeSealed {
	const recipientPublicKey = requireRawKey(options.recipientPublicKey, N_PUBLIC_KEY, "hpke_invalid_recipient_key");
	if (!(options.plaintext instanceof Uint8Array)) throw new CealHpkeError("hpke_invalid_plaintext", "Plaintext must be bytes.");
	const ephemeral = generateCealHpkeKeyPair();
	const sharedSecret = encapsulate(recipientPublicKey, ephemeral.privateKey);
	const schedule = keySchedule(sharedSecret, options.info);
	return { enc: ephemeral.publicKey, ciphertext: sealAead(schedule, options.plaintext, options.aad) };
}

interface HpkeSchedule {
	key: Buffer;
	baseNonce: Buffer;
}

// RFC 9180 §4.1. `dh` is the raw X25519 shared coordinate; `kem_context` binds
// it to both public keys so a shared secret cannot be reused under a different
// pair.
function extractAndExpand(dh: Buffer, kemContext: Buffer): Buffer {
	const eaePrk = labeledExtract(KEM_SUITE_ID, Buffer.alloc(0), "eae_prk", dh);
	return labeledExpand(KEM_SUITE_ID, eaePrk, "shared_secret", kemContext, N_SECRET);
}

function encapsulate(recipientPublicKey: Uint8Array, ephemeralPrivateKey: Uint8Array): Buffer {
	const dh = agree(ephemeralPrivateKey, recipientPublicKey);
	const ephemeralPublicKey = publicKeyOf(ephemeralPrivateKey);
	return extractAndExpand(dh, Buffer.concat([ephemeralPublicKey, Buffer.from(recipientPublicKey)]));
}

function decapsulate(enc: Uint8Array, recipientPrivateKey: Uint8Array): Buffer {
	const dh = agree(recipientPrivateKey, enc);
	// The recipient's own public key is derived rather than accepted from the
	// caller: taking it as an argument would let a caller bind the context to a
	// key it does not hold, and the mismatch would surface as an opaque decrypt
	// failure rather than as the argument error it is.
	const recipientPublicKey = publicKeyOf(recipientPrivateKey);
	return extractAndExpand(dh, Buffer.concat([Buffer.from(enc), recipientPublicKey]));
}

// RFC 9180 §5.1, mode_base. `psk` and `psk_id` are empty in this mode and are
// written as such rather than dropped, because the empty values still enter the
// transcript through `psk_id_hash` and `secret`.
function keySchedule(sharedSecret: Buffer, info: Uint8Array): HpkeSchedule {
	if (!(info instanceof Uint8Array)) throw new CealHpkeError("hpke_invalid_info", "HPKE info must be bytes.");
	const empty = Buffer.alloc(0);
	const pskIdHash = labeledExtract(SUITE_ID, empty, "psk_id_hash", empty);
	const infoHash = labeledExtract(SUITE_ID, empty, "info_hash", Buffer.from(info));
	const context = Buffer.concat([Buffer.from([MODE_BASE]), pskIdHash, infoHash]);
	const secret = labeledExtract(SUITE_ID, sharedSecret, "secret", empty);
	return {
		key: labeledExpand(SUITE_ID, secret, "key", context, N_KEY),
		baseNonce: labeledExpand(SUITE_ID, secret, "base_nonce", context, N_NONCE),
	};
}

// Single-shot only, so the sequence number is always zero and the nonce is the
// base nonce unchanged. There is no counter to advance and none is kept: a
// second message under the same context would need the XOR that RFC 9180 §5.2
// specifies, and that branch is absent rather than present-and-unused so it
// cannot be reached by a caller who assumes it works.
function sealAead(schedule: HpkeSchedule, plaintext: Uint8Array, aad: Uint8Array): Uint8Array {
	const cipher = createCipheriv("aes-256-gcm", schedule.key, schedule.baseNonce, { authTagLength: N_TAG });
	cipher.setAAD(requireAad(aad));
	const body = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()]);
	return new Uint8Array(Buffer.concat([body, cipher.getAuthTag()]));
}

function openAead(schedule: HpkeSchedule, sealed: Uint8Array, aad: Uint8Array): Uint8Array {
	const body = Buffer.from(sealed.subarray(0, sealed.length - N_TAG));
	const tag = Buffer.from(sealed.subarray(sealed.length - N_TAG));
	try {
		const decipher = createDecipheriv("aes-256-gcm", schedule.key, schedule.baseNonce, { authTagLength: N_TAG });
		decipher.setAAD(requireAad(aad));
		decipher.setAuthTag(tag);
		return new Uint8Array(Buffer.concat([decipher.update(body), decipher.final()]));
	} catch (error) {
		if (error instanceof CealHpkeError) throw error;
		throw new CealHpkeError("hpke_open_failed", "Sealed message did not authenticate under this key, info, and associated data.");
	}
}

function requireAad(aad: Uint8Array): Buffer {
	if (!(aad instanceof Uint8Array)) throw new CealHpkeError("hpke_invalid_aad", "HPKE associated data must be bytes.");
	return Buffer.from(aad);
}

// RFC 9180 §4. `labeled_ikm` and `labeled_info` are what stop one suite's key
// schedule from ever colliding with another's, so the suite id is a parameter
// here: the KEM uses `KEM<kem_id>` and everything above it uses the full
// `HPKE<kem><kdf><aead>`, and swapping them silently produces a wrong-but-
// consistent implementation.
function labeledExtract(suiteId: Buffer, salt: Buffer, label: string, ikm: Buffer): Buffer {
	return extract(salt, Buffer.concat([HPKE_VERSION, suiteId, Buffer.from(label, "utf8"), ikm]));
}

function labeledExpand(suiteId: Buffer, prk: Buffer, label: string, info: Buffer, length: number): Buffer {
	return expand(prk, Buffer.concat([i2osp(length, 2), HPKE_VERSION, suiteId, Buffer.from(label, "utf8"), info]), length);
}

// HKDF-SHA256 (RFC 5869) as its two halves. Node's `hkdfSync` performs both at
// once and never exposes the pseudorandom key, but HPKE reuses one PRK across
// several expansions and feeds `shared_secret` in as the salt of another
// extract, so the halves have to be separable.
function extract(salt: Buffer, ikm: Buffer): Buffer {
	return createHmac(HASH, salt).update(ikm).digest();
}

function expand(prk: Buffer, info: Buffer, length: number): Buffer {
	if (length > N_HASH * 255) throw new CealHpkeError("hpke_expand_too_long", "HKDF cannot expand to the requested length.");
	const blocks: Buffer[] = [];
	let previous: Buffer = Buffer.alloc(0);
	for (let counter = 1; blocks.reduce((total, block) => total + block.length, 0) < length; counter += 1) {
		previous = createHmac(HASH, prk)
			.update(Buffer.concat([previous, info, Buffer.from([counter])]))
			.digest();
		blocks.push(previous);
	}
	return Buffer.concat(blocks).subarray(0, length);
}

function agree(privateKey: Uint8Array, publicKey: Uint8Array): Buffer {
	let shared: Buffer;
	try {
		shared = diffieHellman({ privateKey: importPrivateKey(privateKey), publicKey: importPublicKey(publicKey) });
	} catch {
		// Node rejects the small-order points here, which is the same condition
		// RFC 9180 §7.1.4 asks implementations to reject.
		throw new CealHpkeError("hpke_open_failed", "X25519 key agreement failed for this key pair.");
	}
	// Belt and braces for the same rule: an all-zero shared coordinate means the
	// peer key had small order, and continuing would derive a key an attacker
	// also knows.
	if (shared.length !== N_PUBLIC_KEY || shared.every((byte) => byte === 0)) {
		throw new CealHpkeError("hpke_open_failed", "X25519 key agreement produced a degenerate shared secret.");
	}
	return shared;
}

function publicKeyOf(privateKey: Uint8Array): Buffer {
	return createPublicKey(importPrivateKey(privateKey)).export({ type: "spki", format: "der" }).subarray(X25519_SPKI_PREFIX.length);
}

function importPublicKey(raw: Uint8Array): ReturnType<typeof createPublicKey> {
	return createPublicKey({ key: Buffer.concat([X25519_SPKI_PREFIX, Buffer.from(raw)]), format: "der", type: "spki" });
}

function importPrivateKey(raw: Uint8Array): ReturnType<typeof createPrivateKey> {
	return createPrivateKey({ key: Buffer.concat([X25519_PKCS8_PREFIX, Buffer.from(raw)]), format: "der", type: "pkcs8" });
}

function requireRawKey(value: unknown, length: number, code: string): Uint8Array {
	if (!(value instanceof Uint8Array) || value.length !== length) {
		throw new CealHpkeError(code, `Expected a raw ${length}-byte X25519 key.`);
	}
	// An all-zero key is the canonical small-order point. Rejecting it here
	// names the argument rather than letting it surface later as a failed open.
	if (value.every((byte) => byte === 0)) throw new CealHpkeError(code, "Raw X25519 key is the all-zero small-order point.");
	return value;
}

function i2osp(value: number, length: number): Buffer {
	const encoded = Buffer.alloc(length);
	encoded.writeUIntBE(value, 0, length);
	return encoded;
}
