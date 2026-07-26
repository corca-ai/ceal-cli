import type { CealClientRefreshResult } from "@corca-ai/ceal-protocol";
import {
	CealEnrollmentClientError,
	CealPersonalClientSessionError,
	createCealEnrollmentClient,
	createCealPersonalClientSessionClient,
} from "@corca-ai/ceal";
import type { CealCliIo, CealCommandRuntime } from "./cli-runtime.js";
import { parseNamedOptions } from "./named-options.js";
import { splitSubcommandRoute } from "./subcommands.js";
import { writeYaml } from "./output.js";
import { CealSessionStoreError } from "./profile-store.js";
import type { CealStoredSession } from "./profile-store.js";

const CREDENTIAL_CONTEXT = "gateway_issued_client_session" as const;

export async function runSession(options: readonly string[], io: CealCliIo, runtime: CealCommandRuntime): Promise<number> {
	// Both session routes are resolved from the declared subcommand table, so the
	// routes help advertises and the routes this runner accepts cannot diverge.
	const { subcommand, rest } = splitSubcommandRoute("session", options);
	if (!subcommand) return options.length === 0 ? showSession(io, runtime) : writeEnrollmentInvalidArgument(io);
	if (subcommand.route[0] === "logout") {
		return rest.length === 0 ? runSessionLogout(io, runtime) : writeEnrollmentInvalidArgument(io);
	}
	return enrollSession(rest, io, runtime);
}

async function showSession(io: CealCliIo, runtime: CealCommandRuntime): Promise<number> {
	let session: CealStoredSession | null;
	try { session = runtime.loadSession ? await runtime.loadSession() : null; }
	catch { return writeEnrollmentUnavailable("session_load_failed", io); }
	const now = runtime.now?.() ?? Date.now();
	return writeYaml(io.stdout, session ? configuredSessionSummary(session, now) : unconfiguredSessionSummary());
}

function configuredSessionSummary(session: CealStoredSession, now: number): Record<string, unknown> {
	return {
		schema_version: "ceal.client_session.v1", command: "ceal", ok: true, status: "configured",
		gateway_endpoint: session.gatewayEndpoint, profile_ref: session.profileRef,
		membership_ref: session.membershipRef, registration_ref: session.registrationRef, client_ref: session.clientRef,
		subject_ref: session.subjectRef, instance_ref: session.instanceRef, expires_at: session.expiresAt,
		access_status: Date.parse(session.expiresAt) > now ? "current" : "expired",
		// A stored refresh credential is necessary but does not prove a live
		// Gateway renewal.  Advertising it as "available" made an expired client
		// look healthy precisely when an operator needed to distinguish the two.
		renewal_configured: true,
		renewal_status: "not_checked",
		refresh_token_idle_expires_at: session.refreshTokenIdleExpiresAt,
		refresh_token_absolute_expires_at: session.refreshTokenAbsoluteExpiresAt,
		raw_token_visible: false, proof_level: "local_state",
		next_action: "Run 'ceal capabilities' to verify live Gateway access.",
	};
}

function unconfiguredSessionSummary(): Record<string, unknown> {
	return {
		schema_version: "ceal.client_session.v1", command: "ceal", ok: true, status: "unconfigured",
		gateway_endpoint: null, profile_ref: null, membership_ref: null, registration_ref: null, client_ref: null,
		subject_ref: null, instance_ref: null, expires_at: null, access_status: null,
		renewal_configured: false, renewal_status: "not_configured",
		refresh_token_idle_expires_at: null, refresh_token_absolute_expires_at: null,
		raw_token_visible: false, proof_level: "local_state", next_action: "Run 'ceal session enroll --help'.",
	};
}

async function enrollSession(options: readonly string[], io: CealCliIo, runtime: CealCommandRuntime): Promise<number> {
	const parsed = parseEnrollmentOptions(options);
	if (!parsed.ok) return writeEnrollmentInvalidArgument(io);
	if (!runtime.saveSession) return writeEnrollmentUnavailable("session_runtime_unavailable", io);
	const code = await readEnrollmentCode(parsed.input, runtime);
	if (!code.ok) return writeEnrollmentUnavailable(code.error, io);
	try {
		const response = await createCealEnrollmentClient({ endpoint: parsed.gateway }).exchange(code.value);
		if (!response.ok) return writeEnrollmentRejected(response.error.code, io);
		const stored = toStoredSession(parsed.gateway, response);
		await runtime.saveSession(stored);
		return writeEnrollmentSuccess(parsed.gateway, stored, io);
	} catch (error) {
		const reason = error instanceof CealEnrollmentClientError ? error.code : "session_save_failed";
		return writeEnrollmentUnavailable(reason, io);
	}
}

