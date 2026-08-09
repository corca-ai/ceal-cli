import type { CealDeviceAdoptionClient, CealPersonalClientSessionClient } from "@corca-ai/ceal";
import type { CealAgentAuditState, CealAgentSessionEventsLookup } from "./agent-audit.js";
import type { CealAgentGuideHost, CealAgentGuideState } from "./agent-guide.js";
import type { CealDiscoveryCacheEntry } from "./discovery-cache.js";
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

// Progress belongs exclusively to the interactive stderr surface. The final
// result remains the one YAML document on stdout so agents never need to parse
// transient status text.
export type CealStableUpdateProgressStage = "check" | "download_install" | "verify" | "installed_readback";

export interface CealStableUpdateOptions {
	onProgress?: (stage: CealStableUpdateProgressStage) => void;
}

export interface CealCommandRuntime {
	readSecret?: () => Promise<string>;
	promptEnrollmentCode?: () => Promise<string>;
	isInteractiveTerminal?: () => boolean;
	/** Whether stderr is a human terminal suitable for transient progress text. */
	isOutputTerminal?: () => boolean;
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
	/** Clear the receipt spool and its drop count; session-derived, so logout owns it. */
	removeReceiptSpool?: () => Promise<void>;
	// The agent host is the declared `guide register <host>` route token; `status`
	// omits it and reads the default host projection plus every host's state.
	inspectAgentGuide?: (agent?: CealAgentGuideHost) => CealAgentGuideState;
	registerAgentGuide?: (agent?: CealAgentGuideHost) => CealAgentGuideState;
	// Client-local receipt spool (advisory allowlisted call-outcome metadata;
	// failures never change call behavior). See receipt-spool.ts.
	recordReceiptSpool?: (identity: string, entry: CealReceiptSpoolEntry) => void;
	/** Count one receipt that could not be spooled, so `ceal observe` can say so. */
	recordReceiptSpoolDrop?: (identity: string) => void;
	loadReceiptSpool?: (session: CealStoredSession | null) => Promise<CealReceiptSpoolState | null>;
	// Read-only agent-runtime transcript inventory plus bounded normalized
	// event summaries (ceal-audit; transcript text never surfaces). See
	// agent-audit.ts.
	inspectAgentAudit?: () => CealAgentAuditState;
	// On-demand bounded event scan for one inventoried session (Workbench
	// drill-down); null declares a rejected runtime/ref grammar.
	inspectAgentSession?: (runtime: string, sessionRef: string) => CealAgentSessionEventsLookup | null;
	runStableUpdate?: (options?: CealStableUpdateOptions) => Promise<CealStableUpdateResult>;
	/** Real executable path for managed-install observation (`ceal observe`). */
	executablePath?: string;
	/** Test/embedding hook: receives the live observer URL and a closer. */
	onObserverListening?: (handle: { url: string; close: () => Promise<void> }) => void;
	/** Freshness window for a served discovery-cache entry. */
	discoveryCacheTtlMs?: number;
	nextRequestId?: () => string;
	/**
	 * Injectable wait, so the adoption poll loop can be driven without a test
	 * spending the Gateway's own retry interval in real time. Absent in the
	 * shipped binary, which uses a real timer. The clock is the existing `now`.
	 */
	sleep?: (ms: number) => Promise<void>;
	now?: () => number;
	/**
	 * Monotonic elapsed-time source for bounded workflows. Unlike `now`, it is
	 * not compared with a timestamp issued by another machine, so NTP skew
	 * cannot turn a fresh Gateway challenge into a local expiry.
	 */
	monotonicNow?: () => number;
	/**
	 * Adoption transport factory. The Protocol requires an https origin for this
	 * flow, so a loopback test server cannot stand in for the Gateway the way it
	 * can elsewhere; the state machine is driven through this seam instead, and
	 * the transport itself is proven separately against a real socket in
	 * `@corca-ai/ceal`. Absent in the shipped binary, which builds the real one.
	 */
	createDeviceAdoptionClient?: (options: { endpoint: string }) => CealDeviceAdoptionClient;
	/**
	 * Personal client-session transport factory, for the same reason as the
	 * adoption seam above: `session adopt` binds an https Gateway origin the
	 * Protocol will not let a loopback test server stand in for, so the
	 * revocation an identity replacement performs there is otherwise unreachable
	 * from a test. Absent in the shipped binary, which builds the real one.
	 */
	createClientSessionClient?: (options: { endpoint: string }) => CealPersonalClientSessionClient;
}
