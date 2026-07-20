import type { CealDiscoveryCacheEntry } from "./discovery-cache.js";
import type { CealAgentGuideState } from "./agent-guide.js";
import type { CealLockedSessionStore, CealStoredSession } from "./profile-store.js";

export interface CealCliIo {
	stdout: { write(chunk: string): unknown };
	stderr: { write(chunk: string): unknown };
}

export interface CealCommandRuntime {
	readSecret?: () => Promise<string>;
	promptEnrollmentCode?: () => Promise<string>;
	isInteractiveTerminal?: () => boolean;
	isInputTerminal?: () => boolean;
	loadSession?: () => Promise<CealStoredSession | null>;
	saveSession?: (session: CealStoredSession) => Promise<void>;
	removeSession?: () => Promise<void>;
	withSessionStateLock?: <T>(action: (store: CealLockedSessionStore) => Promise<T>) => Promise<T>;
	// Client-local discovery-catalog cache (advisory; failures degrade to a live
	// probe). Present only when a home directory is available. See discovery-cache.ts.
	loadDiscoveryCache?: () => Promise<CealDiscoveryCacheEntry | null>;
	saveDiscoveryCache?: (entry: CealDiscoveryCacheEntry) => Promise<void>;
	removeDiscoveryCache?: () => Promise<void>;
	inspectAgentGuide?: () => CealAgentGuideState;
	registerAgentGuide?: () => CealAgentGuideState;
	/** Freshness window for a served discovery-cache entry. */
	discoveryCacheTtlMs?: number;
	nextRequestId?: () => string;
	now?: () => number;
}