async function readEnrollmentCode(input: "stdin" | "interactive", runtime: CealCommandRuntime): Promise<{ ok: true; value: string } | { ok: false; error: string }> {
	if (input === "stdin" && runtime.isInputTerminal?.()) return { ok: false, error: "stdin_enrollment_requires_pipe" };
	const reader = enrollmentCodeReader(input, runtime);
	if (!reader) return { ok: false, error: input === "interactive" ? "interactive_enrollment_required" : "session_runtime_unavailable" };
	try { return { ok: true, value: await reader() }; }
	catch { return { ok: false, error: "enrollment_code_input_failed" }; }
}

function enrollmentCodeReader(input: "stdin" | "interactive", runtime: CealCommandRuntime): (() => Promise<string>) | undefined {
	if (input === "stdin") return runtime.readSecret;
	return runtime.isInteractiveTerminal?.() ? runtime.promptEnrollmentCode : undefined;
}

function toStoredSession(gatewayEndpoint: string, response: {
	profile_ref: string; membership_ref: string; registration_ref: string; client_ref: string; subject_ref: string;
	instance_ref: string; access_token: string; expires_at: string; refresh_token: string;
	refresh_token_idle_expires_at: string; refresh_token_absolute_expires_at: string;
}): CealStoredSession {
	return {
		gatewayEndpoint, profileRef: response.profile_ref, membershipRef: response.membership_ref,
		registrationRef: response.registration_ref, clientRef: response.client_ref, subjectRef: response.subject_ref,
		instanceRef: response.instance_ref, accessToken: response.access_token, expiresAt: response.expires_at,
		refreshToken: response.refresh_token, refreshTokenIdleExpiresAt: response.refresh_token_idle_expires_at,
		refreshTokenAbsoluteExpiresAt: response.refresh_token_absolute_expires_at,
	};
}

function writeEnrollmentSuccess(gateway: string, response: ReturnType<typeof toStoredSession>, io: CealCliIo): number {
	return writeYaml(io.stdout, {
		schema_version: "ceal.session_enrollment.v1", command: "ceal", ok: true, status: "enrolled",
		enrollment_kind: "preapproved_client_device",
		gateway_endpoint: gateway, profile_ref: response.profileRef, membership_ref: response.membershipRef,
		registration_ref: response.registrationRef, client_ref: response.clientRef, subject_ref: response.subjectRef,
		instance_ref: response.instanceRef, expires_at: response.expiresAt,
		renewal_configured: true,
		renewal_status: "not_checked",
		refresh_token_idle_expires_at: response.refreshTokenIdleExpiresAt,
		refresh_token_absolute_expires_at: response.refreshTokenAbsoluteExpiresAt,
		raw_token_visible: false, proof_level: "host_decision",
		next_action: "Run 'ceal capabilities' to verify the stored session, Profile membership, and Gateway binding.",
	});
}

async function runSessionLogout(io: CealCliIo, runtime: CealCommandRuntime): Promise<number> {
	if (!runtime.loadSession || !runtime.removeSession) return writeEnrollmentUnavailable("session_runtime_unavailable", io);
	if (runtime.withSessionStateLock) return runtime.withSessionStateLock(async (store) => {
		const session = await store.load();
		if (!session) return writeAlreadyLoggedOut(io);
		const revokeFailure = await revokeClientSession(session);
		if (revokeFailure) return writeClientSessionUnavailable(revokeFailure, io);
		await store.remove();
		await clearDiscoveryCache(runtime);
		return writeLoggedOut(io);
	}).catch((error) => writeClientSessionUnavailable(sessionStoreFailureCode(error), io));
	let session: CealStoredSession | null;
	try { session = await runtime.loadSession(); } catch { return writeEnrollmentUnavailable("session_load_failed", io); }
	if (!session) return writeAlreadyLoggedOut(io);
	const revokeFailure = await revokeClientSession(session);
	if (revokeFailure) return writeClientSessionUnavailable(revokeFailure, io);
	try { await runtime.removeSession(); } catch { return writeClientSessionUnavailable("session_remove_failed", io); }
	await clearDiscoveryCache(runtime);
	return writeLoggedOut(io);
}

