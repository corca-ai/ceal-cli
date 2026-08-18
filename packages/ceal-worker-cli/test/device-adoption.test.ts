import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { CealDeviceAdoptionClient, CealPersonalClientSessionClient } from "@corca-ai/ceal";
import {
	CEAL_DEVICE_ENROLLMENT_APPROVAL_WAIT_FEATURE,
	CEAL_DEVICE_ENROLLMENT_FEATURE,
	type CealClientRefreshResponse,
	type CealClientRevokeResponse,
	type CealClientSessionFailure,
	type CealDeviceEnrollmentChallenge,
	type CealDeviceEnrollmentDeliveryBinding,
	type CealDeviceEnrollmentPollRequest,
	type CealDeviceEnrollmentPollResponse,
	type CealDeviceEnrollmentStartRequest,
	type CealDeviceEnrollmentStartResult,
	deviceEnrollmentHpkeAssociatedData,
	deviceEnrollmentHpkeInfo,
	deviceEnrollmentProofPayload,
} from "@corca-ai/ceal-protocol";
import type { CealCliIo, CealCommandRuntime } from "../dist/cli-runtime.js";
import { verifyCealDeviceProof } from "../dist/device-proof.js";
import { sealCealHpkeMessage } from "../dist/hpke.js";
import { runCealCommand } from "../dist/index.js";
import type { CealStoredSession } from "../dist/profile-store.js";
import { CealSessionStoreError } from "../dist/profile-store.js";
import { createCealSessionCapability } from "../dist/session-capability.js";

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
	assert.ok(world.gateway.start);
	assert.ok(signed);
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
	assert.ok(world.gateway.start);
	assert.ok(world.gateway.polls.at(0));
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
	const poll = world.gateway.polls.at(0);
	assert.ok(poll);
	for (const secret of [
		EMAIL,
		world.gateway.challenge().nonce,
		poll.signature,
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

test("waiting is paced only by the Gateway, and only a monotonic local safety cap stops a silent Gateway", async () => {
	const world = createWorld({ pendingPolls: 3, retryAfterMs: 5_000 });
	assert.equal(await run(world), 0);
	assert.deepEqual(world.slept, [5_000, 5_000, 5_000], "each wait must be exactly the interval the Gateway named");
	assert.equal(
		(world.stderrText().match(/Waiting for mailbox verification/gu) ?? []).length,
		1,
		"the employee sees one wait instruction, not one per poll",
	);
	assert.doesNotMatch(world.stderrText(), /next check in/u);

	const expiring = createWorld({ pendingPolls: 1000, retryAfterMs: 30_000 });
	const code = await run(expiring);
	assert.equal(code, 3);
	assert.equal(expiring.result().error.kind, "wait_timeout");
	assert.equal(expiring.saved.length, 0);
	assert.ok(expiring.slept.length <= 70, `stopped after ${expiring.slept.length} waits rather than polling forever`);
});

test("a later-device approval wait is explicitly negotiated, Gateway-paced, and announced once", async () => {
	const world = createWorld({ approvalRequiredPolls: 2, retryAfterMs: 4_000 });
	assert.equal(await run(world), 0);
	const start = world.gateway.start;
	assert.ok(start);
	assert.deepEqual(start.client.features, [CEAL_DEVICE_ENROLLMENT_FEATURE, CEAL_DEVICE_ENROLLMENT_APPROVAL_WAIT_FEATURE]);
	assert.deepEqual(world.slept, [4_000, 4_000]);
	assert.equal((world.stderrText().match(/Waiting for operator approval/gu) ?? []).length, 1);
	assert.equal(world.result().status, "adopted");
});

test("a skewed device clock does not locally expire a fresh Gateway challenge", async () => {
	const world = createWorld({ pendingPolls: 1, retryAfterMs: 3_000, localWallClock: NOW + 40 * 60 * 1000 });
	assert.equal(await run(world), 0);
	assert.equal(world.result().status, "adopted");
	assert.deepEqual(world.slept, [3_000]);
	assert.equal(world.saved.length, 1);
});

test("a skewed device clock waits for the Gateway's terminal expiry", async () => {
	const world = createWorld({ pendingPolls: 1, retryAfterMs: 3_000, failWith: "expired", localWallClock: NOW + 40 * 60 * 1000 });
	assert.equal(await run(world), 3);
	assert.equal(world.result().error.kind, "expired");
	assert.deepEqual(world.slept, [3_000]);
	assert.equal(world.gateway.polls.length, 2, "the terminal expiry must come from a second Gateway poll");
	assert.equal(world.saved.length, 0);
});

test("retries inside one run reuse the same device keys", async () => {
	const world = createWorld({ pendingPolls: 4 });
	assert.equal(await run(world), 0);
	const proofKeys = new Set(world.gateway.polls.map((poll) => poll.registration_ref));
	assert.equal(proofKeys.size, 1);
	assert.equal(world.gateway.startCount, 1, "a retry must not start a second transaction");
	assert.equal(new Set(world.gateway.polls.map((poll) => poll.signature)).size, 1, "the same challenge signature is reused, not re-minted");
});

// By the time polling matters the employee has verified a mailbox in a browser
// and may have waited out an operator approval, and the device keys exist only in
// this process — the leaf help says interrupting requires a fresh adoption. One
// dropped connection used to spend all of that to report a packet.
test("a transient poll failure is another wait, not the end of an adoption the employee already completed", async () => {
	const world = createWorld({ pendingPolls: 1, retryAfterMs: 5_000, transientPollFailures: 2 });
	assert.equal(await run(world), 0);
	assert.equal(world.result().status, "adopted");
	assert.equal(world.saved.length, 1);
	// Before the Gateway has answered once it has named no interval, so those
	// waits use the local floor; once it names one, that is what a later failed
	// poll waits. The client never invents a pace the Gateway did state.
	assert.deepEqual(world.slept, [1_000, 1_000, 5_000]);

	// It stays bounded by the same local ceiling, not by a separate counter: a
	// Gateway that never answers still ends, and ends as a wait timeout.
	const silent = createWorld({ transientPollFailures: 10_000, retryAfterMs: 30_000 });
	assert.equal(await run(silent), 3);
	assert.equal(silent.result().error.kind, "wait_timeout");
	assert.equal(silent.saved.length, 0);
});

test("a malformed poll response stays terminal, because retrying returns the same answer", async () => {
	const world = createWorld({ transientPollFailures: 1, transientPollCode: "invalid_response" });
	assert.equal(await run(world), 3);
	assert.equal(world.result().error.kind, "malformed_response");
	assert.deepEqual(world.slept, [], "a terminal outcome must not be waited on");
	assert.equal(world.saved.length, 0);
});

test("typed start availability failures stay distinct and never write a session", async () => {
	const failureCodes: AdoptionFailureCode[] = ["adoption_not_available", "gateway_unavailable", "rate_limited"];
	for (const kind of failureCodes) {
		const world = createWorld({ startFailureCode: kind });
		assert.equal(await run(world), 3);
		assert.equal(world.result().error.kind, kind);
		assert.equal(world.saved.length, 0);
	}
});

test("start-only failure codes received during poll remain malformed and never write a session", async () => {
	const failureCodes: AdoptionFailureCode[] = ["adoption_not_available", "gateway_unavailable", "rate_limited"];
	for (const code of failureCodes) {
		const world = createWorld({ transientPollFailures: 1, transientPollCode: code });
		assert.equal(await run(world), 3);
		assert.equal(world.result().error.kind, "malformed_response");
		assert.equal(world.saved.length, 0);
	}
});

// Each of these is a distinguishable, fail-closed outcome. The assertion that
// matters in every one is the same: no session was written.
test("every tampered delivery fails closed with its own error kind", async () => {
	const cases: Array<[string, TestOptions]> = [
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
		const code = await runCealCommand(["session", "adopt", ...options], world.io, prepareRuntime(world.runtime));
		assert.equal(code, 2, `${JSON.stringify(options)} must be an argument error`);
		assert.equal(world.result().error.kind, "invalid_argument");
		assert.equal(world.gateway.startCount, 0, "no transaction may be started for a malformed invocation");
		assert.equal(world.saved.length, 0);
	}
});

test("a store that cannot write reports failure instead of a session", async () => {
	const world = createWorld({ saveFails: true });
	assert.equal(await run(world), 3);
	const result = world.result();
	assert.equal(result.error.kind, "session_save_failed");
	assert.equal(result.session_written, false);
	assert.equal(result.issued_session_revoked, "revoked");
	assert.deepEqual(
		world.revoked.map((call) => call.refreshToken),
		["ceal_refresh_YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXp7fH1-f4A"],
	);
	assert.doesNotMatch(result.error.next_action, /enrollment|replacement code/u);
	assert.match(result.error.next_action, /fresh adoption transaction/u);
});

test("an adoption lock failure revokes the issued session and keeps recovery local", async () => {
	const world = createWorld();
	world.runtime.runWithLockedSession = async () => {
		throw new CealSessionStoreError("refresh_busy");
	};
	assert.equal(await run(world), 3);
	const result = world.result();
	assert.equal(result.error.kind, "refresh_busy");
	assert.equal(result.issued_session_revoked, "revoked");
	assert.deepEqual(
		world.revoked.map((call) => call.refreshToken),
		["ceal_refresh_YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXp7fH1-f4A"],
	);
	assert.doesNotMatch(result.error.next_action, /enrollment|replacement code/u);
	assert.doesNotMatch(result.error.next_action, /Gateway URL/u);
	assert.match(result.error.next_action, /fresh adoption transaction/u);
});

test("a failed forced adoption never inherits enrollment-code recovery", async () => {
	const world = createWorld({
		storedSession: storedSession({ subjectRef: "subject:someone-else", refreshToken: "ceal_refresh_outgoing" }),
		saveFails: true,
	});
	assert.equal(await run(world, ["--force"]), 3);
	const result = world.result();
	assert.equal(result.error.kind, "session_save_failed");
	assert.equal(result.issued_session_revoked, "revoked");
	assert.deepEqual(
		world.revoked.map((call) => call.refreshToken),
		["ceal_refresh_outgoing", "ceal_refresh_YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXp7fH1-f4A"],
	);
	assert.match(result.error.next_action, /adoption did not land/u);
	assert.doesNotMatch(result.error.next_action, /enrollment|replacement code/u);
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
	assert.ok(first.gateway.start);
	assert.ok(second.gateway.start);
	assert.notEqual(first.gateway.start.recipient_public_key, second.gateway.start.recipient_public_key);
	assert.notEqual(first.gateway.start.proof_public_key, second.gateway.start.proof_public_key);
});

// One home holds one session, so a successful adoption is also a replacement
// decision. These four fix which decision it makes, because the sealed-delivery
// proof above says the Gateway meant this session for this device and says
// nothing about whether this host may hand the identity behind `ceal call` over.

test("re-adopting the identity this host already holds needs no flag and keeps its history", async () => {
	const world = createWorld({ storedSession: storedSession() });
	assert.equal(await run(world), 0);
	const result = world.result();
	assert.equal(result.status, "adopted");
	assert.equal(result.session_replacement, "same_identity");
	assert.equal(result.local_derived_state_cleared, false);
	assert.deepEqual(world.removedStores, [], "a renewal keeps the audit history of the identity it renews");
	// It still ends the credential it displaced: one home has one slot, so a
	// refresh token the store no longer names is unreachable from this host.
	assert.deepEqual(
		world.revoked.map((call) => call.refreshToken),
		["ceal_refresh_previous"],
	);
	assert.equal(result.previous_session_revoked, "revoked");
	const stored = world.storedSession();
	assert.ok(stored);
	assert.equal(stored.accessToken, "ceal_personal_QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVpbXF1eX2A");
});

test("adopting over a different identity is refused by name, keeps the stored session, and ends the one it refused", async () => {
	const world = createWorld({ storedSession: storedSession({ subjectRef: "subject:someone-else", instanceRef: "instance:ceal-dev" }) });
	assert.equal(await run(world), 3);
	const result = world.result();
	assert.equal(result.ok, false);
	assert.equal(result.status, "conflict");
	assert.equal(result.error.kind, "session_identity_conflict");
	assert.equal(result.session_written, false);
	assert.deepEqual(result.changed_bindings, ["subject_ref", "instance_ref"]);
	assert.match(result.error.next_action, /--force/u);
	assert.match(result.error.message, /adopted one differs/u);
	assert.match(result.error.next_action, /approve replacement/u);
	assert.doesNotMatch(result.error.next_action, /replacement code/u);
	assert.equal(world.saved.length, 0);
	const stored = world.storedSession();
	assert.ok(stored);
	assert.equal(stored.subjectRef, "subject:someone-else", "the identity this host holds is the one it keeps");
	// The refusal happens after the Gateway has issued a session, so the refusal
	// owns ending it; leaving it live is the orphan this guard exists to prevent.
	assert.deepEqual(
		world.revoked.map((call) => call.refreshToken),
		["ceal_refresh_YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXp7fH1-f4A"],
	);
	assert.equal(result.issued_session_revoked, "revoked");
});

test("--force replaces a different identity, revoking it first and clearing what it produced", async () => {
	const world = createWorld({ storedSession: storedSession({ subjectRef: "subject:someone-else", refreshToken: "ceal_refresh_outgoing" }) });
	assert.equal(await run(world, ["--force"]), 0);
	const result = world.result();
	assert.equal(result.status, "adopted");
	assert.equal(result.session_replacement, "replaced");
	assert.equal(result.previous_session_revoked, "revoked");
	assert.equal(result.local_derived_state_cleared, true);
	assert.deepEqual(
		world.revoked.map((call) => call.refreshToken),
		["ceal_refresh_outgoing"],
		"the credential that ends is the one being displaced, not the one just adopted",
	);
	// The receipt spool carries no identity discriminator, so a spool kept across
	// a substitution renders two subjects' history as one.
	assert.deepEqual(world.removedStores.sort(), ["discovery-cache", "receipt-spool"]);
	const stored = world.storedSession();
	assert.ok(stored);
	assert.equal(stored.subjectRef, "subject:employee");
});

test("a session store this host cannot read stops the adoption before the employee is asked for anything", async () => {
	const world = createWorld({ loadFails: true });
	assert.equal(await run(world), 3);
	assert.equal(world.result().error.kind, "session_load_failed");
	assert.deepEqual(world.gateway.calledRoutes, {}, "no transaction may start against a store whose contents are unknown");
	assert.equal(world.stderrText(), "", "and the employee is shown no verification URL");
});

function storedSession(overrides: Partial<CealStoredSession> = {}): CealStoredSession {
	return {
		gatewayEndpoint: GATEWAY,
		profileRef: "profile:work",
		membershipRef: "membership:1",
		registrationRef: "registration:0",
		clientRef: "client:previous",
		subjectRef: "subject:employee",
		instanceRef: "instance:ceal-prod",
		accessToken: "ceal_personal_previous",
		expiresAt: new Date(NOW + 3600_000).toISOString(),
		refreshToken: "ceal_refresh_previous",
		refreshTokenIdleExpiresAt: new Date(NOW + 86_400_000).toISOString(),
		refreshTokenAbsoluteExpiresAt: new Date(NOW + 604_800_000).toISOString(),
		...overrides,
	};
}

interface TestOptions {
	pendingPolls?: number;
	approvalRequiredPolls?: number;
	retryAfterMs?: number;
	localWallClock?: number;
	transientPollFailures?: number;
	transientPollCode?:
		| "invalid_configuration"
		| "request_timeout"
		| "request_failed"
		| "invalid_response"
		| "adoption_not_available"
		| "gateway_unavailable"
		| "rate_limited";
	startFailureCode?:
		| "invalid_configuration"
		| "request_timeout"
		| "request_failed"
		| "invalid_response"
		| "adoption_not_available"
		| "gateway_unavailable"
		| "rate_limited";
	malformedStart?: boolean;
	failWith?: "recovery_required" | "unsupported_feature" | "expired";
	tamperStart?: (start: CealDeviceEnrollmentStartResult) => CealDeviceEnrollmentStartResult;
	tamperBinding?: (binding: CealDeviceEnrollmentDeliveryBinding) => CealDeviceEnrollmentDeliveryBinding;
	tamperCiphertext?: boolean;
	tamperAadAfterSealing?: boolean;
	tamperPayload?: (payload: EnrollmentPayload) => EnrollmentPayload;
	storedSession?: CealStoredSession;
	saveFails?: boolean;
	loadFails?: boolean;
	revokeDeniedCode?: CealClientSessionFailure["error"]["code"];
}

type AdoptionFailureCode = NonNullable<TestOptions["startFailureCode"]>;

interface TestRuntime extends CealCommandRuntime {
	readStoredSession: () => Promise<CealStoredSession | null>;
	writeStoredSession: (session: CealStoredSession) => Promise<void>;
	runWithLockedSession?: <T>(action: (store: LockedStore) => Promise<T>) => Promise<T>;
	removeDiscoveryCache: () => Promise<void>;
	removeReceiptSpool: () => Promise<void>;
	createClientSessionClient: (options: { endpoint: string }) => CealPersonalClientSessionClient;
}

interface LockedStore {
	load: () => Promise<CealStoredSession | null>;
	save: (session: CealStoredSession) => Promise<void>;
	replace: (expectedRefreshToken: string, session: CealStoredSession) => Promise<void>;
	remove: () => Promise<void>;
}

interface GatewayState {
	start: CealDeviceEnrollmentStartRequest | null;
	startCount: number;
	polls: CealDeviceEnrollmentPollRequest[];
	visitedUrls: string[];
	calledRoutes: Record<string, boolean>;
	browserSessionUrl: string;
	challenge: () => CealDeviceEnrollmentChallenge;
	client: CealDeviceAdoptionClient;
}

interface World {
	io: CealCliIo;
	saved: CealStoredSession[];
	slept: number[];
	revoked: Array<{ endpoint: string; refreshToken: string }>;
	removedStores: string[];
	storedSession: () => CealStoredSession | null;
	readSecretCalls: number;
	gateway: GatewayState;
	stdoutText: () => string;
	stderrText: () => string;
	result: () => TestResult;
	runtime: TestRuntime;
}

interface TestResult {
	[key: string]: ParsedValue;
	ok: boolean;
	status: string;
	enrollment_kind: string;
	sealed_delivery_verified: boolean;
	subject_ref: string;
	raw_token_visible: boolean;
	non_claims: string[];
	session_replacement: string;
	local_derived_state_cleared: boolean;
	previous_session_revoked: string;
	issued_session_revoked: string;
	session_written: boolean;
	changed_bindings: string[];
	error: { kind: string; next_action: string; message: string };
}

type ParsedValue = string | number | boolean | null | ParsedValue[] | { [key: string]: ParsedValue };

interface EnrollmentPayload {
	schema_version: "ceal.enrollment_result.v1";
	ok: true;
	profile_ref: string;
	membership_ref: string;
	registration_ref: string;
	client_ref: string;
	subject_ref: string;
	instance_ref: string;
	access_token: string;
	expires_at: string;
	refresh_token: string;
	refresh_token_idle_expires_at: string;
	refresh_token_absolute_expires_at: string;
}

function run(world: World, extraOptions: string[] = []) {
	return runCealCommand(
		["session", "adopt", "--gateway", GATEWAY, "--email", EMAIL, ...extraOptions],
		world.io,
		prepareRuntime(world.runtime),
	);
}

function prepareRuntime(runtime: TestRuntime): CealCommandRuntime {
	const {
		readStoredSession,
		writeStoredSession,
		runWithLockedSession,
		removeDiscoveryCache,
		removeReceiptSpool,
		createClientSessionClient,
		...commandRuntime
	} = runtime;
	const load = readStoredSession;
	const save = writeStoredSession;
	const remove = async (): Promise<void> => {};
	const lockedStore: LockedStore = {
		load,
		save,
		replace: async (_expectedRefreshToken: string, session: CealStoredSession) => save(session),
		remove,
	};
	return {
		...commandRuntime,
		session: createCealSessionCapability({
			store: {
				load,
				save,
				remove,
				withStateLock: runWithLockedSession ?? ((action) => action(lockedStore)),
			},
			timing: commandRuntime.timing,
			now: commandRuntime.now,
			removeDiscoveryCache,
			removeReceiptSpool,
			createClientSessionClient,
		}),
	};
}

function fingerprint(publicKey: string) {
	return createHash("sha256").update(Buffer.from(publicKey, "base64url")).digest("hex");
}

function createWorld(options: TestOptions = {}): World {
	const stdout: string[] = [];
	const stderr: string[] = [];
	const saved: CealStoredSession[] = [];
	const slept: number[] = [];
	const revoked: Array<{ endpoint: string; refreshToken: string }> = [];
	const removedStores: string[] = [];
	let stored = options.storedSession ?? null;
	let clock = options.localWallClock ?? NOW;
	let monotonicClock = 0;
	const gateway = createGateway(options);

	return {
		io: { stdout: { write: (chunk: string) => stdout.push(chunk) }, stderr: { write: (chunk: string) => stderr.push(chunk) } },
		saved,
		slept,
		revoked,
		removedStores,
		storedSession: () => stored,
		readSecretCalls: 0,
		gateway,
		stdoutText: () => stdout.join(""),
		stderrText: () => stderr.join(""),
		result: () => parseYamlish(stdout.join("")),
		runtime: {
			readStoredSession: async (): Promise<CealStoredSession | null> => {
				if (options.loadFails) throw new Error("unreadable store");
				return stored;
			},
			writeStoredSession: async (session: CealStoredSession) => {
				if (options.saveFails) throw new Error("read-only store");
				stored = session;
				saved.push(session);
			},
			removeDiscoveryCache: async () => {
				removedStores.push("discovery-cache");
			},
			removeReceiptSpool: async () => {
				removedStores.push("receipt-spool");
			},
			// The Protocol binds this flow to an https origin, so the revocation an
			// identity replacement performs has no loopback server to reach. The
			// transport itself is proven against a real socket in `@corca-ai/ceal`;
			// what this seam proves is which credential this command decides to end.
			createClientSessionClient: ({ endpoint }: { endpoint: string }): CealPersonalClientSessionClient => ({
				refresh: async (_refreshToken: string): Promise<CealClientRefreshResponse> => {
					throw new Error("refresh is not part of the adoption test seam");
				},
				revoke: async (refreshToken: string): Promise<CealClientRevokeResponse> => {
					revoked.push({ endpoint, refreshToken });
					if (options.revokeDeniedCode) {
						return {
							ok: false,
							schema_version: "ceal.client_revoke_result.v1",
							error: { code: options.revokeDeniedCode, message: "denied", next_action: "none" },
						};
					}
					return { ok: true, schema_version: "ceal.client_revoke_result.v1", revoked: true };
				},
			}),
			readSecret: async () => {
				throw new Error("adoption must never read an enrollment code");
			},
			now: () => clock,
			monotonicNow: () => monotonicClock,
			sleep: async (ms: number) => {
				slept.push(ms);
				clock += ms;
				monotonicClock += ms;
			},
			createDeviceAdoptionClient: () => gateway.client,
		},
	};
}

function createGateway(options: TestOptions): GatewayState {
	const pendingPolls = options.pendingPolls ?? 0;
	const approvalRequiredPolls = options.approvalRequiredPolls ?? 0;
	const retryAfterMs = options.retryAfterMs ?? 1_000;
	const browserSessionUrl = `${ORIGIN}/adopt/verify/${encodeURIComponent("adoption:1")}`;
	const state: Omit<GatewayState, "client"> = {
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
	let approvalRemaining = approvalRequiredPolls;
	let transientFailures = options.transientPollFailures ?? 0;
	let gateway: GatewayState;

	const client: CealDeviceAdoptionClient = {
		async start(request: CealDeviceEnrollmentStartRequest): Promise<CealDeviceEnrollmentStartResult> {
			gateway.calledRoutes.start = true;
			gateway.startCount += 1;
			gateway.start = request;
			if (options.startFailureCode) throw new (await import("@corca-ai/ceal")).CealDeviceAdoptionClientError(options.startFailureCode);
			if (options.malformedStart) throw new (await import("@corca-ai/ceal")).CealDeviceAdoptionClientError("invalid_response");
			const result: CealDeviceEnrollmentStartResult = {
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
		async poll(request: CealDeviceEnrollmentPollRequest): Promise<CealDeviceEnrollmentPollResponse> {
			gateway.calledRoutes.poll = true;
			gateway.polls.push(request);
			if (transientFailures > 0) {
				transientFailures -= 1;
				throw new (await import("@corca-ai/ceal")).CealDeviceAdoptionClientError(options.transientPollCode ?? "request_timeout");
			}
			if (remaining > 0) {
				remaining -= 1;
				return { schema_version: "ceal.device_enrollment_poll_result.v1", status: "pending", retry_after_ms: retryAfterMs };
			}
			if (approvalRemaining > 0) {
				approvalRemaining -= 1;
				return { schema_version: "ceal.device_enrollment_poll_result.v1", status: "approval_required", retry_after_ms: retryAfterMs };
			}
			if (options.failWith) return { schema_version: "ceal.device_enrollment_poll_result.v1", status: "failed", code: options.failWith };
			return sealed(gateway, options);
		},
	};
	gateway = { ...state, client };
	return gateway;
}

function sealed(state: Omit<GatewayState, "client">, options: TestOptions): CealDeviceEnrollmentPollResponse {
	assert.ok(state.start);
	const payload = options.tamperPayload ? options.tamperPayload(enrollmentPayload()) : enrollmentPayload();
	const binding: CealDeviceEnrollmentDeliveryBinding = {
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

function enrollmentPayload(): EnrollmentPayload {
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
type ParseNode = { [key: string]: ParsedValue };

function parseYamlish(text: string): TestResult {
	const root: TestResult = {
		ok: false,
		status: "",
		enrollment_kind: "",
		sealed_delivery_verified: false,
		subject_ref: "",
		raw_token_visible: false,
		non_claims: [],
		session_replacement: "",
		local_derived_state_cleared: false,
		previous_session_revoked: "",
		issued_session_revoked: "",
		session_written: false,
		changed_bindings: [],
		error: { kind: "", next_action: "", message: "" },
	};
	const stack: Array<{ indent: number; node: ParseNode }> = [{ indent: -1, node: root }];
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
			const node: { [key: string]: ParsedValue } = {};
			parent[key] = node;
			stack.push({ indent, node });
			continue;
		}
		parent[key] = scalar(value);
	}
	materialize(root);
	return root;
}

function scalar(value: string): string | number | boolean | null {
	const unquoted = value.replace(/^"(.*)"$/su, "$1");
	if (unquoted === "true") return true;
	if (unquoted === "false") return false;
	if (unquoted === "null") return null;
	if (/^-?\d+$/u.test(unquoted)) return Number(unquoted);
	return unquoted;
}

function materialize(node: ParseNode): void {
	for (const [key, value] of Object.entries(node)) {
		if (isParsedRecord(value)) node[key] = materializeRecord(value);
	}
}

function materializeRecord(node: { [key: string]: ParsedValue }): ParsedValue {
	if (Array.isArray(node.__list)) return node.__list;
	for (const [key, value] of Object.entries(node)) {
		if (isParsedRecord(value)) node[key] = materializeRecord(value);
	}
	return node;
}

function isParsedRecord(value: ParsedValue): value is { [key: string]: ParsedValue } {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
