import { performance } from "node:perf_hooks";
import { CealDeviceAdoptionClientError, createCealDeviceAdoptionClient } from "@corca-ai/ceal";
import {
	assertCealDeviceEnrollmentDeliveryExpectation,
	assertCealDeviceEnrollmentSealedPayloadBinding,
	assertCealDeviceEnrollmentStartExpectation,
	CEAL_DEVICE_ENROLLMENT_APPROVAL_WAIT_FEATURE,
	CEAL_DEVICE_ENROLLMENT_FEATURE,
	CEAL_DEVICE_ENROLLMENT_PROOF_SUITE,
	CEAL_DEVICE_ENROLLMENT_RECIPIENT_SUITE,
	CEAL_DEVICE_ENROLLMENT_START_SCHEMA,
	CEAL_PROTOCOL_VERSION,
	type CealDeviceEnrollmentDeliveryBinding,
	type CealDeviceEnrollmentStartResult,
	decodeCealDeviceEnrollmentSealedPayload,
	deviceEnrollmentHpkeAssociatedData,
	deviceEnrollmentHpkeInfo,
	deviceEnrollmentProofPayload,
	deviceEnrollmentPublicKeyFingerprint,
} from "@corca-ai/ceal-protocol";
import packageJson from "../package.json" with { type: "json" };
import type { CealCliIo, CealCommandRuntime } from "./cli-runtime.js";
import { generateCealDeviceProofKeyPair, signCealDeviceProof } from "./device-proof.js";
import { generateCealHpkeKeyPair, openCealHpkeMessage } from "./hpke.js";
import { parseNamedOptions } from "./named-options.js";
import { writeYaml } from "./output.js";
import type { CealStoredSession } from "./profile-store.js";
import {
	type CealRevokeDisposition,
	commitEnrolledSession,
	endedPreviousSessionAction,
	issuedSessionDispositionAction,
	sessionIdentityConflictFields,
	sessionReplacementFields,
	sessionReplacementNextAction,
} from "./session-replacement.js";
import { withCealTiming } from "./timing.js";

// `ceal session adopt`: the employee-facing verified-email device flow.
//
// It is a different state machine from `session enroll`, not another spelling
// of it. `enroll` consumes an operator-issued plaintext code, which means the
// credential exists in a form a human copies through chat or mail and an
// operator has seen. This flow never has that value: the device generates two
// key pairs, sends only their public halves, the employee verifies their own
// mailbox in a browser, and the Gateway seals the resulting session to the
// recipient public key. The only thing that can open it is the process that
// generated the private key.
//
// The ordering below is the security property, not a convenience:
//
//   1. Generate both key pairs locally. Send public keys and the address only.
//   2. Validate the pending start response — schema, origin, and both key
//      fingerprints — BEFORE presenting `browser_session_url` to anyone. An
//      unvalidated response is an attacker-chosen URL with a Gateway's tone of
//      voice, and the employee is about to type a mailbox verification into it.
//   3. Show both fingerprints so the employee compares them against the page.
//   4. Sign only the returned challenge, poll only on the Gateway's own
//      `retry_after_ms`, accept the Gateway's terminal expiry, and bound a
//      repeatedly-pending wait by one local monotonic safety limit.
//   5. Validate the sealed delivery's binding against locally retained facts
//      before decrypting, open it, then validate the decrypted payload's
//      identity against the authenticated AAD, and only then persist a session.
//
// This client never fetches the verifier URL, never submits its form, and never
// handles the mailbox token. Those belong to the browser and the employee; a
// client that could drive them would be a client that could adopt a device
// without the human, which is the whole thing this flow exists to prevent.
//
// Key custody is in-process only. The Protocol's fallback for a client that
// cannot atomically persist owner-only pending private keys and reliably remove
// them on completion, expiry, or terminal failure is to keep them in memory and
// require a fresh adoption after a restart, and that is what this does — a
// half-removed private key on disk is a worse failure than retyping a command.