function writeAlreadyLoggedOut(io: CealCliIo): number {
	return writeYaml(io.stdout, {
		schema_version: "ceal.session_logout.v1", command: "ceal", ok: true, status: "already_logged_out",
		server_session_revoked: false, local_session_removed: false, raw_token_visible: false,
		proof_level: "local_state", next_action: "Run 'ceal session enroll --help' to configure a session.",
	});
}

async function revokeClientSession(session: CealStoredSession): Promise<string | null> {
	try {
		const response = await createCealPersonalClientSessionClient({ endpoint: session.gatewayEndpoint }).revoke(session.refreshToken);
		return !response.ok && response.error.code !== "refresh_revoked" ? response.error.code : null;
	} catch (error) {
		return clientSessionTransportFailure(error, "revocation");
	}
}

// Logout leaves no session-derived local state behind. The discovery cache is
// advisory, so a removal failure must never block a successful logout.
async function clearDiscoveryCache(runtime: CealCommandRuntime): Promise<void> {
	if (!runtime.removeDiscoveryCache) return;
	try { await runtime.removeDiscoveryCache(); } catch { /* advisory cache: ignore */ }
}

function writeLoggedOut(io: CealCliIo): number {
	return writeYaml(io.stdout, {
		schema_version: "ceal.session_logout.v1", command: "ceal", ok: true, status: "logged_out",
		server_session_revoked: true, local_session_removed: true, raw_token_visible: false,
		proof_level: "host_decision",
		next_action: "Run 'ceal session enroll --help' to configure another session.",
	});
}

export class CealClientSessionError extends Error {
	constructor(readonly code: string) { super("Ceal client session unavailable."); }
}

export async function ensureCurrentSession(session: CealStoredSession, runtime: CealCommandRuntime, force = false): Promise<CealStoredSession> {
	const now = runtime.now?.() ?? Date.now();
	if (!force && sessionIsCurrent(session, now)) return session;
	if (runtime.withSessionStateLock && runtime.loadSession) {
		try {
			return await runtime.withSessionStateLock(async (store) => {
				const current = await store.load();
				if (!current) throw new CealClientSessionError("reenrollment_required");
				assertSessionIdentity(current, session);
				const refreshForced = force && current.refreshToken === session.refreshToken;
				return renewSession(current, now, refreshForced, async (rotated) => store.replace(current.refreshToken, rotated));
			});
		} catch (error) {
			if (error instanceof CealClientSessionError) throw error;
			throw new CealClientSessionError(sessionStoreFailureCode(error));
		}
	}
	if (!runtime.saveSession) throw new CealClientSessionError("reenrollment_required");
	return renewSession(session, now, force, runtime.saveSession);
}

async function renewSession(
	session: CealStoredSession,
	now: number,
	force: boolean,
	save: (session: CealStoredSession) => Promise<void>,
): Promise<CealStoredSession> {
	if (!force && sessionIsCurrent(session, now)) return session;
	const refresh = requireRefreshContext(session, now);
	const response = await refreshSession(session, refresh);
	if (!response.ok) throw new CealClientSessionError(response.error.code);
	assertSessionBindings(session, response);
	const rotated = rotatedSession(session, response);
	await save(rotated);
	return rotated;
}

function sessionIsCurrent(session: CealStoredSession, now: number): boolean {
	return Date.parse(session.expiresAt) > now + 60_000;
}

function requireRefreshContext(session: CealStoredSession, now: number): string {
	const expiresAt = Date.parse(session.refreshTokenAbsoluteExpiresAt);
	if (!Number.isFinite(expiresAt) || expiresAt <= now) {
		throw new CealClientSessionError("refresh_expired");
	}
	return session.refreshToken;
}

async function refreshSession(session: CealStoredSession, refreshToken: string) {
	try {
		return await createCealPersonalClientSessionClient({ endpoint: session.gatewayEndpoint }).refresh(refreshToken);
	} catch (error) {
		throw new CealClientSessionError(clientSessionTransportFailure(error, "renewal"));
	}
}

