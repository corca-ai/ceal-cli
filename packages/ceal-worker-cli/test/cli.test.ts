import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import type { CealPersonalClientSessionClient } from "@corca-ai/ceal";
import type { CealGatewayDiscoveryCapability, CealGatewayTargetCatalog } from "@corca-ai/ceal-protocol";
import { parseAllDocuments } from "yaml";
import { requiredCapture, required as requiredValue } from "../../../test/required.ts";
import {
	buildAcceptanceRecord,
	type CealAcceptanceRecordParts,
	type CealInstalledReleaseReading,
	readInstalledReleaseFacts,
} from "../dist/acceptance-record.js";
import { type CealAgentGuideHost, type CealAgentGuideState, isCealAgentGuideHost } from "../dist/agent-guide.js";
import { classifyGatewayFailure, writeCallCompleted, writeCallGatewayFailure } from "../dist/call-result-output.js";
import type { CealStableUpdateProgressStage } from "../dist/cli-runtime.js";
import type { CealDiscoveryCacheEntry } from "../dist/discovery-cache.js";
import type { CealCommandRuntime } from "../dist/index.js";
import {
	CEAL_COMMANDS,
	CEAL_SUBCOMMANDS,
	classifyUnsupportedTargetSelector,
	dispatchedRouteKeys,
	renderPlainYamlDocument,
	resolveSubcommandRoute,
	runCealCommand,
	splitSubcommandRoute,
	subcommandRouteKey,
} from "../dist/index.js";
import { type CealSessionStore, CealSessionStoreError, type CealStoredSession } from "../dist/profile-store.js";
import type { CealReceiptSpoolEntry } from "../dist/receipt-spool.js";
import { createCealSessionCapability } from "../dist/session-capability.js";
import type { CealCommandName, CealSubcommandHandlers } from "../dist/subcommands.js";
import { CEAL_TIMING_STAGES, type CealTimingStage, createCealTimingRecorder } from "../dist/timing.js";
import { deferredVoid } from "./deferred-test-support.ts";

// The version the worker introduces itself to the Gateway with is derived from
// the manifest, so asserting a literal here would reintroduce the hand-bumped
// copy this suite exists to prevent.
const WORKER_PACKAGE_VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

// Both source sweeps below assert that nothing bad exists, so under-scanning
// reads as a pass. `readdirSync` was not recursive, which made the first
// `src/` subdirectory a silent hole; the file count is asserted for the same
// reason, because an empty scan would satisfy every sweep trivially.
function workerSource(): string {
	const entries = readdirSync(new URL("../src", import.meta.url), { recursive: true }).filter((entry) => String(entry).endsWith(".ts"));
	assert.ok(entries.length > 10, `only ${entries.length} source files scanned; the sweep is not reaching src/`);
	return entries.map((entry) => readFileSync(new URL(`../src/${entry}`, import.meta.url), "utf8")).join("\n");
}

// Extract each `error: { … }` body by matching braces rather than stopping at the
// first `}`. Three of the emitted error objects interpolate a template, whose `}`
// closed the old regex early — so the sweep read a prefix, and a `code` key after
// an interpolation would have passed unseen.
function errorObjectBodies(source: string): string[] {
	const bodies: string[] = [];
	for (const match of source.matchAll(/error:\s*\{/gu)) {
		let depth = 1;
		let index = match.index + match[0].length;
		const start = index;
		while (index < source.length && depth > 0) {
			if (source[index] === "{") depth += 1;
			else if (source[index] === "}") depth -= 1;
			index += 1;
		}
		assert.equal(depth, 0, `unbalanced error object near offset ${match.index}`);
		bodies.push(source.slice(start, index - 1));
	}
	return bodies;
}

// Read the child routes a parent leaf advertises, bounded to its own block.
function advertisedSubcommands(help: string): string[] {
	const lines = help.split("\n");
	const start = lines.indexOf("Subcommands:");
	if (start < 0) return [];
	const rows: string[] = [];
	for (const line of lines.slice(start + 1)) {
		if (line === "") break;
		const match = /^ {2}([a-z][a-z0-9-]*(?: [a-z][a-z0-9-]*)*)\s{2,}\S/u.exec(line);
		if (match) rows.push(requiredCapture(match, 1, "advertised_subcommand"));
	}
	return rows;
}

async function run(args: readonly string[], runtime: TestRuntime = {}): Promise<{ code: number; stdout: string; stderr: string }> {
	let stdout = "";
	let stderr = "";
	const code = await runCealCommand(
		args,
		{
			stdout: {
				write: (chunk: string) => {
					stdout += String(chunk);
				},
			},
			stderr: {
				write: (chunk) => {
					stderr += String(chunk);
				},
			},
		},
		prepareRuntime(runtime),
	);
	return { code, stdout, stderr };
}

type TestRuntime = CealCommandRuntime & {
	readStoredSession?: () => Promise<CealStoredSession | null>;
	writeStoredSession?: (session: CealStoredSession) => Promise<void>;
	deleteStoredSession?: () => Promise<void>;
	runWithLockedSession?: CealSessionStore["withStateLock"];
	removeDiscoveryCache?: () => Promise<void>;
	removeReceiptSpool?: () => Promise<void>;
	createClientSessionClient?: (options: { endpoint: string }) => CealPersonalClientSessionClient;
};

function requireStoredSession(value: CealStoredSession | null): CealStoredSession {
	assert.ok(value);
	return value;
}

function prepareRuntime(runtime: TestRuntime): CealCommandRuntime {
	const {
		readStoredSession,
		writeStoredSession,
		deleteStoredSession,
		runWithLockedSession,
		removeDiscoveryCache,
		removeReceiptSpool,
		createClientSessionClient,
		...commandRuntime
	} = runtime;
	if (!readStoredSession && !writeStoredSession && !deleteStoredSession && !runWithLockedSession) return commandRuntime;
	const load = readStoredSession ?? (async () => null);
	const save =
		writeStoredSession ??
		(async () => {
			throw new CealSessionStoreError("home_unavailable");
		});
	const remove = deleteStoredSession ?? (async () => {});
	const lockedStore = {
		load,
		save,
		replace: async (_expectedRefreshToken: string, session: CealStoredSession) => save(session),
		remove,
	};
	const store: CealSessionStore = {
		load,
		save: async (session) => save(session),
		remove,
		withStateLock: runWithLockedSession ?? (async (action) => action(lockedStore)),
	};
	return {
		...commandRuntime,
		session: createCealSessionCapability({
			store,
			...(commandRuntime.timing === undefined ? {} : { timing: commandRuntime.timing }),
			...(commandRuntime.now === undefined ? {} : { now: commandRuntime.now }),
			...(removeDiscoveryCache === undefined ? {} : { removeDiscoveryCache }),
			...(removeReceiptSpool === undefined ? {} : { removeReceiptSpool }),
			...(createClientSessionClient === undefined ? {} : { createClientSessionClient }),
		}),
	};
}

type YamlValue = ReturnType<ReturnType<typeof parseAllDocuments>[number]["toJS"]>;

type FixtureRequestBody = {
	operation?: string;
	request_id?: string;
	capability_id?: string;
	target_ref?: string;
	arguments?: Record<string, string | number>;
	purpose?: string;
	match?: string;
	cursor?: string;
	limit?: number;
	client?: { name: string; version: string };
	[key: string]: unknown;
};
type FixtureRequest = {
	request_id: string;
	profile_ref: string;
	operation: string;
	body: FixtureRequestBody;
	code?: string;
	refresh_token?: string;
	[key: string]: unknown;
};
type FixtureSuccessResponse = {
	ok: true;
	request_id: string;
	protocol_version: string;
	proof_ref_or_unavailable?: string;
	value: Record<string, unknown>;
	[key: string]: unknown;
};
type FixtureFailureResponse = {
	ok: false;
	request_id: string;
	protocol_version: string;
	error: Record<string, unknown>;
	[key: string]: unknown;
};
type FixtureResponse = FixtureSuccessResponse | FixtureFailureResponse;

function isFixtureRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertFixtureRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
	if (!isFixtureRecord(value)) throw new Error(`${label} is not a record`);
}

function fixtureRecord(value: unknown, label: string): Record<string, unknown> {
	assertFixtureRecord(value, label);
	return value;
}

function fixtureRecordField(value: Record<string, unknown>, key: string): Record<string, unknown> {
	return fixtureRecord(value[key], `fixture field ${key}`);
}

function fixtureRecordArrayField(value: Record<string, unknown>, key: string): Record<string, unknown>[] {
	const items = value[key];
	if (!Array.isArray(items)) throw new Error(`fixture field ${key} is not an array`);
	const records: Record<string, unknown>[] = [];
	for (const item of items) records.push(fixtureRecord(item, `fixture field ${key} item`));
	return records;
}

function isCealCommandName(value: string): value is CealCommandName {
	return CEAL_COMMANDS.some((command) => command.name === value);
}

async function yamlRun(args: readonly string[], expectedCode = 0, runtime: TestRuntime = {}): Promise<YamlValue> {
	const result = await run(args, runtime);
	assert.equal(result.code, expectedCode, `${result.stderr}\n${result.stdout}`);
	assert.equal(result.stderr, "");
	return parseYaml(result.stdout);
}

test("canonical registry is reachable through stable, read-only help", async () => {
	for (const args of [[], ["help"], ["-h"], ["--help"]]) {
		const result = await run(args);
		assert.equal(result.code, 0);
		assert.match(result.stdout, /^Usage: ceal \[--timing\] <command> \[options\]/u);
		assert.match(result.stdout, /Named options follow required positionals, are order-independent, and may be supplied once\./u);
		assert.equal(result.stderr, "");
		for (const command of CEAL_COMMANDS) assert.match(result.stdout, new RegExp(`^  ${command.name}\\s`, "mu"));
	}
	for (const command of CEAL_COMMANDS) {
		// `ceal version` is frozen: the installer that runs during `ceal update` is
		// the installed generation's, and older generations compare that document
		// byte for byte, so adding a field there breaks the upgrade path for every
		// already-installed client. It stays byte-stable until no installed client
		// compares it whole. CHANGELOG.md records which release proved this; do not
		// restate a release number here.
		if (command.name === "version") continue;
		for (const args of [
			[command.name, "--help"],
			[command.name, "-h"],
			["help", command.name],
		]) {
			const result = await run(args);
			assert.equal(result.code, 0);
			assert.equal(result.stderr, "");
			assert.match(result.stdout, new RegExp(`^Usage: ${escapeRegExp(command.usage)}$`, "mu"));
			assert.match(result.stdout, /Named options follow required positionals, are order-independent, and may be supplied once\./u);
			assert.match(result.stdout, new RegExp(`^Effect: ${command.effect}$`, "mu"));
			if (command.session_effect) assert.match(result.stdout, new RegExp(`^Session effect: ${command.session_effect}$`, "mu"));
			assert.match(result.stdout, new RegExp(`^Evidence: ${command.evidence}$`, "mu"));
			assert.match(result.stdout, new RegExp(`^Result schema: ${command.result_schema}$`, "mu"));
			assert.match(result.stdout, /^Recovery\/readback: /mu);
		}
	}
	const capabilitiesHelp = await run(["capabilities", "--help"]);
	for (const option of ["--endpoint", "--profile", "--request-id", "--token-stdin"]) {
		assert.match(capabilitiesHelp.stdout, new RegExp(option, "u"));
	}
	const callHelp = await run(["call", "--help"]);
	assert.match(callHelp.stdout, /select a target for that same capability/u);
	assert.match(callHelp.stdout, /Do not mix a target returned for another capability/u);
});

// The guide tells an agent to descend into a route and read that leaf's four
// fields, so every route the dispatcher accepts as a subcommand owes its own
// help. Assert the contract from the declared table, not per hand-patched case.
test("every declared subcommand renders its own four-field leaf help", async () => {
	for (const subcommand of CEAL_SUBCOMMANDS) {
		const route = [subcommand.parent, ...subcommand.route];
		for (const args of [
			[...route, "--help"],
			[...route, "-h"],
			["help", ...route],
		]) {
			const result = await run(args);
			assert.equal(result.code, 0, `${args.join(" ")}: ${result.stdout}`);
			assert.equal(result.stderr, "");
			assert.match(result.stdout, new RegExp(`^Usage: ${escapeRegExp(subcommand.usage)}$`, "mu"));
			assert.match(result.stdout, new RegExp(`^Effect: ${subcommand.effect}$`, "mu"));
			if ("session_effect" in subcommand) assert.match(result.stdout, new RegExp(`^Session effect: ${subcommand.session_effect}$`, "mu"));
			assert.match(result.stdout, new RegExp(`^Evidence: ${subcommand.evidence}$`, "mu"));
			assert.match(result.stdout, new RegExp(`^Result schema: ${subcommand.result_schema}$`, "mu"));
			assert.match(result.stdout, /^Recovery\/readback: /mu);
		}
	}
});

// The invariant issue #1 was missing: acceptance is derived from the same
// declaration help renders, so an undeclared route cannot be accepted by a
// runner and a declared route cannot be rejected as unknown.
test("route acceptance is derived from the declaration", async () => {
	for (const parent of new Set(CEAL_SUBCOMMANDS.map((subcommand) => subcommand.parent))) {
		// An undeclared route reaches no runner.
		const bogus = await run([parent, "bogus-route"], {
			readStoredSession: () => assert.fail("an undeclared route must not reach a runner"),
			inspectAgentGuide: () => assert.fail("an undeclared route must not reach a runner"),
		});
		// Refused before any runner work: the runtime hooks above would have failed.
		// The exit code is the refusing surface's own (2 argument, 3 command error).
		assert.ok([2, 3].includes(bogus.code), `${parent} bogus-route: ${bogus.code}`);
		assert.match(bogus.stdout, /^ {2}kind: \w+$/mu);
		// Every declared route resolves off the same table the help renders from.
		for (const subcommand of CEAL_SUBCOMMANDS.filter((item) => item.parent === parent)) {
			const { subcommand: resolved, rest } = splitSubcommandRoute(parent, [...subcommand.route, "--flag", "value"]);
			assert.deepEqual(resolved?.route, subcommand.route, subcommand.route.join(" "));
			assert.deepEqual(rest, ["--flag", "value"]);
		}
	}
	// A route declared under a different parent is not accepted here.
	assert.equal(splitSubcommandRoute("capabilities", ["status"]).subcommand, undefined);
});

// Acceptance being table-derived was never the whole invariant: every runner then
// picked its handler by testing one token and falling through, so `runSession`
// sent every non-`logout` route to enrollment and `runGuide` sent every
// non-`register` route to status. A row added to the table alone passed this
// suite — which proves help and refusal — and misrouted in the shipped binary.
// Dispatch keys on the route's own declaration now; `tsc` rejects a handler table
// that is not total over one parent's declared routes, and this proves the
// resolver those tables are read through does not fall through.
test("dispatch selects the handler the route itself declares", () => {
	for (const parent of new Set(CEAL_SUBCOMMANDS.map((subcommand) => subcommand.parent))) {
		const declared = CEAL_SUBCOMMANDS.filter((subcommand) => subcommand.parent === parent);
		const defaults = declared.filter((subcommand) => "default" in subcommand && subcommand.default === true);
		assert.ok(defaults.length <= 1, `${parent} declares more than one default route`);
		// A total table whose handlers are distinguishable only by which route they
		// were registered under: a fallthrough would return a sibling's key.
		const handlers: CealSubcommandHandlers<CealCommandName, () => string> = {
			status: () => "status",
			"register codex": () => "register codex",
			"register claude": () => "register claude",
			refresh: () => "refresh",
			enroll: () => "enroll",
			adopt: () => "adopt",
			logout: () => "logout",
			targets: () => "targets",
			show: () => "show",
			emit: () => "emit",
		};
		for (const subcommand of declared) {
			const key = subcommandRouteKey(subcommand);
			const resolved = resolveSubcommandRoute(parent, [...subcommand.route, "--flag", "value"], handlers);
			assert.ok(resolved, `${parent} ${key} resolved to no handler`);
			assert.equal(resolved.handler(), key, `${parent} ${key} reached another route's handler`);
			assert.deepEqual(resolved.subcommand.route, subcommand.route);
			assert.deepEqual(resolved.rest, ["--flag", "value"]);
		}
		// An undeclared route reaches no handler rather than the nearest one.
		assert.equal(resolveSubcommandRoute(parent, ["bogus-route"], handlers), undefined);
		const bare = resolveSubcommandRoute(parent, [], handlers);
		if (defaults[0]) {
			assert.equal(bare?.handler(), subcommandRouteKey(defaults[0]), `${parent} did not reach its declared default route`);
			assert.deepEqual(bare?.rest, []);
		} else assert.equal(bare, undefined);
	}
	// A declared route whose handler is missing fails closed as undeclared instead
	// of throwing, so the worst case is an argument refusal rather than a crash.
	const emptySessionHandlers: CealSubcommandHandlers<"session", undefined> = {
		status: undefined,
		refresh: undefined,
		enroll: undefined,
		adopt: undefined,
		logout: undefined,
	};
	assert.equal(resolveSubcommandRoute("session", ["logout"], emptySessionHandlers), undefined);
});

