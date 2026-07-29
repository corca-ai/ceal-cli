import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { deviceEnrollmentHpkeAssociatedData, deviceEnrollmentHpkeInfo, deviceEnrollmentProofPayload } from "@corca-ai/ceal-protocol";
import { adoptSession } from "../dist/device-adoption.js";
import { verifyCealDeviceProof } from "../dist/device-proof.js";
import { sealCealHpkeMessage } from "../dist/hpke.js";

// The Gateway in these tests is a real sealer, not a stub that returns a
// fixture: it opens the start request the command actually sent, seals a real
// enrollment payload to the recipient key that command generated, and computes
// the same HPKE info and AAD from the Protocol. A stub would let a client that
// never checks a binding pass every one of these.

const GATEWAY = "https://ceal.example.test";
const ORIGIN = "https://ceal.example.test";
const EMAIL = "employee@example.test";
const NOW = Date.parse("2026-07-29T12:00:00.000Z");

test("a full adoption verifies the delivery, stores the session, and claims nothing more", async () => {
	const world = createWorld();
	const code = await run(world);

	assert.equal(code, 0);
	const result = world.result();
	assert.equal(result.ok, true);
	assert.equal(result.status, "adopted");
	assert.equal(result.enrollment_kind, "verified_email_first_device");
	assert.equal(result.sealed_delivery_verified, true);
	assert.equal(result.subject_ref, "subject:employee");
	assert.equal(result.raw_token_visible, false);
	assert.equal(world.saved.length, 1);
	assert.equal(world.saved[0].accessToken, "ceal_personal_QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVpbXF1eX2A");
	assert.equal(world.saved[0].gatewayEndpoint, GATEWAY);
	// The command cannot claim the mailbox check it did not perform.
	assert.ok(result.non_claims.some((claim) => claim.includes("did not verify the mailbox")));
});

test("the challenge is signed under the proof key the Gateway was given", async () => {
	const world = createWorld();
	assert.equal(await run(world), 0);
	const signed = world.gateway.polls.at(0);
	assert.ok(
		verifyCealDeviceProof(
			Buffer.from(world.gateway.start.proof_public_key, "base64url"),
			deviceEnrollmentProofPayload(world.gateway.challenge()),
			Buffer.from(signed.signature, "base64url"),
		),
		"the polled signature must verify under the proof public key that was sent to the Gateway",
	);
	assert.equal(signed.nonce_ref, world.gateway.challenge().nonce_ref);
});

test("both fingerprints are shown before the verification URL, and nothing secret is", async () => {
	const world = createWorld();
	assert.equal(await run(world), 0);
	const shown = world.stderrText();

	const proofFingerprint = fingerprint(world.gateway.start.proof_public_key);
	const recipientFingerprint = fingerprint(world.gateway.start.recipient_public_key);
	const compact = shown.replaceAll(" ", "");
	assert.ok(compact.includes(proofFingerprint), "the proof key fingerprint must be shown");
	assert.ok(compact.includes(recipientFingerprint), "the recipient key fingerprint must be shown");
	assert.ok(
		shown.indexOf(proofFingerprint.slice(0, 8)) < shown.indexOf(world.gateway.browserSessionUrl),
		"fingerprints must be presented before the URL the employee is asked to open",
	);

	// Redaction: the submitted address, the nonce, the signature, the raw keys,
	// and every token stay out of what a terminal or a captured log sees.
	const everything = shown + world.stdoutText();
	for (const secret of [
		EMAIL,
		world.gateway.challenge().nonce,
		world.gateway.polls.at(0).signature,
		world.gateway.start.proof_public_key,
		world.gateway.start.recipient_public_key,
		"ceal_personal_QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVpbXF1eX2A",
		"ceal_refresh_YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXp7fH1-f4A",
	]) {
		assert.ok(!everything.includes(secret), `output must not contain ${secret.slice(0, 12)}...`);
	}
});

test("the client never fetches the verifier and never falls back to code enrollment", async () => {
	const world = createWorld();
	assert.equal(await run(world), 0);
	assert.deepEqual(world.gateway.visitedUrls, [], "the command must not open or fetch the verification URL itself");
	assert.equal(world.readSecretCalls, 0, "no enrollment code may be read; that is the other command's flow");
	assert.deepEqual(Object.keys(world.gateway.calledRoutes).sort(), ["poll", "start"]);
});