function clientSessionTransportFailure(error: unknown, operation: "renewal" | "revocation"): string {
	const code = error instanceof CealPersonalClientSessionError ? error.code : "request_failed";
	// The transport client deliberately cannot claim why a peer returned no
	// valid Gateway response.  Keep that uncertainty explicit at the session
	// boundary instead of presenting it as a rejected or unusable enrollment.
	if (code === "request_timeout" || code === "request_failed" || code === "invalid_response") {
		return `session_${operation}_unavailable`;
	}
	return code;
}

function assertSessionBindings(session: CealStoredSession, response: CealClientRefreshResult): void {
	const bindings = [
		[response.profile_ref, session.profileRef], [response.membership_ref, session.membershipRef],
		[response.registration_ref, session.registrationRef], [response.client_ref, session.clientRef],
		[response.subject_ref, session.subjectRef], [response.instance_ref, session.instanceRef],
	];
	if (bindings.some(([actual, expected]) => actual !== expected)) throw new CealClientSessionError("binding_changed");
}

function assertSessionIdentity(current: CealStoredSession, expected: CealStoredSession): void {
	const bindings = [
		[current.gatewayEndpoint, expected.gatewayEndpoint], [current.profileRef, expected.profileRef],
		[current.membershipRef, expected.membershipRef], [current.registrationRef, expected.registrationRef],
		[current.clientRef, expected.clientRef], [current.subjectRef, expected.subjectRef], [current.instanceRef, expected.instanceRef],
	];
	if (bindings.some(([actual, expectedValue]) => actual !== expectedValue)) throw new CealClientSessionError("binding_changed");
}

function sessionStoreFailureCode(error: unknown): string {
	return error instanceof CealSessionStoreError ? error.code : "session_save_failed";
}

function rotatedSession(session: CealStoredSession, response: CealClientRefreshResult): CealStoredSession {
	return {
		...session, accessToken: response.access_token, expiresAt: response.expires_at,
		refreshToken: response.refresh_token,
		refreshTokenIdleExpiresAt: response.refresh_token_idle_expires_at,
		refreshTokenAbsoluteExpiresAt: response.refresh_token_absolute_expires_at,
	};
}

export function writeClientSessionUnavailable(reason: string, io: CealCliIo): number {
	const failure = classifyClientSessionFailure(reason);
	writeYaml(io.stdout, {
		schema_version: "ceal.client_session.v1", command: "ceal", ok: false, status: "unavailable",
		credential_context: CREDENTIAL_CONTEXT, proof_level: "surface", raw_token_visible: false,
		error: {
			kind: failure.kind,
			retryable: failure.retryable,
			message: failure.message,
			next_action: failure.nextAction,
		},
	});
	return 3;
}

interface ClientSessionFailureDisposition {
	retryable: boolean;
	message: string;
	nextAction: string;
}

// A session whose refresh credential can no longer produce a session: the local
// state is intact but useless, and only a new enrollment moves it forward.
const NOT_RENEWABLE: ClientSessionFailureDisposition = {
	retryable: false,
	message: "The stored Gateway session can no longer be renewed.",
	nextAction: "Ask the organization administrator for a replacement device-enrollment code, then run 'ceal session enroll --help'.",
};

/**
 * Every Gateway denial reason this command surface classifies.
 *
 * `classifyClientSessionFailure` and `isClassifiedClientSessionFailure` both
 * derive from this one table. They used to keep two hand-maintained lists, and
 * the second one gates whether `call` and `receipt` attach the classification at
 * all — so a reason added to the classifier but forgotten in the membership list
 * rendered correctly under `ceal session` while `ceal call` fell through to the
 * unknown-outcome path and emitted a write caution plus an `outcome_unknown`
 * receipt for a call the Gateway provably never issued. One table cannot desync.
 */
const CLIENT_SESSION_FAILURES: Readonly<Record<string, ClientSessionFailureDisposition>> = {
	session_renewal_unavailable: {
		retryable: true,
		message: "The Gateway did not return a usable response while renewing the stored session.",
		nextAction: "Wait briefly, then retry the same command. This does not establish that the enrollment or refresh credential is invalid.",
	},
	session_revocation_unavailable: {
		retryable: true,
		message: "The Gateway did not return a usable response while revoking the stored session.",
		nextAction: "Wait briefly, then retry 'ceal session logout'. Keep the local session until Gateway revocation succeeds.",
	},
	refresh_busy: {
		retryable: true,
		message: "Another local Ceal process is changing this session.",
		nextAction: "Wait briefly, then retry the same command.",
	},
	refresh_expired: NOT_RENEWABLE,
	refresh_invalid: NOT_RENEWABLE,
	refresh_replayed: NOT_RENEWABLE,
	refresh_revoked: NOT_RENEWABLE,
	reenrollment_required: NOT_RENEWABLE,
	binding_changed: NOT_RENEWABLE,
};

