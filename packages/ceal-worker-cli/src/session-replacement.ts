import { CealPersonalClientSessionError, createCealPersonalClientSessionClient } from "@corca-ai/ceal";
import type { CealCommandRuntime } from "./cli-runtime.js";
import { CealSessionStoreError, type CealStoredSession } from "./profile-store.js";

// One home holds exactly one session (`profile-store.ts`, `~/.ceal/client-session.json`),
// so `session enroll` and `session adopt` are not only first-configuration
// commands: run against a configured host they *substitute* the identity behind
// every later `ceal call`, `ceal observe`, and receipt. They used to do it by
// writing straight over the store, which meant a different subject could take
// over a host with no refusal, no revoke of the session it displaced, and no
// cleanup of local state the displaced identity produced.
//
// This module owns that transition. The rule it enforces is the one
// `assertSessionIdentity` already enforces on the renewal edge: the identity a
// consumer reads must be the identity the operator last consented to. Renewing
// the same identity still passes with no ceremony, because that is exactly what
// the CLI's own `NOT_RENEWABLE` recovery text tells an operator to do.

/**
 * The bindings that make a stored session *this operator's*, and therefore the
 * ones whose change is a substitution rather than a renewal.
 *
 * `registration_ref` and `client_ref` are deliberately absent: they name one
 * enrollment artifact, not an identity, and a replacement code legitimately
 * mints new ones for the same subject on the same instance. Comparing them
 * would refuse the recovery path this guard exists to keep open.
 */
const IDENTITY_BINDINGS = [
	["gateway_endpoint", (session: CealStoredSession) => session.gatewayEndpoint],
	["profile_ref", (session: CealStoredSession) => session.profileRef],
	["membership_ref", (session: CealStoredSession) => session.membershipRef],
	["subject_ref", (session: CealStoredSession) => session.subjectRef],
	["instance_ref", (session: CealStoredSession) => session.instanceRef],
] as const;

/** How an accepted or refused session write disposed of the credential it displaced. */
export type CealRevokeDisposition = "revoked" | "already_unusable" | "unavailable" | "not_applicable";

export type CealSessionCommit =
	| {
			ok: true;
			/** `first_session` had nothing to displace; `same_identity` is a renewal; `replaced` consumed `--force`. */
			replacement: "first_session" | "same_identity" | "replaced";
			previousSessionRevoked: CealRevokeDisposition;
			derivedStateCleared: boolean;
	  }
	| {
			ok: false;
			reason: "identity_conflict";
			/** Named, so the operator learns *what* changed rather than that something did. */
			changedBindings: readonly string[];
			/** The session this command just caused the Gateway to issue and then refused to keep. */
			issuedSessionRevoked: CealRevokeDisposition;
	  }
	| {
			ok: false;
			reason: "store_failure";
			code: string;
			/** A replacement that already revoked the displaced session before failing to write. */
			previousSessionEnded: boolean;
	  };

interface CealSessionCommitStore {
	load(): Promise<CealStoredSession | null>;
	save(session: CealStoredSession): Promise<void>;
}

/**
 * Compare, dispose, then write. The comparison happens after the Gateway has
 * already issued `incoming` — an enrollment cannot know whose session a code
 * buys until it spends it — so a refusal revokes what it refuses rather than
 * leaving a session this host will never be able to reach again.
 */
export async function commitEnrolledSession(
	incoming: CealStoredSession,
	runtime: CealCommandRuntime,
	force: boolean,
): Promise<CealSessionCommit> {
	try {
		return await withCommitStore(runtime, async (store) => {
			const current = await store.load();
			const changed = current ? changedIdentityBindings(current, incoming) : [];
			if (current && changed.length > 0 && !force) {
				return { ok: false, reason: "identity_conflict", changedBindings: changed, issuedSessionRevoked: await revoke(incoming, runtime) };
			}
			const replacing = current !== null && changed.length > 0;
			// Whatever is displaced is ended first, renewal included: this home has
			// one slot, so a credential the store no longer names is one no local
			// command can ever revoke. It stays live at the Gateway until its TTL
			// otherwise, which is half of what this issue reported.
			const previousSessionRevoked = current ? await revoke(current, runtime) : "not_applicable";
			try {
				await store.save(incoming);
			} catch (error) {
				// The displaced session is already retired. Keeping the one that was
				// to replace it would strand a live session this host never stored
				// and can no longer name — the same orphan the refusal path avoids.
				if (current) await revoke(incoming, runtime);
				return { ok: false, reason: "store_failure", code: sessionStoreFailureCode(error), previousSessionEnded: current !== null };
			}
			// A renewal keeps the audit history of the identity it renews. Every
			// other write may inherit state from an identity that is not the one
			// being stored — the receipt spool carries no discriminator to tell them
			// apart — so it clears, first session included.
			if (current && !replacing) return { ok: true, replacement: "same_identity", previousSessionRevoked, derivedStateCleared: false };
			await clearSessionDerivedState(runtime);
			return { ok: true, replacement: replacing ? "replaced" : "first_session", previousSessionRevoked, derivedStateCleared: true };
		});
	} catch (error) {
		return { ok: false, reason: "store_failure", code: sessionStoreFailureCode(error), previousSessionEnded: false };
	}
}

