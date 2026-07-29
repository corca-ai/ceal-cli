import assert from "node:assert/strict";
import test from "node:test";
import { CealHpkeError, generateCealHpkeKeyPair, openCealHpkeMessage, sealCealHpkeMessage } from "../dist/hpke.js";

// A round-trip proves only that this module agrees with itself, and a key
// schedule that is consistently wrong round-trips perfectly. The first test is
// therefore the published vector: it is the only thing here that can tell a
// correct implementation from a self-consistent one, and it is what stands in
// for the Gateway, whose counterpart composes the same suite out of `@hpke/core`
// rather than out of this file.
//
// Source: the CFRG HPKE test vectors, pinned commit, suite
// (kem 0x0020, kdf 0x0001, aead 0x0002), mode_base, first exported message.
// https://github.com/cfrg/draft-irtf-cfrg-hpke/blob/5f503c564da00b0687b3de75f1dfbdfc4079ad31/test-vectors.json
const VECTOR = {
	recipientPrivateKey: "497b4502664cfea5d5af0b39934dac72242a74f8480451e1aee7d6a53320333d",
	enc: "6c93e09869df3402d7bf231bf540fadd35cd56be14f97178f0954db94b7fc256",
	info: "4f6465206f6e2061204772656369616e2055726e",
	aad: "436f756e742d30",
	ciphertext: "e5d84cd531cfb583096e7cfa9641bd3079cf3a91cda813c52deb5f512be9931980a41de125a925cdad859d5b7a",
	plaintext: "4265617574792069732074727574682c20747275746820626561757479",
};

const hex = (value) => new Uint8Array(Buffer.from(value, "hex"));
const vectorMessage = () => ({
	recipientPrivateKey: hex(VECTOR.recipientPrivateKey),
	enc: hex(VECTOR.enc),
	ciphertext: hex(VECTOR.ciphertext),
	info: hex(VECTOR.info),
	aad: hex(VECTOR.aad),
});

test("the published RFC 9180 vector for this exact suite opens", () => {
	const opened = openCealHpkeMessage(vectorMessage());
	assert.equal(Buffer.from(opened).toString("hex"), VECTOR.plaintext);
	assert.equal(Buffer.from(opened).toString("utf8"), "Beauty is truth, truth beauty");
});

// Each of these alters exactly one authenticated input of the vector, so a
// failure here is attributable rather than general. Together they are the
// evidence that `info` and `aad` are genuinely bound rather than decorative —
// an implementation that dropped either would still pass the test above if the
// vector happened to use empty values, and this one does not.
test("altering any authenticated input of the vector fails the open", () => {
	for (const [name, mutate] of [
		["ciphertext", (message) => ({ ...message, ciphertext: flipLastBit(message.ciphertext) })],
		["tag", (message) => ({ ...message, ciphertext: flipFirstTagBit(message.ciphertext) })],
		["aad", (message) => ({ ...message, aad: flipLastBit(message.aad) })],
		["info", (message) => ({ ...message, info: flipLastBit(message.info) })],
		["encapsulated key", (message) => ({ ...message, enc: flipLastBit(message.enc) })],
		["recipient key", (message) => ({ ...message, recipientPrivateKey: flipLastBit(message.recipientPrivateKey) })],
	]) {
		assert.throws(
			() => openCealHpkeMessage(mutate(vectorMessage())),
			(error) => error instanceof CealHpkeError && error.code === "hpke_open_failed",
			`a modified ${name} must not open`,
		);
	}
});

test("a sealed message opens only under its own key, info, and associated data", () => {
	const recipient = generateCealHpkeKeyPair();
	const other = generateCealHpkeKeyPair();
	const info = Buffer.from("ceal.device_enrollment_hpke_info.v1", "utf8");
	const aad = Buffer.from("ceal.device_enrollment_hpke_aad.v1", "utf8");
	const plaintext = Buffer.from('{"ok":true,"schema_version":"ceal.enrollment.v1"}', "utf8");

	const sealed = sealCealHpkeMessage({ recipientPublicKey: recipient.publicKey, plaintext, info, aad });
	assert.equal(sealed.enc.length, 32);
	assert.equal(sealed.ciphertext.length, plaintext.length + 16);
	assert.notEqual(Buffer.from(sealed.ciphertext).toString("hex"), Buffer.from(plaintext).toString("hex"));

	const base = { recipientPrivateKey: recipient.privateKey, enc: sealed.enc, ciphertext: sealed.ciphertext, info, aad };
	assert.deepEqual(openCealHpkeMessage(base), new Uint8Array(plaintext));

	for (const [name, override] of [
		["another recipient", { recipientPrivateKey: other.privateKey }],
		["a different info", { info: Buffer.from("ceal.device_enrollment_hpke_info.v2", "utf8") }],
		["different associated data", { aad: Buffer.from("ceal.device_enrollment_hpke_aad.v2", "utf8") }],
	]) {
		assert.throws(
			() => openCealHpkeMessage({ ...base, ...override }),
			(error) => error instanceof CealHpkeError && error.code === "hpke_open_failed",
			`${name} must not open this message`,
		);
	}
});