// An unclassified reason is still reported, but its token is not echoed into the
// public `kind` field unless it looks like one of our own reason codes: `kind` is
// a contract field readers branch on, and a Gateway-supplied string of arbitrary
// shape does not belong in it.
const UNCLASSIFIED_REASON_KIND = "session_unusable";
const SAFE_REASON_TOKEN = /^[a-z][a-z0-9_]{0,63}$/u;

export function classifyClientSessionFailure(reason: string): { kind: string; retryable: boolean; message: string; nextAction: string } {
	const disposition = Object.hasOwn(CLIENT_SESSION_FAILURES, reason) ? CLIENT_SESSION_FAILURES[reason] : undefined;
	if (disposition) return { kind: reason, ...disposition };
	return {
		kind: SAFE_REASON_TOKEN.test(reason) ? reason : UNCLASSIFIED_REASON_KIND,
		retryable: false,
		message: "The stored Gateway session could not be used safely.",
		nextAction: "Run 'ceal session' to inspect local state, then correct the reported local configuration or ask the organization administrator for a replacement device-enrollment code.",
	};
}

export function isClassifiedClientSessionFailure(reason: string): boolean {
	return Object.hasOwn(CLIENT_SESSION_FAILURES, reason);
}

/** The classified reasons, for tests that must prove both readers agree. */
export function classifiedClientSessionFailureReasons(): readonly string[] {
	return Object.keys(CLIENT_SESSION_FAILURES);
}

function parseEnrollmentOptions(options: readonly string[]): { ok: true; gateway: string; input: "interactive" | "stdin" } | { ok: false } {
	const parsed = parseNamedOptions(options, new Set(["--gateway"]), new Set(["--code-stdin"]));
	const gateway = parsed?.values.get("--gateway");
	if (parsed?.operands.length !== 0 || !gateway) return { ok: false };
	return { ok: true, gateway, input: parsed.flags.has("--code-stdin") ? "stdin" : "interactive" };
}

function writeEnrollmentInvalidArgument(io: CealCliIo): number {
	writeYaml(io.stdout, {
		schema_version: "ceal.error.v1", command: "ceal", ok: false, status: "error",
		credential_context: CREDENTIAL_CONTEXT,
		error: { kind: "invalid_argument", message: "Invalid session enrollment options.", next_action: "Run 'ceal --help'." },
	});
	return 2;
}

function writeEnrollmentRejected(code: string, io: CealCliIo): number {
	writeYaml(io.stdout, {
		schema_version: "ceal.session_enrollment.v1",
		command: "ceal",
		ok: false,
		status: "denied",
		proof_level: "host_decision",
		error: {
			kind: code,
			message: "The Gateway rejected the device-enrollment code.",
			next_action: "Ask the organization administrator to confirm approved access and issue a replacement device-enrollment code.",
		},
	});
	return 3;
}

function writeEnrollmentUnavailable(reason: string, io: CealCliIo): number {
	writeYaml(io.stdout, {
		schema_version: "ceal.session_enrollment.v1",
		command: "ceal",
		ok: false,
		status: "unavailable",
		proof_level: "surface",
		error: {
			kind: reason,
			message: "The device enrollment could not be completed.",
			next_action: enrollmentRecoveryAction(reason),
		},
	});
	return 3;
}

function enrollmentRecoveryAction(reason: string): string {
	if (reason === "interactive_enrollment_required") {
		return "Run this command from a terminal that supports hidden input, or use --code-stdin only from approved non-interactive automation.";
	}
	if (reason === "stdin_enrollment_requires_pipe") {
		return "Omit '--code-stdin' and enter the code at the hidden prompt, or pipe it only from approved non-interactive automation.";
	}
	return "Check the Gateway URL, then ask the organization administrator for a replacement device-enrollment code.";
}