test("waiting is paced only by the Gateway and stops at the challenge expiry", async () => {
	const world = createWorld({ pendingPolls: 3, retryAfterMs: 5_000 });
	assert.equal(await run(world), 0);
	assert.deepEqual(world.slept, [5_000, 5_000, 5_000], "each wait must be exactly the interval the Gateway named");

	const expiring = createWorld({ pendingPolls: 1000, retryAfterMs: 30_000 });
	const code = await run(expiring);
	assert.equal(code, 3);
	assert.equal(expiring.result().error.kind, "expired");
	assert.equal(expiring.saved.length, 0);
	// The expiry stops it, not the poll count: the challenge lives 10 minutes and
	// the Gateway asks for 30s waits.
	assert.ok(expiring.slept.length <= 20, `stopped after ${expiring.slept.length} waits rather than polling forever`);
});

test("retries inside one run reuse the same device keys", async () => {
	const world = createWorld({ pendingPolls: 4 });
	assert.equal(await run(world), 0);
	const proofKeys = new Set(world.gateway.polls.map((poll) => poll.registration_ref));
	assert.equal(proofKeys.size, 1);
	assert.equal(world.gateway.startCount, 1, "a retry must not start a second transaction");
	assert.equal(new Set(world.gateway.polls.map((poll) => poll.signature)).size, 1, "the same challenge signature is reused, not re-minted");
});

// Each of these is a distinguishable, fail-closed outcome. The assertion that
// matters in every one is the same: no session was written.
test("every tampered delivery fails closed with its own error kind", async () => {
	const cases = [
		["start_binding_mismatch", { tamperStart: (start) => ({ ...start, gateway_origin: "https://attacker.example.test" }) }],
		["start_binding_mismatch", { tamperStart: (start) => ({ ...start, recipient_key_sha256: "c".repeat(64) }) }],
		["start_binding_mismatch", { tamperStart: (start) => ({ ...start, proof_key_sha256: "d".repeat(64) }) }],
		["delivery_binding_mismatch", { tamperBinding: (binding) => ({ ...binding, transaction_ref: "adoption:other" }) }],
		["delivery_binding_mismatch", { tamperBinding: (binding) => ({ ...binding, gateway_origin: "https://attacker.example.test" }) }],
		["sealed_open_failed", { tamperCiphertext: true }],
		["sealed_open_failed", { tamperAadAfterSealing: true }],
		["sealed_payload_rejected", { tamperPayload: (payload) => ({ ...payload, subject_ref: "subject:someone-else" }) }],
		["malformed_response", { malformedStart: true }],
		["recovery_required", { failWith: "recovery_required" }],
		["unsupported_feature", { failWith: "unsupported_feature" }],
		["expired", { failWith: "expired" }],
	];
	for (const [kind, options] of cases) {
		const world = createWorld(options);
		const code = await run(world);
		assert.equal(code, 3, `${kind} must exit non-zero`);
		const result = world.result();
		assert.equal(result.ok, false);
		assert.equal(result.error.kind, kind);
		assert.equal(result.session_written, false);
		assert.equal(world.saved.length, 0, `${kind} must not write a session`);
	}
});

test("a malformed invocation is refused before any key or request exists", async () => {
	for (const options of [
		[],
		["--gateway", GATEWAY],
		["--email", EMAIL],
		["--gateway", "http://ceal.example.test", "--email", EMAIL],
		["--gateway", GATEWAY, "--email", EMAIL, "extra"],
	]) {
		const world = createWorld();
		const code = await adoptSession(options, world.io, world.runtime);
		assert.equal(code, 2, `${JSON.stringify(options)} must be an argument error`);
		assert.equal(world.result().error.kind, "invalid_argument");
		assert.equal(world.gateway.startCount, 0, "no transaction may be started for a malformed invocation");
		assert.equal(world.saved.length, 0);
	}
});

test("a store that cannot write reports failure instead of a session", async () => {
	const world = createWorld({ saveFails: true });
	assert.equal(await run(world), 3);
	assert.equal(world.result().error.kind, "session_save_failed");
	assert.equal(world.result().session_written, false);
});