const CREDENTIAL_CONTEXT = "gateway_issued_client_session" as const;
// The Gateway is authoritative for a challenge's absolute expiry: comparing
// its wall-clock timestamp to a separate device's clock can falsely reject a
// fresh confirmation when that device is skewed. This monotonic local ceiling
// only bounds a Gateway that keeps returning pending. It deliberately exceeds the
// deployed 30-minute device-registration window, so the normal terminal path
// is the Gateway's explicit `expired` response.
const MAX_LOCAL_WAIT_MS = 35 * 60 * 1000;
// Only ever used when the Gateway did not answer, so it named no interval of its
// own. A Gateway-supplied interval is still honored exactly.
const POLL_RETRY_FLOOR_MS = 1_000;

interface AdoptionOutcome {
	code: string;
	message: string;
	nextAction: string;
}

export async function adoptSession(options: readonly string[], io: CealCliIo, runtime: CealCommandRuntime): Promise<number> {
	const parsed = parseAdoptionOptions(options);
	if (!parsed.ok) {
		return writeAdoptionFailure(
			io,
			{
				code: "invalid_argument",
				message: "Usage: ceal session adopt --gateway <https-url> --email <address> [--force]",
				nextAction:
					"Run 'ceal session adopt --help', then supply the Gateway your organization published and the mailbox that received the invitation.",
			},
			2,
		);
	}
	if (!runtime.saveSession || !runtime.loadSession) {
		return writeAdoptionFailure(io, {
			code: "session_runtime_unavailable",
			message: "This host has no writable session store, so an adopted session could not be kept.",
			nextAction: "Run from a host with a home directory this user owns.",
		});
	}
	// Read the store before the employee is asked for anything. A session this
	// host cannot read is a session this command cannot decide it may replace,
	// and finding that out after a mailbox verification wastes the employee's.
	try {
		await runtime.loadSession();
	} catch {
		return writeAdoptionFailure(io, {
			code: "session_load_failed",
			message: "This host's existing session store could not be read, so an adoption could not decide what it would replace.",
			nextAction: "Run 'ceal session status' to inspect local state, then correct the reported local configuration and start again.",
		});
	}

	// Both pairs are generated once, before anything is sent, and are reused for
	// every retry inside this run. Minting a new pair after verification has
	// begun would silently invalidate the fingerprints the employee is looking
	// at on the verification page.
	const proof = generateCealDeviceProofKeyPair();
	const recipient = generateCealHpkeKeyPair();
	const proofPublicKey = base64url(proof.publicKey);
	const recipientPublicKey = base64url(recipient.publicKey);

	const client = (runtime.createDeviceAdoptionClient ?? createCealDeviceAdoptionClient)({ endpoint: parsed.gateway });
	let started: CealDeviceEnrollmentStartResult;
	try {
		started = await withCealTiming(runtime.timing, "session_adoption_start", () =>
			client.start({
				schema_version: CEAL_DEVICE_ENROLLMENT_START_SCHEMA,
				email: parsed.email,
				proof_suite: CEAL_DEVICE_ENROLLMENT_PROOF_SUITE,
				proof_public_key: proofPublicKey,
				recipient_suite: CEAL_DEVICE_ENROLLMENT_RECIPIENT_SUITE,
				recipient_public_key: recipientPublicKey,
				client: {
					name: "ceal",
					version: packageJson.version,
					protocol_version: CEAL_PROTOCOL_VERSION,
					// Ordered capability negotiation: a Gateway that does not know the
					// second marker still has the original sealed-delivery path, while a
					// Gateway enforcing the later-device limit can keep this command in a
					// bounded approval wait instead of forcing the employee to restart.
					features: [CEAL_DEVICE_ENROLLMENT_FEATURE, CEAL_DEVICE_ENROLLMENT_APPROVAL_WAIT_FEATURE],
				},
			} as Parameters<typeof client.start>[0]),
		);
	} catch (error) {
		return writeAdoptionFailure(io, transportOutcome(error, "start"));
	}

	// Nothing from `started` has been shown yet. This is the gate that decides
	// whether it ever will be.
	try {
		assertCealDeviceEnrollmentStartExpectation(started, {
			gateway_origin: parsed.origin,
			protocol_version: CEAL_PROTOCOL_VERSION,
			proof_public_key: proofPublicKey,
			recipient_public_key: recipientPublicKey,
		});
	} catch {
		return writeAdoptionFailure(io, {
			code: "start_binding_mismatch",
			message: "The Gateway's pending response did not bind this origin and these device keys.",
			nextAction: "Confirm the Gateway URL with your organization operator and start again; do not open any URL this response carried.",
		});
	}

	presentVerification(io, started, proofPublicKey, recipientPublicKey);

	const signature = base64url(signCealDeviceProof(proof.privateKey, deviceEnrollmentProofPayload(started.challenge)));
	const monotonicNow = runtime.monotonicNow ?? (() => performance.now());
	const sleep = runtime.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
	const localDeadline = monotonicNow() + MAX_LOCAL_WAIT_MS;
	let approvalWaitAnnounced = false;
	// Retained across iterations so a poll that never returned still has an
	// interval to wait, and so a run of failures is bounded by the same local
	// ceiling every other wait answers to rather than by a separate counter.
	let retryAfterMs = POLL_RETRY_FLOOR_MS;

	while (true) {
		let response: Awaited<ReturnType<typeof client.poll>>;
		try {
			response = await withCealTiming(runtime.timing, "session_adoption_poll", () =>
				client.poll({
					schema_version: "ceal.device_enrollment_poll.v1",
					registration_ref: started.registration_ref,
					nonce_ref: started.challenge.nonce_ref,
					signature,
				} as Parameters<typeof client.poll>[0]),
			);
		} catch (error) {
			// By this point the employee has already verified a mailbox in a browser
			// and may have waited out an operator approval, and the device keys exist
			// only in this process — the leaf help says so: interrupting requires a
			// fresh adoption. Ending that on one dropped connection spends the
			// human's work to report a packet. A timeout or a failed request is
			// another wait tick, bounded by the same local ceiling below; a malformed
			// response or an unusable configuration stays terminal, because retrying
			// those returns the same answer.
			const outcome = transportOutcome(error, "poll");
			if (outcome.code !== "request_timeout" && outcome.code !== "request_failed") return writeAdoptionFailure(io, outcome);
			if (monotonicNow() + retryAfterMs > localDeadline) return writeAdoptionFailure(io, waitTimeout());
			await sleep(retryAfterMs);
			continue;
		}

		if (response.status === "failed") return writeAdoptionFailure(io, failureOutcome(response.code));
		if (response.status === "sealed") {
			return await completeAdoption(io, runtime, {
				gateway: parsed.gateway,
				origin: parsed.origin,
				force: parsed.force,
				started,
				recipientPrivateKey: recipient.privateKey,
				proofPublicKey,
				recipientPublicKey,
				binding: response.binding,
				encapsulatedKey: response.encapsulated_key,
				ciphertext: response.ciphertext,
			});
		}
		// The Gateway's own interval, remembered so a later poll that returns
		// nothing at all still has one to wait.
		retryAfterMs = Math.max(response.retry_after_ms, POLL_RETRY_FLOOR_MS);
		if (response.status === "approval_required" && !approvalWaitAnnounced) {
			io.stderr.write("Mailbox verified. Waiting for operator approval. This command will continue automatically.\n");
			approvalWaitAnnounced = true;
		}

		// Only the Gateway's own interval is honored. The Gateway decides whether
		// its absolute challenge expiry has passed; a client-side cross-machine
		// wall-clock comparison would reject a valid confirmation on a skewed
		// device. The local monotonic ceiling merely prevents an unavailable
		// Gateway from keeping this process alive indefinitely.
		if (monotonicNow() + response.retry_after_ms > localDeadline) return writeAdoptionFailure(io, waitTimeout());
		await sleep(response.retry_after_ms);
	}
}

