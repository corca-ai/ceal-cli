import type { CealPersonalClientSessionClient } from "@corca-ai/ceal";
import type { CealSessionCapability } from "./cli-runtime.js";
import { ensureCurrentSessionWithDependencies, runSessionLogoutWithDependencies } from "./client-session.js";
import type { CealSessionStore } from "./profile-store.js";
import { commitEnrolledSession } from "./session-replacement.js";
import type { CealTimingRecorder } from "./timing.js";

/** Dependencies owned by the one session lifecycle capability. */
export interface CealSessionCapabilityDependencies {
	store: CealSessionStore;
	timing?: CealTimingRecorder;
	now?: () => number;
	removeDiscoveryCache?: () => Promise<void>;
	removeReceiptSpool?: () => Promise<void>;
	createClientSessionClient?: (options: { endpoint: string }) => CealPersonalClientSessionClient;
}

/**
 * Bind every session transition to one locked store owner.
 *
 * A capability is deliberately all-or-none: callers never infer lifecycle
 * support from combinations of reader and writer callbacks.
 */
export function createCealSessionCapability(dependencies: CealSessionCapabilityDependencies): CealSessionCapability {
	const capability: CealSessionCapability = {
		load: () => dependencies.store.load(),
		commitEnrolled: (incoming, force) => commitEnrolledSession(incoming, dependencies, force),
		ensureCurrent: (session, force) => ensureCurrentSessionWithDependencies(session, dependencies, force),
		logout: (io) => runSessionLogoutWithDependencies(io, dependencies),
	};
	return Object.freeze(capability);
}