// Interruption policy: keys are held in this process and nowhere else, so a
// second run cannot resume the first. This asserts the observable half of that
// — a fresh run is a fresh transaction with fresh keys — because the absence of
// a file is not something a test can assert by looking at one place.
test("a second run adopts as a new transaction rather than resuming the first", async () => {
	const first = createWorld({ pendingPolls: 1 });
	await run(first);
	const second = createWorld({ pendingPolls: 1 });
	await run(second);
	assert.notEqual(first.gateway.start.recipient_public_key, second.gateway.start.recipient_public_key);
	assert.notEqual(first.gateway.start.proof_public_key, second.gateway.start.proof_public_key);
});

function run(world) {
	return adoptSession(["--gateway", GATEWAY, "--email", EMAIL], world.io, world.runtime);
}

function fingerprint(publicKey) {
	return createHash("sha256").update(Buffer.from(publicKey, "base64url")).digest("hex");
}

function createWorld(options = {}) {
	const stdout = [];
	const stderr = [];
	const saved = [];
	const slept = [];
	let clock = NOW;
	const gateway = createGateway(options);

	return {
		io: { stdout: { write: (chunk) => stdout.push(chunk) }, stderr: { write: (chunk) => stderr.push(chunk) } },
		saved,
		slept,
		readSecretCalls: 0,
		gateway,
		stdoutText: () => stdout.join(""),
		stderrText: () => stderr.join(""),
		result: () => parseYamlish(stdout.join("")),
		runtime: {
			saveSession: async (session) => {
				if (options.saveFails) throw new Error("read-only store");
				saved.push(session);
			},
			readSecret: async () => {
				throw new Error("adoption must never read an enrollment code");
			},
			now: () => clock,
			sleep: async (ms) => {
				slept.push(ms);
				clock += ms;
			},
			createDeviceAdoptionClient: () => gateway.client,
		},
	};
}

function createGateway(options) {
	const pendingPolls = options.pendingPolls ?? 0;
	const retryAfterMs = options.retryAfterMs ?? 1_000;
	const browserSessionUrl = `${ORIGIN}/adopt/verify/${encodeURIComponent("adoption:1")}`;
	const state = {
		start: null,
		startCount: 0,
		polls: [],
		visitedUrls: [],
		calledRoutes: {},
		browserSessionUrl,
		challenge: () => ({
			schema_version: "ceal.device_enrollment_challenge.v1",
			registration_ref: "registration:1",
			nonce_ref: "nonce:1",
			nonce: "AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA",
			gateway_origin: ORIGIN,
			proof_suite: "Ed25519",
			protocol_version: "1.3.0",
			expires_at: new Date(NOW + 10 * 60 * 1000).toISOString(),
		}),
	};
	let remaining = pendingPolls;

	state.client = {
		async start(request) {
			state.calledRoutes.start = true;
			state.startCount += 1;
			state.start = request;
			if (options.malformedStart) throw new (await import("@corca-ai/ceal")).CealDeviceAdoptionClientError("invalid_response");
			const result = {
				schema_version: "ceal.device_enrollment_start_result.v1",
				status: "pending",
				transaction_ref: "adoption:1",
				registration_ref: "registration:1",
				gateway_origin: ORIGIN,
				proof_key_sha256: fingerprint(request.proof_public_key),
				recipient_key_sha256: fingerprint(request.recipient_public_key),
				challenge_handle: "ISIjJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PD0-P0A",
				browser_session_url: browserSessionUrl,
				challenge: state.challenge(),
			};
			return options.tamperStart ? options.tamperStart(result) : result;
		},
		async poll(request) {
			state.calledRoutes.poll = true;
			state.polls.push(request);
			if (options.failWith) return { schema_version: "ceal.device_enrollment_poll_result.v1", status: "failed", code: options.failWith };
			if (remaining > 0) {
				remaining -= 1;
				return { schema_version: "ceal.device_enrollment_poll_result.v1", status: "pending", retry_after_ms: retryAfterMs };
			}
			return sealed(state, options);
		},
	};
	return state;
}