// The type-level totality above is not a complete gate, which is why this one
// exists at runtime. `CealSubcommandRouteKey` reads *literal* route tuples, so a
// row declared `route: ["refresh"] as string[]` — or built from any non-`const`
// value — contributes no key, demands no handler, and compiles clean. Verified by
// probe: that row builds green, then advertises leaf help, passes acceptance, and
// dead-ends in `invalid_argument` — issue #1's failure from the other side. This
// compares dispatch against the declaration where the type system cannot.
// A positional index into either declaration table is valid forever and correct
// only until somebody inserts a row above it. That is not hypothetical here:
// `CEAL_COMMANDS[2].recovery` was `session` when written and became `update` when
// `update` was added, so the logged-out `capabilities` envelope sent operators to
// reinstall the binary. Look rows up by name; the tables are small and the names
// are a literal union, so nothing is lost.
test("no source file reaches into a declaration table by position", () => {
	// `workerSource()` asserts the sweep actually reached src/, so this cannot pass
	// by scanning nothing.
	const offenders = workerSource()
		.split("\n")
		// Comments may name the defect; code may not commit it.
		.filter((line) => !/^\s*(?:\/\/|\*)/u.test(line))
		.filter((line) => /\b(?:CEAL_COMMANDS|CEAL_SUBCOMMANDS)\s*\[\s*\d/u.test(line));
	assert.deepEqual(offenders, [], "look the row up by name instead — a positional index survives a reordering silently");
});

test("every declared route has a handler in the runner that serves it", () => {
	const dispatched = dispatchedRouteKeys();
	const parents = new Set<CealCommandName>(CEAL_SUBCOMMANDS.map((subcommand) => subcommand.parent));
	for (const parent of parents) {
		const declared = CEAL_SUBCOMMANDS.filter((subcommand) => subcommand.parent === parent)
			.map((subcommand) => subcommandRouteKey(subcommand))
			.sort();
		assert.deepEqual(
			[...(dispatched[parent] ?? [])].sort(),
			declared,
			`${parent}: the declaration table and the runner's dispatch table disagree`,
		);
	}
	// And no runner dispatches a parent that declares nothing, which would be a
	// handler for a route no help advertises.
	for (const parent of Object.keys(dispatched)) {
		if (!isCealCommandName(parent)) throw new Error(`${parent} has a dispatch table but declares no route`);
		assert.ok(parents.has(parent), `${parent} has a dispatch table but declares no route`);
	}
});

// Route keys are the declared tokens joined by a space, so a token containing a
// space would make two different declarations collide on one key and let a single
// handler satisfy both — the totality check above would read "covered" while one
// route has no handler of its own. An empty route is unreachable for the same
// reason: it joins to "" and `splitSubcommandRoute` never matches it.
test("every declared route is a non-empty sequence of single-word tokens", () => {
	for (const subcommand of CEAL_SUBCOMMANDS) {
		const key = subcommandRouteKey(subcommand);
		assert.ok(subcommand.route.length > 0, `${subcommand.parent} declares an empty route`);
		for (const token of subcommand.route) {
			assert.match(token, /^[a-z][a-z0-9-]*$/u, `${subcommand.parent} ${key} has a token that is not one lowercase word`);
		}
	}
	// Distinct declarations therefore have distinct keys.
	const keys = CEAL_SUBCOMMANDS.map((subcommand) => `${subcommand.parent} ${subcommandRouteKey(subcommand)}`);
	assert.equal(new Set(keys).size, keys.length, "two declarations collide on one route key");
});

// A parent that advertises a subcommand row an agent cannot descend into
// reintroduces the same dead end from the other side.
test("advertised subcommand rows and declared routes stay in sync", async () => {
	for (const command of CEAL_COMMANDS) {
		// `ceal version` is frozen: the installer that runs during `ceal update` is
		// the installed generation's, and older generations compare that document
		// byte for byte, so adding a field there breaks the upgrade path for every
		// already-installed client. It stays byte-stable until no installed client
		// compares it whole. CHANGELOG.md records which release proved this; do not
		// restate a release number here.
		if (command.name === "version") continue;
		const declared = CEAL_SUBCOMMANDS.filter((subcommand) => subcommand.parent === command.name);
		const { stdout } = await run([command.name, "--help"]);
		if (declared.length === 0) {
			assert.doesNotMatch(stdout, /^Subcommands:$/mu);
			continue;
		}
		assert.match(stdout, /^Subcommands:$/mu);
		assert.match(stdout, new RegExp(`^Run: ceal ${command.name} <subcommand> --help`, "mu"));
		assert.deepEqual(
			advertisedSubcommands(stdout),
			declared.map((subcommand) => subcommand.route.join(" ")),
		);
		// A route token left behind in the Options block reads as a flag.
		const optionRows = stdout.split("\n").slice(stdout.split("\n").indexOf("Options:") + 1);
		for (const subcommand of declared) {
			assert.ok(!optionRows.some((line) => line.startsWith(`  ${subcommand.route[0]} `)), `${command.name}: ${subcommand.route[0]}`);
		}
	}
});

test("parent session help advertises force for both replacement-capable routes", async () => {
	const { stdout } = await run(["session", "--help"]);
	const usage = requiredValue(stdout.split("\n")[0], "session_help_usage");
	assert.equal((usage.match(/\[--force\]/gu) ?? []).length, 2);
});

// Every declared route must emit a schema the package actually writes, so a
// leaf cannot advertise a `Result schema` no code produces.
test("declared result schemas exist in the emitting package", () => {
	const source = workerSource();
	const emitted = new Set(
		[...source.matchAll(/schema_version: "([a-z0-9_.]+)"/gu)].map((match) => requiredCapture(match, 1, "emitted_schema")),
	);
	for (const definition of [...CEAL_COMMANDS, ...CEAL_SUBCOMMANDS]) {
		const label = "name" in definition ? definition.name : definition.route.join(" ");
		assert.ok(emitted.has(definition.result_schema), `${label}: ${definition.result_schema}`);
	}
});

// The reported dead end: a help probe on the target-selection child must answer
// whether an unfiltered page is in contract instead of erroring.
test("target selection help states its unfiltered-page bound", async () => {
	const { code, stdout } = await run(["capabilities", "targets", "--help"]);
	const parentHelp = (await run(["capabilities", "--help"])).stdout;
	assert.equal(code, 0);
	assert.match(stdout, /An unfiltered page is permitted/u);
	assert.match(stdout, /--limit <1-64>/u);
	assert.match(stdout, /a complete page with zero targets is terminal/u);
	assert.match(stdout, /target_catalog\.next_cursor/u);
	assert.match(stdout, /Target selectors are capability-specific/u);
	assert.match(stdout, /input_contract describes\s+call arguments, not what --match accepts/u);
	assert.match(stdout, /some capabilities do not support\s+--match at all/u);
	assert.match(stdout, /selector_not_supported/u);
	assert.match(stdout, /catalog navigation declares it/u);
	assert.doesNotMatch(stdout, /--match <text-or-url>|target labels, or an approved source URL/u);
	assert.match(parentHelp, /--match <selector>/u);
	assert.doesNotMatch(parentHelp, /--match <text-or-url>/u);
	assert.match(stdout, /--detail/u);
});

test("acceptance help names Gateway-audit readback without claiming provider state", async () => {
	const { code, stdout } = await run(["acceptance", "emit", "--help"]);
	assert.equal(code, 0);
	assert.match(stdout, /embeds the Gateway-audit readback/u);
	assert.match(stdout, /does not establish provider state/u);
	assert.doesNotMatch(stdout, /verified receipt/u);
});

// A help token anywhere in the tail is read-only help, never an operand: a
// guessed or partially typed route must land on a leaf that names the real
// routes instead of reaching a runner or the top of the tree.
test("a help token anywhere resolves to the nearest declared leaf", async () => {
	const cases = [
		{ args: ["guide", "bogus", "--help"], usage: "Usage: ceal guide [status | register codex | register claude]" },
		{ args: ["capabilities", "targets", "--capability", "message.search", "--help"], usage: "Usage: ceal capabilities targets" },
		{ args: ["session", "enroll", "--gateway", "--help"], usage: "Usage: ceal session enroll" },
		{ args: ["call", "message.search", "--help"], usage: "Usage: ceal call <capability-id>" },
	];
	for (const { args, usage } of cases) {
		const result = await run(args, { promptEnrollmentCode: () => assert.fail("a help probe must not read a credential") });
		assert.equal(result.code, 0, args.join(" "));
		assert.equal(result.stderr, "");
		assert.ok(result.stdout.startsWith(usage), `${args.join(" ")}: ${result.stdout.split("\n")[0]}`);
	}
	// The explicit `help` verb names a leaf, so an unknown route stays an error.
	const named = await run(["help", "capabilities", "bogus"]);
	assert.equal(named.code, 2);
	assert.match(named.stdout, /^ {2}kind: invalid_argument$/mu);
});

test("a malformed known route points at the nearest help that can correct it", async () => {
	const cases = [
		{ args: ["version", "unexpected"], nextAction: "Run 'ceal version --help'." },
		{ args: ["commands", "unexpected"], nextAction: "Run 'ceal commands --help'." },
		{ args: ["update", "unexpected"], nextAction: "Run 'ceal update --help'." },
		{ args: ["help", "capabilities", "bogus"], nextAction: "Run 'ceal capabilities --help'." },
		{ args: ["help", "session", "status", "unexpected"], nextAction: "Run 'ceal session status --help'." },
		{ args: ["help", "session", "enroll", "unexpected"], nextAction: "Run 'ceal session enroll --help'." },
		{ args: ["help", "session", "logout", "unexpected"], nextAction: "Run 'ceal session logout --help'." },
		{ args: ["help", "session", "adopt", "unexpected"], nextAction: "Run 'ceal session adopt --help'." },
		{ args: ["session", "bogus"], nextAction: "Run 'ceal session --help'." },
		{ args: ["session", "status", "unexpected"], nextAction: "Run 'ceal session status --help'." },
		{ args: ["session", "enroll"], nextAction: "Run 'ceal session enroll --help'." },
		{ args: ["session", "logout", "unexpected"], nextAction: "Run 'ceal session logout --help'." },
		{ args: ["session", "adopt"], nextAction: "Run 'ceal session adopt --help', then supply" },
		{ args: ["guide", "bogus"], nextAction: "Run 'ceal guide --help'." },
		{ args: ["guide", "status", "unexpected"], nextAction: "Run 'ceal guide status --help'." },
		{ args: ["observe", "--bogus"], nextAction: "Run 'ceal observe --help'." },
		{ args: ["call"], nextAction: "Run 'ceal call --help'" },
		{ args: ["receipt"], nextAction: "Run 'ceal receipt show --help'" },
	];
	for (const { args, nextAction } of cases) {
		const payload = await yamlRun(args, 2, {
			runStableUpdate: () => assert.fail("an invalid update must not run"),
			readStoredSession: () => assert.fail("invalid session arguments must not read state"),
		});
		assert.equal(payload.error.kind, "invalid_argument", args.join(" "));
		assert.ok(payload.error.next_action.startsWith(nextAction), `${args.join(" ")}: ${payload.error.next_action}`);
	}
});

test("observational routes declare a read-only effect and keep session rotation explicit", () => {
	for (const name of ["receipt", "acceptance"]) {
		const command = CEAL_COMMANDS.find((entry) => entry.name === name);
		assert.ok(command);
		assert.equal(command.effect, "read_only", name);
	}
	const capabilities = CEAL_COMMANDS.find((command) => command.name === "capabilities");
	assert.ok(capabilities);
	assert.equal(capabilities.effect, "read_only");
	for (const [parent, route] of [
		["receipt", "show"],
		["acceptance", "emit"],
	]) {
		const subcommand = CEAL_SUBCOMMANDS.find((entry) => entry.parent === parent && entry.route.join(" ") === route);
		assert.ok(subcommand);
		assert.equal(subcommand.effect, "read_only", `${parent} ${route}`);
	}
	const targets = CEAL_SUBCOMMANDS.find((subcommand) => subcommand.parent === "capabilities" && subcommand.route.join(" ") === "targets");
	assert.ok(targets);
	assert.equal(targets.effect, "read_only");
	const refresh = CEAL_SUBCOMMANDS.find((subcommand) => subcommand.parent === "session" && subcommand.route.join(" ") === "refresh");
	assert.ok(refresh);
	assert.equal(refresh.effect, "remote_write");
});

test("session recovery strings point at the probe-safe status leaf", () => {
	const source = workerSource();
	assert.match(source, /Run 'ceal session status' to/u);
	assert.doesNotMatch(source, /Run 'ceal session' to/u);
});

test("every public command emits one YAML document without a format flag", async () => {
	for (const command of CEAL_COMMANDS) {
		// `ceal version` is frozen: the installer that runs during `ceal update` is
		// the installed generation's, and older generations compare that document
		// byte for byte, so adding a field there breaks the upgrade path for every
		// already-installed client. It stays byte-stable until no installed client
		// compares it whole. CHANGELOG.md records which release proved this; do not
		// restate a release number here.
		if (command.name === "version") continue;
		const args =
			command.name === "call"
				? ["call", "message.search", "--target", "target:team-inbox", "query=launch"]
				: command.name === "receipt"
					? ["receipt", "show", "request:test"]
					: command.name === "observe"
						? ["observe", "--port", "0"]
						: [command.name];
		// The observer intentionally serves until closed; close it right after
		// its single serving document is written.
		const runtime: TestRuntime = command.name === "observe" ? { onObserverListening: (handle) => void handle.close() } : {};
		// `acceptance` joins the failing set for the same reason `capabilities`
		// is in it: with no Gateway session there is nothing live to evidence, so
		// the honest answer is its own schema with ok:false rather than a record.
		const failing = ["call", "receipt", "guide", "update", "capabilities", "acceptance"].includes(command.name);
		const payload = await yamlRun(args, failing ? 3 : 0, runtime);
		assert.equal(payload.schema ?? payload.schema_version, command.result_schema);
		if (payload.command !== undefined) assert.equal(payload.command, "ceal");
	}
});

test("version identifies the package, protocol, range, and credential context", async () => {
	const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
	// Deliberately byte-stable; see the sweep's exemption.
	assert.deepEqual(await yamlRun(["version"]), {
		schema_version: "ceal.version.v1",
		command: "ceal",
		// Drift guard: the rendered version must track the package manifest.
		version: manifest.version,
		protocol_version: "1.4.0",
		supported_gateway_protocol_range: { minimum: "1.4.0", maximum: "1.4.0" },
		credential_context: "gateway_issued_client_session",
	});
	// No literal version is asserted here: the drift guard above already pins the
	// rendered document to the manifest, and a hardcoded number would only force
	// a test edit on every bump. CHANGELOG.md is where release numbers live.
});

// `ceal update` runs the *installed* generation's `install-ceal.sh`, and older
// installers compare this document whole. Adding one field to it broke every
// installed client's upgrade path once, so the key set is frozen rather than
// left to a comment; CHANGELOG.md records which release proved it. Unlock
// condition: once no supported client predates the installer that field-checks
// instead of byte-comparing, this document may carry `ok` like every other one,
// and this gate can go.
test("the version document's key set is frozen for older installers", async () => {
	assert.deepEqual(Object.keys(await yamlRun(["version"])), [
		"schema_version",
		"command",
		"version",
		"protocol_version",
		"supported_gateway_protocol_range",
		"credential_context",
	]);
});

test("commands YAML is the machine-readable discovery surface", async () => {
	const payload = await yamlRun(["commands"]);
	assert.equal(payload.schema_version, "ceal.commands.v1");
	assert.deepEqual(
		payload.commands.map((command: { name: string }) => command.name),
		["version", "commands", "update", "session", "guide", "capabilities", "call", "receipt", "observe", "acceptance"],
	);
	const observe = payload.commands.find((command: { name: string }) => command.name === "observe");
	assert.ok(observe);
	assert.equal(observe.lifecycle, "until_interrupted");
	// An agent that parses this document instead of prose help must see the same
	// route depth the help surface advertises.
	assert.deepEqual(
		payload.subcommands.map((subcommand: { parent: string; route: string[] }) => [subcommand.parent, ...subcommand.route].join(" ")),
		CEAL_SUBCOMMANDS.map((subcommand) => [subcommand.parent, ...subcommand.route].join(" ")),
	);
	for (const subcommand of payload.subcommands) {
		for (const field of ["usage", "effect", "evidence", "result_schema", "recovery"] as const) {
			assert.match(subcommand[field], /\S/u, `${subcommand.route.join(" ")}.${field}`);
		}
	}
	const call = payload.commands.find((command: { name: string }) => command.name === "call");
	assert.ok(call);
	assert.equal(call.description, "Invoke a capability and read back its Gateway audit event.");
	assert.doesNotMatch(call.description, /approved/iu);
});

test("update is option-free, stable-only, and keeps child execution behind one YAML result", async () => {
	let invoked = 0;
	let guideWrites = 0;
	const payload = await yamlRun(["update"], 0, {
		registerAgentGuide: () => {
			guideWrites += 1;
			throw new Error("guide registration must remain separate");
		},
		runStableUpdate: async () => {
			invoked += 1;
			return {
				status: "updated",
				previous_version: "0.65.0",
				installed_version: "1.2.3",
				platform: "linux-arm64",
				artifact_sha256: "a".repeat(64),
				elapsed_ms: 42,
				guide: {
					status: "registration_not_attempted",
					next_action: "Run 'ceal guide register codex' from the updated command.",
					non_claim: "Guide registration was not attempted.",
				},
			};
		},
	});
	assert.deepEqual(payload, {
		schema_version: "ceal.update.v1",
		command: "ceal",
		ok: true,
		status: "updated",
		effect: "local_write",
		stable_only: true,
		previous_version: "0.65.0",
		installed_version: "1.2.3",
		platform: "linux-arm64",
		artifact_sha256: "a".repeat(64),
		elapsed_ms: 42,
		guide: {
			status: "registration_not_attempted",
			next_action: "Run 'ceal guide register codex' from the updated command.",
			non_claim: "Guide registration was not attempted.",
		},
		non_claims: ["Gateway_not_contacted", "Agent_not_updated", "operator_cli_not_updated"],
	});
	const invalid = await run(["update", "v1.2.3"], {
		runStableUpdate: async () => {
			invoked += 1;
			return { status: "updated" };
		},
	});
	assert.equal(invalid.code, 2);
	assert.equal(invoked, 1);
	assert.equal(guideWrites, 0);
	const unavailable = await yamlRun(["update"], 3);
	assert.equal(unavailable.schema_version, "ceal.update.v1");
	assert.equal(unavailable.status, "unavailable");
	assert.equal(unavailable.error.kind, "update_unavailable");
});

test("update reports bounded stable progress only to an interactive stderr surface", async () => {
	const stages: string[] = [];
	const interactive = await run(["update"], {
		isOutputTerminal: () => true,
		runStableUpdate: async ({ onProgress } = {}) => {
			for (const stage of ["check", "download_install", "verify", "installed_readback"] satisfies readonly CealStableUpdateProgressStage[]) {
				stages.push(stage);
				onProgress?.(stage);
			}
			return { status: "unchanged", previous_version: "1.2.3", installed_version: "1.2.3", platform: "darwin-arm64" };
		},
	});
	assert.deepEqual(stages, ["check", "download_install", "verify", "installed_readback"]);
	assert.deepEqual(parseYaml(interactive.stdout).status, "unchanged");
	assert.deepEqual(interactive.stderr.split("\n").filter(Boolean), [
		"ceal update: checking the installed worker release",
		"ceal update: downloading and installing the signed stable worker release",
		"ceal update: verifying signed update completion",
		"ceal update: reading back the installed worker release",
	]);
	assert.doesNotMatch(interactive.stderr, /https?:\/\//u);
	assert.doesNotMatch(interactive.stderr, /[|/\\-]\r/u);

	const nonInteractive = await run(["update"], {
		isOutputTerminal: () => false,
		runStableUpdate: async ({ onProgress } = {}) => {
			onProgress?.("check");
			return { status: "unchanged" };
		},
	});
	assert.equal(nonInteractive.stderr, "");
	assert.equal(parseYaml(nonInteractive.stdout).status, "unchanged");

	let timingOutput = "";
	const timed = await run(["update"], {
		isOutputTerminal: () => true,
		timing: createCealTimingRecorder({ write: (chunk) => (timingOutput += chunk) }),
		runStableUpdate: async ({ onProgress } = {}) => {
			for (const stage of ["check", "download_install", "verify", "installed_readback"] satisfies readonly CealStableUpdateProgressStage[])
				onProgress?.(stage);
			return { status: "updated" };
		},
	});
	assert.equal(timed.code, 0);
	assert.equal(timed.stderr, "", "timing mode keeps TTY stderr machine-parseable instead of mixing human progress");
	assert.ok(timingEvents(timingOutput).every((event) => event.stage.startsWith("update_")));

	let committed = false;
	const hostileDiagnostic = await run(["update"], {
		timing: {
			start(stage) {
				if (stage === "update_verify") throw new Error("diagnostic stderr failed");
				return { finish() {} };
			},
			completed() {},
		},
		runStableUpdate: async ({ onProgress } = {}) => {
			onProgress?.("check");
			onProgress?.("download_install");
			committed = true;
			onProgress?.("verify");
			onProgress?.("installed_readback");
			return { status: "updated" };
		},
	});
	assert.equal(committed, true);
	assert.equal(hostileDiagnostic.code, 0, "an observation callback cannot reclassify a committed update as failed");
	assert.equal(parseYaml(hostileDiagnostic.stdout).status, "updated");
});

test("guide status and per-host registration expose one update-safe local skill path", async () => {
	const root = mkdtempSync(path.join(tmpdir(), "ceal-guide-runtime-"));
	const guidePath = path.join(root, "install", ".ceal-cli", "worker", "current", "guide");
	const registrationPaths = {
		codex: path.join(root, "codex", "skills", "ceal-guide"),
		claude: path.join(root, "claude", "skills", "ceal-guide"),
	};
	mkdirSync(guidePath, { recursive: true });
	writeFileSync(path.join(guidePath, "SKILL.md"), "name: ceal-guide\n");
	const registered: Record<"codex" | "claude", boolean> = { codex: false, claude: false };
	const guideHosts: readonly CealAgentGuideHost[] = ["codex", "claude"];
	// The store's own contract: the top-level fields project one host and `hosts`
	// carries every host, so this stub mirrors that shape rather than inventing one.
	const inspect = (agent: CealAgentGuideHost = "codex"): CealAgentGuideState => ({
		status: "available",
		agent,
		guide_id: "ceal-guide",
		guide_path: guidePath,
		update_safe: true,
		hosts: guideHosts.map((host) => ({
			agent: host,
			status: registered[host] ? "registered" : "staged",
			registration_path: registrationPaths[host],
			registered: registered[host],
		})),
	});
	try {
		const status = await yamlRun(["guide", "status"], 0, { inspectAgentGuide: inspect });
		const statusRecord = fixtureRecord(status, "guide status");
		assert.equal(statusRecord.status, "available");
		assert.equal(statusRecord.effect, "read_only");
		// A Codex-only reader of ceal.guide.v1 keeps reading the same top-level
		// fields it always did, while `hosts` names every supported host.
		assert.equal(statusRecord.agent, "codex");
		assert.deepEqual(
			fixtureRecordArrayField(statusRecord, "hosts").map((host) => host.agent),
			["codex", "claude"],
		);
		const codexStatus = fixtureRecordArrayField(statusRecord, "hosts").find((host) => host.agent === "codex");
		if (!codexStatus) throw new Error("guide status omitted the codex host");
		assert.equal(codexStatus.status, "staged");
		assert.equal(codexStatus.registered, false);
		// No caveat is needed: there is no top-level per-host projection to misread.
		assert.equal("non_claims" in status, false);
		// The declared route token is what selects the host; the dispatcher passes
		// it through instead of registering a host of its own choosing.
		for (const agent of ["codex", "claude"] as const) {
			const result = await yamlRun(["guide", "register", agent], 0, {
				registerAgentGuide: (requested: "codex" | "claude" = "codex") => {
					registered[requested] = true;
					return inspect(requested);
				},
			});
			const resultRecord = fixtureRecord(result, `guide register ${agent}`);
			assert.equal(resultRecord.status, "available");
			assert.equal(resultRecord.action, "register");
			assert.equal(resultRecord.agent, agent);
			assert.equal(resultRecord.effect, "local_write");
			assert.equal(resultRecord.update_safe, true);
			const registeredHost = fixtureRecordArrayField(resultRecord, "hosts").find((host) => host.agent === agent);
			if (!registeredHost) throw new Error(`guide register ${agent} omitted its host`);
			assert.equal(registeredHost.registration_path, registrationPaths[agent]);
			assert.equal(registeredHost.status, "registered");
			assert.equal(registeredHost.registered, true);
			assert.equal("agent_source" in resultRecord, false);
		}
		// With no store at all, a register route still answers as that host.
		const unavailable = await yamlRun(["guide", "register", "claude"], 3);
		const unavailableRecord = fixtureRecord(unavailable, "unavailable guide register");
		assert.equal(unavailableRecord.agent, "claude");
		assert.equal(unavailableRecord.action, "register");
		assert.equal(unavailableRecord.effect, "local_write");
		assert.equal("agent_source" in unavailableRecord, false);
		assert.equal(fixtureRecordField(unavailableRecord, "error").kind, "guide_unavailable");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

// The route table and the agent-host table are two declarations that must agree:
// a `guide register <host>` route whose token is not a declared host would
// otherwise reach the store and register a host the operator never named.
test("every declared guide register route names a supported agent host", async () => {
	const registerRoutes = CEAL_SUBCOMMANDS.filter((subcommand) => subcommand.parent === "guide" && subcommand.route[0] === "register");
	assert.ok(registerRoutes.length > 0);
	for (const subcommand of registerRoutes) {
		assert.equal(subcommand.route.length, 2, subcommand.usage);
		assert.equal(isCealAgentGuideHost(subcommand.route[1]), true, subcommand.usage);
	}
	// An unsupported host never falls back to the default one, and no store hook is
	// reached. Two guards can answer this, and asserting only `invalid_argument`
	// could not tell them apart — it passed while the host guard it named was
	// unreachable, so deleting that guard left this green. Pin which one answers.
	const refused = await run(["guide", "register", "gemini"], {
		registerAgentGuide: () => assert.fail("an unsupported agent host must not reach the store"),
	});
	assert.equal(refused.code, 2);
	assert.match(refused.stdout, /^ {2}kind: invalid_argument$/mu);
	// The route table has no `["register", "gemini"]` row, so dispatch refuses
	// before the host guard is entered.
	assert.match(refused.stdout, /Invalid guide action/u);
	// `runGuideRegister`'s own "Unsupported guide agent host." guard is deliberately
	// unreachable from argv — its comment says what it is for, a declared route
	// added without its host row — and the loop above is what proves that case, by
	// asserting every declared register route's host token. Asserting the guard's
	// message here would only re-assert this dispatch refusal under another name.
	assert.doesNotMatch(refused.stdout, /Unsupported guide agent host/u);
});

// corca-ai/ceal-cli#4 item 2: nothing in the binary told an agent the guide
// existed, so following its method was left to chance. The advisory appears on
// the surface every agent reaches first, and only for an unregistered running
// host — never as noise on a healthy install.
// corca-ai/ceal-cli#5: every rejected `capabilities` argv reported a failed
// target selection, so an agent reading the structured error started digging
// into grants and approval targets when the real fault was an undeclared flag —
// and the bare catalog route selects no target at all. An agent trusts this
// document, so it must name the option and point at the help that lists it.
test("a rejected capabilities option names the option and its own route's help", async () => {
	// The reporter's first case: a flag that exists nowhere.
	const bogus = await yamlRun(["capabilities", "--bogus-flag"], 2);
	assert.equal(bogus.error.kind, "invalid_argument");
	assert.match(bogus.error.message, /Unknown option '--bogus-flag' for 'ceal capabilities'/u);
	assert.equal(bogus.error.next_action, "Run 'ceal capabilities --help'.");
	assert.doesNotMatch(bogus.error.message, /target selection/u);

	// The reporter's second case: a flag that is real, but on the subcommand.
	const misplaced = await yamlRun(["capabilities", "--capability", "message.search"], 2);
	assert.match(misplaced.error.message, /Unknown option '--capability' for 'ceal capabilities'/u);
	assert.equal(misplaced.error.next_action, "Run 'ceal capabilities --help'.");
	assert.doesNotMatch(misplaced.error.message, /target selection/u);

	// The same option on the route that declares it is not an unknown-option
	// failure, and only that route may still speak of a target selection.
	const targets = await yamlRun(["capabilities", "targets", "--bogus-flag"], 2);
	assert.match(targets.error.message, /Unknown option '--bogus-flag' for 'ceal capabilities targets'/u);
	assert.equal(targets.error.next_action, "Run 'ceal capabilities targets --help'.");
	const noCapability = await yamlRun(["capabilities", "targets", "--match", "x"], 2);
	assert.match(noCapability.error.message, /Invalid capabilities target selection/u);
	assert.equal(noCapability.error.next_action, "Run 'ceal capabilities targets --help'.");
});

test("capabilities points an unregistered running host at the guide, and stays silent otherwise", async () => {
	const guide =
		(registered: boolean, agentSource: "detected" | "default"): (() => CealAgentGuideState) =>
		() => {
			const state: CealAgentGuideState = {
				status: "available",
				agent: "claude",
				agent_source: agentSource,
				guide_id: "ceal-guide",
				update_safe: true,
				hosts: [{ agent: "claude", status: registered ? "registered" : "staged", registration_path: "/tmp/c", registered }],
			};
			return state;
		};
	await withGateway(async ({ endpoint }) => {
		const unregistered = await yamlRun(["capabilities"], 0, {
			readStoredSession: async () => storedSession(endpoint),
			inspectAgentGuide: guide(false, "detected"),
		});
		assert.equal(unregistered.agent_guide.agent, "claude");
		assert.match(unregistered.agent_guide.next_action, /ceal guide register claude/u);

		// Registered, undetected host, and a missing guide asset each stay silent.
		const missingAsset = (): CealAgentGuideState => ({
			status: "unavailable",
			agent: "claude",
			agent_source: "detected",
			guide_id: "ceal-guide",
			update_safe: false,
		});
		for (const state of [guide(true, "detected"), guide(false, "default"), missingAsset]) {
			const quiet = await yamlRun(["capabilities"], 0, {
				readStoredSession: async () => storedSession(endpoint),
				inspectAgentGuide: state,
			});
			assert.equal("agent_guide" in quiet, false);
		}
	});
});

// corca-ai/ceal-cli#2 item 1, the one that cost real data: a client read
// `error.kind` only, so a discovery failure — which published `error.code` —
// looked like no error at all, and a 36-call sweep lost 16 calls while
// reporting none of them. The predicate is only worth anything if it holds
// everywhere, so derive the sweep from the command table rather than hand-picking
// surfaces: `ok` must be present, agree with the exit code, and imply an
// `error.kind` when false.
// Frozen: the installer that runs during `ceal update` is the installed
// generation's, and older generations compare that document byte for byte, so
// adding a field there breaks the upgrade path for every already-installed
// client. It stays byte-stable until no installed client compares it whole.
// CHANGELOG.md records which release proved this; do not restate a release
// number here.
const OK_SWEEP_EXEMPT = ["version"];

// The list above is the one place the code records that a command answers no
// `ok`. The shipped guide teaches agents to branch on `ok`, so the two must agree
// or an agent reads a success as a failure — which is what happened: the guide
// sentence was written true, the exemption was added the same day to restore the
// upgrade path, and nothing bound them, so the guide overclaimed for weeks. Bind
// the count, not the wording: a second exemption makes the guide's "one document"
// false and fails here.
test("the guide's account of the success predicate matches the exemptions the code takes", () => {
	assert.deepEqual(OK_SWEEP_EXEMPT, ["version"], "a new exemption owes the shipped guide a rewrite; it promises exactly one document");
	const guide = readFileSync(new URL("../../../skills/ceal-guide/references/capability-workflow.md", import.meta.url), "utf8");
	assert.match(guide, /One\s+installed document[\s\S]{0,240}answers no `ok`/u);
	// It must not name the command: the guide contract forbids command snapshots,
	// so the property is what an agent can act on.
	assert.doesNotMatch(guide, /\bceal\s+version\b/u);
});

test("every command answers one success predicate that agrees with its exit code", async () => {
	for (const command of CEAL_COMMANDS) {
		if (OK_SWEEP_EXEMPT.includes(command.name)) continue;
		const args =
			command.name === "call"
				? ["call", "message.search", "--target", "target:team-inbox", "query=launch"]
				: command.name === "receipt"
					? ["receipt", "show", "ceal:missing:call"]
					: command.name === "observe"
						? ["observe", "--port", "0"]
						: [command.name];
		const runtime: TestRuntime =
			command.name === "observe" ? { onObserverListening: (handle: { url: string; close: () => Promise<void> }) => void handle.close() } : {};
		const { code, stdout } = await run(args, runtime);
		const payload = parseYaml(stdout);
		assert.equal(typeof payload.ok, "boolean", `${command.name} must carry ok`);
		assert.equal(payload.ok, code === 0, `${command.name}: ok must agree with exit ${code}`);
		if (payload.ok === false) {
			assert.match(payload.error?.kind ?? "", /\S/u, `${command.name}: a false ok owes error.kind`);
		}
	}

	// The Gateway-rejection writer needs a live rejection, so gate its shape
	// structurally instead: `kind` is the only error key, so no emitted error
	// object may carry `code` at all.
	const bodies = errorObjectBodies(workerSource());
	assert.ok(bodies.length >= 20, `only ${bodies.length} error objects found; the sweep is not reaching the writers`);
	for (const body of bodies) {
		// `code,` shorthand counts too: the first pass of this gate missed one.
		// Match a property key at a property boundary, never a `.code` or `: code`
		// value expression.
		assert.doesNotMatch(body, /(?:^|,)\s*code\s*[:,]/u, `error objects speak 'kind' only: ${body.trim()}`);
		assert.match(body, /(?:^|,)\s*kind\s*[:,]/u, `error object without kind: ${body.trim()}`);
	}
});

test("session lifecycle capability is all-or-none and owns the locked mutation interval", async () => {
	let stored: CealStoredSession | null = null;
	let lockEntries = 0;
	const lockedStore = {
		load: async () => stored,
		save: async (session: CealStoredSession) => {
			stored = session;
		},
		replace: async (_expectedRefreshToken: string, session: CealStoredSession) => {
			stored = session;
		},
		remove: async () => {
			stored = null;
		},
	};
	const capability = createCealSessionCapability({
		store: {
			...lockedStore,
			withStateLock: async (action) => {
				lockEntries += 1;
				return action(lockedStore);
			},
		},
	});
	assert.deepEqual(Object.keys(capability).sort(), ["commitEnrolled", "ensureCurrent", "load", "logout"]);
	assert.equal(Object.isFrozen(capability), true);
	assert.equal(Object.hasOwn(prepareRuntime({}), "session"), false);

	const incoming = storedSession("https://ceal.example.test");
	const commit = await capability.commitEnrolled(incoming, false);
	assert.equal(commit.ok, true);
	assert.equal(await capability.load(), incoming);
	assert.equal(lockEntries, 1, "commit must enter the canonical locked interval");
});

test("worker source exposes one semantic session capability and no raw session hooks", () => {
	const source = workerSource();
	assert.match(source, /createCealSessionCapability/u, "positive control must reach the canonical session owner");
	for (const removedName of [
		"load" + "Session",
		"save" + "Session",
		"remove" + "Session",
		"with" + "SessionStateLock",
		"create" + "CealCommandContext",
	]) {
		assert.doesNotMatch(source, new RegExp(`\\b${removedName}\\b`, "u"), `${removedName} must not return as a compatibility seam`);
	}
});

test("session enrollment exchanges stdin once, stores the credential, and never renders it", async () => {
	await withEnrollmentGateway(async ({ endpoint, token }) => {
		let stored: CealStoredSession | null = null;
		const payload = await yamlRun(["session", "enroll", "--code-stdin", "--gateway", endpoint], 0, {
			readSecret: async () => "E".repeat(48),
			readStoredSession: async () => null,
			writeStoredSession: async (session) => {
				stored = session;
			},
		});
		assert.equal(payload.status, "enrolled");
		assert.equal(payload.session_replacement, "first_session");
		assert.equal(payload.raw_token_visible, false);
		const storedValue = requireStoredSession(stored);
		assert.equal(storedValue.accessToken, token);
		assert.match(storedValue.refreshToken, /^ceal_refresh_/u);
		assert.doesNotMatch(JSON.stringify(payload), new RegExp(token, "u"));
	});
});

test("a first enrollment save failure revokes the issued session and asks for a fresh code", async () => {
	await withEnrollmentGateway(async ({ endpoint, refreshToken, revoked }) => {
		const payload = await yamlRun(["session", "enroll", "--code-stdin", "--gateway", endpoint], 3, {
			readSecret: async () => "E".repeat(48),
			readStoredSession: async () => null,
			writeStoredSession: async () => {
				throw new Error("read-only store");
			},
		});
		assert.equal(payload.error.kind, "session_save_failed");
		assert.equal(payload.issued_session_revoked, "revoked");
		assert.deepEqual(revoked, [refreshToken]);
		assert.doesNotMatch(payload.error.next_action, /Gateway URL/u);
		assert.match(payload.error.next_action, /fresh replacement device-enrollment code/u);
	});
});

test("an enrollment lock failure revokes the issued session without blaming the Gateway URL", async () => {
	await withEnrollmentGateway(async ({ endpoint, refreshToken, revoked }) => {
		const payload = await yamlRun(["session", "enroll", "--code-stdin", "--gateway", endpoint], 3, {
			readSecret: async () => "E".repeat(48),
			readStoredSession: async () => null,
			writeStoredSession: async () => assert.fail("the lock failure must happen before save"),
			runWithLockedSession: async () => {
				throw new CealSessionStoreError("refresh_busy");
			},
		});
		assert.equal(payload.error.kind, "refresh_busy");
		assert.equal(payload.issued_session_revoked, "revoked");
		assert.deepEqual(revoked, [refreshToken]);
		assert.doesNotMatch(payload.error.next_action, /Gateway URL/u);
		assert.match(payload.error.next_action, /fresh replacement device-enrollment code/u);
	});
});

test("a replacement enrollment save failure reports both session dispositions", async () => {
	await withEnrollmentGateway(async ({ endpoint, refreshToken, revoked }) => {
		const outgoing = `ceal_refresh_${"O".repeat(43)}`;
		const payload = await yamlRun(["session", "enroll", "--code-stdin", "--gateway", endpoint, "--force"], 3, {
			readSecret: async () => "E".repeat(48),
			readStoredSession: async () => storedSession(endpoint, { subjectRef: "subject:someone-else", refreshToken: outgoing }),
			writeStoredSession: async () => {
				throw new Error("read-only store");
			},
		});
		assert.equal(payload.error.kind, "session_save_failed");
		assert.equal(payload.issued_session_revoked, "revoked");
		assert.deepEqual(revoked, [outgoing, refreshToken]);
		assert.match(payload.error.next_action, /previous session was revoked/u);
		assert.match(payload.error.next_action, /fresh replacement device-enrollment code/u);
	});
});

// One home holds one session (`~/.ceal/client-session.json`), so an enrollment
// run against a configured host is a substitution of the identity behind every
// later `ceal call`. These fix that the substitution is refused by name, that the
// documented recovery from an unrenewable session is not caught by the refusal,
// and that a deliberate replacement leaves nothing of the identity it displaced.
test("enrolling the identity this host already holds is the documented recovery, needs no flag, and keeps its history", async () => {
	await withEnrollmentGateway(async ({ endpoint, revoked }) => {
		let stored: CealStoredSession | null = null;
		const cleared: string[] = [];
		// Exactly the state `NOT_RENEWABLE` sends an operator to re-enroll from,
		// and with a different registration and client ref, because a replacement
		// code mints new ones for the same subject.
		const previous = storedSession(endpoint, {
			registrationRef: "registration:previous",
			clientRef: "client:previous",
			refreshToken: `ceal_refresh_${"O".repeat(43)}`,
			renewalBlockedReason: "refresh_replayed",
		});
		const payload = await yamlRun(["session", "enroll", "--code-stdin", "--gateway", endpoint], 0, {
			readSecret: async () => "E".repeat(48),
			readStoredSession: async () => previous,
			writeStoredSession: async (session) => {
				stored = session;
			},
			removeDiscoveryCache: async () => {
				cleared.push("discovery-cache");
			},
			removeReceiptSpool: async () => {
				cleared.push("receipt-spool");
			},
		});
		assert.equal(payload.status, "enrolled");
		assert.equal(payload.session_replacement, "same_identity");
		assert.equal(payload.local_derived_state_cleared, false);
		assert.deepEqual(cleared, [], "a renewal keeps the audit history of the identity it renews");
		// It still ends the credential it displaced. One home has one slot, so a
		// refresh token the store no longer names is one no local command can
		// revoke, and it would otherwise stay usable until its TTL.
		assert.deepEqual(revoked, [`ceal_refresh_${"O".repeat(43)}`]);
		assert.equal(payload.previous_session_revoked, "revoked");
		const storedValue = requireStoredSession(stored);
		assert.equal(storedValue.subjectRef, "subject:hwidong");
	});
});

test("enrolling a different identity is refused by name, keeps the stored session, and revokes the session it refused", async () => {
	await withEnrollmentGateway(async ({ endpoint, refreshToken, revoked }) => {
		const previous = storedSession(endpoint, {
			profileRef: "profile:other",
			subjectRef: "subject:someone-else",
			instanceRef: "instance:ceal-dev",
			refreshToken: `ceal_refresh_${"O".repeat(43)}`,
		});
		const payload = await yamlRun(["session", "enroll", "--code-stdin", "--gateway", endpoint], 3, {
			readSecret: async () => "E".repeat(48),
			readStoredSession: async () => previous,
			writeStoredSession: async () => assert.fail("a refused enrollment must not write"),
		});
		assert.equal(payload.ok, false);
		assert.equal(payload.status, "conflict");
		assert.equal(payload.error.kind, "session_identity_conflict");
		assert.equal(payload.session_written, false);
		assert.deepEqual(payload.changed_bindings, ["profile_ref", "subject_ref", "instance_ref"]);
		assert.match(payload.error.next_action, /--force/u);
		// The Gateway has already issued the session by the time identities can be
		// compared, so the refusal owns ending it rather than leaving an orphan
		// this host can no longer reach.
		assert.deepEqual(revoked, [refreshToken]);
		assert.equal(payload.issued_session_revoked, "revoked");
	});
});

test("an identity refusal distinguishes an already unusable incoming session from one that may remain live", async () => {
	await withEnrollmentGateway(
		async ({ endpoint }) => {
			const payload = await yamlRun(["session", "enroll", "--code-stdin", "--gateway", endpoint], 3, {
				readSecret: async () => "E".repeat(48),
				readStoredSession: async () =>
					storedSession(endpoint, { subjectRef: "subject:someone-else", refreshToken: `ceal_refresh_${"O".repeat(43)}` }),
				writeStoredSession: async () => assert.fail("a refused enrollment must not write"),
			});
			assert.equal(payload.error.kind, "session_identity_conflict");
			assert.equal(payload.issued_session_revoked, "already_unusable");
			assert.match(payload.error.next_action, /already unusable at the Gateway/u);
		},
		{ revokeDeniedCode: "refresh_invalid" },
	);
	await withEnrollmentGateway(
		async ({ endpoint }) => {
			const payload = await yamlRun(["session", "enroll", "--code-stdin", "--gateway", endpoint], 3, {
				readSecret: async () => "E".repeat(48),
				readStoredSession: async () =>
					storedSession(endpoint, { subjectRef: "subject:someone-else", refreshToken: `ceal_refresh_${"O".repeat(43)}` }),
				writeStoredSession: async () => assert.fail("a refused enrollment must not write"),
			});
			assert.equal(payload.issued_session_revoked, "unavailable");
			assert.match(payload.error.next_action, /may remain usable at the Gateway until it expires/u);
			assert.match(payload.error.next_action, /report it to your organization operator/u);
		},
		{ revokeDeniedCode: "access_denied" },
	);
});

test("enrollment preflight keeps an unspent code and reports only the local store recovery", async () => {
	const payload = await yamlRun(["session", "enroll", "--code-stdin", "--gateway", "https://ceal.example.test"], 3, {
		readStoredSession: async () => {
			throw new CealSessionStoreError("refresh_busy");
		},
		writeStoredSession: async () => assert.fail("preflight stops before save"),
		readSecret: async () => assert.fail("preflight stops before reading the one-time code"),
	});
	assert.equal(payload.error.kind, "refresh_busy");
	assert.match(payload.error.next_action, /has not been read or sent/u);
	assert.match(payload.error.next_action, /same approved code/u);
	assert.doesNotMatch(payload.error.next_action, /Gateway URL|replacement device-enrollment code/u);
});

test("--force replaces a different identity, revoking it first and clearing the local state it produced", async () => {
	await withEnrollmentGateway(async ({ endpoint, revoked }) => {
		let stored: CealStoredSession | null = null;
		const cleared: string[] = [];
		const outgoing = `ceal_refresh_${"O".repeat(43)}`;
		const payload = await yamlRun(["session", "enroll", "--code-stdin", "--gateway", endpoint, "--force"], 0, {
			readSecret: async () => "E".repeat(48),
			readStoredSession: async () => storedSession(endpoint, { subjectRef: "subject:someone-else", refreshToken: outgoing }),
			writeStoredSession: async (session) => {
				stored = session;
			},
			removeDiscoveryCache: async () => {
				cleared.push("discovery-cache");
			},
			removeReceiptSpool: async () => {
				cleared.push("receipt-spool");
			},
		});
		assert.equal(payload.status, "enrolled");
		assert.equal(payload.session_replacement, "replaced");
		assert.equal(payload.previous_session_revoked, "revoked");
		assert.equal(payload.local_derived_state_cleared, true);
		assert.deepEqual(revoked, [outgoing], "the credential that ends is the displaced one, not the one just enrolled");
		// The receipt spool carries no identity discriminator, so a spool kept
		// across a substitution renders two subjects' history as one — the failure
		// the logout path already fixed once.
		assert.deepEqual(cleared.sort(), ["discovery-cache", "receipt-spool"]);
		const storedValue = requireStoredSession(stored);
		assert.equal(storedValue.subjectRef, "subject:hwidong");
	});
});

test("a replacement reports advisory cleanup failure without undoing its stored session", async () => {
	await withEnrollmentGateway(async ({ endpoint }) => {
		let stored: CealStoredSession | null = null;
		const payload = await yamlRun(["session", "enroll", "--code-stdin", "--gateway", endpoint, "--force"], 0, {
			readSecret: async () => "E".repeat(48),
			readStoredSession: async () => storedSession(endpoint, { subjectRef: "subject:someone-else" }),
			writeStoredSession: async (session) => {
				stored = session;
			},
			removeDiscoveryCache: async () => {
				throw new Error("unsafe cache store");
			},
			removeReceiptSpool: async () => {},
		});
		assert.equal(payload.status, "enrolled");
		assert.equal(payload.local_derived_state_cleared, false);
		const storedValue = requireStoredSession(stored);
		assert.equal(storedValue.subjectRef, "subject:hwidong");
	});
});

test("acceptance argument failures use the argument exit class", async () => {
	for (const args of [
		["acceptance", "bogus"],
		["acceptance", "emit", "bogus"],
		["acceptance", "emit", "--profile", "profile:a", "--profile", "profile:b"],
	]) {
		const payload = await yamlRun(args, 2, {
			readInstalledReleaseFacts: () => assert.fail("invalid acceptance argv must stop before installed-release inspection"),
		});
		assert.equal(payload.error.kind, "invalid_argument");
		assert.match(payload.error.next_action, /ceal acceptance emit --help/u);
	}
});

test("a replacement whose displaced credential the Gateway will not honor still proceeds and says so", async () => {
	await withEnrollmentGateway(
		async ({ endpoint }) => {
			let stored: CealStoredSession | null = null;
			// The worst case the recovery text names: an `outcome_unknown` session
			// whose refresh token may already have rotated server-side. Refusing to
			// replace it because its dead credential cannot be revoked would strand
			// exactly the operator that text is speaking to.
			const payload = await yamlRun(["session", "enroll", "--code-stdin", "--gateway", endpoint, "--force"], 0, {
				readSecret: async () => "E".repeat(48),
				readStoredSession: async () =>
					storedSession(endpoint, {
						subjectRef: "subject:someone-else",
						refreshToken: `ceal_refresh_${"O".repeat(43)}`,
						renewalBlockedReason: "outcome_unknown",
					}),
				writeStoredSession: async (session) => {
					stored = session;
				},
			});
			assert.equal(payload.session_replacement, "replaced");
			assert.equal(payload.previous_session_revoked, "already_unusable");
			const storedValue = requireStoredSession(stored);
			assert.equal(storedValue.subjectRef, "subject:hwidong");
		},
		{ revokeDeniedCode: "refresh_replayed" },
	);
});

test("an unreadable session store stops an enrollment before the one-time code is read", async () => {
	await withEnrollmentGateway(async ({ endpoint }) => {
		let codeRead = false;
		const payload = await yamlRun(["session", "enroll", "--code-stdin", "--gateway", endpoint], 3, {
			readSecret: async () => {
				codeRead = true;
				return "E".repeat(48);
			},
			readStoredSession: async () => {
				throw new Error("unreadable store");
			},
			writeStoredSession: async () => assert.fail("must not save"),
		});
		assert.equal(payload.error.kind, "session_load_failed");
		assert.equal(codeRead, false, "a one-time code is not spent to discover the store cannot be read");
	});
});

test("terminal enrollment uses a hidden prompt by default and pipe input requires an explicit flag", async () => {
	await withEnrollmentGateway(async ({ endpoint, token }) => {
		let prompted = 0;
		let readStdin = 0;
		let stored: CealStoredSession | null = null;
		const result = await run(["session", "enroll", "--gateway", endpoint], {
			isInteractiveTerminal: () => true,
			readStoredSession: async () => null,
			promptEnrollmentCode: async () => {
				prompted += 1;
				return "E".repeat(48);
			},
			readSecret: async () => {
				readStdin += 1;
				return "must-not-be-read";
			},
			writeStoredSession: async (session) => {
				stored = session;
			},
		});
		assert.equal(result.code, 0);
		assert.equal(prompted, 1);
		assert.equal(readStdin, 0);
		const storedValue = requireStoredSession(stored);
		assert.equal(storedValue.accessToken, token);
		assert.doesNotMatch(`${result.stdout}${result.stderr}`, /E{48}|must-not-be-read/u);

		let consumed = false;
		const nonInteractive = await yamlRun(["session", "enroll", "--gateway", endpoint], 3, {
			isInteractiveTerminal: () => false,
			readStoredSession: async () => null,
			promptEnrollmentCode: async () => {
				consumed = true;
				return "E".repeat(48);
			},
			readSecret: async () => {
				consumed = true;
				return "E".repeat(48);
			},
			writeStoredSession: async () => assert.fail("must not save"),
		});
		assert.equal(nonInteractive.error.kind, "interactive_enrollment_required");
		assert.equal(consumed, false);
		assert.match(nonInteractive.error.next_action, /--code-stdin/u);

		let stdinRead = false;
		const ttyStdin = await yamlRun(["session", "enroll", "--gateway", endpoint, "--code-stdin"], 3, {
			isInputTerminal: () => true,
			readStoredSession: async () => null,
			readSecret: async () => {
				stdinRead = true;
				return "E".repeat(48);
			},
			writeStoredSession: async () => assert.fail("must not save"),
		});
		assert.equal(ttyStdin.error.kind, "stdin_enrollment_requires_pipe");
		assert.equal(stdinRead, false);
		assert.match(ttyStdin.error.next_action, /hidden prompt/u);
	});
});

test("rejected operator-activation-shaped material cannot create a worker session or appear in recovery output", async () => {
	const code = `celn_${"A".repeat(40)}`;
	const server = createServer(async (request, response) => {
		const chunks: Buffer[] = [];
		for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
		const body: FixtureRequest = JSON.parse(Buffer.concat(chunks).toString("utf8"));
		assert.equal(request.url, "/gateway/client/enroll");
		assert.equal(body.code, code);
		response.writeHead(200, { "content-type": "application/json" });
		response.end(
			JSON.stringify({
				schema_version: "ceal.enrollment_result.v1",
				ok: false,
				error: {
					code: "enrollment_invalid",
					message: "The supplied material is not a device enrollment.",
					next_action: "Request approved device enrollment.",
				},
			}),
		);
	});
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("test server address unavailable");
	let saved = false;
	try {
		const payload = await yamlRun(["session", "enroll", "--gateway", `http://127.0.0.1:${address.port}/gateway/client`, "--code-stdin"], 3, {
			readSecret: async () => code,
			readStoredSession: async () => null,
			writeStoredSession: async () => {
				saved = true;
			},
		});
		assert.equal(payload.status, "denied");
		assert.equal(saved, false);
		assert.doesNotMatch(JSON.stringify(payload), new RegExp(code, "u"));
		assert.match(payload.error.next_action, /organization administrator/u);
	} finally {
		await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
	}
});

test("session refresh explicitly rotates an expiring stored session once and persists the rotation", async () => {
	await withRenewingGateway(async ({ endpoint, oldRefreshToken, newAccessToken, newRefreshToken }) => {
		let saved: CealStoredSession | null = null;
		const payload = await yamlRun(["session", "refresh"], 0, {
			readStoredSession: async () =>
				storedSession(endpoint, {
					accessToken: `ceal_personal_${"O".repeat(43)}`,
					expiresAt: "2020-01-01T00:00:00.000Z",
					refreshToken: oldRefreshToken,
				}),
			writeStoredSession: async (session) => {
				saved = session;
			},
			now: () => Date.parse("2026-07-13T00:00:00.000Z"),
		});
		assert.equal(payload.schema_version, "ceal.session_refresh.v1");
		assert.equal(payload.status, "refreshed");
		const savedValue = requireStoredSession(saved);
		assert.equal(savedValue.accessToken, newAccessToken);
		assert.equal(savedValue.refreshToken, newRefreshToken);
		assert.doesNotMatch(JSON.stringify(payload), new RegExp(oldRefreshToken, "u"));
	});
});

test("capabilities renew an expired stored session once before catalog and target reads", async () => {
	await withRenewingGateway(async ({ endpoint, oldRefreshToken, newAccessToken, requests, refreshCalls }) => {
		let current = storedSession(endpoint, { expiresAt: "2020-01-01T00:00:00.000Z", refreshToken: oldRefreshToken });
		const runtime: TestRuntime = {
			readStoredSession: async () => current,
			writeStoredSession: async (session) => {
				current = session;
			},
			now: () => Date.parse("2026-07-13T00:00:00.000Z"),
		};
		const catalog = await yamlRun(["capabilities"], 0, runtime);
		const targets = await yamlRun(["capabilities", "targets", "--capability", "message.search"], 0, runtime);
		assert.equal(catalog.status, "available");
		assert.equal(catalog.session_refresh, "refreshed");
		assert.equal(targets.status, "available");
		assert.equal(targets.session_refresh, "none");
		assert.equal(refreshCalls(), 1);
		assert.equal(current.accessToken, newAccessToken);
		assert.deepEqual(
			requests.map((item) => item.authorization),
			[`Bearer ${newAccessToken}`, `Bearer ${newAccessToken}`, `Bearer ${newAccessToken}`, `Bearer ${newAccessToken}`],
		);
	});
});

test("capabilities authentication failure reports a bounded 401 diagnostic without a refresh loop", async () => {
	for (const args of [["capabilities"], ["capabilities", "targets", "--capability", "message.search"]]) {
		await withRenewingGateway(
			async ({ endpoint, oldRefreshToken, requests, refreshCalls }) => {
				const payload = await yamlRun(args, 3, {
					readStoredSession: async () => storedSession(endpoint, { refreshToken: oldRefreshToken }),
				});
				assert.equal(payload.error.kind, "authentication_failed");
				assert.equal(payload.status, "denied");
				assert.equal(payload.session_refresh, "none");
				assert.match(payload.error.next_action, /No additional refresh|HTTP 401/u);
				assert.doesNotMatch(payload.error.next_action, /ceal session refresh/u);
				assert.equal(refreshCalls(), 0);
				assert.deepEqual(
					requests.map((item) => item.authorization),
					[`Bearer ${"ceal_personal_"}${"P".repeat(43)}`],
				);
			},
			{ rejectFirstGateway: true },
		);
	}
});

test("capabilities does not refresh again when preflight renewal is followed by auth rejection", async () => {
	await withRenewingGateway(
		async ({ endpoint, oldRefreshToken, newAccessToken, requests, refreshCalls }) => {
			let current = storedSession(endpoint, {
				expiresAt: "2020-01-01T00:00:00.000Z",
				refreshToken: oldRefreshToken,
			});
			const payload = await yamlRun(["capabilities"], 3, {
				readStoredSession: async () => current,
				writeStoredSession: async (session) => {
					current = session;
				},
				now: () => Date.parse("2026-07-13T00:00:00.000Z"),
			});
			assert.equal(payload.error.kind, "authentication_failed");
			assert.equal(payload.session_refresh, "refreshed");
			assert.match(payload.error.next_action, /do not repeat refresh/u);
			assert.doesNotMatch(payload.error.next_action, /ceal session refresh/u);
			assert.equal(refreshCalls(), 1);
			assert.deepEqual(
				requests.map((item) => item.authorization),
				[`Bearer ${newAccessToken}`],
			);
		},
		{ rejectFirstGateway: true },
	);
});

test("capabilities reports a non-quarantined preflight refresh failure without contacting the Gateway", async () => {
	await withRenewingGateway(
		async ({ endpoint, oldRefreshToken, refreshCalls, requests }) => {
			const payload = await yamlRun(["capabilities", "--fresh"], 3, {
				readStoredSession: async () =>
					storedSession(endpoint, {
						expiresAt: "2020-01-01T00:00:00.000Z",
						refreshToken: oldRefreshToken,
					}),
				writeStoredSession: async () => {
					throw new CealSessionStoreError("refresh_busy");
				},
				now: () => Date.parse("2026-07-13T00:00:00.000Z"),
			});
			assert.equal(payload.schema_version, "ceal.capabilities.v1");
			assert.equal(payload.session_refresh, "refresh_failed");
			assert.equal(payload.error.kind, "refresh_busy");
			assert.equal(payload.live_gateway_checked, false);
			assert.equal(refreshCalls(), 0);
			assert.deepEqual(requests, []);
		},
		{ refreshDeniedCode: "refresh_temporarily_unavailable" },
	);
});

test("receipt and acceptance observation never retry auth or rotate a stale stored session", async () => {
	const observations: readonly [string, readonly string[], string, TestRuntime][] = [
		["receipt", ["receipt", "show", "narnia:call:1:call"], "readback", {}],
		["acceptance", ["acceptance", "emit"], "handshake", { readInstalledReleaseFacts: installedReleaseReading }],
	];
	for (const [name, args, operation, extra] of observations) {
		await withRenewingGateway(
			async ({ endpoint, oldRefreshToken, requests, refreshCalls }) => {
				const payload = await yamlRun(args, 3, {
					...extra,
					readStoredSession: async () =>
						storedSession(endpoint, {
							expiresAt: "2020-01-01T00:00:00.000Z",
							refreshToken: oldRefreshToken,
						}),
					writeStoredSession: async () => assert.fail(`${name} must not rotate a stored session`),
					now: () => Date.parse("2026-07-13T00:00:00.000Z"),
				});
				assert.equal(payload.error.kind, "authentication_failed", name);
				assert.match(payload.error.next_action, /ceal session refresh/u, name);
				assert.equal(refreshCalls(), 0, name);
				assert.deepEqual(
					requests.map((item) => item.body.operation),
					[operation],
					name,
				);
			},
			{ rejectFirstGateway: true },
		);
	}
});

test("session refresh fails closed for malformed absolute refresh expiry before a refresh request", async () => {
	await withRenewingGateway(async ({ endpoint, refreshCalls }) => {
		const payload = await yamlRun(["session", "refresh"], 3, {
			readStoredSession: async () =>
				storedSession(endpoint, {
					expiresAt: "2020-01-01T00:00:00.000Z",
					refreshTokenAbsoluteExpiresAt: "not-a-date",
				}),
			writeStoredSession: async () => {},
			now: () => Date.parse("2026-07-13T00:00:00.000Z"),
		});
		assert.equal(payload.schema_version, "ceal.session_refresh.v1");
		assert.equal(payload.status, "unavailable");
		assert.equal(payload.error.kind, "refresh_expired");
		assert.equal(refreshCalls(), 0);
	});
});

// `device-adoption.ts` states the rule this pins: a Gateway-issued wall-clock
// timestamp compared against a separate device's clock falsely rejects a fresh
// credential on a skewed host. It was enforced for the adoption challenge and not
// for the refresh token, where the local refusal was worse — `refresh_expired`
// classifies NOT_RENEWABLE and sends the operator to spend a replacement
// enrollment code for a session the Gateway would have renewed.
test("an explicit session refresh still lets the Gateway answer past a host clock expiry", async () => {
	await withRenewingGateway(async ({ endpoint, refreshCalls, newAccessToken, oldRefreshToken }) => {
		let saved: CealStoredSession | null = null;
		const payload = await yamlRun(["session", "refresh"], 0, {
			readStoredSession: async () =>
				storedSession(endpoint, {
					expiresAt: "2020-01-01T00:00:00.000Z",
					refreshToken: oldRefreshToken,
					// The Gateway renews it; only this host's clock says otherwise.
					refreshTokenAbsoluteExpiresAt: "2026-07-01T00:00:00.000Z",
				}),
			writeStoredSession: async (session) => {
				saved = session;
			},
			nextRequestId: () => "narnia:skewed:001",
			now: () => Date.parse("2099-01-01T00:00:00.000Z"),
		});
		assert.equal(payload.status, "refreshed");
		assert.equal(refreshCalls(), 1, "the Gateway must be asked rather than pre-empted by this machine's clock");
		const savedValue = requireStoredSession(saved);
		assert.equal(savedValue.accessToken, newAccessToken);
	});
});

test("bare and explicit local session status agree without presenting untested renewal as live", async () => {
	let loads = 0;
	const runtime = {
		readStoredSession: async () => {
			loads += 1;
			return storedSession("https://gateway.example.test", { expiresAt: "2020-01-01T00:00:00.000Z" });
		},
		writeStoredSession: () => assert.fail("session status is read-only"),
		now: () => Date.parse("2026-07-13T00:00:00.000Z"),
	};
	const payload = await yamlRun(["session"], 0, runtime);
	const explicit = await yamlRun(["session", "status"], 0, runtime);
	assert.deepEqual(explicit, payload);
	assert.equal(loads, 2);
	assert.equal(payload.schema_version, "ceal.client_session.v1");
	assert.equal(payload.renewal_configured, true);
	assert.equal(payload.renewal_status, "not_checked");
	assert.equal(Object.hasOwn(payload, "renewal_available"), false);
});

test("session status classifies an unreadable store as a local session failure", async () => {
	for (const args of [["session"], ["session", "status"]]) {
		const payload = await yamlRun(args, 3, {
			readStoredSession: async () => {
				throw new Error("unsafe session store");
			},
		});
		assert.equal(payload.schema_version, "ceal.client_session.v1");
		assert.equal(payload.error.kind, "session_load_failed");
		assert.match(payload.error.message, /stored Gateway session/u);
		assert.match(payload.error.next_action, /ceal session status/u);
		assert.doesNotMatch(payload.error.next_action, /enroll|adopt|device-enrollment code/u);
	}
});

test("generic no-session recovery presents both approved setup routes", async () => {
	const sessionCommand = CEAL_COMMANDS.find((command) => command.name === "session");
	assert.ok(sessionCommand);
	const recovery = sessionCommand.recovery;
	const statusCommand = CEAL_SUBCOMMANDS.find((subcommand) => subcommand.parent === "session" && subcommand.route.join(" ") === "status");
	assert.ok(statusCommand);
	const statusRecovery = statusCommand.recovery;
	assert.match(recovery, /ceal session enroll --help/u);
	assert.match(recovery, /ceal session adopt --help/u);
	assert.ok(statusRecovery.startsWith(recovery));

	const status = await yamlRun(["session", "status"], 0, { readStoredSession: async () => null });
	const logout = await yamlRun(["session", "logout"], 0, {
		readStoredSession: async () => null,
		deleteStoredSession: async () => assert.fail("an absent session must not be removed"),
	});
	const refresh = await yamlRun(["session", "refresh"], 3, { readStoredSession: async () => null });
	const capabilities = await yamlRun(["capabilities"], 3, { readStoredSession: async () => null });
	const call = await yamlRun(["call", "message.search", "--target", "target:team-inbox", "query=launch"], 3, {
		readStoredSession: async () => null,
	});
	const receipt = await yamlRun(["receipt", "show", "ceal:prior:call"], 3, { readStoredSession: async () => null });
	const acceptance = await yamlRun(["acceptance", "emit"], 3, {
		readStoredSession: async () => null,
		readInstalledReleaseFacts: installedReleaseReading,
	});
	assert.equal(status.next_action, recovery);
	assert.equal(logout.next_action, recovery);
	assert.equal(refresh.error.next_action, recovery);
	assert.equal(capabilities.error.next_action, recovery);
	assert.equal(call.error.next_action, recovery);
	assert.equal(receipt.error.next_action, recovery);
	assert.equal(acceptance.schema_version, "ceal.worker_acceptance_result.v2");
	assert.equal(acceptance.error.next_action, `${recovery} Then re-run 'ceal acceptance emit'.`);
});

test("ambiguous renewal response is recovered by reusing the durable refresh attempt", async () => {
	await withRenewingGateway(
		async ({ endpoint, oldRefreshToken, newAccessToken, refreshCalls }) => {
			let current = storedSession(endpoint, { expiresAt: "2020-01-01T00:00:00.000Z", refreshToken: oldRefreshToken });
			const runtime = {
				readStoredSession: async () => current,
				writeStoredSession: async (session: CealStoredSession) => {
					current = session;
				},
			};
			const refresh = await yamlRun(["session", "refresh"], 3, runtime);
			assert.equal(refresh.schema_version, "ceal.session_refresh.v1");
			assert.equal(refresh.error.kind, "session_refresh_attempt_unknown");
			assert.equal(refresh.error.retryable, true);
			assert.match(refresh.error.message, /same attempt may be recovered/u);
			assert.match(refresh.error.next_action, /preserved attempt journal/u);
			assert.match(current.refreshAttemptRef ?? "", /^ceal_refresh_attempt_[A-Za-z0-9_-]{43}$/u);
			assert.equal(current.renewalBlockedReason, "outcome_unknown");
			assert.equal(refreshCalls(), 1);

			const recovered = await yamlRun(["session", "refresh"], 0, runtime);
			assert.equal(recovered.status, "refreshed");
			assert.equal(current.accessToken, newAccessToken);
			assert.equal(current.refreshAttemptRef, undefined);
			assert.equal(current.renewalBlockedReason, undefined);
			assert.equal(refreshCalls(), 2, "recovery reuses the same Gateway attempt instead of creating a second rotation");
		},
		{ invalidRefreshResponse: true, recoverAfterUnknown: true },
	);
});

test("capabilities reports a response-unknown refresh without issuing a second Gateway attempt", async () => {
	await withRenewingGateway(
		async ({ endpoint, oldRefreshToken, refreshCalls, requests }) => {
			let current = storedSession(endpoint, { expiresAt: "2020-01-01T00:00:00.000Z", refreshToken: oldRefreshToken });
			const payload = await yamlRun(["capabilities", "--fresh"], 3, {
				readStoredSession: async () => current,
				writeStoredSession: async (session) => {
					current = session;
				},
				now: () => Date.parse("2026-07-13T00:00:00.000Z"),
			});
			assert.equal(payload.schema_version, "ceal.capabilities.v1");
			assert.equal(payload.session_refresh, "quarantined");
			assert.equal(payload.error.kind, "session_refresh_attempt_unknown");
			assert.equal(payload.error.retryable, true);
			assert.equal(payload.live_gateway_checked, false);
			assert.equal(current.renewalBlockedReason, "outcome_unknown");
			assert.match(current.refreshAttemptRef ?? "", /^ceal_refresh_attempt_[A-Za-z0-9_-]{43}$/u);
			assert.equal(refreshCalls(), 1);
			assert.deepEqual(requests, []);
		},
		{ invalidRefreshResponse: true },
	);
});

test("capabilities quarantines a v2 refresh when the Gateway recovery key is unavailable", async () => {
	await withRenewingGateway(
		async ({ endpoint, oldRefreshToken, refreshCalls }) => {
			let current = storedSession(endpoint, { expiresAt: "2020-01-01T00:00:00.000Z", refreshToken: oldRefreshToken });
			const payload = await yamlRun(["capabilities", "--fresh"], 3, {
				readStoredSession: async () => current,
				writeStoredSession: async (session) => {
					current = session;
				},
			});
			assert.equal(payload.session_refresh, "quarantined");
			assert.equal(payload.error.kind, "refresh_recovery_unavailable");
			assert.equal(payload.error.retryable, true);
			assert.equal(current.renewalBlockedReason, "outcome_unknown");
			assert.match(current.refreshAttemptRef ?? "", /^ceal_refresh_attempt_[A-Za-z0-9_-]{43}$/u);
			assert.equal(refreshCalls(), 1);
		},
		{ refreshDeniedCode: "refresh_recovery_unavailable" },
	);
});

test("an observational acceptance read does not require a durable refresh quarantine", async () => {
	await withRenewingGateway(async ({ endpoint, oldRefreshToken, refreshCalls }) => {
		const runtime = {
			readStoredSession: async () => storedSession(endpoint, { expiresAt: "2020-01-01T00:00:00.000Z", refreshToken: oldRefreshToken }),
			writeStoredSession: async () => {
				throw new Error("disk unavailable");
			},
		};
		const payload = await yamlRun(["session", "refresh"], 3, runtime);
		assert.equal(payload.schema_version, "ceal.session_refresh.v1");
		assert.equal(payload.error.kind, "session_save_failed");
		assert.match(payload.error.message, /stored Gateway session could not be used safely/u);
		assert.match(payload.error.next_action, /ceal session status/u);
		assert.doesNotMatch(payload.error.next_action, /network reachability/u);
		assert.doesNotMatch(payload.error.next_action, /device-enrollment code/u);

		const acceptance = await yamlRun(["acceptance", "emit"], 0, {
			...runtime,
			readInstalledReleaseFacts: installedReleaseReading,
		});
		assert.equal(acceptance.schema_version, "ceal.worker_acceptance_result.v2");
		assert.equal(acceptance.status, "emitted");
		assert.equal(refreshCalls(), 0);
	});
});

test("acceptance readback carries the last Gateway timing from its receipt projection", async () => {
	await withGateway(async ({ endpoint }: { endpoint: string }) => {
		const payload = await yamlRun(["acceptance", "emit", "--request-ref", "narnia:call:1:call"], 0, {
			readStoredSession: async () => storedSession(endpoint),
			readInstalledReleaseFacts: installedReleaseReading,
		});
		assert.equal(payload.status, "emitted");
		assert.equal(payload.bounded_capability_call.receipt.gateway_elapsed_ms, 42);
	});
});

test("typed Gateway refresh denial requires reenrollment instead of retry", async () => {
	await withRenewingGateway(
		async ({ endpoint, oldRefreshToken, refreshCalls }) => {
			let current = storedSession(endpoint, { expiresAt: "2020-01-01T00:00:00.000Z", refreshToken: oldRefreshToken });
			const payload = await yamlRun(["session", "refresh"], 3, {
				readStoredSession: async () => current,
				writeStoredSession: async (session) => {
					current = session;
				},
			});
			assert.equal(payload.schema_version, "ceal.session_refresh.v1");
			assert.equal(payload.error.kind, "refresh_invalid");
			assert.equal(payload.error.retryable, false);
			assert.match(payload.error.next_action, /ceal session enroll --help/u);
			assert.match(payload.error.next_action, /ceal session adopt --help/u);
			assert.equal(current.renewalBlockedReason, "refresh_invalid");
			assert.equal(refreshCalls(), 1);
			const blockedRetry = await yamlRun(["session", "refresh"], 3, {
				readStoredSession: async () => current,
				writeStoredSession: async () => assert.fail("blocked refresh must not save"),
			});
			assert.equal(blockedRetry.schema_version, "ceal.session_refresh.v1");
			assert.equal(blockedRetry.error.kind, "refresh_invalid");
			assert.equal(refreshCalls(), 1);
		},
		{ refreshDeniedCode: "refresh_invalid" },
	);
});

test("separate installed invocations recover a dropped refresh response with the same attempt", async () => {
	await withRenewingGateway(
		async ({ endpoint, oldRefreshToken, newRefreshToken, refreshCalls }) => {
			const home = mkdtempSync(path.join(tmpdir(), "ceal-refresh-quarantine-"));
			try {
				const sessionPath = path.join(home, ".ceal", "client-session.json");
				mkdirSync(path.dirname(sessionPath), { recursive: true, mode: 0o700 });
				writeFileSync(
					sessionPath,
					`${JSON.stringify(serializeStoredSession(storedSession(endpoint, { expiresAt: "2020-01-01T00:00:00.000Z", refreshToken: oldRefreshToken })), null, 2)}\n`,
					{ mode: 0o600 },
				);
				const first = await runBin(["session", "refresh"], "", { HOME: home });
				assert.equal(first.code, 3, first.stdout);
				assert.match(first.stdout, /same attempt may be recovered/u);
				const persisted = JSON.parse(readFileSync(sessionPath, "utf8"));
				assert.equal(persisted.schema_version, "ceal.client_session_store.v3");
				assert.match(persisted.refresh_attempt_ref, /^ceal_refresh_attempt_[A-Za-z0-9_-]{43}$/u);
				assert.equal(persisted.renewal_blocked_reason, "outcome_unknown");
				assert.equal(refreshCalls(), 1);

				const second = await runBin(["session", "refresh"], "", { HOME: home });
				assert.equal(second.code, 0, second.stdout);
				assert.equal(parseYaml(second.stdout).status, "refreshed");
				const recovered = JSON.parse(readFileSync(sessionPath, "utf8"));
				assert.equal(recovered.refresh_token, newRefreshToken);
				assert.equal(Object.hasOwn(recovered, "refresh_attempt_ref"), false);
				assert.equal(Object.hasOwn(recovered, "renewal_blocked_reason"), false);
				assert.equal(refreshCalls(), 2, "the second process must recover the same attempt, not rotate again");
			} finally {
				rmSync(home, { recursive: true, force: true });
			}
		},
		{ invalidRefreshResponse: true, recoverAfterUnknown: true },
	);
});

test("logout retains local session when Gateway revocation transport is unavailable", async () => {
	await withRenewingGateway(
		async ({ endpoint, oldRefreshToken }) => {
			let removed = false;
			const payload = await yamlRun(["session", "logout"], 3, {
				readStoredSession: async () => storedSession(endpoint, { refreshToken: oldRefreshToken }),
				deleteStoredSession: async () => {
					removed = true;
				},
			});
			assert.equal(payload.schema_version, "ceal.session_logout.v1");
			assert.equal(payload.server_session_revoked, false);
			assert.equal(payload.local_session_removed, false);
			assert.equal(payload.local_derived_state_cleared, false);
			assert.equal(payload.error.kind, "session_revocation_unavailable");
			assert.equal(payload.error.retryable, true);
			assert.match(payload.error.next_action, /Keep the local session/u);
			assert.equal(removed, false);
		},
		{ invalidRevokeResponse: true },
	);
});

test("every logout precondition failure stays in the logout result contract", async () => {
	const unavailable = await yamlRun(["session", "logout"], 3);
	assert.equal(unavailable.schema_version, "ceal.session_logout.v1");
	assert.equal(unavailable.error.kind, "session_runtime_unavailable");
	assert.doesNotMatch(unavailable.error.next_action, /Gateway URL|device-enrollment code/u);

	const unsafe = await yamlRun(["session", "logout"], 3, {
		readStoredSession: async () => {
			throw new CealSessionStoreError("unsafe_store");
		},
		deleteStoredSession: async () => assert.fail("an unreadable session is not removed"),
	});
	assert.equal(unsafe.schema_version, "ceal.session_logout.v1");
	assert.equal(unsafe.error.kind, "unsafe_store");
	assert.equal(unsafe.server_session_revoked, false);
	assert.equal(unsafe.local_session_removed, false);

	const lockedLoadFailure = await yamlRun(["session", "logout"], 3, {
		readStoredSession: async () => assert.fail("the locked store owns loading"),
		deleteStoredSession: async () => assert.fail("an unreadable session is not removed"),
		runWithLockedSession: async (action) =>
			action({
				load: async () => {
					throw new Error("unclassified local read failure");
				},
				save: async () => assert.fail("logout does not save"),
				replace: async () => assert.fail("logout does not replace"),
				remove: async () => assert.fail("an unreadable session is not removed"),
			}),
	});
	assert.equal(lockedLoadFailure.error.kind, "session_load_failed");
	assert.doesNotMatch(lockedLoadFailure.error.next_action, /Gateway URL|network/u);
});

test("logout removes local state when the Gateway says the refresh credential is already retired", async () => {
	for (const retiredCode of ["refresh_revoked", "refresh_invalid", "refresh_expired", "refresh_replayed"]) {
		await withEnrollmentGateway(
			async ({ endpoint, refreshToken }) => {
				let removed = false;
				const payload = await yamlRun(["session", "logout"], 0, {
					readStoredSession: async () => storedSession(endpoint, { refreshToken }),
					deleteStoredSession: async () => {
						removed = true;
					},
					removeDiscoveryCache: async () => {},
					removeReceiptSpool: async () => {},
				});
				assert.equal(payload.status, "logged_out", retiredCode);
				assert.equal(payload.server_session_revoked, false, retiredCode);
				assert.equal(payload.server_session_disposition, "already_unusable", retiredCode);
				assert.equal(removed, true, retiredCode);
			},
			{ revokeDeniedCode: retiredCode },
		);
	}
});

test("capabilities does not retry an authentication rejection or rotate a still-current session", async () => {
	await withRenewingGateway(
		async ({ endpoint, oldRefreshToken, requests, refreshCalls }) => {
			const payload = await yamlRun(["capabilities"], 3, {
				readStoredSession: async () =>
					storedSession(endpoint, { refreshToken: oldRefreshToken, refreshTokenAbsoluteExpiresAt: "2099-10-14T00:00:00.000Z" }),
				nextRequestId: () => "narnia:retry:001",
			});
			assert.equal(payload.error.kind, "authentication_failed");
			assert.equal(payload.session_refresh, "none");
			assert.match(payload.error.next_action, /No additional refresh|HTTP 401/u);
			assert.doesNotMatch(payload.error.next_action, /ceal session refresh/u);
			assert.equal(refreshCalls(), 0);
			assert.deepEqual(
				requests.map((item) => item.authorization),
				[`Bearer ${"ceal_personal_"}${"P".repeat(43)}`],
			);
		},
		{ rejectFirstGateway: true },
	);
});

test("session logout revokes the server session before removing every session-derived store", async () => {
	await withRenewingGateway(async ({ endpoint, oldRefreshToken, revoked }) => {
		const cleared: string[] = [];
		const payload = await yamlRun(["session", "logout"], 0, {
			readStoredSession: async () => storedSession(endpoint, { refreshToken: oldRefreshToken }),
			deleteStoredSession: async () => {
				cleared.push("session");
			},
			removeDiscoveryCache: async () => {
				cleared.push("discovery_cache");
			},
			// The spool is session-derived — it holds this session's request refs,
			// audit refs, and capability/target refs for thirty days. Leaving it made
			// `ceal observe` render a revoked binding's history beside
			// `Session (absent)`, and the logout path asserted the opposite in a
			// comment while no test looked.
			removeReceiptSpool: async () => {
				cleared.push("receipt_spool");
			},
		});
		assert.equal(payload.status, "logged_out");
		assert.equal(payload.server_session_revoked, true);
		assert.equal(payload.server_session_disposition, "revoked");
		assert.equal(payload.local_derived_state_cleared, true);
		const sessionCommand = CEAL_COMMANDS.find((command) => command.name === "session");
		assert.ok(sessionCommand);
		assert.equal(payload.next_action, sessionCommand.recovery);
		assert.deepEqual(revoked, [oldRefreshToken]);
		assert.deepEqual(cleared.sort(), ["discovery_cache", "receipt_spool", "session"]);
	});
	// A store that refuses to clear may not turn a completed revocation into a
	// failure: the server session is already gone, and reporting otherwise would
	// send the operator to revoke something that no longer exists.
	await withRenewingGateway(async ({ endpoint, oldRefreshToken }) => {
		const payload = await yamlRun(["session", "logout"], 0, {
			readStoredSession: async () => storedSession(endpoint, { refreshToken: oldRefreshToken }),
			deleteStoredSession: async () => {},
			removeReceiptSpool: async () => {
				throw new Error("spool store is unsafe");
			},
		});
		assert.equal(payload.status, "logged_out");
		assert.equal(payload.server_session_revoked, true);
		assert.equal(payload.server_session_disposition, "revoked");
		assert.equal(payload.local_derived_state_cleared, false);
		assert.match(payload.next_action, /cached local state could not be cleared/u);
		assert.match(payload.next_action, /ceal session logout/u);
	});
});

test("logout preserves completed Gateway revocation when locked local session removal fails", async () => {
	await withRenewingGateway(async ({ endpoint, oldRefreshToken, revoked }) => {
		const session = storedSession(endpoint, { refreshToken: oldRefreshToken });
		let cleanupAttempted = false;
		const payload = await yamlRun(["session", "logout"], 3, {
			readStoredSession: async () => session,
			deleteStoredSession: async () => assert.fail("the locked store owns removal"),
			runWithLockedSession: async (action) =>
				action({
					load: async () => session,
					save: async () => assert.fail("logout does not save"),
					replace: async () => assert.fail("logout does not replace"),
					remove: async () => {
						throw new CealSessionStoreError("unsafe_store");
					},
				}),
			removeDiscoveryCache: async () => {
				cleanupAttempted = true;
			},
			removeReceiptSpool: async () => {
				cleanupAttempted = true;
			},
		});
		assert.equal(payload.schema_version, "ceal.session_logout.v1");
		assert.equal(payload.status, "local_cleanup_failed");
		assert.equal(payload.server_session_revoked, true);
		assert.equal(payload.server_session_disposition, "revoked");
		assert.equal(payload.local_session_removed, false);
		assert.equal(payload.local_derived_state_cleared, false);
		assert.equal(payload.error.kind, "unsafe_store");
		assert.match(payload.error.next_action, /already revoked or unusable/u);
		assert.doesNotMatch(payload.error.next_action, /network|reachability/u);
		assert.deepEqual(revoked, [oldRefreshToken]);
		assert.equal(cleanupAttempted, false, "derived cleanup waits until the credential store can be removed safely");
	});
});

test("call invokes one granted capability and independently reads back its audit event", async () => {
	await withGateway(async ({ endpoint, requests }) => {
		const payload = await yamlRun(["call", "message.search", "--target", "target:team-inbox", "query=launch", "limit=3"], 0, {
			readStoredSession: async () => storedSession(endpoint),
			nextRequestId: (() => {
				let id = 0;
				return () => `narnia:call:${++id}`;
			})(),
		});
		assert.equal(payload.schema_version, "ceal.result.v2");
		assert.equal(payload.status, "completed");
		assert.equal(payload.capability, "message.search");
		assert.equal(payload.target, "target:team-inbox");
		assert.equal(payload.data.results.length, 1);
		assert.equal(payload.receipt.evidence, "readback_verified");
		assert.deepEqual(payload.receipt.verification, {
			gateway_audit_readback: "verified",
			provider_state_readback: "not_established",
		});
		assert.equal(payload.receipt.request_ref, "narnia:call:1:call");
		assert.equal("usage" in payload, false);
		assert.equal("profile" in payload, false);
		assert.equal("audit" in payload, false);
		assert.deepEqual(
			requests.map((item) => item.body.operation),
			["call", "readback"],
		);
		const firstRequest = requiredValue(requests[0], "first_call_request");
		const firstArguments = firstRequest.body.body.arguments;
		assert.ok(firstArguments);
		assert.equal(firstArguments.query, "launch");
		assert.equal(firstRequest.body.body.purpose, "Invoke capability 'message.search' for the current task.");
		assert.doesNotMatch(firstRequest.body.body.purpose, /approved/iu);
	});
});

test("call spools an allowlisted receipt projection and a spool failure never changes the result", async () => {
	await withGateway(async ({ endpoint }) => {
		const spooled: CealReceiptSpoolEntry[] = [];
		const payload = await yamlRun(["call", "message.search", "--target", "target:team-inbox", "query=launch"], 0, {
			readStoredSession: async () => storedSession(endpoint),
			nextRequestId: (() => {
				let id = 0;
				return () => `narnia:spool:${++id}`;
			})(),
			recordReceiptSpool: (_identity: string, entry: CealReceiptSpoolEntry): void => {
				spooled.push(entry);
			},
			now: () => Date.parse("2026-07-24T12:00:00.000Z"),
		});
		assert.equal(payload.status, "completed");
		assert.deepEqual(spooled, [
			{
				recordedAt: Date.parse("2026-07-24T12:00:00.000Z"),
				requestRef: "narnia:spool:1:call",
				status: "completed",
				evidence: "readback_verified",
				auditRefs: ["gateway-audit:event:001"],
				capabilityId: "message.search",
				targetRef: "target:team-inbox",
			},
		]);
		// The spooled projection may never carry call arguments or result data.
		assert.equal(JSON.stringify(spooled).includes("launch"), false);
	});
	await withGateway(async ({ endpoint }) => {
		const broken = await yamlRun(["call", "message.search", "--target", "target:team-inbox", "query=launch"], 0, {
			readStoredSession: async () => storedSession(endpoint),
			recordReceiptSpool: () => {
				throw new Error("spool unavailable");
			},
		});
		assert.equal(broken.status, "completed");
		assert.equal(broken.receipt.evidence, "readback_verified");
	});
});

test("a pre-issue call failure is not spooled while an issued unknown-outcome failure is", async () => {
	const spoolState: { entries: CealReceiptSpoolEntry[] } = { entries: [] };
	await yamlRun(["call", "message.search", "--target", "target:team-inbox", "query=launch"], 3, {
		recordReceiptSpool: (_identity: string, entry: CealReceiptSpoolEntry): void => {
			spoolState.entries.push(entry);
		},
	});
	assert.deepEqual(spoolState.entries, []);
	await yamlRun(["call", "message.search", "--target", "target:team-inbox", "query=launch"], 3, {
		readStoredSession: async () => storedSession("http://127.0.0.1:9"),
		recordReceiptSpool: (_identity: string, entry: CealReceiptSpoolEntry): void => {
			spoolState.entries.push(entry);
		},
		now: () => Date.parse("2026-07-24T12:00:00.000Z"),
	});
	assert.deepEqual(spoolState.entries, [
		{
			recordedAt: Date.parse("2026-07-24T12:00:00.000Z"),
			requestRef: "ceal:call:call",
			status: "error",
			evidence: "outcome_unknown",
			auditRefs: [],
			capabilityId: "message.search",
			targetRef: "target:team-inbox",
			errorKind: "request_failed",
		},
	]);
});

test("receipt keeps audit metadata out of normal results and retrieves a safe projection on demand", async () => {
	await withGateway(async ({ endpoint, requests }) => {
		const payload = await yamlRun(["receipt", "show", "narnia:call:1:call"], 0, {
			readStoredSession: async () => storedSession(endpoint),
			nextRequestId: () => "narnia:receipt:1",
		});
		assert.deepEqual(payload, {
			schema_version: "ceal.receipt.v1",
			ok: true,
			status: "verified",
			verification: {
				gateway_audit_readback: "verified",
				provider_state_readback: "not_established",
			},
			request_ref: "narnia:call:1:call",
			gateway: { instance_ref: "instance:corca", profile_ref: "profile:narnia" },
			events: [
				{
					ref: "gateway-audit:event:001",
					operation: "call",
					outcome: "succeeded",
					authorization: "allowed",
					capability: "message.search",
					target: "target:team-inbox",
					grant: { ref: "grant:team-inbox-message-search", revision: 4 },
					timing: { gateway_elapsed_ms: 42 },
				},
			],
		});
		assert.deepEqual(
			requests.map((item) => item.body.operation),
			["readback"],
		);
	});
});

test("a policy-denied receipt retains the error code, non-claims, and negotiated Gateway timing", async () => {
	await withGateway(
		async ({ endpoint }) => {
			const payload = await yamlRun(["receipt", "show", "narnia:denied:1:call"], 0, {
				readStoredSession: async () => storedSession(endpoint),
				nextRequestId: () => "narnia:denied-receipt:1",
			});
			assert.deepEqual(payload, {
				schema_version: "ceal.receipt.v1",
				ok: true,
				status: "verified",
				verification: {
					gateway_audit_readback: "verified",
					provider_state_readback: "not_established",
				},
				request_ref: "narnia:denied:1:call",
				gateway: { instance_ref: "instance:corca", profile_ref: "profile:narnia" },
				events: [
					{
						ref: "gateway-audit:event:denied",
						operation: "call",
						outcome: "denied",
						authorization: "denied",
						error_code: "resource_not_available",
						non_claims: ["provider_execution_not_reached", "production_audit_not_reached"],
						timing: { gateway_elapsed_ms: 6892 },
					},
				],
			});
		},
		(request) => policyDeniedReadbackResponse(request),
	);
});

test("a legacy readback without negotiated timing omits the timing block instead of rendering zero", async () => {
	await withGateway(
		async ({ endpoint }) => {
			const payload = await yamlRun(["receipt", "show", "narnia:denied:2:call"], 0, {
				readStoredSession: async () => storedSession(endpoint),
				nextRequestId: () => "narnia:denied-receipt:2",
			});
			assert.equal(payload.status, "verified");
			assert.equal("timing" in payload.events[0], false);
		},
		(request) => {
			const response = policyDeniedReadbackResponse(request);
			assert.ok(response.ok);
			const events = fixtureRecordArrayField(response.value, "events");
			const firstEvent = events[0];
			assert.ok(firstEvent);
			delete firstEvent.gateway_elapsed_ms;
			return response;
		},
	);
});

test("a decoder-legal invalid call-detail timing is omitted, not rendered", async () => {
	await withGateway(
		async ({ endpoint }) => {
			const payload = await yamlRun(["receipt", "show", "narnia:call:3:call"], 0, {
				readStoredSession: async () => storedSession(endpoint),
				nextRequestId: () => "narnia:receipt:3",
			});
			assert.equal(payload.status, "verified");
			assert.equal("timing" in payload.events[0], false);
		},
		(request) => {
			const response = readbackResponse(request);
			assert.ok(response.ok);
			const events = fixtureRecordArrayField(response.value, "events");
			const firstEvent = events[0];
			assert.ok(firstEvent);
			fixtureRecordField(firstEvent, "call").gateway_elapsed_ms = 42.5;
			return response;
		},
	);
});

test("event-level Gateway timing stays authoritative over successful call-detail timing", async () => {
	await withGateway(
		async ({ endpoint }) => {
			const payload = await yamlRun(["receipt", "show", "narnia:call:2:call"], 0, {
				readStoredSession: async () => storedSession(endpoint),
				nextRequestId: () => "narnia:receipt:2",
			});
			assert.deepEqual(payload.events[0].timing, { gateway_elapsed_ms: 57 });
		},
		(request) => {
			const response = readbackResponse(request);
			assert.ok(response.ok);
			const events = fixtureRecordArrayField(response.value, "events");
			const firstEvent = events[0];
			assert.ok(firstEvent);
			firstEvent.gateway_elapsed_ms = 57;
			return response;
		},
	);
});

test("stored client Session selects an assigned Profile per request without another login", async () => {
	await withGateway(async ({ endpoint, requests }) => {
		const runtime = {
			readStoredSession: async () => storedSession(endpoint),
			nextRequestId: (() => {
				let index = 0;
				return () => `narnia:profile:${++index}`;
			})(),
		};
		const capabilities = await yamlRun(["capabilities", "--profile", "profile:ax"], 0, runtime);
		assert.equal(capabilities.gateway.profile_ref, "profile:ax");
		const call = await yamlRun(
			["call", "message.search", "--profile", "profile:ax", "--target", "target:team-inbox", "query=launch"],
			0,
			runtime,
		);
		assert.equal(call.status, "completed");
		const receipt = await yamlRun(["receipt", "show", "narnia:profile:3:call", "--profile", "profile:ax"], 0, runtime);
		assert.equal(receipt.status, "verified");
		assert.deepEqual(
			requests.map((item) => item.body.profile_ref),
			["profile:ax", "profile:ax", "profile:ax", "profile:ax", "profile:ax"],
		);
	});
});

test("call refuses to claim completion when audit readback has no verified event", () => {
	let stdout = "";
	const code = writeCallCompleted(
		{
			schema_version: "ceal.gateway_call_result.v1",
			capability_id: "file.search",
			grant_ref: "grant:workspace-file-search",
			grant_revision: 7,
			target_ref: "target:workspace",
			data: { schema_version: "ceal.file_search_result.v1", results: [{ ref: "file:roadmap", label: "Roadmap" }] },
			redaction: { state: "applied", omitted_classes: ["raw_provider_ids"] },
			host_decision: "accepted",
			proof_level: "host_decision",
			non_claims: ["production_audit_not_reached"],
		},
		[],
		"request:missing-readback",
		{
			stdout: {
				write: (chunk) => {
					stdout += String(chunk);
				},
			},
		},
		null,
		{
			ok: true,
			capabilityId: "file.search",
			targetRef: "target:workspace",
			arguments: {},
			purpose: "Search",
		},
	);
	assert.equal(code, 3);
	const payload = parseYaml(stdout);
	assert.equal(payload.status, "error");
	assert.equal(payload.receipt.evidence, "readback_unavailable");
	assert.deepEqual(payload.receipt.audit_refs, []);
	assert.equal(payload.error.kind, "audit_readback_missing");
});

// The Protocol calls `cache_origin` the SOLE live-vs-replay discriminator: a
// cache serve replays the original serve's `non_claims` verbatim, so nothing else
// in the document distinguishes an hour-old replay from a fresh provider read.
// The envelope used to copy `data` alone, and the guide tells an agent to report
// completion once audit evidence is present — which a replay carries.
test("a served call result carries the cache and redaction provenance a reader needs to tell a replay from a live read", () => {
	const render = (extra: Record<string, unknown>) => {
		let stdout = "";
		writeCallCompleted(
			{
				schema_version: "ceal.gateway_call_result.v1",
				capability_id: "file.search",
				grant_ref: "grant:workspace-file-search",
				grant_revision: 7,
				target_ref: "target:workspace",
				data: { schema_version: "ceal.file_search_result.v1", results: [] },
				redaction: { state: "applied", omitted_classes: [] },
				host_decision: "accepted",
				proof_level: "host_decision",
				non_claims: ["production_audit_not_reached"],
				...extra,
			},
			[{ event_ref: "audit:1" }],
			"request:1",
			{
				stdout: {
					write: (chunk: string) => {
						stdout += String(chunk);
					},
				},
			},
			null,
			{ ok: true, capabilityId: "file.search", targetRef: "target:workspace", arguments: {}, purpose: "Search" },
		);
		return parseYaml(stdout);
	};

	const replay = render({
		cache_origin: { schema_version: "ceal.gateway_cache_origin.v1", origin_at: "2026-08-09T00:00:00.000Z", age_ms: 3_600_000 },
		redaction: { state: "applied", omitted_classes: ["raw_provider_ids"] },
	});
	assert.equal(replay.status, "completed");
	assert.equal(replay.cache_origin.age_ms, 3_600_000);
	assert.equal(replay.cache_origin.origin_at, "2026-08-09T00:00:00.000Z");
	assert.deepEqual(replay.redaction.omitted_classes, ["raw_provider_ids"]);

	// A fresh serve must stay distinguishable by ABSENCE, so neither field may be
	// emitted empty — that would make the discriminator always present and useless.
	const live = render({});
	assert.equal(Object.hasOwn(live, "cache_origin"), false);
	assert.equal(Object.hasOwn(live, "redaction"), false);
});

// corca-ai/ceal-cli#3: two instances answer with the same profile name, the same
// client, and cross-stable target refs, so a result that does not name its
// issuing Gateway cannot be attributed after the fact. A study mixed 2,387
// records from two instances exactly this way.
test("every call result names the issuing instance and the profile it used", async () => {
	const session = {
		gatewayEndpoint: "https://gateway.example/api/ceal/v1",
		profileRef: "profile:work",
		membershipRef: "membership:hwidong-work",
		registrationRef: "registration:1",
		clientRef: "client:narnia",
		subjectRef: "subject:hwidong",
		instanceRef: "instance:ceal-prod",
		accessToken: "token",
		expiresAt: new Date(Date.now() + 600_000).toISOString(),
		refreshToken: "refresh",
		refreshTokenIdleExpiresAt: new Date(Date.now() + 600_000).toISOString(),
		refreshTokenAbsoluteExpiresAt: new Date(Date.now() + 600_000).toISOString(),
	};
	let stdout = "";
	const io = {
		stdout: {
			write: (chunk: string) => {
				stdout += String(chunk);
			},
		},
	};
	writeCallCompleted(
		{
			schema_version: "ceal.gateway_call_result.v1",
			capability_id: "message.get",
			grant_ref: "grant:g",
			grant_revision: 1,
			target_ref: "target:t",
			data: { schema_version: "ceal.message_get_result.v1", ref: "message:1" },
			redaction: { state: "applied", omitted_classes: [] },
			host_decision: "accepted",
			proof_level: "host_decision",
			non_claims: [],
		},
		[{ event_ref: "gateway-audit:1" }],
		"request:1",
		io,
		session,
		{
			// The per-call override, not the session default, is what answered.
			ok: true,
			capabilityId: "message.get",
			targetRef: "target:t",
			arguments: {},
			purpose: "Read",
			profileRef: "profile:kb-study",
		},
	);
	const completed = parseYaml(stdout);
	assert.deepEqual(completed.gateway, { instance_ref: "instance:ceal-prod", profile_ref: "profile:kb-study" });

	// A failure path is where misattribution is most likely, so it carries the
	// same stamp; with no session resolved there is nothing to claim.
	const failure = await yamlRun(["call", "message.get", "--target", "target:t"], 3, {
		readStoredSession: async () => session,
		nextRequestId: () => "ceal:test",
	});
	assert.deepEqual(failure.gateway, { instance_ref: "instance:ceal-prod", profile_ref: "profile:work" });
	const unresolved = await yamlRun(["call", "message.get", "--target", "target:t"], 3);
	assert.equal(unresolved.gateway, undefined);
});

test("compatibility result data passes through without a client-side message projection", () => {
	let stdout = "";
	const code = writeCallCompleted(
		{
			schema_version: "ceal.gateway_call_result.v1",
			capability_id: "message.get",
			grant_ref: "grant:team-inbox-message-get",
			grant_revision: 4,
			target_ref: "target:team-inbox",
			data: {
				schema_version: "ceal.message_get_result.v1",
				ref: "message:approved_001",
				source_label: "Team inbox",
				source: { provider: "slack", url: "https://workspace.slack.com/archives/C0123456789/p1720000000000100" },
				text: "Full authorized message text.",
				offset: 0,
			},
			redaction: { state: "applied", omitted_classes: ["credential_material"] },
			host_decision: "accepted",
			proof_level: "host_decision",
			non_claims: ["production_audit_not_reached"],
		},
		[{ event_ref: "gateway-audit:get:001" }],
		"request:get:001",
		{
			stdout: {
				write: (chunk) => {
					stdout += String(chunk);
				},
			},
		},
		null,
		{
			ok: true,
			capabilityId: "message.get",
			targetRef: "target:team-inbox",
			arguments: {},
			purpose: "Read",
		},
	);
	assert.equal(code, 0);
	const payload = parseYaml(stdout);
	assert.deepEqual(payload, {
		schema_version: "ceal.result.v2",
		ok: true,
		status: "completed",
		capability: "message.get",
		target: "target:team-inbox",
		data: {
			schema_version: "ceal.message_get_result.v1",
			ref: "message:approved_001",
			source_label: "Team inbox",
			source: { provider: "slack", url: "https://workspace.slack.com/archives/C0123456789/p1720000000000100" },
			text: "Full authorized message text.",
			offset: 0,
		},
		// `data` is untouched, which is what this test is about. The Gateway's own
		// redaction statement travels beside it rather than being folded into it:
		// dropped, a withheld class read as one the provider does not have.
		redaction: { state: "applied", omitted_classes: ["credential_material"] },
		receipt: {
			evidence: "readback_verified",
			verification: {
				gateway_audit_readback: "verified",
				provider_state_readback: "not_established",
			},
			request_ref: "request:get:001",
			audit_refs: ["gateway-audit:get:001"],
		},
	});
});

test("compatibility result data passes through without a client-side write projection", async () => {
	let stdout = "";
	const code = writeCallCompleted(
		{
			schema_version: "ceal.gateway_call_result.v1",
			capability_id: "message.create",
			grant_ref: "grant:team-inbox-message-create",
			grant_revision: 4,
			target_ref: "target:team-inbox",
			data: {
				schema_version: "ceal.message_create_result.v1",
				delivery: "verified",
				message_ref: "message:created_001",
				reply_to: "message:approved_001",
			},
			redaction: { state: "applied", omitted_classes: ["message_text", "idempotency_key", "provider_locator", "provider_identity"] },
			host_decision: "accepted",
			proof_level: "host_decision",
			non_claims: ["production_audit_not_reached"],
		},
		[{ event_ref: "gateway-audit:create:001" }],
		"request:create:001",
		{
			stdout: {
				write: (chunk) => {
					stdout += String(chunk);
				},
			},
		},
		null,
		{
			ok: true,
			capabilityId: "message.create",
			targetRef: "target:team-inbox",
			arguments: {},
			purpose: "Reply",
		},
	);
	assert.equal(code, 0);
	const payload = parseYaml(stdout);
	assert.deepEqual(payload.data, {
		schema_version: "ceal.message_create_result.v1",
		delivery: "verified",
		message_ref: "message:created_001",
		reply_to: "message:approved_001",
	});
});

test("call does not impose a legacy capability-specific operand allowlist", async () => {
	const payload = await yamlRun(
		[
			"call",
			"message.create",
			"--target",
			"target:team-inbox",
			"reply_to=message:approved_001",
			"text=Approved",
			"idempotency_key=retry-001",
			"format=compact",
		],
		3,
		{ readStoredSession: async () => storedSession("http://127.0.0.1:9") },
	);
	assert.equal(payload.error.kind, "request_failed");
	assert.deepEqual(payload.receipt, {
		evidence: "outcome_unknown",
		verification: {
			gateway_audit_readback: "not_read_back",
			provider_state_readback: "not_established",
		},
		request_ref: "ceal:call:call",
		audit_refs: [],
	});
	// The effect is unknown here (no discovery cache), so the caution stands.
	assert.match(payload.error.next_action, /Do not repeat this call yet/u);
	assert.match(payload.error.next_action, /ceal receipt show ceal:call:call/u);
	assert.match(payload.error.next_action, /audit_event_not_found/u);
});

// corca-ai/ceal-cli#2 item 3: the failing capability was a declared read, and
// write-grade caution on an idempotent read makes an agent apply replay
// discipline that does not apply — and makes a later transcript reader see a
// write that never existed.
test("an unknown outcome on a declared read does not warn about repeating a write", async () => {
	const session = storedSession("http://127.0.0.1:9");
	const payload = await yamlRun(["call", "message.search", "--target", "target:team-inbox", "query=launch"], 3, {
		readStoredSession: async () => session,
		// A real cached entry: the effect lookup trusts the cache only under the
		// same identity and freshness rules the catalog path uses.
		loadDiscoveryCache: async () => cachedEntry(session.gatewayEndpoint, Date.now()),
	});
	assert.equal(payload.error.kind, "request_failed");
	assert.equal(payload.receipt.evidence, "outcome_unknown");
	assert.doesNotMatch(payload.error.next_action, /Do not repeat/u);
	// It still points at the route that resolves the unknown outcome.
	assert.match(payload.error.next_action, /ceal receipt show/u);
});

test("a rejected call followed by failed pre-send refresh quarantine is known pre-provider state, not an unknown receipt", async () => {
	await withRenewingGateway(
		async ({ endpoint, oldRefreshToken, requests }) => {
			const payload = await yamlRun(["call", "message.search", "--target", "target:team-inbox", "query=launch"], 3, {
				readStoredSession: async () => storedSession(endpoint, { refreshToken: oldRefreshToken }),
				writeStoredSession: async () => {
					throw new Error("local store unavailable");
				},
				nextRequestId: () => "narnia:renewal-failed:001",
			});
			assert.equal(payload.error.kind, "session_save_failed");
			assert.equal("receipt" in payload, false);
			assert.doesNotMatch(payload.error.next_action, /Do not repeat this call yet/u);
			assert.deepEqual(
				requests.map((request) => request.body.operation),
				["call"],
			);
		},
		{ rejectFirstGateway: true },
	);
});

test("target-catalog failures keep their exact code through the capabilities targets route", async () => {
	for (const expected of [
		{
			code: "target_catalog_selection_invalid",
			status: "unavailable",
			message: "server-controlled",
		},
		{
			code: "target_catalog_capability_not_granted",
			status: "denied",
			message: "server-controlled",
		},
	]) {
		await withGateway(
			async ({ endpoint, requests }) => {
				const payload = await yamlRun(["capabilities", "targets", "--capability", "message.search", "--match", "team"], 3, {
					readStoredSession: async () => storedSession(endpoint),
					nextRequestId: () => `narnia:${expected.code}`,
				});
				assert.equal(payload.error.kind, expected.code);
				assert.equal(payload.error.message, expected.message);
				assert.equal(payload.error.next_action, "server-controlled action");
				assert.equal(payload.status, expected.status);
				assert.equal(payload.live_gateway_checked, true);
				assert.deepEqual(
					requests.map((request) => request.body.operation),
					["handshake", "discover"],
				);
			},
			(request) =>
				request.operation === "handshake"
					? handshakeResponse(request)
					: {
							ok: false,
							request_id: request.request_id,
							protocol_version: "1.4.0",
							error: {
								code: expected.code,
								message: "server-controlled",
								next_action: "server-controlled action",
								recovery: { kind: "select_granted_scope" },
							},
						},
		);
	}
});

test("an invalid Gateway call renders caller correction without connector restoration", async () => {
	await withGateway(
		async ({ endpoint, requests }) => {
			const payload = await yamlRun(["call", "message.enumerate", "--target", "target:team-inbox", "limit=101"], 3, {
				readStoredSession: async () => storedSession(endpoint),
				nextRequestId: () => "narnia:invalid-arguments:001",
			});
			assert.equal(payload.error.kind, "invalid_arguments");
			assert.equal(payload.error.next_action, "server-controlled");
			assert.doesNotMatch(payload.error.next_action, /connector|Gateway status|same call/iu);
			assert.deepEqual(
				requests.map(({ body }) => body.operation),
				["call"],
			);
		},
		(request) => (request.operation === "call" ? invalidArgumentsFailureResponse(request) : failedReadbackResponse(request)),
	);
});

test("an opaque resource denial classifies at the call surface and defers disposition to the receipt", async () => {
	await withGateway(
		async ({ endpoint }) => {
			const runtime = {
				readStoredSession: async () => storedSession(endpoint),
				nextRequestId: (() => {
					let index = 0;
					return () => `narnia:opaque:${++index}`;
				})(),
			};
			const failed = await yamlRun(["call", "message.search", "--target", "target:team-inbox", "query=roadmap"], 3, runtime);
			assert.equal(failed.status, "error");
			assert.equal(failed.error.kind, "resource_not_available");
			assert.deepEqual(failed.receipt, {
				evidence: "not_read_back",
				verification: {
					gateway_audit_readback: "not_read_back",
					provider_state_readback: "not_established",
				},
				request_ref: "narnia:opaque:1:call",
				audit_refs: [],
			});
		},
		(request) =>
			request.operation === "call"
				? {
						ok: false,
						request_id: request.request_id,
						protocol_version: "1.4.0",
						error: { code: "resource_not_available", message: "server-controlled", next_action: "server-controlled" },
					}
				: policyDeniedReadbackResponse(request),
	);
});

test("a failed pre-provider call preserves its request ref and receipt exposes the safe failure phase", async () => {
	await withGateway(
		async ({ endpoint }) => {
			const runtime = {
				readStoredSession: async () => storedSession(endpoint),
				nextRequestId: (() => {
					let index = 0;
					return () => `narnia:failed:${++index}`;
				})(),
			};
			const failed = await yamlRun(["call", "message.get", "--target", "target:team-inbox", "ref=message:expired"], 3, runtime);
			assert.deepEqual(failed.receipt, {
				evidence: "not_read_back",
				verification: {
					gateway_audit_readback: "not_read_back",
					provider_state_readback: "not_established",
				},
				request_ref: "narnia:failed:1:call",
				audit_refs: [],
			});
			assert.equal(failed.error.kind, "continuation_not_available");

			const receipt = await yamlRun(["receipt", "show", "narnia:failed:1:call"], 0, runtime);
			assert.deepEqual(receipt.events[0], {
				ref: "gateway-audit:event:failed",
				operation: "call",
				outcome: "failed",
				authorization: "allowed",
				error_code: "continuation_not_available",
				non_claims: ["provider_execution_not_reached", "production_audit_not_reached"],
				capability: "message.get",
				target: "target:team-inbox",
				grant: { ref: "grant:team-inbox-message-get", revision: 4 },
			});
		},
		(request) => (request.operation === "call" ? continuationFailureResponse(request) : failedReadbackResponse(request)),
	);
});

// The Gateway lane owns this contract and shipped it as an immutable fixture; the
// bytes are pinned here so a silent edit to the copy cannot quietly relax what
// these four tests prove. Verified against the digest the request named.
const ANNOUNCEMENT_POLICY_FIXTURE_SHA256 = "afa97a8ecdcd59455bb4013743414adae469316f5172fd4a6e026a21f0270db0";
const ANNOUNCEMENT_POLICY_ABSENT = "scope not declared by the Gateway";

function announcementPolicyFixtureCase(name: string) {
	const bytes = readFileSync(new URL("./fixtures/gateway-announcement-policy-discovery.v1.json", import.meta.url));
	assert.equal(
		createHash("sha256").update(bytes).digest("hex"),
		ANNOUNCEMENT_POLICY_FIXTURE_SHA256,
		"the pinned announcement-policy fixture no longer matches the bytes the Gateway lane handed over",
	);
	const fixture = JSON.parse(bytes.toString("utf8"));
	const found = fixture.cases.find((item: { name: string }) => item.name === name);
	assert.ok(found, `fixture case ${name} is missing`);
	return found;
}

// Serve the fixture's capability rows verbatim through the ordinary discovery
// path, so what is under test is this client's rendering of Gateway-authored
// bytes rather than a locally invented policy shape.
async function renderFixtureCapabilities(caseName: string, args: readonly string[]): Promise<Awaited<ReturnType<typeof yamlRun>>> {
	const capabilities = announcementPolicyFixtureCase(caseName).response.value.capabilities;
	let payload: Awaited<ReturnType<typeof yamlRun>>;
	await withGateway(
		async ({ endpoint }) => {
			payload = await yamlRun(args, 0, {
				readStoredSession: async () => storedSession(endpoint),
				nextRequestId: () => "narnia:policy:001",
			});
		},
		(body) =>
			body.operation === "handshake"
				? handshakeResponse(body)
				: success(body, {
						schema_version: "ceal.gateway_discovery.v3",
						phase: "target_page",
						profile_ref: body.profile_ref,
						membership_ref: "membership:narnia",
						capabilities,
						targets: [],
						target_catalog: { target_count: 0, returned_count: 0, complete: true },
						host_decision: "accepted",
						proof_level: "host_decision",
						non_claims: ["provider_execution_not_reached", "production_audit_not_reached"],
					}),
	);
	return payload;
}

// 1. Exact rendering of the accepted closed policy shape.
test("an accepted announcement policy renders exactly the Gateway-authored values and nothing more", async () => {
	const source = announcementPolicyFixtureCase("negotiated_github_read").response.value.capabilities[0].announcement_policy;
	for (const args of [["capabilities"], ["capabilities", "--detail"]]) {
		const payload = await renderFixtureCapabilities("negotiated_github_read", args);
		const rendered = payload.capabilities[0].announcement_policy;
		assert.deepEqual(rendered, {
			scope_statement: source.scope_statement,
			provider_application_authority: source.provider_application_authority,
			explicit_request_required: source.explicit_request_required,
			provenance_requirement: source.provenance_requirement,
			non_claims: source.non_claims,
		});
		// The contract lists five values. `schema_version` and `scope_statement_kind`
		// are on the wire and are deliberately not among them, so a spread of the
		// decoded field would render two values the client is not permitted to show.
		assert.deepEqual(Object.keys(rendered).sort(), [
			"explicit_request_required",
			"non_claims",
			"provenance_requirement",
			"provider_application_authority",
			"scope_statement",
		]);
	}
});

// 2. Exact absent-policy fallback.
test("a legacy or non-accept response renders the exact not-declared wording, not silence", async () => {
	const source = announcementPolicyFixtureCase("legacy_or_non_accept").response.value.capabilities[0];
	assert.equal(Object.hasOwn(source, "announcement_policy"), false, "the legacy fixture case must carry no policy");
	for (const args of [["capabilities"], ["capabilities", "--detail"]]) {
		const payload = await renderFixtureCapabilities("legacy_or_non_accept", args);
		// Silence would read as "this capability has no scope restriction", which is
		// the inference the fixed wording exists to prevent.
		assert.equal(payload.capabilities[0].announcement_policy, ANNOUNCEMENT_POLICY_ABSENT);
	}
});

// 3. No provider-wide inference, no reference leakage, no duplicated readiness.
test("a rendered policy leaks no reference and does not restate capability readiness", async () => {
	const payload = await renderFixtureCapabilities("negotiated_github_read", ["capabilities", "--detail"]);
	const rendered = payload.capabilities[0].announcement_policy;
	const serialized = JSON.stringify(rendered);
	// Capability-level policy cannot carry target, grant, binding, credential,
	// evidence, or audit identity. Assert on the rendered bytes rather than on the
	// key list, so a nested addition is caught too.
	for (const forbidden of ["target_ref", "grant_ref", "grant_revision", "binding", "credential", "audit_ref", "evidence_ref", "proof_ref"]) {
		assert.doesNotMatch(serialized, new RegExp(forbidden, "u"), `announcement policy rendered ${forbidden}`);
	}
	// Readiness keeps its own closed vocabulary elsewhere; a policy that repeated
	// it would give an agent two sources of truth for whether a call can proceed.
	for (const readiness of ["ready", "degraded", "unavailable", "unknown"]) {
		assert.equal(Object.hasOwn(rendered, readiness), false);
	}
	assert.doesNotMatch(serialized, /"readiness"/u);
	// The scope statement is the Gateway's exact sentence, not a widened summary.
	assert.equal(rendered.scope_statement, "Repositories in the installed GitHub App installation.");
	assert.deepEqual(rendered.provider_application_authority, { kind: "github_app", granted_permissions: ["metadata:read"] });
});

// 4. Typed retry rendering, independently of policy.
test("retry_after_ms comes from a typed error recovery and never from an announcement policy", async () => {
	// A policy is explanatory; it must not become a quota or permission message.
	const payload = await renderFixtureCapabilities("negotiated_github_read", ["capabilities", "--detail"]);
	assert.doesNotMatch(JSON.stringify(payload.capabilities[0].announcement_policy), /retry_after_ms/u);
	// The typed recovery path is the only source of a retry, and it is unchanged.
	assert.deepEqual(
		classifyGatewayFailure({
			code: "quota_exceeded_v2",
			message: "server-controlled",
			next_action: "server-controlled prose",
			recovery: { kind: "retry", retry_after_ms: 30_000 },
		}),
		{
			code: "quota_exceeded_v2",
			message: "server-controlled",
			nextAction: "server-controlled prose",
			denial: false,
			// The wait travels with the classification now (corca-ai/ceal#642); an
			// unknown code degrading by recovery class keeps the Gateway's number.
			retryAfterMs: 30_000,
		},
	);
});

// corca-ai/ceal#642: a throttled caller could not learn a safe pace, so agents
// binary-searched it. The wait was on the wire the whole time — the renderer
// dropped it. The known-code table wins over a disagreeing recovery class, which
// is exactly how `rate_limited` used to lose the number sitting beside it.
// The classifier carrying the value is only half of it; the number has to reach
// the document an agent actually reads. This drives a throttled call through the
// ordinary CLI path and asserts the rendered YAML.
test("a throttled call renders the Gateway's wait in its error document", async () => {
	await withGateway(
		async ({ endpoint }) => {
			const payload = await yamlRun(["call", "message.search", "--target", "target:team-inbox", "query=x"], 3, {
				readStoredSession: async () => storedSession(endpoint),
				nextRequestId: () => "narnia:throttle:001",
			});
			assert.equal(payload.ok, false);
			assert.equal(payload.status, "error");
			assert.equal(payload.error.kind, "rate_limited");
			assert.equal(payload.error.retry_after_ms, 45_000);
			assert.equal(payload.error.message, "server-controlled");
		},
		(body) =>
			body.operation === "handshake"
				? handshakeResponse(body)
				: body.operation === "discover"
					? discoveryResponse(body)
					: {
							ok: false,
							request_id: body.request_id,
							protocol_version: "1.4.0",
							proof_ref_or_unavailable: `audit:${body.request_id}`,
							error: {
								code: "rate_limited",
								message: "server-controlled",
								next_action: "server-controlled prose",
								recovery: { kind: "retry", retry_after_ms: 45_000 },
							},
						},
	);
});

test("a throttle carries the Gateway's own wait instead of making the caller guess one", () => {
	const throttled = classifyGatewayFailure({
		code: "rate_limited",
		message: "server-controlled",
		next_action: "server-controlled prose",
		recovery: { kind: "retry", retry_after_ms: 45_000 },
	});
	assert.equal(throttled.code, "rate_limited");
	assert.equal(throttled.message, "server-controlled");
	assert.equal(throttled.retryAfterMs, 45_000);

	// Absence must stay absent. A default would be a locally invented backoff
	// presented as the Gateway's, and pacing against it is the same guess in a
	// more confident costume.
	const silent = classifyGatewayFailure({ code: "rate_limited", message: "x", next_action: "y", recovery: { kind: "retry" } });
	assert.equal(Object.hasOwn(silent, "retryAfterMs"), false);
	const noRecovery = classifyGatewayFailure({ code: "rate_limited", message: "x", next_action: "y" });
	assert.equal(Object.hasOwn(noRecovery, "retryAfterMs"), false);

	// A value the protocol would never have passed is not rendered either.
	for (const bad of [-1, 1.5, "45000", null, 3_600_001]) {
		const rejected = classifyGatewayFailure({
			code: "rate_limited",
			message: "x",
			next_action: "y",
			recovery: { kind: "retry", retry_after_ms: bad },
		});
		assert.equal(Object.hasOwn(rejected, "retryAfterMs"), false, `retry_after_ms ${JSON.stringify(bad)} must not render`);
	}
});

test("a Gateway-authored recovery preserves its exact bounded text", () => {
	assert.deepEqual(
		classifyGatewayFailure({
			code: "quota_exceeded_v2",
			message: "server-controlled",
			next_action: "server-controlled prose",
			recovery: { kind: "retry", retry_after_ms: 30_000 },
		}),
		{
			code: "quota_exceeded_v2",
			message: "server-controlled",
			nextAction: "server-controlled prose",
			denial: false,
			// The wait travels with the classification now (corca-ai/ceal#642); an
			// unknown code degrading by recovery class keeps the Gateway's number.
			retryAfterMs: 30_000,
		},
	);
});

test("a safe Gateway message survives when optional next_action is absent", () => {
	assert.deepEqual(classifyGatewayFailure({ code: "duplicate_write_refused", message: "The previous write is message:already-sent_001." }), {
		code: "duplicate_write_refused",
		message: "The previous write is message:already-sent_001.",
		nextAction: "Check Gateway status and audit readback before deciding whether to retry.",
		denial: false,
	});
});

test("a safe Gateway action survives when the message is missing", () => {
	assert.deepEqual(classifyGatewayFailure({ code: "legacy_failure", next_action: "Use the Gateway-issued confirmation reference." }), {
		code: "legacy_failure",
		message: "The Gateway rejected the capability request.",
		nextAction: "Use the Gateway-issued confirmation reference.",
		denial: false,
	});
});

test("a direct Gateway failure renderer never reflects unsafe code, text, or proof refs", () => {
	const unsafe = `ceal_refresh_${"r".repeat(43)}`;
	const unsafeProofRef = `ghp_${"a".repeat(36)}`;
	const opaqueProofRef = "audit:AbcDef123456789012345678";
	assert.deepEqual(classifyGatewayFailure({ code: unsafe, message: unsafe, next_action: unsafe }), {
		code: "gateway_request_failed",
		message: "The Gateway rejected the capability request.",
		nextAction: "Check Gateway status and audit readback before deciding whether to retry.",
		denial: false,
	});
	let stdout = "";
	writeCallGatewayFailure(
		{ error: { code: unsafe, message: unsafe, next_action: unsafe }, proof_ref_or_unavailable: unsafeProofRef },
		{
			stdout: {
				write: (chunk) => {
					stdout += String(chunk);
				},
			},
		},
		storedSession("http://127.0.0.1:1/gateway/client"),
		{ ok: true, capabilityId: "message.create", targetRef: "target:team-inbox", arguments: {}, purpose: "Create" },
		"request:direct-unsafe",
	);
	const payload = parseYaml(stdout);
	assert.equal(payload.error.kind, "gateway_request_failed");
	assert.deepEqual(payload.receipt.audit_refs, []);
	assert.doesNotMatch(JSON.stringify(payload), new RegExp(unsafe, "u"));
	assert.doesNotMatch(JSON.stringify(payload), new RegExp(unsafeProofRef, "u"));
	stdout = "";
	writeCallGatewayFailure(
		{ error: { code: "legacy_failure", message: "safe", next_action: "safe" }, proof_ref_or_unavailable: opaqueProofRef },
		{
			stdout: {
				write: (chunk) => {
					stdout += String(chunk);
				},
			},
		},
		storedSession("http://127.0.0.1:1/gateway/client"),
		{ ok: true, capabilityId: "message.create", targetRef: "target:team-inbox", arguments: {}, purpose: "Create" },
		"request:direct-opaque",
	);
	assert.deepEqual(parseYaml(stdout).receipt.audit_refs, [opaqueProofRef]);
	stdout = "";
	writeCallGatewayFailure(
		{
			error: {
				code: "unknown_gateway_code",
				message: "safe",
				next_action: "safe",
				recovery: { kind: "request_approval", retry_after_ms: -1 },
			},
		},
		{
			stdout: {
				write: (chunk) => {
					stdout += String(chunk);
				},
			},
		},
		storedSession("http://127.0.0.1:1/gateway/client"),
		{ ok: true, capabilityId: "message.create", targetRef: "target:team-inbox", arguments: {}, purpose: "Create" },
		"request:direct-malformed-recovery",
	);
	const malformedRecovery = parseYaml(stdout);
	assert.equal(malformedRecovery.status, "error");
	assert.equal(malformedRecovery.error.kind, "unknown_gateway_code");
	assert.equal(Object.hasOwn(malformedRecovery.error, "retry_after_ms"), false);
	stdout = "";
	writeCallGatewayFailure(
		{ error: { code: "policy_denied", message: "safe", next_action: "safe" } },
		{
			stdout: {
				write: (chunk) => {
					stdout += String(chunk);
				},
			},
		},
		storedSession("http://127.0.0.1:1/gateway/client"),
		{ ok: true, capabilityId: "message.create", targetRef: "target:team-inbox", arguments: {}, purpose: "Create" },
		"request:direct-partial-policy",
	);
	const partialPolicy = parseYaml(stdout);
	assert.equal(partialPolicy.status, "error");
	assert.equal(partialPolicy.error.kind, "policy_denied");
	stdout = "";
	writeCallGatewayFailure(
		{
			ok: false,
			request_id: "request:direct-policy",
			protocol_version: "1.4.0",
			proof_ref_or_unavailable: "proof:policy:1",
			error: {
				code: "policy_denied",
				message: "The authenticated profile is not granted this capability for the requested target.",
				next_action: "Request policy approval for this capability and target.",
				decision: {
					schema_version: "ceal.gateway_policy_denial.v1",
					capability_id: "message.create",
					target_ref: "target:team-inbox",
					host_decision: "denied",
					proof_level: "host_decision",
					non_claims: ["provider_execution_not_reached", "production_audit_not_reached"],
				},
			},
		},
		{
			stdout: {
				write: (chunk) => {
					stdout += String(chunk);
				},
			},
		},
		storedSession("http://127.0.0.1:1/gateway/client"),
		{ ok: true, capabilityId: "message.create", targetRef: "target:team-inbox", arguments: {}, purpose: "Create" },
		"request:direct-policy",
	);
	const completePolicy = parseYaml(stdout);
	assert.equal(completePolicy.status, "blocked");
	assert.equal(completePolicy.error.kind, "authorization_denied");
	stdout = "";
	const datePolicy = Object.assign(new Date(), {
		ok: false,
		request_id: "request:direct-policy",
		protocol_version: "1.4.0",
		proof_ref_or_unavailable: "proof:policy:gateway",
		error: {
			code: "policy_denied",
			message: "The authenticated profile is not granted this capability for the requested target.",
			next_action: "Request policy approval for this capability and target.",
			decision: {
				schema_version: "ceal.gateway_policy_denial.v1",
				capability_id: "message.create",
				target_ref: "target:team-inbox",
				host_decision: "denied",
				proof_level: "host_decision",
				non_claims: ["provider_execution_not_reached", "production_audit_not_reached"],
			},
		},
	});
	writeCallGatewayFailure(
		datePolicy,
		{
			stdout: {
				write: (chunk) => {
					stdout += String(chunk);
				},
			},
		},
		storedSession("http://127.0.0.1:1/gateway/client"),
		{ ok: true, capabilityId: "message.create", targetRef: "target:team-inbox", arguments: {}, purpose: "Create" },
		"request:direct-policy",
	);
	assert.equal(parseYaml(stdout).status, "error");
	stdout = "";
	const forgedClaimsPolicy = {
		...datePolicy,
		error: {
			...datePolicy.error,
			decision: {
				...datePolicy.error.decision,
				non_claims: { toJSON: () => ["provider_execution_not_reached", "production_audit_not_reached"] },
			},
		},
	};
	writeCallGatewayFailure(
		forgedClaimsPolicy,
		{
			stdout: {
				write: (chunk) => {
					stdout += String(chunk);
				},
			},
		},
		storedSession("http://127.0.0.1:1/gateway/client"),
		{ ok: true, capabilityId: "message.create", targetRef: "target:team-inbox", arguments: {}, purpose: "Create" },
		"request:direct-policy",
	);
	assert.equal(parseYaml(stdout).status, "error");
});

test("Gateway authorization classifications keep denials separate from availability", () => {
	for (const code of ["authentication_failed", "profile_binding_denied", "profile_access_denied", "target_catalog_capability_not_granted"]) {
		assert.equal(classifyGatewayFailure({ code, message: "server-controlled", next_action: "server-controlled action" }).denial, true, code);
	}
	assert.equal(
		classifyGatewayFailure({
			code: "unknown_gateway_code",
			message: "server-controlled",
			next_action: "server-controlled action",
			recovery: { kind: "request_approval" },
		}).denial,
		true,
	);
	assert.equal(
		classifyGatewayFailure({
			code: "target_catalog_selection_invalid",
			message: "server-controlled",
			next_action: "server-controlled action",
			recovery: { kind: "select_granted_scope" },
		}).denial,
		false,
	);
	for (const recovery of [
		{ kind: "request_approval", retry_after_ms: -1 },
		{ kind: "reboot_universe", retry_after_ms: 30_000 },
		{ kind: "request_approval", retry_after_ms: 30_000, injected: true },
	]) {
		const malformed = classifyGatewayFailure({
			code: "unknown_gateway_code",
			message: "server-controlled",
			next_action: "server-controlled action",
			recovery,
		});
		assert.equal(malformed.denial, false, JSON.stringify(recovery));
		assert.equal(Object.hasOwn(malformed, "retryAfterMs"), false, JSON.stringify(recovery));
	}
	const dateRecovery = Object.assign(new Date(), { kind: "request_approval" });
	assert.equal(
		classifyGatewayFailure({
			code: "unknown_gateway_code",
			message: "server-controlled",
			next_action: "server-controlled action",
			recovery: dateRecovery,
		}).denial,
		false,
	);
	const dateError = Object.assign(new Date(), {
		code: "unknown_gateway_code",
		message: "server-controlled",
		next_action: "server-controlled action",
		recovery: { kind: "request_approval" },
	});
	assert.deepEqual(classifyGatewayFailure(dateError), {
		code: "gateway_request_failed",
		message: "The Gateway rejected the capability request.",
		nextAction: "Check Gateway status and audit readback before deciding whether to retry.",
		denial: false,
	});
});

test("a complete HTTP policy denial remains a blocked call", async () => {
	await withGateway(
		async ({ endpoint }) => {
			const payload = await yamlRun(["call", "message.create", "--target", "target:team-inbox", "text=hello"], 3, {
				readStoredSession: async () => storedSession(endpoint),
			});
			assert.equal(payload.status, "blocked");
			assert.equal(payload.error.kind, "authorization_denied");
		},
		(request) =>
			request.operation === "call"
				? {
						ok: false,
						request_id: request.request_id,
						protocol_version: "1.4.0",
						proof_ref_or_unavailable: "proof:policy:gateway",
						error: {
							code: "policy_denied",
							message: "The authenticated profile is not granted this capability for the requested target.",
							next_action: "Request policy approval for this capability and target.",
							decision: {
								schema_version: "ceal.gateway_policy_denial.v1",
								capability_id: request.body.capability_id,
								target_ref: request.body.target_ref,
								host_decision: "denied",
								proof_level: "host_decision",
								non_claims: ["provider_execution_not_reached", "production_audit_not_reached"],
							},
						},
					}
				: handshakeResponse(request),
	);
});

test("receipt projects safe connector route provenance without provider material", async () => {
	await withGateway(
		async ({ endpoint }) => {
			const receipt = await yamlRun(["receipt", "show", "narnia:route:1:call"], 0, {
				readStoredSession: async () => storedSession(endpoint),
				nextRequestId: () => "narnia:route:receipt",
			});
			assert.deepEqual(receipt.events[0], {
				ref: "gateway-audit:event:failed",
				operation: "call",
				outcome: "failed",
				authorization: "not_evaluated",
				error_code: "connector_unavailable",
				non_claims: ["provider_execution_not_reached", "production_audit_not_reached"],
				connector_route_failure: { connector_kind: "notion", phase: "scope_observation" },
			});
		},
		(request) => connectorFailureReadbackResponse(request),
	);
});

test("a non-member recovery kind stays unrendered while Gateway guidance survives", () => {
	assert.deepEqual(
		classifyGatewayFailure({
			code: "mystery_code",
			message: "server-controlled",
			next_action: "server-controlled prose",
			recovery: { kind: "reboot_universe" },
		}),
		{
			code: "mystery_code",
			message: "server-controlled",
			nextAction: "server-controlled prose",
			denial: false,
		},
	);
});

test("a duplicate-write refusal preserves the Gateway-issued confirmation reference", async () => {
	const messageRef = "message:already-sent_001";
	const message = `An identical governed message was already sent as ${messageRef}.`;
	const nextAction = `Re-send the same call with duplicate_confirmed set to ${messageRef} to repeat it, or change the message.`;
	await withGateway(
		async ({ endpoint }) => {
			const payload = await yamlRun(
				[
					"call",
					"message.create",
					"--target",
					"target:team-inbox",
					"reply_to=message:approved_001",
					"text=Approved",
					"idempotency_key=retry-001",
				],
				3,
				{ readStoredSession: async () => storedSession(endpoint), nextRequestId: () => "fixture:duplicate-write:001" },
			);
			assert.equal(payload.error.kind, "duplicate_write_refused");
			assert.equal(payload.error.message, message);
			assert.equal(payload.error.next_action, nextAction);
			assert.match(payload.error.next_action, new RegExp(messageRef, "u"));
		},
		(request) =>
			request.operation === "call"
				? {
						ok: false,
						request_id: request.request_id,
						protocol_version: "1.4.0",
						error: { code: "duplicate_write_refused", message, next_action: nextAction },
					}
				: failedReadbackResponse(request),
	);
});

test("a duplicate-write refusal keeps its safe message when the optional action is absent", async () => {
	const message = "An identical governed message was already sent as message:already-sent_001.";
	await withGateway(
		async ({ endpoint }) => {
			const payload = await yamlRun(
				["call", "message.create", "--target", "target:team-inbox", "text=Approved", "idempotency_key=retry-001"],
				3,
				{ readStoredSession: async () => storedSession(endpoint), nextRequestId: () => "fixture:duplicate-write:optional-action" },
			);
			assert.equal(payload.error.message, message);
			assert.equal(payload.error.next_action, "Check Gateway status and audit readback before deciding whether to retry.");
		},
		(request) =>
			request.operation === "call"
				? {
						ok: false,
						request_id: request.request_id,
						protocol_version: "1.4.0",
						error: { code: "duplicate_write_refused", message },
					}
				: failedReadbackResponse(request),
	);
});

test("a non-policy authorization refusal stays blocked on the call surface", async () => {
	await withGateway(
		async ({ endpoint }) => {
			const payload = await yamlRun(
				["call", "message.create", "--target", "target:team-inbox", "text=Approved", "idempotency_key=denied-001"],
				3,
				{ readStoredSession: async () => storedSession(endpoint), nextRequestId: () => "fixture:target-denied:001" },
			);
			assert.equal(payload.status, "blocked");
			assert.equal(payload.error.kind, "authorization_denied");
			assert.equal(payload.error.message, "The target is not granted for this capability.");
		},
		(request) =>
			request.operation === "call"
				? {
						ok: false,
						request_id: request.request_id,
						protocol_version: "1.4.0",
						error: {
							code: "target_catalog_capability_not_granted",
							message: "The target is not granted for this capability.",
							next_action: "Choose a granted target.",
						},
					}
				: failedReadbackResponse(request),
	);
});

test("compatibility link data passes through and unsafe input is left to the Gateway contract", async () => {
	const sourceUrl = "https://workspace.slack.com/archives/C0123456789/p1720000000000100";
	await withGateway(
		async ({ endpoint, requests }) => {
			const url = `${sourceUrl}?thread_ts=1720000000.000100&channel=C0123456789&message_ts=1720000000.000100`;
			const payload = await yamlRun(["call", "resource.resolve", "--target", "target:team-inbox", `url=${url}`], 0, {
				readStoredSession: async () => storedSession(endpoint),
				nextRequestId: () => "narnia:resolve:1",
			});
			assert.deepEqual(payload.data, {
				schema_version: "ceal.resource_resolve_result.v1",
				resource: {
					ref: "message:approved_001",
					kind: "message",
					source: { provider: "slack", url: sourceUrl },
				},
			});
			assert.deepEqual(requiredValue(requests[0], "resource_resolve_call").body.body.arguments, { url });
		},
		(request) =>
			request.operation === "call"
				? success(request, {
						schema_version: "ceal.gateway_call_result.v1",
						capability_id: "resource.resolve",
						grant_ref: "grant:team-inbox-resource-resolve",
						grant_revision: 4,
						target_ref: request.body.target_ref,
						data: {
							schema_version: "ceal.resource_resolve_result.v1",
							resource: {
								ref: "message:approved_001",
								kind: "message",
								source: { provider: "slack", url: sourceUrl },
							},
						},
						redaction: { state: "applied", omitted_classes: ["credential_material"] },
						host_decision: "accepted",
						proof_level: "host_decision",
						non_claims: ["production_audit_not_reached"],
					})
				: readbackResponse(request),
	);
	const invalid = await yamlRun(
		[
			"call",
			"resource.resolve",
			"--target",
			"target:team-inbox",
			"url=https://workspace.slack.com/archives/C0123456789/p1720000000000100?token=forbidden",
		],
		3,
		{ readStoredSession: async () => storedSession("http://127.0.0.1:9") },
	);
	assert.equal(invalid.error.kind, "invalid_request");
});

test("call preserves one request identity across authentication refresh and final audit readback", async () => {
	await withRenewingGateway(
		async ({ endpoint, oldRefreshToken, newAccessToken, requests }) => {
			let saved: CealStoredSession | null = null;
			const payload = await yamlRun(["call", "message.search", "--target", "target:team-inbox", "query=launch"], 0, {
				readStoredSession: async () =>
					storedSession(endpoint, {
						refreshToken: oldRefreshToken,
						refreshTokenAbsoluteExpiresAt: "2099-10-14T00:00:00.000Z",
					}),
				writeStoredSession: async (session) => {
					saved = session;
				},
				nextRequestId: (() => {
					let id = 0;
					return () => `narnia:retry-call:${++id}`;
				})(),
			});
			assert.equal(payload.status, "completed");
			assert.equal(payload.capability, "message.search");
			const savedValue = requireStoredSession(saved);
			assert.equal(savedValue.accessToken, newAccessToken);
			assert.deepEqual(
				requests.map((item) => item.body.operation),
				["call", "call", "readback"],
			);
			assert.deepEqual(
				requests.map((item) => item.authorization),
				[`Bearer ${"ceal_personal_"}${"P".repeat(43)}`, `Bearer ${newAccessToken}`, `Bearer ${newAccessToken}`],
			);
			assert.equal(
				requiredValue(requests[0], "first_retry_call").body.request_id,
				requiredValue(requests[1], "second_retry_call").body.request_id,
			);
			assert.equal(
				requiredValue(requests[2], "readback_call").body.body.request_id,
				requiredValue(requests[1], "second_retry_call").body.request_id,
			);
		},
		{ rejectFirstGateway: true },
	);
});

test("call forwards a discovered provider-neutral capability without a CLI command rewrite", async () => {
	await withGateway(
		async ({ endpoint, requests }) => {
			const payload = await yamlRun(["call", "file.search", "--target", "target:workspace", "query=roadmap", "kind=document"], 0, {
				readStoredSession: async () => storedSession(endpoint),
				nextRequestId: (() => {
					let id = 0;
					return () => `narnia:generic:${++id}`;
				})(),
			});
			assert.equal(payload.schema_version, "ceal.result.v2");
			assert.equal(payload.status, "completed");
			assert.equal(payload.capability, "file.search");
			assert.equal(payload.target, "target:workspace");
			assert.deepEqual(requiredValue(requests[0], "file_search_call").body.body.arguments, { query: "roadmap", kind: "document" });
		},
		(request) =>
			request.operation === "call"
				? success(request, {
						schema_version: "ceal.gateway_call_result.v1",
						capability_id: "file.search",
						grant_ref: "grant:workspace-file-search",
						grant_revision: 7,
						target_ref: request.body.target_ref,
						data: { schema_version: "ceal.file_search_result.v1", results: [{ ref: "file:roadmap", label: "Roadmap" }] },
						redaction: { state: "applied", omitted_classes: ["raw_provider_ids"] },
						host_decision: "accepted",
						proof_level: "host_decision",
						non_claims: ["production_audit_not_reached"],
					})
				: success(request, {
						schema_version: "ceal.gateway_audit_readback.v1",
						request_id: request.body.request_id,
						events: [
							{
								schema_version: "ceal.gateway_audit_event.v1",
								event_ref: "gateway-audit:event:generic",
								request_id: request.body.request_id,
								profile_ref: request.profile_ref,
								membership_ref: "membership:narnia",
								membership_revision: 1,
								registration_ref: "registration:narnia",
								client_ref: "client:narnia",
								client_revision: 1,
								subject_ref: "subject:hwidong",
								instance_ref: "instance:corca",
								occurred_at: "2026-07-13T21:00:00.000Z",
								operation: "call",
								auth_decision: "allowed",
								policy_decision: "allowed",
								outcome: "succeeded",
								error_code: null,
								grant_snapshot: {
									schema_version: "ceal.gateway_authorization_snapshot.v1",
									capability_id: "file.search",
									target_ref: "target:workspace",
									grant_ref: "grant:workspace-file-search",
									grant_revision: 7,
								},
								call: {
									schema_version: "ceal.gateway_audit_call_detail.v1",
									capability_id: "file.search",
									grant_ref: "grant:workspace-file-search",
									grant_revision: 7,
									target_ref: "target:workspace",
									input_summary: { field_count: 2 },
									output_summary: { result_count: 1 },
								},
								proof_level: "host_decision",
								non_claims: ["production_audit_not_reached"],
							},
						],
					}),
	);
});

test("capabilities uses an enrolled session without endpoint or token options", async () => {
	await withGateway(async ({ endpoint, requests }) => {
		const token = `ceal_personal_${"P".repeat(43)}`;
		const payload = await yamlRun(["capabilities"], 0, {
			readStoredSession: async () => ({
				gatewayEndpoint: endpoint,
				profileRef: "profile:narnia",
				registrationRef: "registration:narnia",
				membershipRef: "membership:narnia",
				clientRef: "client:narnia",
				subjectRef: "subject:hwidong",
				instanceRef: "instance:corca",
				accessToken: token,
				expiresAt: "2099-07-14T00:00:00.000Z",
				refreshToken: `ceal_refresh_${"R".repeat(43)}`,
				refreshTokenIdleExpiresAt: "2099-08-14T00:00:00.000Z",
				refreshTokenAbsoluteExpiresAt: "2099-10-14T00:00:00.000Z",
			}),
			nextRequestId: () => "narnia:stored:001",
		});
		assert.equal(payload.status, "available");
		assert.deepEqual(
			requests.map((item) => item.authorization),
			[`Bearer ${token}`, `Bearer ${token}`],
		);
		assert.doesNotMatch(JSON.stringify(payload), new RegExp(token, "u"));
	});
});

test("packaged bin exposes no partial session lifecycle when HOME is absent", async () => {
	const status = await runBinWithoutHome(["session", "status"]);
	assert.equal(status.code, 0);
	assert.equal(parseYaml(status.stdout).status, "unconfigured");

	const logout = await runBinWithoutHome(["session", "logout"]);
	assert.equal(logout.code, 3);
	const payload = parseYaml(logout.stdout);
	assert.equal(payload.status, "unavailable");
	assert.equal(payload.error.kind, "session_runtime_unavailable");
});

test("packaged bin persists an enrolled session with owner-only modes", async () => {
	await withEnrollmentGateway(async ({ endpoint, token }) => {
		const home = mkdtempSync(path.join(tmpdir(), "ceal-bin-home-"));
		try {
			const result = await runBin(["session", "enroll", "--gateway", endpoint, "--code-stdin"], `${"E".repeat(48)}\n`, { HOME: home });
			assert.equal(result.code, 0, result.stdout);
			assert.doesNotMatch(result.stdout, new RegExp(token, "u"));
			assert.equal(statSync(path.join(home, ".ceal")).mode & 0o777, 0o700);
			const sessionPath = path.join(home, ".ceal", "client-session.json");
			assert.equal(statSync(sessionPath).mode & 0o777, 0o600);
			assert.equal(JSON.parse(readFileSync(sessionPath, "utf8")).access_token, token);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});
});

// The decision tests above drive the command through injected runtime seams,
// which do not take the session state lock. The shipped binary always does
// (`bin.ts` supplies `runWithLockedSession` under the same condition as
// `writeStoredSession`), so the refusal is proven once against the real locked store
// and a real file rather than only against the fallback the suite exercises.
test("packaged bin refuses a second enrollment for a different identity and leaves the stored session on disk", async () => {
	await withEnrollmentGateway(
		async ({ endpoint, token, revoked }) => {
			const home = mkdtempSync(path.join(tmpdir(), "ceal-bin-replace-"));
			const sessionPath = path.join(home, ".ceal", "client-session.json");
			try {
				const first = await runBin(["session", "enroll", "--gateway", endpoint, "--code-stdin"], `${"E".repeat(48)}\n`, { HOME: home });
				assert.equal(first.code, 0, first.stdout);
				const second = await runBin(["session", "enroll", "--gateway", endpoint, "--code-stdin"], `${"E".repeat(48)}\n`, { HOME: home });
				assert.equal(second.code, 3, second.stdout);
				assert.match(second.stdout, /session_identity_conflict/u);
				assert.match(second.stdout, /subject_ref/u);
				assert.equal(
					JSON.parse(readFileSync(sessionPath, "utf8")).access_token,
					token,
					"the identity on disk is the one this host consented to",
				);
				assert.deepEqual(revoked, [`ceal_refresh_${"S".repeat(43)}`], "the refused enrollment's own session is the one that ends");

				const forced = await runBin(["session", "enroll", "--gateway", endpoint, "--code-stdin", "--force"], `${"E".repeat(48)}\n`, {
					HOME: home,
				});
				assert.equal(forced.code, 0, forced.stdout);
				assert.match(forced.stdout, /session_replacement: replaced/u);
				assert.equal(JSON.parse(readFileSync(sessionPath, "utf8")).subject_ref, "subject:someone-else");
				assert.deepEqual(revoked, [`ceal_refresh_${"S".repeat(43)}`, `ceal_refresh_${"R".repeat(43)}`], "then the displaced one does");
			} finally {
				rmSync(home, { recursive: true, force: true });
			}
		},
		{
			identities: [
				{},
				{ subject_ref: "subject:someone-else", refresh_token: `ceal_refresh_${"S".repeat(43)}` },
				{ subject_ref: "subject:someone-else", refresh_token: `ceal_refresh_${"T".repeat(43)}` },
			],
		},
	);
});

test("separate ceal processes serialize an in-flight single-use client refresh", async () => {
	const home = mkdtempSync(path.join(tmpdir(), "ceal-bin-refresh-lock-"));
	const firstRefresh = `ceal_refresh_${"R".repeat(43)}`;
	const secondRefresh = `ceal_refresh_${"S".repeat(43)}`;
	const refreshRequests: string[] = [];
	const firstRefreshObserved = deferredVoid();
	const firstRefreshRelease = deferredVoid();
	let currentRefresh = firstRefresh;
	const server = createServer(async (request, response) => {
		const chunks: Buffer[] = [];
		for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
		const body: FixtureRequest = JSON.parse(Buffer.concat(chunks).toString("utf8"));
		if (request.url === "/gateway/client/refresh") {
			assert.ok(typeof body.refresh_token === "string");
			refreshRequests.push(body.refresh_token);
			if (body.refresh_token !== currentRefresh) {
				response.writeHead(409, { "content-type": "application/json" });
				return response.end(
					JSON.stringify({
						schema_version: "ceal.client_refresh_result.v2",
						ok: false,
						error: {
							code: "refresh_replayed",
							message: "Refresh token was already rotated.",
							next_action: "Recover the recorded attempt.",
						},
					}),
				);
			}
			if (refreshRequests.length === 1) {
				firstRefreshObserved.resolve();
				await firstRefreshRelease.promise;
			}
			currentRefresh = secondRefresh;
			response.writeHead(200, { "content-type": "application/json" });
			assert.ok(typeof body.refresh_attempt_ref === "string");
			return response.end(JSON.stringify(rotatedClientSessionV2(currentRefresh, body.refresh_attempt_ref)));
		}
		const value = body.operation === "handshake" ? handshakeResponse(body) : discoveryResponse(body);
		response.writeHead(200, { "content-type": "application/json" });
		return response.end(JSON.stringify(value));
	});
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => resolve());
	});
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("test server address unavailable");
	const endpoint = `http://127.0.0.1:${address.port}/gateway/client`;
	const sessionPath = path.join(home, ".ceal", "client-session.json");
	try {
		mkdirSync(path.dirname(sessionPath), { recursive: true, mode: 0o700 });
		writeFileSync(
			sessionPath,
			`${JSON.stringify(
				serializeStoredSession(
					storedSession(endpoint, {
						expiresAt: "2020-01-01T00:00:00.000Z",
						refreshToken: firstRefresh,
					}),
				),
				null,
				2,
			)}\n`,
			{ mode: 0o600 },
		);
		const firstRun = runBin(["session", "refresh"], "", { HOME: home });
		await waitForTestSignal(firstRefreshObserved.promise, "the first ceal process did not reach the Gateway refresh route");
		const secondReachedLock = deferredVoid();
		const secondLockWaitStarted = secondReachedLock.promise;
		const secondRun = runBin(["--timing", "session", "refresh"], "", { HOME: home }, (output) => {
			if (output.includes('"stage":"local_store_lock_wait"')) secondReachedLock.resolve();
		});
		await waitForTestSignal(secondLockWaitStarted, "the second ceal process did not reach the session lock");
		firstRefreshRelease.resolve();
		const [first, second] = await Promise.all([firstRun, secondRun]);
		assert.equal(first.code, 0, first.stderr);
		assert.equal(second.code, 0, second.stderr);
		assert.equal(parseYaml(first.stdout).status, "refreshed");
		assert.equal(parseYaml(second.stdout).status, "refreshed");
		assert.deepEqual(refreshRequests, [firstRefresh]);
		assert.match(readFileSync(sessionPath, "utf8"), new RegExp(secondRefresh, "u"));
	} finally {
		firstRefreshRelease.resolve();
		await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
		rmSync(home, { recursive: true, force: true });
	}
});

test("capabilities reports an honest Gateway-required unavailable surface without connection options", async () => {
	// No client session is a failure, and now answers like one: ok false, an
	// error object with a kind, and a failing exit code.
	const payload = await yamlRun(["capabilities"], 3);
	assert.equal(payload.status, "unavailable");
	assert.equal(payload.ok, false);
	assert.equal(payload.error.kind, "client_session_unavailable");
	assert.equal(payload.proof_level, "surface");
	assert.equal(payload.live_gateway_checked, false);
	assert.deepEqual(payload.capabilities, []);
	assert.deepEqual(payload.claims_allowed, []);
	// Which recovery, not merely that there is one. `typeof … === "string"` was the
	// assertion here, and under it this envelope told a logged-out operator to
	// reinstall the binary for a year — the source read `CEAL_COMMANDS[2]`, which
	// meant `session` until `update` was inserted above it. Deriving the expected
	// text from the table is what makes a future reordering fail here.
	const sessionCommand = CEAL_COMMANDS.find((command) => command.name === "session");
	assert.ok(sessionCommand);
	assert.equal(payload.error.next_action, sessionCommand.recovery);
	assert.match(payload.error.next_action, /ceal session enroll --help/u);
	assert.match(payload.error.next_action, /ceal session adopt --help/u);
	assert.equal(Object.hasOwn(payload, "next_actions"), false);
});

test("capabilities rejects stray operands in both explicit and target-selection grammars", async () => {
	const explicit = await yamlRun(
		[
			"capabilities",
			"--endpoint",
			"https://gateway.example.test",
			"--profile",
			"profile:narnia",
			"--request-id",
			"narnia:grammar:001",
			"--token-stdin",
			"unexpected",
		],
		2,
	);
	assert.equal(explicit.error.kind, "invalid_argument");
	const targets = await yamlRun(["capabilities", "targets", "--capability", "message.search", "unexpected"], 2);
	assert.equal(targets.error.kind, "invalid_argument");
	for (const match of ["--literal", "--"]) {
		// An option-like value is accepted as a value; with no session configured
		// the surface then fails closed, which is now an exit-3 answer.
		const optionLikeValue = await yamlRun(["capabilities", "targets", "--capability", "message.search", "--match", match], 3);
		assert.equal(optionLikeValue.status, "unavailable");
		assert.equal(optionLikeValue.ok, false);
	}
});

test("capabilities rejects duplicate special flags before session or Gateway work", async () => {
	for (const args of [
		["capabilities", "--fresh", "--fresh"],
		["capabilities", "--detail", "--detail"],
		["capabilities", "targets", "--capability", "message.search", "--detail", "--detail"],
	]) {
		const payload = await yamlRun(args, 2, {
			readStoredSession: () => assert.fail("duplicate flags must be refused before session access"),
		});
		assert.equal(payload.error.kind, "invalid_argument", args.join(" "));
		assert.match(payload.error.next_action, /--help/u);
	}
});

test("capabilities performs outbound handshake and discovery with a stdin-only token", async () => {
	await withGateway(async ({ endpoint, requests }) => {
		const token = "ceal_personal_test_token_never_render";
		const payload = await yamlRun(
			["capabilities", "--endpoint", endpoint, "--profile", "profile:narnia", "--request-id", "narnia:acceptance:001", "--token-stdin"],
			0,
			{ readSecret: async () => token },
		);
		assert.equal(payload.status, "available");
		assert.equal(payload.session_refresh, "none");
		assert.equal(payload.live_gateway_checked, true);
		assert.equal(payload.proof_level, "host_decision");
		assert.equal(payload.gateway.profile_ref, "profile:narnia");
		assert.equal(payload.gateway.membership_ref, "membership:narnia");
		assert.deepEqual(
			payload.capabilities.map((item: { capability_id: string }) => item.capability_id),
			["message.search"],
		);
		assert.deepEqual(payload.targets, []);
		assert.deepEqual(payload.target_catalog, { target_count: 0, returned_count: 0, complete: true });
		assert.match(payload.next_action, /zero currently authorized targets/u);
		assert.match(payload.next_action, /terminal/u);
		assert.deepEqual(
			requests.map((item) => item.body.operation),
			["handshake", "discover"],
		);
		assert.deepEqual(
			requests.map((item) => item.authorization),
			[`Bearer ${token}`, `Bearer ${token}`],
		);
		assert.doesNotMatch(JSON.stringify(payload), new RegExp(token, "u"));
	});
});

test("capabilities defaults to a concise catalog that omits each per-capability contract body", async () => {
	await withGateway(async ({ endpoint }) => {
		const payload = await yamlRun(
			["capabilities", "--endpoint", endpoint, "--profile", "profile:narnia", "--request-id", "narnia:concise:001", "--token-stdin"],
			0,
			{ readSecret: async () => `ceal_personal_${"C".repeat(43)}` },
		);
		assert.equal(payload.status, "available");
		// The concise rows keep everything an agent needs to *select* a capability
		// (id, label, effect, target requirement) but drop the input grammar body.
		assert.deepEqual(
			payload.capabilities.map((item: { capability_id: string }) => item.capability_id),
			["message.search"],
		);
		for (const capability of payload.capabilities) {
			assert.equal(Object.hasOwn(capability, "input_contract"), false, "concise default must omit input_contract");
			assert.equal(Object.hasOwn(capability, "write_contract"), false, "concise default must omit write_contract");
			assert.equal(typeof capability.label, "string");
			assert.equal(typeof capability.effect, "string");
		}
		// And the caller is told how to recover the omitted detail.
		assert.match(payload.capability_detail, /--detail/u);
	});
});

test("capabilities --detail restores each capability's full input contract", async () => {
	await withGateway(async ({ endpoint }) => {
		const payload = await yamlRun(
			[
				"capabilities",
				"--detail",
				"--endpoint",
				endpoint,
				"--profile",
				"profile:narnia",
				"--request-id",
				"narnia:detail:001",
				"--token-stdin",
			],
			0,
			{ readSecret: async () => `ceal_personal_${"D".repeat(43)}` },
		);
		assert.equal(payload.status, "available");
		assert.deepEqual(
			payload.capabilities.map((item: { capability_id: string }) => item.capability_id),
			["message.search"],
		);
		const [capability] = payload.capabilities;
		assert.equal(Object.hasOwn(capability, "input_contract"), true, "--detail must include input_contract");
		assert.equal(capability.input_contract.schema_version, "ceal.message_search_input.v1");
		// The concise-mode recovery hint is not repeated when the detail is present.
		assert.equal(Object.hasOwn(payload, "capability_detail"), false);
	});
});

test("capabilities negotiates and surfaces the eligible-Profile catalog for --profile selection", async () => {
	const eligible = [
		{ profile_ref: "profile:ax-team", membership_ref: "membership:ax-team" },
		{ profile_ref: "profile:narnia", membership_ref: "membership:narnia" },
	];
	const responseFactory = (body: FixtureRequest): FixtureResponse => {
		if (body.operation !== "handshake") return discoveryResponse(body);
		const base = handshakeResponse(body);
		assert.ok(base.ok);
		return { ...base, value: { ...base.value, eligible_profiles: eligible } };
	};
	await withGateway(async ({ endpoint, requests }) => {
		const payload = await yamlRun(
			["capabilities", "--endpoint", endpoint, "--profile", "profile:narnia", "--request-id", "narnia:profiles:001", "--token-stdin"],
			0,
			{ readSecret: async () => `ceal_personal_${"S".repeat(43)}` },
		);
		assert.equal(payload.status, "available");
		// The transport declared the negotiation on the handshake request.
		const handshake = requiredValue(requests[0], "capabilities_handshake");
		assert.equal(handshake.body.operation, "handshake");
		assert.equal(handshake.profiles, "accept");
		// The currently selected Profile and the catalog of alternatives an agent
		// may pass to `--profile` are both operator-visible.
		assert.equal(payload.gateway.profile_ref, "profile:narnia");
		assert.deepEqual(payload.gateway.eligible_profiles, eligible);
	}, responseFactory);
});

test("capabilities names profile_selection_required with the catalog when more than one Profile is eligible", async () => {
	const eligible = [
		{ profile_ref: "profile:ax-team", membership_ref: "membership:ax-team" },
		{ profile_ref: "profile:narnia", membership_ref: "membership:narnia" },
	];
	const responseFactory = (body: FixtureRequest): FixtureResponse => {
		if (body.operation !== "handshake") return discoveryResponse(body);
		const base = handshakeResponse(body);
		assert.ok(base.ok);
		return { ...base, value: { ...base.value, eligible_profiles: eligible } };
	};
	await withGateway(async ({ endpoint }) => {
		const payload = await yamlRun(
			["capabilities", "--endpoint", endpoint, "--profile", "profile:narnia", "--request-id", "narnia:selection:001", "--token-stdin"],
			0,
			{ readSecret: async () => `ceal_personal_${"S".repeat(43)}` },
		);
		assert.equal(payload.status, "available");
		assert.equal(payload.profile_selection.code, "profile_selection_required");
		assert.equal(payload.profile_selection.active_profile_ref, "profile:narnia");
		assert.match(payload.profile_selection.next_action, /--profile/u);
		// The hint points at the catalog surfaced on the gateway block.
		assert.deepEqual(payload.gateway.eligible_profiles, eligible);
	}, responseFactory);
});

test("capabilities omits profile_selection when a single eligible Profile becomes active automatically", async () => {
	const eligible = [{ profile_ref: "profile:narnia", membership_ref: "membership:narnia" }];
	const responseFactory = (body: FixtureRequest): FixtureResponse => {
		if (body.operation !== "handshake") return discoveryResponse(body);
		const base = handshakeResponse(body);
		assert.ok(base.ok);
		return { ...base, value: { ...base.value, eligible_profiles: eligible } };
	};
	await withGateway(async ({ endpoint }) => {
		const payload = await yamlRun(
			["capabilities", "--endpoint", endpoint, "--profile", "profile:narnia", "--request-id", "narnia:selection:single", "--token-stdin"],
			0,
			{ readSecret: async () => `ceal_personal_${"S".repeat(43)}` },
		);
		assert.equal(payload.status, "available");
		// One selectable Profile activates automatically; no selection hint.
		assert.deepEqual(payload.gateway.eligible_profiles, eligible);
		assert.equal(Object.hasOwn(payload, "profile_selection"), false);
	}, responseFactory);
});

test("capabilities omits eligible_profiles when the Gateway does not negotiate the catalog", async () => {
	await withGateway(async ({ endpoint }) => {
		const payload = await yamlRun(
			["capabilities", "--endpoint", endpoint, "--profile", "profile:narnia", "--request-id", "narnia:profiles:absent", "--token-stdin"],
			0,
			{ readSecret: async () => `ceal_personal_${"S".repeat(43)}` },
		);
		assert.equal(payload.status, "available");
		// Older Gateway / non-negotiated response carries no catalog, so the
		// surface stays absent rather than an empty list.
		assert.equal(Object.hasOwn(payload.gateway, "eligible_profiles"), false);
	});
});

test("target queries keep their exact request shape and render signed target metadata", async () => {
	await withGateway(async ({ endpoint, requests }) => {
		const token = `ceal_personal_${"S".repeat(43)}`;
		const runtime = {
			readStoredSession: async () => storedSession(endpoint, { accessToken: token }),
			nextRequestId: () => "narnia:target-catalog:001",
		};
		const matched = await yamlRun(
			["capabilities", "targets", "--capability", "message.search", "--match", "team", "--limit", "1"],
			0,
			runtime,
		);
		assert.equal(matched.status, "available");
		assert.equal(matched.targets[0].connector_kind, "slack");
		assert.equal(matched.targets[0].target_kind, "conversation");
		assert.deepEqual(matched.targets[0].capability_access[0], { ...matureCapabilityAccess(), effect: "read", writable: false });
		const unfiltered = await yamlRun(["capabilities", "targets", "--capability", "message.search", "--limit", "1"], 0, runtime);
		assert.equal(unfiltered.status, "available");
		const cursor = `cursor:${"c".repeat(48)}`;
		const continued = await yamlRun(
			["capabilities", "targets", "--capability", "message.search", "--cursor", cursor, "--limit", "1"],
			0,
			runtime,
		);
		assert.equal(continued.status, "available");
		assert.doesNotMatch(JSON.stringify(continued), new RegExp(cursor, "u"));
		const catalog = await yamlRun(["capabilities"], 0, runtime);
		assert.equal(Object.hasOwn(catalog, "target_selection"), false);
		assert.deepEqual(
			requests.map((item) => item.body.body),
			[
				{ client: { name: "ceal", version: WORKER_PACKAGE_VERSION } },
				{ capability_id: "message.search", match: "team", limit: 1 },
				{ client: { name: "ceal", version: WORKER_PACKAGE_VERSION } },
				{ capability_id: "message.search", limit: 1 },
				{ client: { name: "ceal", version: WORKER_PACKAGE_VERSION } },
				{ capability_id: "message.search", cursor, limit: 1 },
				{ client: { name: "ceal", version: WORKER_PACKAGE_VERSION } },
				{},
			],
		);
	});
});

test("a URL target match without a navigation declaration preserves the Gateway catalog result", async () => {
	const selector = `https://www.notion.so/${"a".repeat(32)}`;
	const responseFactory = (request: FixtureRequest): FixtureResponse =>
		request.operation === "handshake"
			? handshakeResponse(request)
			: success(request, {
					schema_version: "ceal.gateway_discovery.v3",
					phase: "target_page",
					profile_ref: request.profile_ref,
					membership_ref: "membership:narnia",
					capabilities: [
						{
							capability_id: "notion.page.get",
							label: "Read one Notion page",
							effect: "read",
							target_requirement: "required",
							input_contract: {
								schema_version: "ceal.notion_page_get_input.v1",
								required: ["ref"],
								ref: { type: "string", format: "notion_page_ref" },
							},
							evidence_requirement: "gateway_audit",
						},
					],
					targets: [],
					target_catalog: { target_count: 0, returned_count: 0, complete: true },
					host_decision: "accepted",
					proof_level: "host_decision",
					non_claims: ["provider_execution_not_reached", "production_audit_not_reached"],
				});
	await withGateway(async ({ endpoint, requests }) => {
		const payload = await yamlRun(
			["capabilities", "targets", "--capability", "notion.page.get", "--profile", "profile:narnia", "--match", selector],
			0,
			{
				readStoredSession: async () => storedSession(endpoint),
				nextRequestId: () => "narnia:target-catalog:empty-match",
			},
		);
		assert.equal(payload.status, "available");
		assert.deepEqual(payload.targets, []);
		assert.equal(
			requiredValue(requests[1], "catalog_match_request").body.body.match,
			selector,
			"the test must exercise a real match request",
		);
	}, responseFactory);
});

test("catalog navigation refuses a URL selector with the exact provider-neutral resolver workflow", () => {
	const capability: CealGatewayDiscoveryCapability = {
		capability_id: "notion.page.get",
		label: "Read one Notion page",
		effect: "read",
		target_requirement: "required",
		input_contract: { schema_version: "ceal.notion_page_get_input.v1" },
		evidence_requirement: "gateway_audit",
		navigation: {
			target_selector: "opaque_catalog_target",
			url_target_selector: "unsupported",
			required_argument_source: {
				argument: "ref",
				handle_kind: "document",
				issued_by: ["resource.resolve", "notion.search"],
			},
		},
	};
	const selection: Parameters<typeof classifyUnsupportedTargetSelector>[1] = {
		kind: "targets",
		profileRef: "profile:narnia",
		body: { capability_id: "notion.page.get", match: `https://www.notion.so/${"a".repeat(32)}` },
	};
	const refusal = classifyUnsupportedTargetSelector([capability], selection);
	assert.deepEqual(refusal, {
		message:
			"Capability 'notion.page.get' does not accept a URL as a target selector; its catalog navigation requires a 'document' ref in 'ref'.",
		nextAction:
			"Run 'ceal capabilities targets --capability notion.page.get --profile profile:narnia --limit 64' without --match to select its opaque target. Then run 'ceal capabilities targets --capability resource.resolve --profile profile:narnia --limit 64' and use one returned target with 'ceal call resource.resolve --target <target-ref> url=<URL>'; pass the returned document ref as 'ref=<document-ref>' when calling 'notion.page.get'.",
	});
	const selectedMatch = selection.body.match;
	assert.ok(selectedMatch);
	assert.equal(refusal.nextAction.includes(selectedMatch), false, "the rejected URL must not be echoed");
	assert.equal(
		classifyUnsupportedTargetSelector([capability], { ...selection, body: { ...selection.body, match: "shared workspace" } }),
		null,
		"the URL-specific declaration must not invent semantics for a text selector",
	);
	const unrelated = classifyUnsupportedTargetSelector([{ ...capability, capability_id: "other.page.get" }], selection);
	assert.equal(unrelated, null, "navigation from another capability must not control this selection");
	const missingResolver = structuredClone(capability);
	assert.ok(missingResolver.navigation);
	missingResolver.navigation.required_argument_source.issued_by = ["notion.search"];
	assert.deepEqual(classifyUnsupportedTargetSelector([missingResolver], selection), {
		message:
			"Capability 'notion.page.get' does not accept a URL as a target selector; its catalog navigation requires a 'document' ref in 'ref'.",
		nextAction:
			"Run 'ceal capabilities targets --capability notion.search --profile profile:narnia --limit 64', call that capability with its declared arguments, and pass the returned document ref as 'ref=<document-ref>' when calling 'notion.page.get'.",
	});
	const malformed = structuredClone(capability);
	assert.ok(malformed.navigation);
	malformed.navigation.required_argument_source.issued_by = [];
	assert.equal(classifyUnsupportedTargetSelector([malformed], selection), null, "malformed metadata cannot invent a refusal");
	assert.equal(
		classifyUnsupportedTargetSelector(
			[{ ...(({ navigation: _navigation, ...withoutNavigation }) => withoutNavigation)(capability), capability_id: "resource.resolve" }],
			{
				...selection,
				body: { ...selection.body, capability_id: "resource.resolve" },
			},
		),
		null,
		"a URL-capable selector without a refusal declaration remains available",
	);
});

test("target selector refusal preserves the capability preflight refresh outcome", async () => {
	const selector = `https://www.notion.so/${"a".repeat(32)}`;
	const navigation = {
		target_selector: "opaque_catalog_target",
		url_target_selector: "unsupported",
		required_argument_source: {
			argument: "ref",
			handle_kind: "document",
			issued_by: ["resource.resolve"],
		},
	};
	await withRenewingGateway(
		async ({ endpoint, oldRefreshToken, newAccessToken, requests, refreshCalls }) => {
			let current = storedSession(endpoint, {
				expiresAt: "2020-01-01T00:00:00.000Z",
				refreshToken: oldRefreshToken,
			});
			const payload = await yamlRun(
				["capabilities", "targets", "--capability", "notion.page.get", "--profile", "profile:narnia", "--match", selector],
				2,
				{
					readStoredSession: async () => current,
					writeStoredSession: async (session) => {
						current = session;
					},
					now: () => Date.parse("2026-07-13T00:00:00.000Z"),
				},
			);
			assert.equal(payload.schema_version, "ceal.error.v1");
			assert.equal(payload.error.kind, "selector_not_supported");
			assert.equal(payload.session_refresh, "refreshed");
			assert.equal(refreshCalls(), 1);
			assert.deepEqual(
				requests.map((item) => item.authorization),
				[`Bearer ${newAccessToken}`, `Bearer ${newAccessToken}`],
			);
		},
		{
			discoveryFactory: (request) => {
				const response = discoveryResponse(request);
				if (!response.ok) throw new Error("discovery_fixture_failure");
				const discovery = response.value;
				if (!Array.isArray(discovery.capabilities) || discovery.capabilities.length === 0)
					throw new Error("discovery_capability_fixture_missing");
				const capability = fixtureRecord(discovery.capabilities[0], "discovery_capability");
				return success(request, {
					...discovery,
					capabilities: [{ ...capability, capability_id: "notion.page.get", navigation }],
					targets: [],
					target_catalog: { target_count: 0, returned_count: 0, complete: true },
				});
			},
		},
	);
});

test("target recovery preserves a selected Profile and never hides a continuation behind empty-page advice", async () => {
	let selectedCatalog: CealGatewayTargetCatalog = {
		target_count: 1,
		returned_count: 1,
		complete: false,
		next_cursor: `cursor:${"a".repeat(48)}`,
	};
	const responseFactory = (request: FixtureRequest): FixtureResponse => {
		if (request.operation === "handshake") return handshakeResponse(request);
		const discoveryResponseValue = discoveryResponse(request);
		assert.ok(discoveryResponseValue.ok);
		const discovery = discoveryResponseValue.value;
		return success(request, {
			...discovery,
			targets: selectedCatalog.target_count === 0 ? [] : discovery.targets,
			target_catalog: selectedCatalog,
		});
	};
	await withGateway(async ({ endpoint }) => {
		const runtime = { readStoredSession: async () => storedSession(endpoint), nextRequestId: () => "narnia:target-recovery" };
		const args = ["capabilities", "targets", "--capability", "message.search", "--profile", "profile:narnia", "--match", "team"];
		const continued = await yamlRun(args, 0, runtime);
		assert.deepEqual(continued.target_selection, { capability_id: "message.search", request_kind: "match" });
		assert.equal(
			continued.next_action,
			`Run 'ceal capabilities targets --capability message.search --profile profile:narnia --cursor ${selectedCatalog.next_cursor}'.`,
		);

		selectedCatalog = { target_count: 0, returned_count: 0, complete: true };
		const matchedEmpty = await yamlRun(args, 0, runtime);
		assert.match(matchedEmpty.next_action, /response alone does not prove the capability has no authorized targets/u);
		assert.match(matchedEmpty.next_action, /--profile profile:narnia --limit 64/u);
		assert.doesNotMatch(matchedEmpty.next_action, /--match <selector>/u);

		const unfilteredEmpty = await yamlRun(
			["capabilities", "targets", "--capability", "message.search", "--profile", "profile:narnia"],
			0,
			runtime,
		);
		assert.equal(
			unfilteredEmpty.next_action,
			"The unfiltered target catalog is complete and contains zero currently authorized targets for 'message.search'. This is terminal; do not invent a target ref or retry this page.",
		);
	}, responseFactory);
});

test("packaged bin reads stdin, completes async discovery, and preserves safe exit behavior", async () => {
	await withGateway(async ({ endpoint }) => {
		const args = ["capabilities", "--endpoint", endpoint, "--profile", "profile:narnia", "--request-id", "narnia:bin:001", "--token-stdin"];
		const success = await runBin(args, "ceal_personal_bin_token_never_render\n");
		assert.equal(success.code, 0, success.stderr);
		assert.equal(parseYaml(success.stdout).status, "available");
		assert.doesNotMatch(success.stdout, /ceal_personal_bin_token_never_render/u);

		const empty = await runBin(args, "");
		assert.equal(empty.code, 3);
		assert.equal(parseYaml(empty.stdout).error.kind, "invalid_configuration");

		const oversized = await runBin(args, "x".repeat(4098));
		assert.equal(oversized.code, 3);
		assert.equal(parseYaml(oversized.stdout).error.kind, "credential_input_failed");
		assert.equal(oversized.stderr, "");
	});
});

test("Gateway failure output never reflects server-controlled secret text", async () => {
	const token = "ceal_personal_reflected_token_never_render";
	await withGateway(
		async ({ endpoint }) => {
			const payload = await yamlRun(
				["capabilities", "--endpoint", endpoint, "--profile", "profile:narnia", "--request-id", "narnia:failure:001", "--token-stdin"],
				3,
				{ readSecret: async () => token },
			);
			assert.equal(payload.status, "unavailable");
			assert.equal(payload.proof_level, "host_decision");
			assert.equal(payload.error.kind, "internal_error");
			assert.deepEqual(payload.gateway_observation, {
				phase: "handshake",
				operation: "handshake",
				network_reached: true,
				http_response_received: true,
				protocol_handshake_verified: false,
				discovery_verified: false,
				request_id: "narnia:failure:001:handshake",
				response_kind: "typed_gateway_error",
			});
			assert.doesNotMatch(JSON.stringify(payload), new RegExp(token, "u"));
		},
		(request) => ({
			ok: false,
			request_id: request.request_id,
			protocol_version: "1.4.0",
			error: { code: "internal_error", message: token, next_action: token },
		}),
	);
});

test("an HTTP Gateway failure missing its required message is refused before CLI rendering", async () => {
	const action = "This must not reach the CLI.";
	await withGateway(
		async ({ endpoint }) => {
			const payload = await yamlRun(
				[
					"capabilities",
					"--endpoint",
					endpoint,
					"--profile",
					"profile:narnia",
					"--request-id",
					"narnia:failure:missing-message",
					"--token-stdin",
				],
				3,
				{ readSecret: async () => `ceal_personal_${"P".repeat(43)}` },
			);
			assert.equal(payload.status, "unavailable");
			assert.equal(payload.error.kind, "invalid_response");
			assert.doesNotMatch(JSON.stringify(payload), new RegExp(action, "u"));
		},
		(request) => ({
			ok: false,
			request_id: request.request_id,
			protocol_version: "1.4.0",
			error: { code: "legacy_failure", next_action: action },
		}),
	);
});

test("Gateway option and transport failures are redacted YAML", async () => {
	const secret = "ceal_personal_failure_token_never_render";
	for (const args of [
		["capabilities", "--endpoint", "https://gateway.example.test"],
		[
			"capabilities",
			"--endpoint",
			"http://not-loopback.example.test",
			"--profile",
			"profile:narnia",
			"--request-id",
			"request:1",
			"--token-stdin",
		],
	]) {
		const expectedCode = args.length === 3 ? 2 : 3;
		const payload = await yamlRun(args, expectedCode, { readSecret: async () => secret });
		assert.doesNotMatch(JSON.stringify(payload), new RegExp(secret, "u"));
	}
});

test("every stored-session --profile consumer enforces the public Profile reference grammar before work", async () => {
	const cases = [
		["capabilities", "--profile", "bogus"],
		["capabilities", "targets", "--capability", "message.search", "--profile", "bogus"],
		["call", "message.search", "--target", "target:team-inbox", "--profile", "bogus", "query=launch"],
		["receipt", "show", "request:test", "--profile", "bogus"],
		["acceptance", "emit", "--profile", "bogus"],
	];
	for (const args of cases) {
		const payload = await yamlRun(args, 2, {
			readStoredSession: () => assert.fail(`${args.join(" ")} must reject before local session work`),
			readInstalledReleaseFacts: () => assert.fail(`${args.join(" ")} must reject before release inspection`),
		});
		assert.equal(payload.error.kind, "invalid_argument", args.join(" "));
	}
});

test("acceptance rejects an unsafe request reference before release or session work", async () => {
	const payload = await yamlRun(["acceptance", "emit", "--request-ref", "free text with spaces"], 2, {
		readStoredSession: () => assert.fail("unsafe acceptance request ref must reject before local session work"),
		readInstalledReleaseFacts: () => assert.fail("unsafe acceptance request ref must reject before release inspection"),
	});
	assert.equal(payload.error.kind, "invalid_argument");
});

test("JSON modes and unsafe commands fail as redacted YAML", async () => {
	for (const args of [
		["version", "--json"],
		["version", "--format", "json"],
	]) {
		const payload = await yamlRun(args, 2);
		assert.equal(payload.error.kind, "invalid_argument");
	}
	const unsafeOperand = "secret-token-xoxb-never-render";
	for (const command of ["admin", "apply", "credential", "doctor", "login", "restart", "status"]) {
		const result = await run([command, unsafeOperand]);
		assert.equal(result.code, 2);
		assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(unsafeOperand, "u"));
		assert.equal((await yamlRun([command, unsafeOperand], 2)).error.kind, "unknown_command");
	}
});

test("library execution is deterministic, dependency-injected, and does not assign process exit state", async () => {
	const beforeExitCode = process.exitCode;
	const first = await run(["capabilities"]);
	const second = await run(["capabilities"]);
	assert.deepEqual(second, first);
	assert.equal(process.exitCode, beforeExitCode);
});

test("YAML renderer rejects non-plain scalars, objects, cycles, and aliases", () => {
	const shared = { value: 1 };
	const cyclic: { self?: unknown } = {};
	cyclic.self = cyclic;
	for (const value of [undefined, Number.NaN, 1n, new Date(), new Map(), { nested: undefined }, [shared, shared], cyclic]) {
		assert.throws(() => renderPlainYamlDocument(value), TypeError);
	}
	assert.doesNotMatch(renderPlainYamlDocument({ text: "plain", nested: [true, null, 1.5] }), /^(?:---|%YAML)|[&*][A-Za-z0-9_-]+/mu);
});

test("capabilities probes live and populates the discovery cache when cold", async () => {
	await withGateway(async ({ endpoint, requests }) => {
		const cache = inMemoryDiscoveryCache();
		let refreshCalls = 0;
		const payload = await yamlRun(["capabilities"], 0, {
			readStoredSession: async () => storedSession(endpoint),
			createClientSessionClient: () => {
				refreshCalls += 1;
				throw new Error("unexpected session refresh");
			},
			now: () => Date.parse("2026-07-18T12:00:00.000Z"),
			...cache.runtime,
		});
		assert.equal(payload.status, "available");
		assert.equal(payload.catalog_source, "live_discovery");
		assert.deepEqual(payload.claims_allowed, ["gateway_handshake", "gateway_discovery"]);
		assert.deepEqual(
			requests.map((item) => item.body.operation),
			["handshake", "discover"],
		);
		assert.equal(refreshCalls, 0, "a locally current session does not need preflight refresh");
		const entry = cache.entry();
		assert.ok(entry, "cold probe must populate the cache");
		assert.deepEqual(entry.key, {
			gatewayEndpoint: endpoint,
			profileRef: "profile:narnia",
			membershipRef: "membership:narnia",
			negotiatedProtocolVersion: "1.4.0",
		});
		assert.equal(entry.cachedAt, Date.parse("2026-07-18T12:00:00.000Z"));
		assert.equal(entry.discovery.schema_version, "ceal.gateway_discovery.v3");
	});
});

test("capabilities serves a warm discovery cache without a live discovery probe", async () => {
	await withGateway(async ({ endpoint, requests }) => {
		const now = Date.parse("2026-07-18T12:00:00.000Z");
		const cache = inMemoryDiscoveryCache(cachedEntry(endpoint, now - 60_000));
		let refreshCalls = 0;
		const payload = await yamlRun(["capabilities"], 0, {
			readStoredSession: async () => storedSession(endpoint),
			createClientSessionClient: () => {
				refreshCalls += 1;
				throw new Error("unexpected session refresh");
			},
			now: () => now,
			...cache.runtime,
		});
		assert.equal(payload.status, "available");
		assert.equal(payload.catalog_source, "cached_discovery");
		assert.equal(payload.live_gateway_checked, true, "the handshake is still a live gateway check");
		assert.deepEqual(payload.claims_allowed, ["gateway_handshake"], "no live discovery is claimed when cached");
		assert.equal(payload.catalog_cached_at, new Date(now - 60_000).toISOString());
		assert.equal(typeof payload.catalog_expires_at, "string");
		// The discovery probe never ran: only the handshake reached the gateway.
		assert.deepEqual(
			requests.map((item) => item.body.operation),
			["handshake"],
		);
		assert.equal(refreshCalls, 0, "a locally current session does not need preflight refresh");
		// The served empty catalog is the cached value; request count proves no live probe.
		assert.equal(payload.target_catalog.target_count, 0);
	});
});

test("capabilities reports HTTP reachability and protocol phases for malformed Gateway responses", async () => {
	for (const { failureAt, expected } of [
		{
			failureAt: "handshake",
			expected: {
				kind: "authentication_failed",
				status: 401,
				live: false,
				phase: "handshake",
				operation: "handshake",
				requests: ["handshake"],
			},
		},
		{
			failureAt: "discover",
			expected: {
				kind: "invalid_response",
				status: 502,
				live: true,
				phase: "discovery",
				operation: "discover",
				requests: ["handshake", "discover"],
			},
		},
	] as const) {
		await withGatewayPhaseFailure(failureAt, async ({ endpoint, requests }) => {
			const payload = await yamlRun(["capabilities"], 3, {
				readStoredSession: async () => storedSession(endpoint),
			});
			assert.equal(payload.error.kind, expected.kind, failureAt);
			assert.equal(payload.session_refresh, "none", failureAt);
			assert.equal(payload.live_gateway_checked, expected.live, failureAt);
			assert.deepEqual(
				requests.map((item) => item.body.operation),
				expected.requests,
				failureAt,
			);
			assert.deepEqual(payload.gateway_observation, payload.error.diagnostics, failureAt);
			assert.deepEqual(
				payload.gateway_observation,
				{
					phase: expected.phase,
					operation: expected.operation,
					network_reached: true,
					http_response_received: true,
					protocol_handshake_verified: expected.phase === "discovery",
					discovery_verified: false,
					request_id: `ceal:capabilities:${expected.operation}`,
					http_status: expected.status,
					response_content_type: "text/plain",
					response_kind: "content_type_invalid",
				},
				failureAt,
			);
			assert.match(payload.error.next_action, expected.phase === "discovery" ? /handshake succeeded/u : /HTTP 401/u, failureAt);
			assert.doesNotMatch(JSON.stringify(payload), /proxy secret|authorization|Bearer/u, failureAt);
		});
	}
});

test("capabilities identifies an HTTP 200 protocol-invalid discovery response without refreshing", async () => {
	await withGateway(
		async ({ endpoint, requests }) => {
			const payload = await yamlRun(["capabilities", "--fresh"], 3, {
				readStoredSession: async () => storedSession(endpoint),
			});
			assert.equal(payload.error.kind, "invalid_response");
			assert.equal(payload.session_refresh, "none");
			assert.equal(payload.live_gateway_checked, true);
			assert.equal(payload.gateway_observation.http_status, 200);
			assert.equal(payload.gateway_observation.response_kind, "protocol_invalid");
			assert.equal(payload.gateway_observation.response_protocol_version, null);
			assert.equal(payload.gateway_observation.response_schema_version, null);
			assert.equal(payload.gateway_observation.response_envelope_kind, "unknown");
			assert.equal(payload.gateway_observation.protocol_handshake_verified, true);
			assert.match(payload.error.next_action, /HTTP 200/u);
			assert.match(payload.error.next_action, /1\.4\.0/u);
			assert.deepEqual(
				requests.map((item) => item.body.operation),
				["handshake", "discover"],
			);
		},
		(body) => (body.operation === "discover" ? {} : handshakeResponse(body)),
	);
});

test("capabilities names the serving Gateway protocol mismatch and exposes both versions", async () => {
	await withGatewayProtocolMismatch(async ({ endpoint, requests }) => {
		const payload = await yamlRun(["capabilities", "--fresh"], 3, {
			readStoredSession: async () => storedSession(endpoint),
		});
		assert.equal(payload.status, "unavailable");
		assert.equal(payload.error.kind, "invalid_response");
		assert.equal(payload.session_refresh, "none");
		assert.equal(payload.live_gateway_checked, false);
		assert.equal(payload.gateway_observation.http_status, 409);
		assert.equal(payload.gateway_observation.response_kind, "protocol_invalid");
		assert.equal(payload.gateway_observation.response_protocol_version, "1.3.0");
		assert.equal(payload.gateway_observation.response_error_code, "incompatible_protocol");
		assert.equal(payload.gateway_observation.protocol_handshake_verified, false);
		assert.match(payload.error.next_action, /serving Gateway\/worker protocol mismatch/u);
		assert.match(payload.error.next_action, /1\.3\.0/u);
		assert.match(payload.error.next_action, /1\.4\.0/u);
		assert.match(payload.error.next_action, /Align the serving Gateway/u);
		assert.doesNotMatch(payload.error.next_action, /route\/proxy failure/u);
		assert.doesNotMatch(payload.error.next_action, /Run 'ceal session refresh'/u);
		assert.deepEqual(
			requests.map((item) => item.body.operation),
			["handshake"],
			"protocol mismatch must stop before discovery",
		);
	});
});

test("capabilities identifies a stale incomplete target page after one refresh without retrying", async () => {
	await withRenewingGateway(
		async ({ endpoint, oldRefreshToken, requests, refreshCalls }) => {
			let current = storedSession(endpoint, { expiresAt: "2020-01-01T00:00:00.000Z", refreshToken: oldRefreshToken });
			const payload = await yamlRun(["capabilities", "--fresh"], 3, {
				readStoredSession: async () => current,
				writeStoredSession: async (session) => {
					current = session;
				},
				now: () => Date.parse("2026-07-13T00:00:00.000Z"),
			});
			assert.equal(payload.error.kind, "invalid_response");
			assert.equal(payload.session_refresh, "refreshed");
			assert.equal(payload.gateway_observation.response_shape_issue, "discovery_target_catalog_incomplete_without_cursor");
			assert.equal(refreshCalls(), 1);
			assert.deepEqual(
				requests.map((item) => item.body.operation),
				["handshake", "discover"],
			);
			assert.match(payload.error.next_action, /incomplete discovery target catalog/u);
			assert.match(payload.error.next_action, /continuation cursor/u);
			assert.doesNotMatch(payload.error.next_action, /Gateway\/proxy protocol compatibility/u);
			assert.doesNotMatch(JSON.stringify(payload), /selection_required|target_count|safe-token/u);
		},
		{
			discoveryFactory: (body) => {
				const response = discoveryResponse(body);
				if (!response.ok) throw new Error("discovery_fixture_failure");
				return {
					...response,
					value: {
						...response.value,
						target_catalog: { target_count: 373, returned_count: 0, complete: false },
					},
				};
			},
		},
	);
});

test("the default discovery-cache window is the operator-measured 30 minutes", async () => {
	await withGateway(async ({ endpoint, requests }) => {
		const now = Date.parse("2026-07-18T12:00:00.000Z");
		// 20 minutes: past the former 5-minute default, inside the measured 30-minute
		// one. Pinning the boundary here is what makes the default a decision rather
		// than a literal — shrink DEFAULT_DISCOVERY_CACHE_TTL_MS and this goes red.
		const cache = inMemoryDiscoveryCache(cachedEntry(endpoint, now - 20 * 60_000));
		const payload = await yamlRun(["capabilities"], 0, {
			readStoredSession: async () => storedSession(endpoint),
			now: () => now,
			...cache.runtime,
		});
		assert.equal(payload.catalog_source, "cached_discovery");
		assert.deepEqual(
			requests.map((item) => item.body.operation),
			["handshake"],
			"a 20-minute-old entry must not cost a discovery probe",
		);
	});
});

test("an entry older than the default window still re-probes", async () => {
	await withGateway(async ({ endpoint, requests }) => {
		const now = Date.parse("2026-07-18T12:00:00.000Z");
		// 31 minutes: the widened window is still a window, not an unbounded cache.
		const cache = inMemoryDiscoveryCache(cachedEntry(endpoint, now - 31 * 60_000));
		const payload = await yamlRun(["capabilities"], 0, {
			readStoredSession: async () => storedSession(endpoint),
			now: () => now,
			...cache.runtime,
		});
		assert.equal(payload.catalog_source, "live_discovery");
		assert.deepEqual(
			requests.map((item) => item.body.operation),
			["handshake", "discover"],
		);
	});
});

test("capabilities re-probes when the cached entry is past its freshness window", async () => {
	await withGateway(async ({ endpoint, requests }) => {
		const now = Date.parse("2026-07-18T12:00:00.000Z");
		const cache = inMemoryDiscoveryCache(cachedEntry(endpoint, now - 10_000));
		const payload = await yamlRun(["capabilities"], 0, {
			readStoredSession: async () => storedSession(endpoint),
			now: () => now,
			discoveryCacheTtlMs: 5_000,
			...cache.runtime,
		});
		assert.equal(payload.catalog_source, "live_discovery");
		assert.deepEqual(
			requests.map((item) => item.body.operation),
			["handshake", "discover"],
		);
		const refreshed = cache.entry();
		assert.ok(refreshed);
		assert.equal(refreshed.cachedAt, now, "stale re-probe refreshes the cache stamp");
		assert.equal(fixtureRecordField(refreshed.discovery, "target_catalog").target_count, 0, "cache now holds the live value");
	});
});

test("capabilities re-probes when the cached key does not match the handshake identity", async () => {
	await withGateway(async ({ endpoint, requests }) => {
		const now = Date.parse("2026-07-18T12:00:00.000Z");
		const foreign = cachedEntry(endpoint, now);
		foreign.key.profileRef = "profile:other";
		const cache = inMemoryDiscoveryCache(foreign);
		const payload = await yamlRun(["capabilities"], 0, {
			readStoredSession: async () => storedSession(endpoint),
			now: () => now,
			...cache.runtime,
		});
		assert.equal(payload.catalog_source, "live_discovery");
		assert.deepEqual(
			requests.map((item) => item.body.operation),
			["handshake", "discover"],
		);
	});
});

test("capabilities --fresh bypasses a warm cache and probes live", async () => {
	await withGateway(async ({ endpoint, requests }) => {
		const now = Date.parse("2026-07-18T12:00:00.000Z");
		const cache = inMemoryDiscoveryCache(cachedEntry(endpoint, now));
		const payload = await yamlRun(["capabilities", "--fresh"], 0, {
			readStoredSession: async () => storedSession(endpoint),
			now: () => now,
			...cache.runtime,
		});
		assert.equal(payload.catalog_source, "live_discovery");
		assert.deepEqual(
			requests.map((item) => item.body.operation),
			["handshake", "discover"],
		);
		const refreshed = cache.entry();
		assert.ok(refreshed);
		assert.equal(fixtureRecordField(refreshed.discovery, "target_catalog").target_count, 0, "--fresh refreshes the cache");
	});
});

test("capabilities degrades to a live probe when the discovery cache read fails", async () => {
	await withGateway(async ({ endpoint, requests }) => {
		const payload = await yamlRun(["capabilities"], 0, {
			readStoredSession: async () => storedSession(endpoint),
			now: () => Date.parse("2026-07-18T12:00:00.000Z"),
			loadDiscoveryCache: async () => {
				throw new Error("cache read boom");
			},
			saveDiscoveryCache: async () => {},
		});
		assert.equal(payload.status, "available");
		assert.equal(payload.catalog_source, "live_discovery");
		assert.deepEqual(
			requests.map((item) => item.body.operation),
			["handshake", "discover"],
		);
	});
});

test("capabilities degrades to a live probe when a fresh cache entry has a malformed discovery value", async () => {
	await withGateway(async ({ endpoint, requests }) => {
		const now = Date.parse("2026-07-18T12:00:00.000Z");
		const malformed = cachedEntry(endpoint, now);
		malformed.discovery = { schema_version: "ceal.gateway_discovery.v3" };
		const cache = inMemoryDiscoveryCache(malformed);
		const payload = await yamlRun(["capabilities"], 0, {
			readStoredSession: async () => storedSession(endpoint),
			now: () => now,
			...cache.runtime,
		});
		assert.equal(payload.catalog_source, "live_discovery");
		assert.deepEqual(
			requests.map((item) => item.body.operation),
			["handshake", "discover"],
		);
		const refreshed = cache.entry();
		assert.ok(refreshed);
		assert.equal(
			fixtureRecordField(refreshed.discovery, "target_catalog").target_count,
			0,
			"the live discovery replaces the malformed cache value",
		);
	});
});

function inMemoryDiscoveryCache(initial: CealDiscoveryCacheEntry | null = null): {
	entry: () => CealDiscoveryCacheEntry | null;
	runtime: TestRuntime;
} {
	let current = initial;
	return {
		entry: () => current,
		runtime: {
			loadDiscoveryCache: async () => current,
			saveDiscoveryCache: async (value) => {
				current = value;
			},
			removeDiscoveryCache: async () => {
				current = null;
			},
		},
	};
}

function cachedEntry(endpoint: string, cachedAt: number): CealDiscoveryCacheEntry {
	return {
		key: { gatewayEndpoint: endpoint, profileRef: "profile:narnia", membershipRef: "membership:narnia", negotiatedProtocolVersion: "1.4.0" },
		cachedAt,
		discovery: {
			schema_version: "ceal.gateway_discovery.v3",
			phase: "target_page",
			profile_ref: "profile:narnia",
			membership_ref: "membership:narnia",
			capabilities: [
				{
					capability_id: "message.search",
					label: "Search messages",
					effect: "read",
					target_requirement: "required",
					input_contract: { schema_version: "ceal.message_search_input.v1", required: ["query"], query: { type: "string", max_bytes: 512 } },
					evidence_requirement: "gateway_audit",
				},
			],
			targets: [],
			// An empty complete catalog keeps this cache fixture valid under the
			// current wire contract; the live re-probe is distinguished by its
			// request count below.
			target_catalog: { target_count: 0, returned_count: 0, complete: true },
			host_decision: "accepted",
			proof_level: "host_decision",
			non_claims: ["provider_execution_not_reached", "production_audit_not_reached"],
		},
	};
}

type GatewayRequestLog = { authorization: string | undefined; profiles: string | undefined; body: FixtureRequest };
type GatewayCallback = (input: { endpoint: string; requests: GatewayRequestLog[] }) => Promise<void>;

async function withGateway(callback: GatewayCallback, responseFactory: ((body: FixtureRequest) => unknown) | null = null): Promise<void> {
	const requests: GatewayRequestLog[] = [];
	const server = createServer(async (request, response) => {
		const chunks: Buffer[] = [];
		for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
		const body: FixtureRequest = JSON.parse(Buffer.concat(chunks).toString("utf8"));
		const profiles = request.headers["x-ceal-profiles"];
		requests.push({ authorization: request.headers.authorization, profiles: Array.isArray(profiles) ? profiles.join(",") : profiles, body });
		const value = responseFactory
			? responseFactory(body)
			: body.operation === "handshake"
				? handshakeResponse(body)
				: body.operation === "discover"
					? discoveryResponse(body)
					: body.operation === "call"
						? callResponse(body)
						: readbackResponse(body);
		response.writeHead(200, { "content-type": "application/json" });
		response.end(JSON.stringify(value));
	});
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("test server address unavailable");
	try {
		await callback({ endpoint: `http://127.0.0.1:${address.port}/gateway/client`, requests });
	} finally {
		await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
	}
}

type GatewayPhaseFailure = "handshake" | "discover";
type GatewayPhaseFailureRequest = {
	authorization: string | undefined;
	body: { operation?: string; [key: string]: unknown };
};
type GatewayPhaseFailureCallback = (input: { endpoint: string; requests: GatewayPhaseFailureRequest[] }) => Promise<void>;

async function withGatewayPhaseFailure(failureAt: GatewayPhaseFailure, callback: GatewayPhaseFailureCallback): Promise<void> {
	const requests: GatewayPhaseFailureRequest[] = [];
	const server = createServer(async (request, response) => {
		const chunks = [];
		for await (const chunk of request) chunks.push(chunk);
		const body: FixtureRequest = JSON.parse(Buffer.concat(chunks).toString("utf8"));
		requests.push({ authorization: request.headers.authorization, body });
		if (body.operation === failureAt) {
			response.writeHead(failureAt === "handshake" ? 401 : 502, { "content-type": "text/plain" });
			response.end(failureAt === "handshake" ? "proxy unauthorized" : "discovery proxy failure");
			return;
		}
		const value = body.operation === "handshake" ? handshakeResponse(body) : discoveryResponse(body);
		response.writeHead(200, { "content-type": "application/json" });
		response.end(JSON.stringify(value));
	});
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("test server address unavailable");
	try {
		await callback({ endpoint: `http://127.0.0.1:${address.port}/gateway/client`, requests });
	} finally {
		await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
	}
}

async function withGatewayProtocolMismatch(callback: GatewayCallback): Promise<void> {
	const requests: GatewayRequestLog[] = [];
	const server = createServer(async (request, response) => {
		const chunks: Buffer[] = [];
		for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
		const body: FixtureRequest = JSON.parse(Buffer.concat(chunks).toString("utf8"));
		const profiles = request.headers["x-ceal-profiles"];
		requests.push({ authorization: request.headers.authorization, profiles: Array.isArray(profiles) ? profiles.join(",") : profiles, body });
		if (body.operation === "handshake") {
			response.writeHead(409, { "content-type": "application/json" });
			response.end(
				JSON.stringify({
					ok: false,
					request_id: body.request_id,
					protocol_version: "1.3.0",
					error: {
						code: "incompatible_protocol",
						message: "The serving Gateway only supports protocol 1.3.0.",
						next_action: "Check the Gateway route or proxy and retry.",
					},
				}),
			);
			return;
		}
		response.writeHead(200, { "content-type": "application/json" });
		response.end(JSON.stringify(discoveryResponse(body)));
	});
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("test server address unavailable");
	try {
		await callback({ endpoint: `http://127.0.0.1:${address.port}/gateway/client`, requests });
	} finally {
		await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
	}
}

async function runBin(
	args: readonly string[],
	stdin: string,
	env: NodeJS.ProcessEnv = {},
	onStderr: (output: string) => void = (): void => {},
): Promise<{ code: number; stdout: string; stderr: string }> {
	const bin = fileURLToPath(new URL("../dist/bin.js", import.meta.url));
	// Never let the real binary touch the developer's actual home: the CLI
	// persists session/discovery state under $HOME/.ceal, so an un-overridden
	// spawn would leak fixture data into the real store.
	const isolatedHome = env.HOME === undefined ? mkdtempSync(path.join(tmpdir(), "ceal-bin-isolated-home-")) : null;
	const child = spawn(process.execPath, [bin, ...args], {
		stdio: ["pipe", "pipe", "pipe"],
		env: { ...process.env, ...env, ...(isolatedHome ? { HOME: isolatedHome } : {}) },
	});
	let stdout = "";
	let stderr = "";
	child.stdout.setEncoding("utf8");
	child.stderr.setEncoding("utf8");
	child.stdout.on("data", (chunk) => {
		stdout += chunk;
	});
	child.stderr.on("data", (chunk) => {
		stderr += chunk;
		onStderr(stderr);
	});
	child.stdin.end(stdin);
	try {
		const code = await new Promise<number>((resolve, reject) => {
			child.once("error", reject);
			child.once("close", resolve);
		});
		return { code, stdout, stderr };
	} finally {
		if (isolatedHome) rmSync(isolatedHome, { recursive: true, force: true });
	}
}

async function runBinWithoutHome(args: readonly string[]): Promise<{ code: number; stdout: string; stderr: string }> {
	const bin = fileURLToPath(new URL("../dist/bin.js", import.meta.url));
	const { HOME: _omittedHome, ...environmentWithoutHome } = process.env;
	const child = spawn(process.execPath, [bin, ...args], {
		stdio: ["ignore", "pipe", "pipe"],
		env: environmentWithoutHome,
	});
	let stdout = "";
	let stderr = "";
	child.stdout.setEncoding("utf8");
	child.stderr.setEncoding("utf8");
	child.stdout.on("data", (chunk) => {
		stdout += chunk;
	});
	child.stderr.on("data", (chunk) => {
		stderr += chunk;
	});
	const code = await new Promise<number>((resolve, reject) => {
		child.once("error", reject);
		child.once("close", resolve);
	});
	return { code, stdout, stderr };
}

type EnrollmentGatewayOptions = {
	identities?: readonly Record<string, unknown>[];
	revokeDeniedCode?: string;
};
type EnrollmentGatewayCallback = (input: { endpoint: string; token: string; refreshToken: string; revoked: string[] }) => Promise<void>;

async function withEnrollmentGateway(callback: EnrollmentGatewayCallback, options: EnrollmentGatewayOptions = {}): Promise<void> {
	const token = `ceal_personal_${"T".repeat(43)}`;
	const refreshToken = `ceal_refresh_${"R".repeat(43)}`;
	// The same server answers revocation, so an enrollment that ends a session —
	// the one it refuses to keep, or the one it replaces — is proven against a
	// real socket rather than an injected stub.
	const revoked: string[] = [];
	// One entry per enrollment exchange, so a test can make the second one buy a
	// different identity than the first.
	const identities = options.identities ?? [];
	let exchanges = 0;
	const server = createServer(async (request, response) => {
		const chunks: Buffer[] = [];
		for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
		const body: FixtureRequest = JSON.parse(Buffer.concat(chunks).toString("utf8"));
		if (request.url === "/gateway/client/revoke") {
			assert.ok(typeof body.refresh_token === "string");
			revoked.push(body.refresh_token);
			response.writeHead(200, { "content-type": "application/json" });
			response.end(
				options.revokeDeniedCode
					? JSON.stringify({
							schema_version: "ceal.client_revoke_result.v1",
							ok: false,
							error: { code: options.revokeDeniedCode, message: "Gateway refused the revocation.", next_action: "Ask an operator." },
						})
					: JSON.stringify({ schema_version: "ceal.client_revoke_result.v1", ok: true, revoked: true }),
			);
			return;
		}
		assert.equal(request.url, "/gateway/client/enroll");
		assert.equal(body.code, "E".repeat(48));
		const identity = identities[exchanges++] ?? {};
		response.writeHead(200, { "content-type": "application/json" });
		response.end(
			JSON.stringify({
				schema_version: "ceal.enrollment_result.v1",
				ok: true,
				profile_ref: "profile:narnia",
				membership_ref: "membership:narnia",
				registration_ref: "registration:narnia",
				client_ref: "client:narnia",
				subject_ref: "subject:hwidong",
				instance_ref: "instance:corca",
				access_token: token,
				expires_at: "2099-07-14T00:00:00.000Z",
				refresh_token: refreshToken,
				refresh_token_idle_expires_at: "2099-08-14T00:00:00.000Z",
				refresh_token_absolute_expires_at: "2099-10-14T00:00:00.000Z",
				...identity,
			}),
		);
	});
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("test server address unavailable");
	try {
		await callback({ endpoint: `http://127.0.0.1:${address.port}/gateway/client`, token, refreshToken, revoked });
	} finally {
		await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
	}
}

type RenewingGatewayOptions = {
	invalidRefreshResponse?: boolean;
	recoverAfterUnknown?: boolean;
	refreshDeniedCode?: string;
	invalidRevokeResponse?: boolean;
	rejectFirstGateway?: boolean;
	discoveryFactory?: (body: FixtureRequest) => FixtureResponse;
};
type RenewingGatewayCallback = (input: {
	endpoint: string;
	oldRefreshToken: string;
	newAccessToken: string;
	newRefreshToken: string;
	requests: GatewayRequestLog[];
	revoked: string[];
	refreshCalls: () => number;
}) => Promise<void>;

async function withRenewingGateway(callback: RenewingGatewayCallback, options: RenewingGatewayOptions = {}): Promise<void> {
	const oldRefreshToken = `ceal_refresh_${"O".repeat(43)}`;
	const newRefreshToken = `ceal_refresh_${"N".repeat(43)}`;
	const newAccessToken = `ceal_personal_${"N".repeat(43)}`;
	const requests: GatewayRequestLog[] = [];
	const revoked: string[] = [];
	let refreshCallCount = 0;
	let gatewayRejected = false;
	let committedRefresh: Record<string, unknown> | null = null;
	const server = createServer(async (request, response) => {
		const chunks: Buffer[] = [];
		for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
		const body: FixtureRequest = JSON.parse(Buffer.concat(chunks).toString("utf8"));
		if (request.url === "/gateway/client/refresh") {
			refreshCallCount += 1;
			assert.equal(body.refresh_token, oldRefreshToken);
			const v2 = body.schema_version === "ceal.client_refresh_request.v2";
			if (options.refreshDeniedCode) {
				response.writeHead(200, { "content-type": "application/json" });
				response.end(
					JSON.stringify({
						schema_version: v2 ? "ceal.client_refresh_result.v2" : "ceal.client_refresh_result.v1",
						ok: false,
						error: { code: options.refreshDeniedCode, message: "Gateway rejected refresh.", next_action: "Reenroll." },
					}),
				);
				return;
			}
			const initialResult = {
				schema_version: v2 ? "ceal.client_refresh_result.v2" : "ceal.client_refresh_result.v1",
				ok: true,
				profile_ref: "profile:narnia",
				membership_ref: "membership:narnia",
				registration_ref: "registration:narnia",
				client_ref: "client:narnia",
				subject_ref: "subject:hwidong",
				instance_ref: "instance:corca",
				access_token: newAccessToken,
				expires_at: "2099-07-14T00:00:00.000Z",
				refresh_token: newRefreshToken,
				refresh_token_idle_expires_at: "2099-08-14T00:00:00.000Z",
				refresh_token_absolute_expires_at: "2099-10-14T00:00:00.000Z",
				...(v2 ? { refresh_attempt_ref: body.refresh_attempt_ref, refresh_delivery: "initial" } : {}),
			};
			if (options.invalidRefreshResponse && options.recoverAfterUnknown && refreshCallCount === 1) {
				// Model the Gateway's linearization point: the rotation and its
				// recovery record are committed before the response disappears.
				committedRefresh = initialResult;
				response.writeHead(500, { "content-type": "text/plain" });
				response.end("Gateway committed the refresh, but the response was lost");
				return;
			}
			if (options.invalidRefreshResponse && !(options.recoverAfterUnknown && refreshCallCount > 1)) {
				response.writeHead(500, { "content-type": "text/plain" });
				response.end("Gateway failure without the client JSON contract");
				return;
			}
			const result =
				options.recoverAfterUnknown && refreshCallCount > 1
					? (() => {
							assert.ok(committedRefresh, "the first response must commit before it is dropped");
							assert.equal(body.refresh_attempt_ref, committedRefresh.refresh_attempt_ref, "recovery must use the original attempt");
							return { ...committedRefresh, refresh_delivery: "recovery" };
						})()
					: initialResult;
			response.writeHead(200, { "content-type": "application/json" });
			response.end(JSON.stringify(result));
			return;
		}
		if (request.url === "/gateway/client/revoke") {
			assert.ok(typeof body.refresh_token === "string");
			revoked.push(body.refresh_token);
			if (options.invalidRevokeResponse) {
				response.writeHead(500, { "content-type": "text/plain" });
				response.end("Gateway failure without the client JSON contract");
				return;
			}
			response.writeHead(200, { "content-type": "application/json" });
			response.end(JSON.stringify({ schema_version: "ceal.client_revoke_result.v1", ok: true, revoked: true }));
			return;
		}
		requests.push({ authorization: request.headers.authorization, profiles: undefined, body });
		if (options.rejectFirstGateway && !gatewayRejected) {
			gatewayRejected = true;
			response.writeHead(401, { "content-type": "application/json" });
			response.end(
				JSON.stringify({
					ok: false,
					request_id: body.request_id,
					protocol_version: "1.4.0",
					error: { code: "authentication_failed", message: "Authentication is required.", next_action: "Renew." },
				}),
			);
			return;
		}
		const value =
			body.operation === "handshake"
				? handshakeResponse(body)
				: body.operation === "discover" && options.discoveryFactory
					? options.discoveryFactory(body)
					: body.operation === "discover"
						? discoveryResponse(body)
						: body.operation === "call"
							? callResponse(body)
							: readbackResponse(body);
		response.writeHead(200, { "content-type": "application/json" });
		response.end(JSON.stringify(value));
	});
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("test server address unavailable");
	try {
		await callback({
			endpoint: `http://127.0.0.1:${address.port}/gateway/client`,
			oldRefreshToken,
			newAccessToken,
			newRefreshToken,
			requests,
			revoked,
			refreshCalls: () => refreshCallCount,
		});
	} finally {
		await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
	}
}

function installedReleaseReading(_binaryPath: string): CealInstalledReleaseReading {
	return {
		ok: true,
		facts: {
			platform: "linux-amd64",
			release_version: WORKER_PACKAGE_VERSION,
			artifact_sha256: "a".repeat(64),
			artifact_state: "built",
			manifest: "ceal-worker-release-manifest-linux-amd64.json",
			digest_agreement: "binary_bytes_manifest_and_sha256sums_agree",
			protocol: {},
		},
	};
}

function storedSession(endpoint: string, overrides: Partial<CealStoredSession> = {}): CealStoredSession {
	return {
		gatewayEndpoint: endpoint,
		profileRef: "profile:narnia",
		membershipRef: "membership:narnia",
		registrationRef: "registration:narnia",
		clientRef: "client:narnia",
		subjectRef: "subject:hwidong",
		instanceRef: "instance:corca",
		accessToken: `ceal_personal_${"P".repeat(43)}`,
		expiresAt: "2099-07-14T00:00:00.000Z",
		refreshToken: `ceal_refresh_${"R".repeat(43)}`,
		refreshTokenIdleExpiresAt: "2099-08-14T00:00:00.000Z",
		refreshTokenAbsoluteExpiresAt: "2099-10-14T00:00:00.000Z",
		...overrides,
	};
}

function serializeStoredSession(session: CealStoredSession): Record<string, unknown> {
	const hasAttempt = session.refreshAttemptRef !== undefined;
	return {
		schema_version: hasAttempt
			? "ceal.client_session_store.v3"
			: session.renewalBlockedReason
				? "ceal.client_session_store.v2"
				: "ceal.client_session_store.v1",
		gateway_endpoint: session.gatewayEndpoint,
		profile_ref: session.profileRef,
		membership_ref: session.membershipRef,
		registration_ref: session.registrationRef,
		client_ref: session.clientRef,
		subject_ref: session.subjectRef,
		instance_ref: session.instanceRef,
		access_token: session.accessToken,
		expires_at: session.expiresAt,
		refresh_token: session.refreshToken,
		refresh_token_idle_expires_at: session.refreshTokenIdleExpiresAt,
		refresh_token_absolute_expires_at: session.refreshTokenAbsoluteExpiresAt,
		...(hasAttempt ? { refresh_attempt_ref: session.refreshAttemptRef } : {}),
		...(session.renewalBlockedReason ? { renewal_blocked_reason: session.renewalBlockedReason } : {}),
	};
}

function rotatedClientSession(refreshToken: string): Record<string, unknown> {
	return {
		schema_version: "ceal.client_refresh_result.v1",
		ok: true,
		profile_ref: "profile:narnia",
		membership_ref: "membership:narnia",
		registration_ref: "registration:narnia",
		client_ref: "client:narnia",
		subject_ref: "subject:hwidong",
		instance_ref: "instance:corca",
		access_token: `ceal_personal_${"N".repeat(43)}`,
		expires_at: "2099-07-14T00:00:00.000Z",
		refresh_token: refreshToken,
		refresh_token_idle_expires_at: "2099-08-14T00:00:00.000Z",
		refresh_token_absolute_expires_at: "2099-10-14T00:00:00.000Z",
	};
}

function rotatedClientSessionV2(
	refreshToken: string,
	refreshAttemptRef: string,
	refreshDelivery: "initial" | "recovery" = "initial",
): Record<string, unknown> {
	return {
		...rotatedClientSession(refreshToken),
		schema_version: "ceal.client_refresh_result.v2",
		refresh_attempt_ref: refreshAttemptRef,
		refresh_delivery: refreshDelivery,
	};
}

async function waitForTestSignal(signal: Promise<unknown>, message: string): Promise<void> {
	let timer: NodeJS.Timeout | undefined;
	try {
		await Promise.race([
			signal,
			new Promise((_, reject) => {
				timer = globalThis.setTimeout(() => reject(new Error(message)), 10_000);
			}),
		]);
	} finally {
		globalThis.clearTimeout(timer);
	}
}

function parseYaml(stdout: string): YamlValue {
	const documents = parseAllDocuments(stdout, { uniqueKeys: true });
	assert.equal(documents.length, 1);
	const document = requiredValue(documents[0], "yaml_document");
	assert.deepEqual(document.errors, []);
	return document.toJS();
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function handshakeResponse(request: FixtureRequest): FixtureResponse {
	return success(request, {
		schema_version: "ceal.gateway_handshake.v1",
		negotiated_protocol_version: "1.4.0",
		supported_gateway_protocol_range: { minimum: "1.4.0", maximum: "1.4.0" },
		profile_ref: request.profile_ref,
		membership_ref: "membership:narnia",
		registration_ref: "registration:narnia",
		client_ref: "client:narnia",
		subject_ref: "subject:hwidong",
		instance_ref: "instance:corca",
		host_decision: "accepted",
		proof_level: "host_decision",
		non_claims: ["provider_execution_not_reached", "production_audit_not_reached"],
	});
}

function discoveryResponse(request: FixtureRequest): FixtureResponse {
	const selected = request.body.capability_id === "message.search";
	return success(request, {
		schema_version: "ceal.gateway_discovery.v3",
		phase: "target_page",
		profile_ref: request.profile_ref,
		membership_ref: "membership:narnia",
		capabilities: [
			{
				capability_id: "message.search",
				label: "Search messages",
				effect: "read",
				target_requirement: "required",
				input_contract: {
					schema_version: "ceal.message_search_input.v1",
					required: ["query"],
					query: { type: "string", max_bytes: 512 },
					limit: { type: "integer", minimum: 1, maximum: 10, default: 5 },
				},
				evidence_requirement: "gateway_audit",
			},
		],
		targets: selected
			? [
					{
						target_ref: "target:team-inbox",
						label: "Team inbox",
						connector_kind: "slack",
						target_kind: "conversation",
						access: "granted",
						capability_ids: ["message.search"],
						capability_access: [matureCapabilityAccess()],
					},
				]
			: [],
		target_catalog: selected
			? { target_count: 1, returned_count: 1, complete: true }
			: { target_count: 0, returned_count: 0, complete: true },
		host_decision: "accepted",
		proof_level: "host_decision",
		non_claims: ["provider_execution_not_reached", "production_audit_not_reached"],
	});
}

function callResponse(request: FixtureRequest): FixtureResponse {
	return success(request, {
		schema_version: "ceal.gateway_call_result.v1",
		capability_id: "message.search",
		grant_ref: "grant:team-inbox-message-search",
		grant_revision: 4,
		target_ref: request.body.target_ref,
		data: {
			schema_version: "ceal.message_search_result.v1",
			query: { redacted: true, utf8_bytes: 6, empty: false },
			result_count: 1,
			results: [
				{
					ref: "message:msg_001",
					target_ref: request.body.target_ref,
					created_at: "2026-07-10T00:00:00.000Z",
					source_label: "Team inbox",
					text_preview: "Launch readiness is green.",
				},
			],
			coverage: matureSearchCoverage(),
			minimization: { raw_provider_ids_included: false, raw_messages_included: false, credential_material_included: false },
		},
		redaction: { state: "applied", omitted_classes: ["query_text", "raw_provider_ids", "raw_messages"] },
		host_decision: "accepted",
		proof_level: "host_decision",
		non_claims: ["provider_execution_not_reached", "production_audit_not_reached"],
	});
}

function readbackResponse(request: FixtureRequest): FixtureResponse {
	return success(request, {
		schema_version: "ceal.gateway_audit_readback.v1",
		request_id: request.body.request_id,
		events: [
			{
				schema_version: "ceal.gateway_audit_event.v1",
				event_ref: "gateway-audit:event:001",
				request_id: request.body.request_id,
				profile_ref: request.profile_ref,
				membership_ref: "membership:narnia",
				membership_revision: 1,
				registration_ref: "registration:narnia",
				client_ref: "client:narnia",
				client_revision: 1,
				subject_ref: "subject:hwidong",
				instance_ref: "instance:corca",
				occurred_at: "2026-07-13T21:00:00.000Z",
				operation: "call",
				auth_decision: "allowed",
				policy_decision: "allowed",
				outcome: "succeeded",
				error_code: null,
				grant_snapshot: {
					schema_version: "ceal.gateway_authorization_snapshot.v1",
					capability_id: "message.search",
					target_ref: "target:team-inbox",
					grant_ref: "grant:team-inbox-message-search",
					grant_revision: 4,
				},
				call: {
					schema_version: "ceal.gateway_audit_call_detail.v1",
					capability_id: "message.search",
					grant_ref: "grant:team-inbox-message-search",
					grant_revision: 4,
					target_ref: "target:team-inbox",
					requested_limit: 5,
					query_utf8_bytes: 6,
					result_count: 1,
					gateway_elapsed_ms: 42,
					coverage: matureSearchCoverage(),
				},
				proof_level: "host_decision",
				non_claims: ["provider_execution_not_reached", "production_audit_not_reached"],
			},
		],
	});
}

// Mirrors the applied Gateway's pre-provider policy denial: no call detail or
// grant snapshot exists, so the negotiated handling time rides on the event.
function policyDeniedReadbackResponse(request: FixtureRequest): FixtureResponse {
	return success(request, {
		schema_version: "ceal.gateway_audit_readback.v1",
		request_id: request.body.request_id,
		events: [
			{
				schema_version: "ceal.gateway_audit_event.v1",
				event_ref: "gateway-audit:event:denied",
				request_id: request.body.request_id,
				profile_ref: request.profile_ref,
				membership_ref: "membership:narnia",
				membership_revision: 1,
				registration_ref: "registration:narnia",
				client_ref: "client:narnia",
				client_revision: 1,
				subject_ref: "subject:hwidong",
				instance_ref: "instance:corca",
				occurred_at: "2026-07-24T09:00:00.000Z",
				operation: "call",
				auth_decision: "allowed",
				policy_decision: "denied",
				outcome: "denied",
				error_code: "resource_not_available",
				gateway_elapsed_ms: 6892,
				proof_level: "host_decision",
				non_claims: ["provider_execution_not_reached", "production_audit_not_reached"],
			},
		],
	});
}

function continuationFailureResponse(request: FixtureRequest): FixtureResponse {
	return {
		ok: false,
		request_id: request.request_id,
		protocol_version: "1.4.0",
		error: {
			code: "continuation_not_available",
			message: "server-controlled",
			next_action: "server-controlled",
		},
	};
}

function invalidArgumentsFailureResponse(request: FixtureRequest): FixtureResponse {
	return {
		ok: false,
		request_id: request.request_id,
		protocol_version: "1.4.0",
		error: {
			code: "invalid_arguments",
			message: "server-controlled",
			next_action: "server-controlled",
		},
	};
}

function failedReadbackResponse(request: FixtureRequest): FixtureResponse {
	return success(request, {
		schema_version: "ceal.gateway_audit_readback.v1",
		request_id: request.body.request_id,
		events: [
			{
				schema_version: "ceal.gateway_audit_event.v1",
				event_ref: "gateway-audit:event:failed",
				request_id: request.body.request_id,
				profile_ref: request.profile_ref,
				membership_ref: "membership:narnia",
				membership_revision: 1,
				registration_ref: "registration:narnia",
				client_ref: "client:narnia",
				client_revision: 1,
				subject_ref: "subject:hwidong",
				instance_ref: "instance:corca",
				occurred_at: "2026-07-20T13:00:00.000Z",
				operation: "call",
				auth_decision: "allowed",
				policy_decision: "allowed",
				outcome: "failed",
				error_code: "continuation_not_available",
				grant_snapshot: {
					schema_version: "ceal.gateway_authorization_snapshot.v1",
					capability_id: "message.get",
					target_ref: "target:team-inbox",
					grant_ref: "grant:team-inbox-message-get",
					grant_revision: 4,
				},
				proof_level: "host_decision",
				non_claims: ["provider_execution_not_reached", "production_audit_not_reached"],
			},
		],
	});
}

function connectorFailureReadbackResponse(request: FixtureRequest): FixtureResponse {
	const response = failedReadbackResponse(request);
	assert.ok(response.ok);
	const [event] = fixtureRecordArrayField(response.value, "events");
	assert.ok(event);
	event.policy_decision = "not_evaluated";
	event.error_code = "connector_unavailable";
	delete event.grant_snapshot;
	event.connector_route_failure = {
		schema_version: "ceal.gateway_connector_route_failure.v1",
		connector_kind: "notion",
		phase: "scope_observation",
	};
	return response;
}

function matureCapabilityAccess() {
	return {
		schema_version: "ceal.capability_access.v1",
		capability_id: "message.search",
		grant_ref: "grant:team-inbox-message-search",
		grant_revision: 4,
		readiness: "ready",
	};
}

function matureSearchCoverage() {
	return {
		schema_version: "ceal.message_search_coverage.v1",
		source: "authoritative_index",
		match_semantics: "backend_ranked",
		reply_coverage: "included",
		completeness: "bounded",
		truncated: false,
	};
}

function success(request: FixtureRequest, value: Record<string, unknown>): FixtureResponse {
	return {
		ok: true,
		request_id: request.request_id,
		protocol_version: "1.4.0",
		proof_ref_or_unavailable: `audit:${request.request_id}`,
		value,
	};
}

test("a receipt this client cannot project is counted, not passed over", async () => {
	// The likeliest real loss path, and the one contention never causes: a
	// receipt-bearing result whose fields fall outside the client's safe
	// vocabulary projects to nothing. Before this it was indistinguishable from
	// a pre-issue failure that legitimately has no receipt, so the history came
	// up short with nothing marking the gap. A Gateway that adds a status token
	// or lengthens a ref would trigger it on every call.
	await withGateway(async ({ endpoint }) => {
		const spooled: CealReceiptSpoolEntry[] = [];
		let drops = 0;
		const runtime = {
			readStoredSession: async () => storedSession(endpoint),
			// Not a safe-ref: spaces and a slash are outside the spool's grammar,
			// so the receipt is real and the projection still refuses it.
			nextRequestId: () => "narnia opaque/1",
			recordReceiptSpool: (_identity: string, entry: CealReceiptSpoolEntry): void => {
				spooled.push(entry);
			},
			recordReceiptSpoolDrop: () => {
				drops += 1;
			},
		};
		// The unsafe ref also fails the Gateway's own readback, so this exits 3 —
		// which is beside the point here: the envelope is receipt-bearing either
		// way, and that is what the projection refuses.
		const payload = await yamlRun(["call", "message.search", "--target", "target:team-inbox", "query=launch"], 3, runtime);
		assert.equal(
			payload.receipt.request_ref,
			"narnia opaque/1:call",
			"the result still carries its receipt; only the local projection failed",
		);
		assert.deepEqual(spooled, [], "an unprojectable receipt must not be spooled");
		assert.equal(drops, 1, "and must be counted as lost");
	});

	// The other half of the contract: a pre-issue failure has no receipt at all,
	// which is not a loss and must not inflate the count.
	await withGateway(
		async ({ endpoint }) => {
			let drops = 0;
			const runtime = {
				readStoredSession: async () => storedSession(endpoint),
				recordReceiptSpool: () => {},
				recordReceiptSpoolDrop: () => {
					drops += 1;
				},
			};
			await yamlRun(["call", "message.search", "--target", "target:team-inbox", "query=launch"], 3, runtime);
			assert.equal(drops, 0, "a result that never had a receipt is not a lost one");
		},
		(request) =>
			request.operation === "call"
				? {
						ok: false,
						request_id: request.request_id,
						protocol_version: "1.4.0",
						error: { code: "session_unavailable", message: "server-controlled", next_action: "server-controlled" },
					}
				: readbackResponse(request),
	);
});

test("a receipt the packaged bin could not spool is counted rather than lost silently", async () => {
	// The store counts drops and the observer renders them, but neither proves
	// bin.js actually reports one: its `.catch` is the only place a swallowed
	// append becomes a recorded drop, and nothing else executes that line. With
	// the wiring reverted to `.catch(() => {})` every store-level and
	// observer-level test here still passes.
	await withGateway(async ({ endpoint }) => {
		const home = mkdtempSync(path.join(tmpdir(), "ceal-bin-drop-"));
		try {
			mkdirSync(path.join(home, ".ceal"), { recursive: true, mode: 0o700 });
			writeFileSync(
				path.join(home, ".ceal", "client-session.json"),
				`${JSON.stringify(serializeStoredSession(storedSession(endpoint)), null, 2)}\n`,
				{ mode: 0o600 },
			);
			// A directory where the spool file belongs: the store refuses to write
			// through it, which is a real append failure rather than an injected one.
			mkdirSync(path.join(home, ".ceal", "receipt-spool.json"), { mode: 0o700 });
			const result = await runBin(["call", "message.search", "--target", "target:team-inbox", "query=launch"], "", { HOME: home });
			// The call itself must be untouched: that is the whole reason the spool
			// failure is swallowed in the first place.
			assert.equal(result.code, 0, result.stderr);
			assert.equal(parseYaml(result.stdout).status, "completed");
			const drops = path.join(home, ".ceal", "receipt-spool-drops");
			assert.equal(existsSync(drops), true, "a swallowed spool append must still leave a counted drop");
			assert.match(readFileSync(drops, "utf8"), /^ceal\.receipt_spool_drops\.v2 [a-f0-9]{64}\n\.$/u);
			assert.equal(statSync(drops).mode & 0o777, 0o600);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});
});

test("--timing preserves one-result stdout and emits only fixed secret-free phase events", async () => {
	const ordinary = await runBin(["--help"], "");
	assert.equal(ordinary.code, 0);
	assert.equal(ordinary.stderr, "");
	const staticTimed = await runBin(["--timing", "--help"], "");
	assert.equal(staticTimed.code, 0);
	assert.equal(staticTimed.stdout, ordinary.stdout, "the opt-in diagnostic may not alter the command result");
	const staticEvents = timingEvents(staticTimed.stderr);
	assert.deepEqual(new Set(staticEvents.map((event) => event.stage)), new Set(["cli_bootstrap"]));
	const guideTimed = await runBin(["--timing", "guide", "status"], "");
	assert.equal(guideTimed.code, 0, guideTimed.stderr);
	const guideDocument = parseYaml(guideTimed.stdout);
	assert.equal(guideDocument.status, "available");
	assert.equal(guideDocument.carrier, "source");
	assert.equal(guideDocument.update_safe, false);
	const guideStages = new Set(timingEvents(guideTimed.stderr).map((event) => event.stage));
	assert.ok(guideStages.has("runtime_prepare"));
	assert.ok(guideStages.has("guide_inspect"));

	await withGateway(async ({ endpoint }) => {
		const home = mkdtempSync(path.join(tmpdir(), "ceal-bin-timing-"));
		try {
			mkdirSync(path.join(home, ".ceal"), { recursive: true, mode: 0o700 });
			writeFileSync(
				path.join(home, ".ceal", "client-session.json"),
				`${JSON.stringify(serializeStoredSession(storedSession(endpoint)), null, 2)}\n`,
				{ mode: 0o600 },
			);
			const result = await runBin(["--timing", "capabilities", "--fresh"], "", { HOME: home });
			assert.equal(result.code, 0, result.stderr);
			assert.equal(parseAllDocuments(result.stdout, { uniqueKeys: true }).length, 1);
			const events = timingEvents(result.stderr);
			const stages = new Set(events.map((event) => event.stage));
			const expectedStages: readonly CealTimingStage[] = [
				"cli_bootstrap",
				"runtime_import",
				"session_load",
				"gateway_handshake",
				"gateway_discovery",
			];
			for (const stage of expectedStages) {
				assert.ok(stages.has(stage), `missing ${stage}: ${result.stderr}`);
			}
			for (const event of events) {
				assert.ok(CEAL_TIMING_STAGES.includes(event.stage));
				assert.deepEqual(
					Object.keys(event).sort(),
					event.event === "start"
						? ["event", "schema_version", "sequence", "stage"]
						: ["elapsed_ms", "event", "outcome", "schema_version", "sequence", "stage"],
				);
			}
			assert.doesNotMatch(result.stderr, /profile:|membership:|subject:|instance:|ceal_(?:personal|refresh)_|https?:\/\//u);

			const call = await runBin(["--timing", "call", "message.search", "--target", "target:team-inbox", "query=launch"], "", { HOME: home });
			assert.equal(call.code, 0, call.stderr);
			const callStages = new Set(timingEvents(call.stderr).map((event) => event.stage));
			const expectedCallStages: readonly CealTimingStage[] = ["session_load", "gateway_call", "gateway_readback", "receipt_spool_append"];
			for (const stage of expectedCallStages) {
				assert.ok(callStages.has(stage), `missing ${stage}: ${call.stderr}`);
			}
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});
});

test("--timing separates local lock, refresh, and revoke phases", async () => {
	await withRenewingGateway(async ({ endpoint, oldRefreshToken }) => {
		const home = mkdtempSync(path.join(tmpdir(), "ceal-bin-timing-session-"));
		try {
			mkdirSync(path.join(home, ".ceal"), { recursive: true, mode: 0o700 });
			writeFileSync(
				path.join(home, ".ceal", "client-session.json"),
				`${JSON.stringify(
					serializeStoredSession(
						storedSession(endpoint, {
							expiresAt: "2020-01-01T00:00:00.000Z",
							refreshToken: oldRefreshToken,
							refreshTokenAbsoluteExpiresAt: "2099-01-01T00:00:00.000Z",
						}),
					),
					null,
					2,
				)}\n`,
				{ mode: 0o600 },
			);
			const refreshed = await runBin(["--timing", "session", "refresh"], "", { HOME: home });
			assert.equal(refreshed.code, 0, refreshed.stderr);
			const refreshedStages = new Set(timingEvents(refreshed.stderr).map((event) => event.stage));
			assert.ok(refreshedStages.has("local_store_lock_wait"));
			assert.ok(refreshedStages.has("session_refresh"));

			const loggedOut = await runBin(["--timing", "session", "logout"], "", { HOME: home });
			assert.equal(loggedOut.code, 0, loggedOut.stderr);
			const logoutStages = new Set(timingEvents(loggedOut.stderr).map((event) => event.stage));
			assert.ok(logoutStages.has("local_store_lock_wait"));
			assert.ok(logoutStages.has("session_revoke"));
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});
});

test("private entrypoints fail closed on malformed carrier input and absent control fd", async () => {
	const carrier = await runBin(["--internal-leased-consumer-carrier"], "not-json");
	assert.equal(carrier.code, 2);
	assert.deepEqual(JSON.parse(carrier.stdout), {
		schema_version: "ceal.leased_consumer_call_result.v1",
		ok: false,
		status: "error",
		error_code: "invalid_request",
	});

	const control = await runBin(["--internal-leased-consumer-control-session"], "");
	assert.equal(control.code, 3);
	assert.equal(control.stdout, "");
});

type TimingEvent = {
	schema_version: "ceal.timing.v1";
	event: "start" | "finish";
	sequence: number;
	stage: CealTimingStage;
	outcome?: "ok" | "error";
	elapsed_ms?: number;
};

function timingEvents(stderr: string): TimingEvent[] {
	const events = stderr
		.split("\n")
		.filter(Boolean)
		.map((line): TimingEvent => JSON.parse(line));
	assert.ok(events.length >= 2, "a timed command emits at least one start/finish pair");
	for (const event of events) {
		assert.equal(event.schema_version, "ceal.timing.v1");
		assert.ok(event.event === "start" || event.event === "finish");
		assert.ok(Number.isSafeInteger(event.sequence) && event.sequence > 0);
		if (event.event === "finish") {
			assert.ok(event.outcome === "ok" || event.outcome === "error");
			assert.ok(typeof event.elapsed_ms === "number" && event.elapsed_ms >= 0);
		}
	}
	const started = events.filter((event) => event.event === "start").map((event) => event.sequence);
	const finished = events.filter((event) => event.event === "finish").map((event) => event.sequence);
	assert.deepEqual(finished, started, "every completed timed phase has one matching start");
	return events;
}

// The record this emits leaves the machine, so the property under test is not
// "the fields are right" but "the host is absent". It is built by allow-list for
// that reason, and these drive the builder directly: requiring an installed
// release to test the leak-prevention would mean no gate at all on a machine
// without one.
type AcceptancePartsFixture = {
	release: CealAcceptanceRecordParts["release"] & Record<string, unknown>;
	reportedVersion: CealAcceptanceRecordParts["reportedVersion"];
	clientProtocolVersion: CealAcceptanceRecordParts["clientProtocolVersion"];
	guide: CealAcceptanceRecordParts["guide"] & Record<string, unknown>;
	session: CealAcceptanceRecordParts["session"] & Record<string, unknown>;
	boundedCall: CealAcceptanceRecordParts["boundedCall"];
};

function acceptanceParts(overrides: Record<string, unknown> = {}): AcceptancePartsFixture {
	return acceptancePartsBase(overrides);
}

function acceptancePartsBase(overrides: Record<string, unknown> = {}): AcceptancePartsFixture {
	const base: AcceptancePartsFixture = {
		release: {
			platform: "linux-amd64",
			release_version: "0.68.0",
			artifact_sha256: "a".repeat(64),
			artifact_state: "unsigned_build_candidate",
			manifest: "ceal-worker-release-manifest-linux-amd64.json",
			digest_agreement: "binary_bytes_manifest_and_sha256sums_agree",
			protocol: { package: "@corca-ai/ceal-protocol", producer: { repository: "corca-ai/ceal" } },
		},
		reportedVersion: "0.68.0",
		clientProtocolVersion: "1.4.0",
		guide: { status: "available", registered_host_count: 2 },
		session: {
			instance_ref: "instance:ceal-prod",
			profile_ref: "profile:work",
			negotiated_protocol_version: "1.4.0",
			host_decision: "accepted",
			catalog_source: "live_discovery",
			capability_count: 20,
			elapsed_ms: 1234,
		},
		boundedCall: null,
	};
	return { ...base, ...overrides };
}

test("the emitted acceptance record never carries a host path, however the parts arrive", () => {
	const parts = acceptanceParts();
	// Fields that do not belong in the record are handed in anyway: the builder
	// must not pass them through just because a caller supplied them.
	parts.release.binary_path = "/home/someone/.local/bin/ceal";
	parts.guide.registered_hosts = ["/home/someone/.claude/skills"];
	parts.session.access_token = "ceal_personal_secret";
	const record = buildAcceptanceRecord(parts);
	const serialized = JSON.stringify(record);
	assert.doesNotMatch(serialized, /\/home\/someone|binary_path|registered_hosts|access_token|secret/u);
	// The evidence it exists to carry survives.
	const installedClient = fixtureRecordField(record, "installed_client");
	const guide = fixtureRecordField(record, "guide");
	const gatewaySession = fixtureRecordField(record, "gateway_session");
	assert.equal(installedClient.artifact_sha256, "a".repeat(64));
	assert.equal(installedClient.digest_agreement, "binary_bytes_manifest_and_sha256sums_agree");
	assert.equal(guide.registered_host_count, 2);
	assert.equal(gatewaySession.instance_ref, "instance:ceal-prod");
	assert.equal(record.schema_version, "ceal.worker_acceptance_result.v2");
	assert.equal(record.emitted_by, "installed_client");
});

// The guide this repository ships tells an agent to branch on `ok`, "which every
// command answers". The refusal writer for this schema answers it; the success
// document did not, so a reader following the shipped instruction read a
// successful acceptance run as falsy and reported the release unproven.
test("the emitted acceptance record answers the success predicate its own refusal and guide promise", () => {
	const record = buildAcceptanceRecord(acceptanceParts());
	assert.equal(record.ok, true);
	assert.equal(record.command, "ceal");
	assert.equal(record.status, "emitted");
	// Both halves of the schema must stay one shape for a caller with one reader.
	assert.match(workerSource(), /schema_version: "ceal\.worker_acceptance_result\.v2",\s*\n\s*command: "ceal",\s*\n\s*ok: false/u);
});

test("the record states what it did not do, including that it called no provider", () => {
	const withoutCall = buildAcceptanceRecord(acceptanceParts());
	const claimsValue = withoutCall.non_claims;
	assert.ok(Array.isArray(claimsValue));
	const claims = claimsValue.join("\n");
	assert.match(claims, /performed no provider call/u);
	assert.match(claims, /provider_execution_not_reached/u);
	// An installed host carries no handoff lock, so the producer tuple is the
	// manifest's own statement. Saying so is the difference between evidence and
	// a self-report presented as evidence.
	assert.match(claims, /No handoff lock is present on an installed host/u);
	assert.match(claims, /artifact_state is 'unsigned_build_candidate'/u);
	assert.match(claims, /does not mean the installed artifact is unsigned/u);

	// With a read-back receipt the provider-execution non-claim is dropped,
	// because one did happen — under `ceal call`, not under this command.
	const withCall = buildAcceptanceRecord(
		acceptanceParts({
			boundedCall: {
				capability: null,
				target: null,
				status: "verified",
				exit_code: null,
				elapsed_ms: null,
				evidence: null,
				request_ref: "ceal:x:call",
				receipt: {
					readback_status: "verified",
					gateway_audit_readback: "verified",
					provider_state_readback: "not_established",
					outcome: "succeeded",
					authorization: "allowed",
					audit_refs: [],
					gateway_elapsed_ms: null,
				},
			},
		}),
	);
	const withCallClaims = withCall.non_claims;
	assert.ok(Array.isArray(withCallClaims));
	assert.doesNotMatch(withCallClaims.join("\n"), /provider_execution_not_reached/u);
	assert.match(withCallClaims.join("\n"), /performed no provider call/u);
});

// A legacy acceptance record carried `membership_ref` and `subject_ref` because
// this builder used to emit whatever bounded-call object it
// was handed, and the acceptance path handed it the decoded Gateway audit event.
// The projection is now by declared key, so this asserts the property — an
// undeclared key cannot travel — rather than re-listing the forbidden names.
test("a bounded-call field the builder was never told to emit does not travel", () => {
	const record = buildAcceptanceRecord(
		acceptanceParts({
			boundedCall: {
				capability: null,
				target: null,
				status: "verified",
				exit_code: null,
				elapsed_ms: null,
				evidence: null,
				request_ref: "ceal:x:call",
				receipt: {
					readback_status: "verified",
					gateway_audit_readback: "verified",
					provider_state_readback: "not_established",
					outcome: "succeeded",
					authorization: "allowed",
					audit_refs: ["gateway-audit:one"],
					gateway_elapsed_ms: 7,
					membership_ref: "membership:hwidong-work",
					subject_ref: "subject:hwidong",
				},
				events: [{ subject_ref: "subject:hwidong" }],
			},
		}),
	);
	const serialized = JSON.stringify(record);
	assert.doesNotMatch(serialized, /membership_ref|subject_ref|"events"/u);
	// Positive control: the evidence the row exists to carry did survive.
	const boundedCall = fixtureRecordField(record, "bounded_capability_call");
	const receipt = fixtureRecordField(boundedCall, "receipt");
	assert.equal(boundedCall.request_ref, "ceal:x:call");
	assert.deepEqual(receipt.audit_refs, ["gateway-audit:one"]);
	assert.equal(receipt.gateway_elapsed_ms, 7);
	// Every declared key is present even when the caller omitted it, so the two
	// emitters answer one schema with one key set.
	assert.equal(receipt.exit_code, null);
});

test("a build tree is refused as an installed release rather than described as one", () => {
	// The running binary in a dev checkout has no release layout beside it, which
	// is exactly the substitution this command must not narrate.
	const reading = readInstalledReleaseFacts(fileURLToPath(new URL("../src/bin.ts", import.meta.url)));
	assert.equal(reading.ok, false);
	assert.equal(reading.code, "managed_install_required");
});
