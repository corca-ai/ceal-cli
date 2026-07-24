#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { createCealAgentGuideStore } from "./agent-guide.js";
import { createCealDiscoveryCacheStore } from "./discovery-cache.js";
import { readHiddenTerminalEnrollmentCode } from "./hidden-terminal-input.js";
import { renderPlainYamlDocument, runCealCommand } from "./index.js";
import { createCealSessionStore } from "./profile-store.js";
import { createCealReceiptSpoolStore } from "./receipt-spool.js";
import { createCealStableUpdateRunner } from "./stable-update.js";

let sessionStore: ReturnType<typeof createCealSessionStore> | undefined;
try { sessionStore = createCealSessionStore(process.env.HOME); } catch { sessionStore = undefined; }

let discoveryCache: ReturnType<typeof createCealDiscoveryCacheStore> | undefined;
try { discoveryCache = createCealDiscoveryCacheStore(process.env.HOME); } catch { discoveryCache = undefined; }

let receiptSpool: ReturnType<typeof createCealReceiptSpoolStore> | undefined;
try { receiptSpool = createCealReceiptSpoolStore(process.env.HOME); } catch { receiptSpool = undefined; }

const agentGuide = createCealAgentGuideStore(process.execPath, process.env.HOME, process.env.CODEX_HOME);
const runStableUpdate = createCealStableUpdateRunner(process.execPath, process.env);

void runCealCommand(process.argv.slice(2), {
	stdout: process.stdout,
	stderr: process.stderr,
}, {
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
	inspectAgentGuide: agentGuide ? () => agentGuide.inspect() : undefined,
	registerAgentGuide: agentGuide ? () => agentGuide.register() : undefined,
	// The append is synchronous inside the async wrapper; the .catch keeps a
	// rejected spool write from becoming an unhandled rejection.
	recordReceiptSpool: receiptSpool ? (entry) => { void receiptSpool.append(entry).catch(() => {}) } : undefined,
	loadReceiptSpool: receiptSpool ? () => receiptSpool.load() : undefined,
	runStableUpdate,
	executablePath: process.execPath,
	discoveryCacheTtlMs: parseCacheTtlOverride(process.env.CEAL_DISCOVERY_CACHE_TTL_MS),
	nextRequestId: () => `ceal:${randomUUID()}`,
}).then((code) => {
	process.exitCode = code;
}, () => {
	process.stdout.write(renderPlainYamlDocument({
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
	}));
	process.exitCode = 3;
});

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