async function completeAdoption(
	io: CealCliIo,
	runtime: CealCommandRuntime,
	delivery: {
		gateway: string;
		origin: string;
		force: boolean;
		started: CealDeviceEnrollmentStartResult;
		recipientPrivateKey: Uint8Array;
		proofPublicKey: string;
		recipientPublicKey: string;
		binding: CealDeviceEnrollmentDeliveryBinding;
		encapsulatedKey: string;
		ciphertext: string;
	},
): Promise<number> {
	// Checked before decryption, against facts this process has held since
	// before the first request. A delivery for another transaction or another
	// device is refused while it is still opaque bytes.
	try {
		assertCealDeviceEnrollmentDeliveryExpectation(delivery.binding, {
			gateway_origin: delivery.origin,
			protocol_version: CEAL_PROTOCOL_VERSION,
			transaction_ref: delivery.started.transaction_ref,
			registration_ref: delivery.started.registration_ref,
			proof_public_key: delivery.proofPublicKey,
			recipient_public_key: delivery.recipientPublicKey,
		});
	} catch {
		return writeAdoptionFailure(io, {
			code: "delivery_binding_mismatch",
			message: "The sealed delivery did not belong to this transaction and these device keys.",
			nextAction: "Discard this attempt and run 'ceal session adopt' again; report the mismatch to your operator.",
		});
	}

	let opened: Uint8Array;
	try {
		opened = openCealHpkeMessage({
			recipientPrivateKey: delivery.recipientPrivateKey,
			enc: rawFromBase64url(delivery.encapsulatedKey),
			ciphertext: rawFromBase64url(delivery.ciphertext),
			info: deviceEnrollmentHpkeInfo(delivery.binding),
			aad: deviceEnrollmentHpkeAssociatedData(delivery.binding),
		});
	} catch {
		return writeAdoptionFailure(io, {
			code: "sealed_open_failed",
			message: "The sealed delivery did not authenticate under this device's key and the Gateway's own binding.",
			nextAction: "Discard this attempt and run 'ceal session adopt' again; report the failure to your operator.",
		});
	}

	// The plaintext is an ordinary successful enrollment result, never a new
	// token shape, and its durable identity must match the AAD that was already
	// authenticated. A payload that decrypts but names a different subject is
	// refused here rather than stored.
	let payload: ReturnType<typeof decodeCealDeviceEnrollmentSealedPayload>;
	try {
		payload = decodeCealDeviceEnrollmentSealedPayload(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(opened)));
		assertCealDeviceEnrollmentSealedPayloadBinding(delivery.binding, payload);
	} catch {
		return writeAdoptionFailure(io, {
			code: "sealed_payload_rejected",
			message: "The decrypted delivery was not a session this device may keep.",
			nextAction: "Discard this attempt and run 'ceal session adopt' again; report the rejection to your operator.",
		});
	}

	const stored: CealStoredSession = {
		gatewayEndpoint: delivery.gateway,
		profileRef: payload.profile_ref,
		membershipRef: payload.membership_ref,
		registrationRef: payload.registration_ref,
		clientRef: payload.client_ref,
		subjectRef: payload.subject_ref,
		instanceRef: payload.instance_ref,
		accessToken: payload.access_token,
		expiresAt: payload.expires_at,
		refreshToken: payload.refresh_token,
		refreshTokenIdleExpiresAt: payload.refresh_token_idle_expires_at,
		refreshTokenAbsoluteExpiresAt: payload.refresh_token_absolute_expires_at,
	};
	// A sealed delivery proves the Gateway meant this session for this device. It
	// does not say this host is free to give the identity behind `ceal call` away,
	// and that is a separate refusal with a separate remedy.
	const commit = await commitEnrolledSession(stored, runtime, delivery.force);
	if (!commit.ok) {
		if (commit.reason === "identity_conflict") {
			return writeAdoptionConflict(io, commit.changedBindings, commit.issuedSessionRevoked);
		}
		// Nothing is claimed as adopted here. The session existed only in memory
		// and is dropped with this process.
		const nextAction = commit.previousSessionEnded
			? endedPreviousSessionAction("adopt", adoptionCommitRecoveryAction(commit.code, commit.issuedSessionRevoked))
			: adoptionCommitRecoveryAction(commit.code, commit.issuedSessionRevoked);
		return writeAdoptionFailure(
			io,
			{
				code: commit.code,
				message: "The adopted session could not be written to this host's session store.",
				nextAction,
			},
			3,
			commit.issuedSessionRevoked,
		);
	}

	return writeYaml(io.stdout, {
		schema_version: "ceal.session_adoption.v1",
		command: "ceal",
		ok: true,
		status: "adopted",
		...sessionReplacementFields(commit),
		// Preserve the v1 literal for installed consumers. The Gateway decides
		// whether this transaction is first-device or approval-held; that richer
		// admission meaning needs its paired Protocol result contract rather than
		// a client-only rename.
		enrollment_kind: "verified_email_first_device",
		credential_context: CREDENTIAL_CONTEXT,
		gateway_endpoint: delivery.gateway,
		transaction_ref: delivery.started.transaction_ref,
		profile_ref: stored.profileRef,
		membership_ref: stored.membershipRef,
		registration_ref: stored.registrationRef,
		client_ref: stored.clientRef,
		subject_ref: stored.subjectRef,
		instance_ref: stored.instanceRef,
		expires_at: stored.expiresAt,
		proof_key_sha256: delivery.binding.proof_key_sha256,
		recipient_key_sha256: delivery.binding.recipient_key_sha256,
		delivery_generation: delivery.binding.delivery_generation,
		sealed_delivery_verified: true,
		raw_token_visible: false,
		proof_level: "host_decision",
		non_claims: [
			"This host verified the sealed delivery and stored a session; it did not verify the mailbox, which the employee did in a browser.",
			"This adoption grants only this device session. Additional devices, permission changes, and offboarding remain separately governed.",
		],
		next_action: sessionReplacementNextAction(
			commit,
			"Run 'ceal capabilities' to verify the stored session, Profile membership, and Gateway binding.",
		),
	});
}

