import type { CealDiscoveryCacheEntry } from "./discovery-cache.js";
import type { CealAgentGuideState } from "./agent-guide.js";
import type { CealLockedSessionStore, CealStoredSession } from "./profile-store.js";
import type { CealReceiptSpoolEntry, CealReceiptSpoolState } from "./receipt-spool.js";

export interface CealCliIo {
	stdout: { write(chunk: string): unknown };
	stderr: { write(chunk: string): unknown };
}

export type CealWorkerPlatform = "linux-arm64" | "linux-amd64" | "darwin-arm64" | "darwin-amd64";

export interface CealStableUpdateResult {
	status: "updated" | "unchanged" | "unavailable";
	previous_version?: string;
	installed_version?: string;
	platform?: CealWorkerPlatform;
	artifact_sha256?: string;
	elapsed_ms?: number;
	error?: {
		kind: "update_unavailable" | "update_failed" | "update_readback_failed";
		message: string;
		next_action: string;
	};
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
	// Client-local receipt spool (advisory allowlisted call-outcome metadata;
	// failures never change call behavior). See receipt-spool.ts.
	recordReceiptSpool?: (entry: CealReceiptSpoolEntry) => void;
	loadReceiptSpool?: () => Promise<CealReceiptSpoolState | null>;
	runStableUpdate?: () => Promise<CealStableUpdateResult>;
	/** Real executable path for managed-install observation (`ceal observe`). */
	executablePath?: string;
	/** Test/embedding hook: receives the live observer URL and a closer. */
	onObserverListening?: (handle: { url: string; close: () => Promise<void> }) => void;
	/** Freshness window for a served discovery-cache entry. */
	discoveryCacheTtlMs?: number;
	nextRequestId?: () => string;
	now?: () => number;
}
