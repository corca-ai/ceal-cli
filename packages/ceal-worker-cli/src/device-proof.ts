import { createPrivateKey, generateKeyPairSync, sign, verify } from "node:crypto";

// The Ed25519 half of first-device adoption. The client proves to the Gateway
// that the device asking to be adopted is the same device that started the
// transaction, by signing the Gateway's own challenge nonce with a key that
// never leaves this process.
//
// It is a separate key from the HPKE recipient key on purpose, and the Protocol
// rejects a start request that reuses one for both. Signing and decryption are
// different authorities: a signing oracle must not become a decryption oracle
// because someone reused 32 bytes.
//
// Same raw-key contract as hpke.ts — the Protocol carries 32-byte public keys
// and 64-byte signatures as base64url — so the same DER prefixes appear here,
// for id-Ed25519 (OID 1.3.101.112) rather than X25519.

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const N_PUBLIC_KEY = 32;
const N_PRIVATE_KEY = 32;
const N_SIGNATURE = 64;

export class CealDeviceProofError extends Error {
	readonly code: string;
	constructor(code: string, message: string) {
		super(message);
		this.name = "CealDeviceProofError";
		this.code = code;
	}
}

export interface CealDeviceProofKeyPair {
	/** Raw 32-byte Ed25519 seed. Never persisted, never logged, never printed. */
	privateKey: Uint8Array;
	/** Raw 32-byte Ed25519 public key, the value sent to the Gateway. */
	publicKey: Uint8Array;
}

export function generateCealDeviceProofKeyPair(): CealDeviceProofKeyPair {
	const pair = generateKeyPairSync("ed25519");
	const publicKey = pair.publicKey.export({ type: "spki", format: "der" }).subarray(ED25519_SPKI_PREFIX.length);
	const privateKey = pair.privateKey.export({ type: "pkcs8", format: "der" }).subarray(ED25519_PKCS8_PREFIX.length);
	if (publicKey.length !== N_PUBLIC_KEY || privateKey.length !== N_PRIVATE_KEY) {
		throw new CealDeviceProofError("device_proof_key_generation_failed", "Generated Ed25519 key material is not the expected raw size.");
	}
	return { privateKey: new Uint8Array(privateKey), publicKey: new Uint8Array(publicKey) };
}

/**
 * Signs exactly the bytes it is handed. The payload is built by the Protocol's
 * `deviceEnrollmentProofPayload`, which binds the Gateway origin, registration,
 * nonce reference, and nonce together — this function deliberately cannot see
 * that structure, so it cannot be talked into signing a differently shaped
 * message that happens to be well-formed.
 */
export function signCealDeviceProof(privateKey: Uint8Array, payload: Uint8Array): Uint8Array {
	if (!(privateKey instanceof Uint8Array) || privateKey.length !== N_PRIVATE_KEY) {
		throw new CealDeviceProofError("device_proof_invalid_key", "Expected a raw 32-byte Ed25519 private key.");
	}
	if (!(payload instanceof Uint8Array) || payload.length === 0) {
		throw new CealDeviceProofError("device_proof_invalid_payload", "Refusing to sign an empty proof payload.");
	}
	const signature = sign(null, Buffer.from(payload), importPrivateKey(privateKey));
	if (signature.length !== N_SIGNATURE) {
		throw new CealDeviceProofError("device_proof_signature_failed", "Ed25519 signature is not the expected size.");
	}
	return new Uint8Array(signature);
}

/**
 * Present so the proof path can be falsified rather than only exercised: a test
 * that only signs proves the signer runs, not that what it produced verifies
 * under the public key the Gateway was given.
 *
 * @testOnly
 */
export function verifyCealDeviceProof(publicKey: Uint8Array, payload: Uint8Array, signature: Uint8Array): boolean {
	if (!(publicKey instanceof Uint8Array) || publicKey.length !== N_PUBLIC_KEY) return false;
	if (!(signature instanceof Uint8Array) || signature.length !== N_SIGNATURE) return false;
	try {
		return verify(null, Buffer.from(payload), publicKeyDocument(publicKey), Buffer.from(signature));
	} catch {
		return false;
	}
}

function publicKeyDocument(raw: Uint8Array): { key: Buffer; format: "der"; type: "spki" } {
	return { key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(raw)]), format: "der", type: "spki" };
}

function importPrivateKey(raw: Uint8Array): ReturnType<typeof createPrivateKey> {
	return createPrivateKey({ key: Buffer.concat([ED25519_PKCS8_PREFIX, Buffer.from(raw)]), format: "der", type: "pkcs8" });
}