// The one-time instruction goes to stderr because every non-help result on
// stdout is exactly one YAML document. Nothing here prints the address that was submitted, the nonce, the
// signature, or any key material — only the two fingerprints the employee is
// meant to compare, and the URL that has already been validated.
function presentVerification(io: CealCliIo, started: CealDeviceEnrollmentStartResult, proofKey: string, recipientKey: string): void {
	io.stderr.write("Ceal verified-email device adoption started.\n\n");
	io.stderr.write("Compare these fingerprints with the ones shown on the verification page:\n");
	io.stderr.write(`  proof key      ${grouped(deviceEnrollmentPublicKeyFingerprint(proofKey))}\n`);
	io.stderr.write(`  recipient key  ${grouped(deviceEnrollmentPublicKeyFingerprint(recipientKey))}\n\n`);
	io.stderr.write("If either differs, stop and report it. Do not continue.\n\n");
	io.stderr.write(`Open this page and confirm the message sent to your mailbox:\n  ${started.browser_session_url}\n\n`);
	io.stderr.write("Waiting for mailbox verification. This command will continue automatically after confirmation.\n");
}

// Fingerprints are compared by a human under mild time pressure, and 64 hex
// characters in one run is exactly the shape people skim. Grouping makes a
// mismatch in the middle survivable.
function grouped(fingerprint: string): string {
	return (fingerprint.match(/.{1,8}/gu) ?? [fingerprint]).join(" ");
}