/**
 * What a successful write still owes the operator beyond its own success.
 *
 * A replacement proceeds even when the displaced session's revocation could not
 * be delivered — the operator asked for the replacement and now holds a working
 * session — but the displaced one is still live at the Gateway and no local
 * command can reach it any more, so the result may not fall silent about it.
 */
export function sessionReplacementNextAction(commit: CealSessionCommit & { ok: true }, ordinary: string): string {
	return commit.previousSessionRevoked === "unavailable"
		? `The session this replaced could not be revoked and remains usable at the Gateway until it expires; report it to your organization operator. Then ${lowerFirst(ordinary)}`
		: ordinary;
}

/** What a failed write owes an operator whose previous session it already ended. */
export function endedPreviousSessionAction(ordinary: string): string {
	return `This host's previous session was revoked before the write failed, so it is gone and the enrollment did not land. ${ordinary}`;
}

function lowerFirst(value: string): string {
	return value.charAt(0).toLowerCase() + value.slice(1);
}

/** The identity bindings on which a stored session and an incoming one disagree. */
function changedIdentityBindings(current: CealStoredSession, incoming: CealStoredSession): readonly string[] {
	return IDENTITY_BINDINGS.filter(([, read]) => read(current) !== read(incoming)).map(([name]) => name);
}

/**
 * What an accepted write did to the session it displaced, in the one document
 * the command emits. `ceal session` reports the identity that is stored now; only
 * this result can say whether storing it ended another one.
 */
export function sessionReplacementFields(commit: CealSessionCommit & { ok: true }): Record<string, unknown> {
	return {
		session_replacement: commit.replacement,
		previous_session_revoked: commit.previousSessionRevoked,
		local_derived_state_cleared: commit.derivedStateCleared,
	};
}

/**
 * The refusal. It names the bindings that changed rather than reporting that
 * something did, because the operator's next move differs completely between
 * "wrong Gateway" and "this code belongs to a colleague".
 */
export function sessionIdentityConflictFields(
	changedBindings: readonly string[],
	issuedSessionRevoked: CealRevokeDisposition,
	replaceCommand: string,
): Record<string, unknown> {
	return {
		status: "conflict",
		changed_bindings: [...changedBindings],
		session_written: false,
		issued_session_revoked: issuedSessionRevoked,
		raw_token_visible: false,
		proof_level: "host_decision",
		error: {
			kind: "session_identity_conflict",
			message: `This host already holds a session for a different identity; the enrolled one differs in ${changedBindings.join(", ")}.`,
			next_action:
				issuedSessionRevoked === "revoked"
					? `Run 'ceal session' to read the identity this host keeps. To replace it deliberately, ask for a replacement code and re-run with ${replaceCommand}; the session this attempt created has been revoked.`
					: `Run 'ceal session' to read the identity this host keeps. To replace it deliberately, ask for a replacement code and re-run with ${replaceCommand}; report to your operator that the session this attempt created could not be revoked (${issuedSessionRevoked}).`,
		},
	};
}

async function withCommitStore<T>(runtime: CealCommandRuntime, action: (store: CealSessionCommitStore) => Promise<T>): Promise<T> {
	// The lock makes compare-and-write one interval, so a second local process
	// cannot slip a different identity in between the two. Hosts without it (the
	// embedding seam the suite drives) still get the comparison, just not the
	// mutual exclusion.
	if (runtime.withSessionStateLock) return runtime.withSessionStateLock(action);
	const load = runtime.loadSession;
	const save = runtime.saveSession;
	// Both commands refuse before spending a credential when either is absent, so
	// this is the type system's copy of that guard rather than a second policy.
	if (!load || !save) throw new CealSessionStoreError("home_unavailable");
	return action({ load, save });
}