function sealed(state, options) {
	const payload = options.tamperPayload ? options.tamperPayload(enrollmentPayload()) : enrollmentPayload();
	const binding = {
		gateway_origin: ORIGIN,
		protocol_version: "1.3.0",
		feature: "device_enrollment_sealed_v1",
		transaction_ref: "adoption:1",
		registration_ref: "registration:1",
		profile_ref: payload.profile_ref,
		membership_ref: payload.membership_ref,
		client_ref: payload.client_ref,
		subject_ref: payload.subject_ref,
		instance_ref: payload.instance_ref,
		policy_ref: "policy:1",
		policy_version: 1,
		session_family_ref: "session-family:1",
		proof_key_sha256: fingerprint(state.start.proof_public_key),
		recipient_key_sha256: fingerprint(state.start.recipient_public_key),
		delivery_generation: 1,
		expires_at: new Date(NOW + 10 * 60 * 1000).toISOString(),
	};
	// A payload whose identity was tampered with still has to be sealed under a
	// binding the Gateway would really have produced, or the test would be
	// proving the AAD check rather than the payload-identity check.
	const sealingBinding = options.tamperPayload
		? {
				...binding,
				profile_ref: payload.profile_ref,
				subject_ref: payload.subject_ref === "subject:someone-else" ? "subject:employee" : payload.subject_ref,
			}
		: binding;
	const message = sealCealHpkeMessage({
		recipientPublicKey: Buffer.from(state.start.recipient_public_key, "base64url"),
		plaintext: Buffer.from(JSON.stringify(payload), "utf8"),
		info: deviceEnrollmentHpkeInfo(sealingBinding),
		aad: deviceEnrollmentHpkeAssociatedData(options.tamperAadAfterSealing ? { ...sealingBinding, delivery_generation: 2 } : sealingBinding),
	});
	const ciphertext = Buffer.from(message.ciphertext).toString("base64url");
	return {
		schema_version: "ceal.device_enrollment_poll_result.v1",
		status: "sealed",
		suite: "DHKEM(X25519,HKDF-SHA256)/HKDF-SHA256/AES-256-GCM",
		binding: options.tamperBinding ? options.tamperBinding(sealingBinding) : sealingBinding,
		encapsulated_key: Buffer.from(message.enc).toString("base64url"),
		ciphertext: options.tamperCiphertext ? `${ciphertext.slice(0, -1)}${ciphertext.endsWith("A") ? "B" : "A"}` : ciphertext,
	};
}

function enrollmentPayload() {
	return {
		schema_version: "ceal.enrollment_result.v1",
		ok: true,
		profile_ref: "profile:work",
		membership_ref: "membership:1",
		registration_ref: "registration:1",
		client_ref: "client:mac",
		subject_ref: "subject:employee",
		instance_ref: "instance:ceal-prod",
		access_token: "ceal_personal_QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVpbXF1eX2A",
		expires_at: new Date(NOW + 3600_000).toISOString(),
		refresh_token: "ceal_refresh_YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXp7fH1-f4A",
		refresh_token_idle_expires_at: new Date(NOW + 86_400_000).toISOString(),
		refresh_token_absolute_expires_at: new Date(NOW + 604_800_000).toISOString(),
	};
}

// The commands emit one plain YAML document with no anchors, aliases, or block
// scalars, so this reads what the CLI actually printed rather than pulling in a
// parser that would accept shapes the renderer never produces.
function parseYamlish(text) {
	const root = {};
	const stack = [{ indent: -1, node: root }];
	for (const line of text.split("\n")) {
		if (!line.trim()) continue;
		const indent = line.length - line.trimStart().length;
		const trimmed = line.trim();
		while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
		const parent = stack[stack.length - 1].node;
		if (trimmed.startsWith("- ")) {
			if (!Array.isArray(parent.__list)) parent.__list = [];
			parent.__list.push(scalar(trimmed.slice(2)));
			continue;
		}
		const separator = trimmed.indexOf(":");
		const key = trimmed.slice(0, separator);
		const value = trimmed.slice(separator + 1).trim();
		if (value === "") {
			const node = {};
			parent[key] = node;
			stack.push({ indent, node });
			continue;
		}
		parent[key] = scalar(value);
	}
	return materialize(root);
}

function scalar(value) {
	const unquoted = value.replace(/^"(.*)"$/su, "$1");
	if (unquoted === "true") return true;
	if (unquoted === "false") return false;
	if (unquoted === "null") return null;
	if (/^-?\d+$/u.test(unquoted)) return Number(unquoted);
	return unquoted;
}

function materialize(node) {
	if (Array.isArray(node.__list)) return node.__list;
	for (const [key, value] of Object.entries(node)) {
		if (value && typeof value === "object") node[key] = materialize(value);
	}
	return node;
}