function waitTimeout(): AdoptionOutcome {
	return {
		code: "wait_timeout",
		message: "The Gateway did not finish this adoption within the local safety window.",
		nextAction: "Check Gateway reachability and run 'ceal session adopt' again; the previous device keys are discarded.",
	};
}

function failureOutcome(code: "unsupported_feature" | "recovery_required" | "expired"): AdoptionOutcome {
	if (code === "unsupported_feature") {
		return {
			code: "unsupported_feature",
			message: "This Gateway does not offer verified-email device adoption.",
			nextAction: "Ask your operator which enrollment route this Gateway supports.",
		};
	}
	if (code === "expired") {
		return {
			code: "expired",
			message: "The verification window closed before the mailbox was confirmed.",
			nextAction: "Run 'ceal session adopt' again to start a new transaction; the previous device keys are discarded.",
		};
	}
	return {
		code: "recovery_required",
		message: "The Gateway stopped this adoption and asked for operator recovery.",
		nextAction: "Ask your operator to inspect the adoption transaction before retrying.",
	};
}

function transportOutcome(error: unknown, phase: "start" | "poll"): AdoptionOutcome {
	const code = error instanceof CealDeviceAdoptionClientError ? error.code : "request_failed";
	if (code === "invalid_response") {
		return {
			code: "malformed_response",
			message: `The Gateway's ${phase} response did not match the Protocol.`,
			nextAction: "Confirm the Gateway URL, then retry; a persistent mismatch is an operator issue, not a local one.",
		};
	}
	if (code === "request_timeout") {
		return {
			code: "request_timeout",
			message: `The Gateway did not answer the ${phase} request in time.`,
			nextAction: "Check connectivity to the Gateway and run 'ceal session adopt' again.",
		};
	}
	if (code === "invalid_configuration") {
		return {
			code: "invalid_argument",
			message: "The supplied Gateway URL or mailbox address is not one this command can use.",
			nextAction: "Supply an https Gateway URL with no credentials, query, or fragment, and a plain mailbox address.",
		};
	}
	return {
		code: "request_failed",
		message: `The ${phase} request could not be completed.`,
		nextAction: "Check connectivity to the Gateway and run 'ceal session adopt' again.",
	};
}