/**
 * One revocation request. Its two callers differ only in how they read the
 * answer, so the request lives once and each caller owns its own reading — the
 * shape that stops one of them from quietly inheriting the other's policy.
 */
async function requestRevocation(
	session: CealStoredSession,
	runtime: CealCommandRuntime,
): Promise<{ revoked: true } | { denied: string } | { transport: string }> {
	const create = runtime.createClientSessionClient ?? createCealPersonalClientSessionClient;
	try {
		const response = await create({ endpoint: session.gatewayEndpoint }).revoke(session.refreshToken);
		return response.ok ? { revoked: true } : { denied: response.error.code };
	} catch (error) {
		return { transport: clientSessionTransportFailure(error, "revocation") };
	}
}

/**
 * Revoke a session this command is not keeping.
 *
 * A credential the Gateway has already retired is not a revocation failure: it
 * is the outcome, reached earlier. That distinction is what keeps the documented
 * recovery from a `NOT_RENEWABLE` session usable — refusing to replace a session
 * because its dead refresh token could not be revoked would strand exactly the
 * operator the recovery text is speaking to.
 */
async function revoke(session: CealStoredSession, runtime: CealCommandRuntime): Promise<CealRevokeDisposition> {
	const outcome = await requestRevocation(session, runtime);
	if ("revoked" in outcome) return "revoked";
	if ("denied" in outcome) return RETIRED_REFRESH_CODES.has(outcome.denied) ? "already_unusable" : "unavailable";
	return "unavailable";
}

const RETIRED_REFRESH_CODES: ReadonlySet<string> = new Set(["refresh_revoked", "refresh_invalid", "refresh_expired", "refresh_replayed"]);

/**
 * Revocation for `session logout`, which is stricter on purpose: a logout that
 * could not reach the Gateway keeps local state so the operator can retry, and
 * reports the reason rather than a revocation it did not perform.
 */
export async function revokeClientSession(session: CealStoredSession, runtime: CealCommandRuntime): Promise<string | null> {
	const outcome = await requestRevocation(session, runtime);
	if ("revoked" in outcome) return null;
	return "denied" in outcome ? (outcome.denied === "refresh_revoked" ? null : outcome.denied) : outcome.transport;
}

// Logout leaves no session-derived local state behind, and the receipt spool is
// session-derived: it holds this session's request refs, audit refs, capability
// and target refs for thirty days. Leaving it made `ceal observe` render a full
// month of a revoked binding's history beside `Session (absent)`, while the
// comment here claimed the opposite. A `--force` replacement inherits the same
// duty for the same reason: the spool carries no identity discriminator, so a
// spool kept across a substitution renders two subjects' history as one. Both
// stores are advisory, so neither removal may block an operation that already
// revoked — a logout that half-failed must still report the revocation it did
// perform.
export async function clearSessionDerivedState(runtime: CealCommandRuntime): Promise<void> {
	await clearAdvisoryStore(runtime.removeDiscoveryCache);
	await clearAdvisoryStore(runtime.removeReceiptSpool);
}

async function clearAdvisoryStore(remove: (() => Promise<void>) | undefined): Promise<void> {
	if (!remove) return;
	try {
		await remove();
	} catch {
		/* advisory local state: never block the operation that already revoked */
	}
}

export function clientSessionTransportFailure(error: unknown, operation: "renewal" | "revocation"): string {
	const code = error instanceof CealPersonalClientSessionError ? error.code : "request_failed";
	// The transport client deliberately cannot claim why a peer returned no
	// valid Gateway response.  Keep that uncertainty explicit at the session
	// boundary instead of presenting it as a rejected or unusable enrollment.
	if (code === "request_timeout" || code === "request_failed" || code === "invalid_response") {
		return `session_${operation}_unavailable`;
	}
	return code;
}

/** The store's own reason when it has one; anything else is a failed write. */
export function sessionStoreFailureCode(error: unknown): string {
	return error instanceof CealSessionStoreError ? error.code : "session_save_failed";
}