// Two seals of the same plaintext must differ: the ephemeral key is what makes
// the nonce safe to fix at zero, so a reused encapsulation would mean a reused
// key-and-nonce pair, which is the one failure mode of GCM that loses the
// plaintext outright.
test("every seal uses a fresh encapsulation", () => {
	const recipient = generateCealHpkeKeyPair();
	const message = {
		recipientPublicKey: recipient.publicKey,
		plaintext: Buffer.from("same", "utf8"),
		info: Buffer.alloc(0),
		aad: Buffer.alloc(0),
	};
	const first = sealCealHpkeMessage(message);
	const second = sealCealHpkeMessage(message);
	assert.notEqual(Buffer.from(first.enc).toString("hex"), Buffer.from(second.enc).toString("hex"));
	assert.notEqual(Buffer.from(first.ciphertext).toString("hex"), Buffer.from(second.ciphertext).toString("hex"));
});

test("generated key pairs are raw 32-byte X25519 values that agree with each other", () => {
	const pair = generateCealHpkeKeyPair();
	assert.equal(pair.privateKey.length, 32);
	assert.equal(pair.publicKey.length, 32);
	assert.notEqual(Buffer.from(pair.privateKey).toString("hex"), Buffer.from(pair.publicKey).toString("hex"));
	const info = Buffer.alloc(0);
	const sealed = sealCealHpkeMessage({ recipientPublicKey: pair.publicKey, plaintext: Buffer.from("x"), info, aad: info });
	assert.deepEqual(
		openCealHpkeMessage({ recipientPrivateKey: pair.privateKey, enc: sealed.enc, ciphertext: sealed.ciphertext, info, aad: info }),
		new Uint8Array(Buffer.from("x")),
	);
});

// Malformed arguments are named rather than folded into `hpke_open_failed`:
// they are the caller's bug, not an attacker's guess, and telling them apart is
// what keeps the opaque code meaningful.
test("malformed key material and truncated messages are refused by name", () => {
	const valid = vectorMessage();
	const cases = [
		["hpke_invalid_recipient_key", { recipientPrivateKey: new Uint8Array(31) }],
		["hpke_invalid_recipient_key", { recipientPrivateKey: new Uint8Array(32) }],
		["hpke_invalid_recipient_key", { recipientPrivateKey: "not bytes" }],
		["hpke_invalid_encapsulated_key", { enc: new Uint8Array(33) }],
		["hpke_invalid_encapsulated_key", { enc: new Uint8Array(32) }],
		["hpke_open_failed", { ciphertext: new Uint8Array(16) }],
	];
	for (const [code, override] of cases) {
		assert.throws(
			() => openCealHpkeMessage({ ...valid, ...override }),
			(error) => error instanceof CealHpkeError && error.code === code,
			`${JSON.stringify(Object.keys(override))} must fail as ${code}`,
		);
	}
	assert.throws(
		() =>
			sealCealHpkeMessage({
				recipientPublicKey: new Uint8Array(32),
				plaintext: Buffer.from("x"),
				info: Buffer.alloc(0),
				aad: Buffer.alloc(0),
			}),
		(error) => error instanceof CealHpkeError && error.code === "hpke_invalid_recipient_key",
		"an all-zero recipient public key is the small-order point and must be refused",
	);
});

function flipLastBit(value) {
	const copy = new Uint8Array(value);
	copy[copy.length - 1] ^= 0x01;
	return copy;
}

function flipFirstTagBit(value) {
	const copy = new Uint8Array(value);
	copy[copy.length - 16] ^= 0x01;
	return copy;
}
