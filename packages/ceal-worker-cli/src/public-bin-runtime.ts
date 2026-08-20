import { inspectAgentAudit, inspectAgentSessionEvents } from "./agent-audit.js";
import { createCealAgentGuideStore, detectCealAgentGuideHost } from "./agent-guide.js";
import type { CealCommandRuntime } from "./cli-runtime.js";
import { createCealDiscoveryCacheStore } from "./discovery-cache.js";
import { readDevelopmentCealGuidePath, readEmbeddedCealGuideBundle } from "./embedded-guide.js";
import { readHiddenTerminalEnrollmentCode } from "./hidden-terminal-input.js";
import { runCealCommand } from "./index.js";
import { type CealSessionStore, createCealSessionStore } from "./profile-store.js";
import { createCealReceiptSpoolStore } from "./receipt-spool.js";
import { createCealSessionCapability } from "./session-capability.js";
import { sessionIdentityDiscriminator } from "./session-identity.js";
import { createCealStableUpdateRunner } from "./stable-update.js";
import { type CealTimingRecorder, finishCealTiming, startCealTiming, withCealTiming, withCealTimingSync } from "./timing.js";
import { randomUUID } from "node:crypto";

export async function runPublicCli(args: readonly string[], timing?: CealTimingRecorder): Promise<number> {
	const prepareTiming = startCealTiming(timing, "runtime_prepare");
	let sessionStore: ReturnType<typeof createCealSessionStore> | undefined;
	try {
		sessionStore = createCealSessionStore(process.env.HOME);
	} catch {
		sessionStore = undefined;
	}

	let discoveryCache: ReturnType<typeof createCealDiscoveryCacheStore> | undefined;
	try {
		discoveryCache = createCealDiscoveryCacheStore(process.env.HOME);
	} catch {
		discoveryCache = undefined;
	}

	let receiptSpool: ReturnType<typeof createCealReceiptSpoolStore> | undefined;
	try {
		receiptSpool = createCealReceiptSpoolStore(process.env.HOME);
	} catch {
		receiptSpool = undefined;
	}

	const timedSessionStore: CealSessionStore | undefined = sessionStore
		? {
				load: () => withCealTiming(timing, "session_load", () => sessionStore.load()),
				save: (stored) => withSessionStoreLockTiming(timing, (onAcquired) => sessionStore.save(stored, onAcquired)),
				remove: () => withSessionStoreLockTiming(timing, (onAcquired) => sessionStore.remove(onAcquired)),
				withStateLock: (action) => withSessionStoreLockTiming(timing, (onAcquired) => sessionStore.withStateLock(action, onAcquired)),
			}
		: undefined;
	const session = timedSessionStore
		? createCealSessionCapability({
				store: timedSessionStore,
				...(timing === undefined ? {} : { timing }),
				now: Date.now,
				...(discoveryCache === undefined ? {} : { removeDiscoveryCache: () => discoveryCache.remove() }),
				...(receiptSpool === undefined ? {} : { removeReceiptSpool: () => receiptSpool.remove() }),
			})
		: undefined;

	const agentHostOverrides = { codex: process.env.CODEX_HOME, claude: process.env.CLAUDE_CONFIG_DIR };
	const agentGuide = createCealAgentGuideStore(
		process.execPath,
		process.env.HOME,
		agentHostOverrides.codex,
		agentHostOverrides.claude,
		detectCealAgentGuideHost(process.env),
		readEmbeddedCealGuideBundle(),
		readDevelopmentCealGuidePath(),
	);
	const runStableUpdate = createCealStableUpdateRunner(process.execPath, process.env);
	const discoveryCacheTtlMs = parseCacheTtlOverride(process.env.CEAL_DISCOVERY_CACHE_TTL_MS);
	finishCealTiming(prepareTiming, "ok");

	return await runCealCommand(
		args,
		{
			stdout: process.stdout,
			stderr: process.stderr,
		},
		{
			...(timing === undefined ? {} : { timing }),
			readSecret: readStdinSecret,
			promptEnrollmentCode: () => readHiddenTerminalEnrollmentCode(process.stdin, process.stderr),
			isInteractiveTerminal: () => Boolean(process.stdin.isTTY && process.stderr.isTTY && typeof process.stdin.setRawMode === "function"),
			isOutputTerminal: () => Boolean(process.stderr.isTTY),
			isInputTerminal: () => Boolean(process.stdin.isTTY),
			...(session === undefined ? {} : { session }),
			...(discoveryCache === undefined
				? {}
				: {
						loadDiscoveryCache: () => withCealTiming(timing, "discovery_cache_load", () => discoveryCache.load()),
						saveDiscoveryCache: (entry: Parameters<NonNullable<CealCommandRuntime["saveDiscoveryCache"]>>[0]) => discoveryCache.save(entry),
						invalidateDiscoveryCache: () => discoveryCache.remove(),
					}),
			...(agentGuide === undefined
				? {}
				: {
						inspectAgentGuide: (agent: Parameters<NonNullable<CealCommandRuntime["inspectAgentGuide"]>>[0]) =>
							withCealTimingSync(timing, "guide_inspect", () => agentGuide.inspect(agent)),
						registerAgentGuide: (agent: Parameters<NonNullable<CealCommandRuntime["registerAgentGuide"]>>[0]) =>
							withCealTimingSync(timing, "guide_register", () => agentGuide.register(agent)),
					}),
			// The append takes the spool's cross-process lock, so it is genuinely
			// async and is not awaited here: a spool write must not delay the call's
			// own result, which is already on stdout before this runs.
			//
			// It can still delay *exit*. Nothing in this binary calls process.exit,
			// so the loop drains the append's pending poll timers before the process
			// ends — which is what keeps an uncontended receipt from being lost, and
			// what makes a wedged lock holder cost this process up to the spool's
			// bounded wait before it gives up. A crashed holder is reclaimed at once
			// via the dead-pid path, so that tail needs a *stopped* holder to appear.
			// The .catch keeps a rejected or contended write from becoming an
			// unhandled rejection. It leaves a drop trace so the observer reports an
			// incomplete history rather than a quietly short one.
			...(receiptSpool === undefined
				? {}
				: {
						recordReceiptSpool: (identity: string, entry: Parameters<NonNullable<CealCommandRuntime["recordReceiptSpool"]>>[1]) => {
							void withCealTiming(timing, "receipt_spool_append", () => receiptSpool.append(identity, entry)).catch(() =>
								receiptSpool.recordDrop(identity),
							);
						},
						recordReceiptSpoolDrop: (identity: string) => {
							void receiptSpool.recordDrop(identity);
						},
						...(sessionStore === undefined
							? {}
							: {
									loadReceiptSpool: async (storedSession: Parameters<NonNullable<CealCommandRuntime["loadReceiptSpool"]>>[0]) =>
										storedSession
											? withCealTiming(timing, "receipt_spool_load", () => receiptSpool.load(sessionIdentityDiscriminator(storedSession)))
											: null,
								}),
					}),
			inspectAgentAudit: () =>
				withCealTimingSync(timing, "observer_transcript_scan", () => inspectAgentAudit(process.env.HOME, agentHostOverrides, Date.now())),
			inspectAgentSession: (runtimeName, sessionRef) =>
				withCealTimingSync(timing, "observer_session_scan", () =>
					inspectAgentSessionEvents(process.env.HOME, agentHostOverrides, runtimeName, sessionRef),
				),
			runStableUpdate,
			executablePath: process.execPath,
			...(discoveryCacheTtlMs === undefined ? {} : { discoveryCacheTtlMs }),
			nextRequestId: () => `ceal:${randomUUID()}`,
		},
	);
}

async function withSessionStoreLockTiming<T>(
	timing: CealTimingRecorder | undefined,
	action: (onAcquired: () => void) => Promise<T>,
): Promise<T> {
	const span = startCealTiming(timing, "local_store_lock_wait");
	let acquired = false;
	try {
		return await action(() => {
			acquired = true;
			finishCealTiming(span, "ok");
		});
	} catch (error) {
		if (!acquired) finishCealTiming(span, "error");
		throw error;
	}
}

function parseCacheTtlOverride(value: string | undefined): number | undefined {
	if (value === undefined || !/^\d{1,9}$/u.test(value)) return undefined;
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

async function readStdinSecret(): Promise<string> {
	let value = "";
	for await (const chunk of process.stdin) {
		value += String(chunk);
		if (value.length > 4097) throw new Error("stdin_secret_too_large");
	}
	return value.replace(/\r?\n$/u, "");
}
