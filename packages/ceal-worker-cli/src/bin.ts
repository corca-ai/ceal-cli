#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { inspectAgentAudit, inspectAgentSessionEvents } from "./agent-audit.js";
import { createCealAgentGuideStore, detectCealAgentGuideHost } from "./agent-guide.js";
import { createCealDiscoveryCacheStore } from "./discovery-cache.js";
import { readHiddenTerminalEnrollmentCode } from "./hidden-terminal-input.js";
import { renderPlainYamlDocument, runCealCommand } from "./index.js";
import { LEASED_CONSUMER_CARRIER_ARGV, readLeasedConsumerRequest, runLeasedConsumerCarrier } from "./leased-consumer-carrier.js";
import { LEASED_CONSUMER_CONTROL_SESSION_ARGV, openLeasedConsumerControlSession, runLeasedConsumerControlSession } from "./leased-consumer-control-session.js";
import { createCealSessionStore } from "./profile-store.js";
import { createCealReceiptSpoolStore } from "./receipt-spool.js";
import { createCealStableUpdateRunner } from "./stable-update.js";

if (process.argv.slice(2).length === 1 && process.argv[2] === LEASED_CONSUMER_CARRIER_ARGV) {
	void readLeasedConsumerRequest(process.stdin)
		.then(
			(request) => runLeasedConsumerCarrier(request),
			() => ({ schema_version: "ceal.leased_consumer_call_result.v1", ok: false, status: "error", error_code: "invalid_request" }) as const,
		)
		.then(
			(result) => {
				process.stdout.write(`${JSON.stringify(result)}\n`);
				process.exitCode =
					result.error_code === "leased_consumer_call_unavailable" || result.error_code === "service_channel_unavailable" ? 3 : 2;
			},
			() => {
				process.stdout.write(
					'{"schema_version":"ceal.leased_consumer_call_result.v1","ok":false,"status":"error","error_code":"service_call_failed"}\n',
				);
				process.exitCode = 3;
			},
		);
} else if (process.argv.slice(2).length === 1 && process.argv[2] === LEASED_CONSUMER_CONTROL_SESSION_ARGV) {
	void openLeasedConsumerControlSession()
		.then((session) => runLeasedConsumerControlSession(process.stdin, session, (frame) => { process.stdout.write(frame); }))
		.then(
			() => { process.exitCode = 3; },
			() => { process.exitCode = 3; },
		);
} else {
	runPublicCli();
}

function runPublicCli(): void {
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

	// Guide registration and the transcript audit read the same host roots, so they
	// take the same overrides rather than each deciding where a host lives.
	const agentHostOverrides = { codex: process.env.CODEX_HOME, claude: process.env.CLAUDE_CONFIG_DIR };

	const agentGuide = createCealAgentGuideStore(
		process.execPath,
		process.env.HOME,
		agentHostOverrides.codex,
		agentHostOverrides.claude,
		detectCealAgentGuideHost(process.env),
	);
	const runStableUpdate = createCealStableUpdateRunner(process.execPath, process.env);

	void runCealCommand(
		process.argv.slice(2),
		{
			stdout: process.stdout,
			stderr: process.stderr,
		},
		{
			readSecret: readStdinSecret,
			promptEnrollmentCode: () => readHiddenTerminalEnrollmentCode(process.stdin, process.stderr),
			isInteractiveTerminal: () => Boolean(process.stdin.isTTY && process.stderr.isTTY && typeof process.stdin.setRawMode === "function"),
			isInputTerminal: () => Boolean(process.stdin.isTTY),
			loadSession: sessionStore ? () => sessionStore.load() : undefined,
			saveSession: sessionStore ? (session) => sessionStore.save(session) : undefined,
			removeSession: sessionStore ? () => sessionStore.remove() : undefined,
			withSessionStateLock: sessionStore ? (action) => sessionStore.withStateLock(action) : undefined,
			loadDiscoveryCache: discoveryCache ? () => discoveryCache.load() : undefined,
			saveDiscoveryCache: discoveryCache ? (entry) => discoveryCache.save(entry) : undefined,
			removeDiscoveryCache: discoveryCache ? () => discoveryCache.remove() : undefined,
			inspectAgentGuide: agentGuide ? (agent) => agentGuide.inspect(agent) : undefined,
			registerAgentGuide: agentGuide ? (agent) => agentGuide.register(agent) : undefined,
			// The append takes the spool's cross-process lock, so it is genuinely
			// async now and is not awaited here: a spool write must not delay the
			// call's own result, which is already on stdout before this runs.
			//
			// It can still delay *exit*. Nothing in this binary calls process.exit,
			// so the loop drains the append's pending poll timers before the process
			// ends — which is what keeps an uncontended receipt from being lost, and
			// what makes a wedged lock holder cost this process up to the spool's
			// bounded wait before it gives up. A crashed holder is reclaimed at once
			// via the dead-pid path, so that tail needs a *stopped* holder to appear.
			// The .catch keeps a rejected or contended write from becoming an
			// unhandled rejection.
			recordReceiptSpool: receiptSpool
				? (entry) => {
						// The swallow stays — a spool failure may not change a call's
						// result — but it now leaves a trace, so the observer can report
						// an incomplete history rather than a quietly short one.
						void receiptSpool.append(entry).catch(() => receiptSpool.recordDrop());
					}
				: undefined,
			recordReceiptSpoolDrop: receiptSpool
				? () => {
						void receiptSpool.recordDrop();
					}
				: undefined,
			loadReceiptSpool: receiptSpool ? () => receiptSpool.load() : undefined,
			removeReceiptSpool: receiptSpool ? () => receiptSpool.remove() : undefined,
			inspectAgentAudit: () => inspectAgentAudit(process.env.HOME, agentHostOverrides, Date.now()),
			inspectAgentSession: (runtimeName, sessionRef) =>
				inspectAgentSessionEvents(process.env.HOME, agentHostOverrides, runtimeName, sessionRef),
			runStableUpdate,
			executablePath: process.execPath,
			discoveryCacheTtlMs: parseCacheTtlOverride(process.env.CEAL_DISCOVERY_CACHE_TTL_MS),
			nextRequestId: () => `ceal:${randomUUID()}`,
		},
	).then(
		(code) => {
			process.exitCode = code;
		},
		() => {
			process.stdout.write(
				renderPlainYamlDocument({
					schema_version: "ceal.error.v1",
					command: "ceal",
					ok: false,
					status: "error",
					credential_context: "gateway_issued_client_session",
					error: {
						kind: "unexpected_failure",
						message: "The Ceal command could not be completed.",
						next_action: "Retry once, then inspect the installed version and Gateway reachability.",
					},
				}),
			);
			process.exitCode = 3;
		},
	);
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