// Every terminal failure exits non-zero with `ok: false` and no session
// written, so a caller cannot mistake any of them for a partial success. They
// stay distinguishable by `error.kind` because their recoveries differ: an
// expiry is retried, a binding mismatch is reported.
function writeAdoptionFailure(io: CealCliIo, outcome: AdoptionOutcome, exitCode = 3, issuedSessionRevoked?: CealRevokeDisposition): number {
	writeYaml(io.stdout, {
		schema_version: "ceal.session_adoption.v1",
		command: "ceal",
		ok: false,
		status: outcome.code === "expired" ? "expired" : "error",
		enrollment_kind: "verified_email_first_device",
		credential_context: CREDENTIAL_CONTEXT,
		session_written: false,
		...(issuedSessionRevoked === undefined ? {} : { issued_session_revoked: issuedSessionRevoked }),
		raw_token_visible: false,
		error: { kind: outcome.code, message: outcome.message, next_action: outcome.nextAction },
	});
	return exitCode;
}

function adoptionCommitRecoveryAction(reason: string, issuedSessionRevoked: CealRevokeDisposition): string {
	const local =
		reason === "refresh_busy"
			? "Wait briefly for the other local Ceal process to finish."
			: "Check the local Ceal state directory and its permissions.";
	return `${issuedSessionDispositionAction(issuedSessionRevoked)} ${local} Then run 'ceal session adopt' again to start a fresh adoption transaction.`;
}

// Distinct from every outcome above: the Gateway did its part, and this host
// refused. `session_written: false` is the same claim the other failures make,
// so a caller that already branches on it needs no new rule to stay correct.
function writeAdoptionConflict(io: CealCliIo, changedBindings: readonly string[], issuedSessionRevoked: CealRevokeDisposition): number {
	writeYaml(io.stdout, {
		schema_version: "ceal.session_adoption.v1",
		command: "ceal",
		ok: false,
		enrollment_kind: "verified_email_first_device",
		credential_context: CREDENTIAL_CONTEXT,
		...sessionIdentityConflictFields(changedBindings, issuedSessionRevoked, "adopt"),
	});
	return 3;
}

function parseAdoptionOptions(
	options: readonly string[],
): { ok: true; gateway: string; origin: string; email: string; force: boolean } | { ok: false } {
	const parsed = parseNamedOptions(options, new Set(["--gateway", "--email"]), new Set(["--force"]));
	if (!parsed || parsed.operands.length > 0) return { ok: false };
	const gateway = parsed.values.get("--gateway");
	const email = parsed.values.get("--email");
	if (typeof gateway !== "string" || typeof email !== "string") return { ok: false };
	const origin = gatewayOrigin(gateway);
	if (!origin) return { ok: false };
	return { ok: true, gateway, origin, email, force: parsed.flags.has("--force") };
}

// The origin is what the Protocol binds every later check to, so it is derived
// once from the URL the operator published rather than read back out of any
// Gateway response.
function gatewayOrigin(value: string): string | null {
	try {
		const url = new URL(value);
		if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
		return url.origin;
	} catch {
		return null;
	}
}

function base64url(raw: Uint8Array): string {
	return Buffer.from(raw).toString("base64url");
}

function rawFromBase64url(value: string): Uint8Array {
	return new Uint8Array(Buffer.from(value, "base64url"));
}
