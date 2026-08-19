import { required as requiredValue } from "../../../test/required.ts";
import { CealDeviceProofError, generateCealDeviceProofKeyPair, signCealDeviceProof, verifyCealDeviceProof } from "../dist/device-proof.js";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";

// Ed25519 has published vectors too, but the property that matters for this
// flow is narrower and is what these assert: a signature this module produces
// verifies under the raw 32-byte public key the Gateway was handed, and stops
// verifying the moment either the payload or the key moves. Node owns the
// primitive; what is being proven here is the raw-key packing around it.

test("a signature verifies under the raw public key that was sent, and only over the exact payload", () => {
	const pair = generateCealDeviceProofKeyPair();
	assert.equal(pair.publicKey.length, 32);
	assert.equal(pair.privateKey.length, 32);

	const payload = Buffer.from("ceal.device_enrollment_proof.v1\0nonce", "utf8");
	const signature = signCealDeviceProof(pair.privateKey, payload);
	assert.equal(signature.length, 64);
	assert.ok(verifyCealDeviceProof(pair.publicKey, payload, signature));

	const flipped = new Uint8Array(payload);
	const flippedIndex = flipped.length - 1;
	flipped[flippedIndex] = requiredValue(flipped[flippedIndex], "flipped_payload_byte") ^ 0x01;
	assert.ok(!verifyCealDeviceProof(pair.publicKey, flipped, signature), "a changed payload must not verify");
	assert.ok(!verifyCealDeviceProof(generateCealDeviceProofKeyPair().publicKey, payload, signature), "another key must not verify");

	const tampered = new Uint8Array(signature);
	tampered[0] = requiredValue(tampered[0], "tampered_signature_byte") ^ 0x01;
	assert.ok(!verifyCealDeviceProof(pair.publicKey, payload, tampered), "a changed signature must not verify");
});

// The raw packing is the part this module owns, so it is checked against Node's
// own DER path rather than against itself: the same seed must produce the same
// signature whether the key travelled as 32 raw bytes or as a key object.
test("raw key packing agrees with Node's own DER handling", () => {
	const generated = generateKeyPairSync("ed25519");
	const raw = generated.privateKey.export({ type: "pkcs8", format: "der" }).subarray(16);
	const payload = Buffer.from("same message", "utf8");
	assert.deepEqual(
		Buffer.from(signCealDeviceProof(new Uint8Array(raw), payload)),
		sign(null, payload, generated.privateKey),
		"a raw-seed signature must equal the one Node produces from the key object",
	);
});

test("every generated pair is distinct", () => {
	const keys = new Set();
	for (let index = 0; index < 8; index += 1) keys.add(Buffer.from(generateCealDeviceProofKeyPair().publicKey).toString("hex"));
	assert.equal(keys.size, 8);
});

test("malformed key material and empty payloads are refused by name", () => {
	const payload = Buffer.from("x", "utf8");
	const malformedKey = (value: unknown): unknown => Reflect.apply(signCealDeviceProof, undefined, [value, payload]);
	const cases: Array<[string, () => unknown]> = [
		["device_proof_invalid_key", () => signCealDeviceProof(new Uint8Array(31), payload)],
		["device_proof_invalid_key", () => malformedKey("not bytes")],
		["device_proof_invalid_payload", () => signCealDeviceProof(generateCealDeviceProofKeyPair().privateKey, new Uint8Array(0))],
	];
	for (const [code, act] of cases) {
		assert.throws(act, (error: unknown) => error instanceof CealDeviceProofError && error.code === code);
	}
	// Verification answers false rather than throwing: it is asked about
	// attacker-supplied bytes, and a thrown error there is a control-flow signal
	// a caller can forget to catch.
	assert.equal(verifyCealDeviceProof(new Uint8Array(31), payload, new Uint8Array(64)), false);
	assert.equal(verifyCealDeviceProof(new Uint8Array(32), payload, new Uint8Array(63)), false);
});
