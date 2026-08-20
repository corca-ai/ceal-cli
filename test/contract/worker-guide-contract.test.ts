import { runCealCommand } from "../../packages/ceal-worker-cli/dist/index.js";
import { required as requiredValue,requiredCapture } from "../required.ts";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseAllDocuments } from "yaml";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BINARY_ROOT = existsSync(path.join(ROOT, "packages")) ? ROOT : path.resolve(ROOT, "..", "..");
const ISOLATED_HOME = mkdtempSync(path.join(tmpdir(), "ceal-worker-guide-contract-home-"));
const WORKER = { skill: "ceal-guide", binary: "ceal", packageDir: "ceal-worker-cli" };
const GUIDE_ROOT = path.join(ROOT, "skills", WORKER.skill);
const CAPABILITY_WORKFLOW = path.join(GUIDE_ROOT, "references", "capability-workflow.md");
const LINKED_PRIVATE_CONTEXT = path.join(GUIDE_ROOT, "references", "linked-private-context.md");
const REAL_BINARY_SMOKES = {
	root_help: { args: ["--help"], expectedStatus: 0 },
	deep_explicit_help: { args: ["help", "capabilities", "targets"], expectedStatus: 0 },
	cold_capabilities: { args: ["capabilities"], expectedStatus: 3 },
};

type Route = { name: string; description: string };
type SmokeName = keyof typeof REAL_BINARY_SMOKES;
type CommandResult = { code: number; stdout: string; stderr: string };
type ColdStartStatus = {
	command: "ceal";
	status: "unavailable";
	proof_level: "surface";
	live_gateway_checked: false;
	non_claims: string[];
};

test.after(() => rmSync(ISOLATED_HOME, { recursive: true, force: true }));

// The worker release lane declares its own guide asset in `worker-release-inputs.json`
// and digests the file it actually ships, so nothing here restates a digest: this
// suite asserts what the guide teaches, not that two files were hand-synchronized.
// `release-contract.json` is a forbidden worker release input, and the digest it
// records is the frozen legacy lane's own drift check — asserted for both guides
// in `guide-contract.test.mjs`, alongside the lane that consumes it.
test("the worker guide teaches help-driven discovery without command snapshots", async () => {
	const core = readFileSync(path.join(GUIDE_ROOT, "SKILL.md"), "utf8");
	const guide = `${core}\n${readFileSync(CAPABILITY_WORKFLOW, "utf8")}\n${readFileSync(LINKED_PRIVATE_CONTEXT, "utf8")}`;
	assert.match(guide, /^name: ceal-guide$/mu);
	assert.match(guide, /\bceal --help\b/u);
	assert.match(guide, /ceal <command> --help/u);
	assert.doesNotMatch(guide, /--json|--format json/u);
	const rootHelp = await runCommand(["--help"]);
	assert.equal(runBinarySmoke("root_help").stdout, rootHelp.stdout, "the packaged entrypoint must render the command surface unchanged");
	const routes = parseRoutes(rootHelp.stdout);
	assert.ok(routes.length > 0, "ceal --help advertised no route; the help parser is not matching");
	for (const route of routes) {
		if (!["capabilities", "call", "receipt"].includes(route.name))
			assert.doesNotMatch(guide, new RegExp(`\\bceal\\s+${route.name}(?:\\s|\u0060)`, "u"));
	}
	// The guide owns invariant navigation method, not the currently recommended
	// route order. That order belongs to live Gateway guidance; leaf help remains
	// the fallback contract when a development Gateway has not begun serving it.
	assert.match(core, /Prefer ordered `recommended_next_steps`\s+returned by the live Gateway when present/u);
	assert.match(core, /If that field is\s+absent, use the discovered capability order as the client fallback/u);
	assert.match(core, /If neither surface identifies a next\s+move, stop/u);
	assert.doesNotMatch(guide, /ceal capabilities targets|ceal call <capability-id>|ceal receipt show <request-ref>/u);
	// Two non-claims the guide has to state, not two sentences it has to keep:
	// reword them and this gate should be re-read, which is the point.
	assert.match(guide, /catalog\s+grant is not backend\s+readiness/u);
	assert.match(guide, /not interchangeable with\s+legacy worker fixtures/u);
	assert.match(core, /\[Capability Workflow\]\(references\/capability-workflow[.]md\)/u);
	assert.match(core, /\[Linked Private Context\]\(references\/linked-private-context[.]md\)/u);
	assert.ok(existsSync(CAPABILITY_WORKFLOW));
	assert.ok(existsSync(LINKED_PRIVATE_CONTEXT));
});

test("a cold-start worker intent selects capabilities and preserves proof limits", async () => {
	const guide = readCapabilityGuide();
	assert.match(guide, /command registry is navigation only|Command discovery is navigation only/u);
	assert.match(guide, /Read help incrementally along the selected intent/u);
	assert.match(guide, /Do not front-load downstream\s+call or receipt help before live discovery/u);
	assert.match(guide, /Open each downstream leaf\s+immediately before its first use/u);
	assert.match(guide, /stop when the discovered contract cannot\s+produce the requested effect/u);
	const rootHelp = await runCommand(["--help"]);
	const candidates = await Promise.all(
		parseRoutes(rootHelp.stdout).map(async (route) => ({
			...route,
			help: (await runCommand([route.name, "--help"])).stdout,
		})),
	);
	const selected = candidates.find(
		(candidate) =>
			/Gateway-issued capabilities/u.test(candidate.description) && candidate.help.includes("Result schema: ceal.capabilities.v1"),
	);
	assert.ok(selected, "no semantic capabilities leaf found for a cold-start worker intent");
	for (const field of ["Usage:", "Effect: read_only", "Evidence:", "Result schema:", "Recovery/readback:"]) {
		assert.match(selected.help, new RegExp(field, "u"));
	}
	const result = runBinarySmoke("cold_capabilities");
	const documents = parseAllDocuments(result.stdout, { uniqueKeys: true });
	assert.equal(documents.length, 1);
	const document = requiredValue(documents[0], "cold_capabilities_document");
	assert.deepEqual(document.errors, []);
	const value: ColdStartStatus = document.toJS();
	assert.equal(value.command, "ceal");
	assert.equal(value.status, "unavailable");
	assert.equal(value.proof_level, "surface");
	assert.equal(value.live_gateway_checked, false);
	assert.ok(value.non_claims.some((claim) => /No live Gateway discovery/u.test(claim)));
});

test("the worker guide teaches detailed contracts and diagnosis of a blocked first Gateway call", async () => {
	const guide = readCapabilityGuide();
	assert.match(guide, /`ceal capabilities --profile <profile-ref> --detail`/u);
	assert.match(guide, /source of truth for required call-input fields and\s+result bounds/u);
	assert.match(guide, /not the target-selector contract/u);
	assert.match(guide, /`target_selection\.request_kind`/u);
	assert.match(guide, /complete catalog with `target_count: 0`.*does not prove the Profile has no authorized target/su);
	assert.match(guide, /Follow its returned `next_action` to inspect a bounded\s+unfiltered page/u);
	assert.match(guide, /opaque ref for another capability's\s+call input without making that ref a valid target selector/u);
	assert.doesNotMatch(guide, /precise text or URL\s+match/u);
	assert.match(guide, /capabilities that enumerate or\s+resolve resources/u);
	assert.match(guide, /host sandbox or network policy/u);
	assert.match(guide, /report host reachability separately from Ceal\s+capability availability/u);
	assert.match(guide, /retry the same read-only discovery/u);
	assert.match(guide, /Do not\s+weaken the sandbox, switch to a provider CLI/u);
	assert.match(guide, /infer that the Profile has no\s+capability from a request that never reached the Gateway/u);
	assert.match(guide, /only when the discovered write contract requires\s+one/u);
	assert.match(guide, /exact returned\s+`receipt\.request_ref`/u);
	assert.match(guide, /original call inputs, and the original idempotency\s+key/u);
	assert.match(guide, /`audit_event_not_found` as permission to\s+retry/u);
	assert.doesNotMatch(guide, /preserve its replay identity/u);
	assert.match(
		guide,
		/`receipt\.verification\.gateway_audit_readback`; `ceal receipt show` reports it\s+at `verification\.gateway_audit_readback`/u,
	);
	assert.match(guide, /`verified` proves a Gateway journal\s+event/u);
	assert.match(guide, /does not prove provider state/u);
	const privateContext = readFileSync(LINKED_PRIVATE_CONTEXT, "utf8");
	assert.match(privateContext, /Do not open it automatically/u);
	assert.match(privateContext, /do not widen access/u);

	const capabilityHelp = (await runCommand(["capabilities", "--help"])).stdout;
	assert.match(capabilityHelp, /^ {2}--detail\s+Include each capability's full input_contract/mu);
});

test("every worker route advertised for descent renders four-field leaf help", async () => {
	const guide = readFileSync(path.join(GUIDE_ROOT, "SKILL.md"), "utf8");
	assert.match(guide, /`Subcommands:`/u);
	let advertised = 0;
	const advertisedRoutes = new Set();
	const rootHelp = await runCommand(["--help"]);
	for (const route of parseRoutes(rootHelp.stdout)) {
		const parentHelp = await runCommand([route.name, "--help"]);
		for (const child of parseSubcommands(parentHelp.stdout)) {
			advertised += 1;
			const childRoute = [route.name, ...child.split(" ")];
			advertisedRoutes.add(childRoute.join(" "));
			for (const args of [
				[...childRoute, "--help"],
				["help", ...childRoute],
			]) {
				const help = (await runCommand(args)).stdout;
				for (const field of ["Usage:", "Effect:", "Evidence:", "Result schema:", "Recovery/readback:"]) {
					assert.match(help, new RegExp(`^${field} \\S`, "mu"), `ceal ${args.join(" ")} is missing ${field}`);
				}
				assert.match(help, new RegExp(`^Usage: ceal ${childRoute.join(" ")}`, "mu"));
			}
		}
	}
	assert.ok(advertised > 0, "ceal advertises no subcommand route to descend into");
	assert.ok(advertisedRoutes.has("capabilities targets"), "the real-binary deep-help smoke must remain an advertised route");
	const explicitHelpArgs = REAL_BINARY_SMOKES.deep_explicit_help.args;
	assert.equal(
		runBinarySmoke("deep_explicit_help").stdout,
		(await runCommand(explicitHelpArgs)).stdout,
		"the packaged entrypoint must preserve explicit help routing for a deepest advertised leaf",
	);
});

test("the worker guide refuses a missing matching binary without a guessed fallback", () => {
	const guide = readFileSync(path.join(GUIDE_ROOT, "SKILL.md"), "utf8");
	assert.match(guide, /stop and request\s+installation or update of the matching binary/u);
	assert.match(guide, /Do not fall back to another\s+guide, binary, or guessed command/u);
	assert.doesNotMatch(guide, /\bcealctl\s+(?!--help\b)[a-z][a-z-]*/u, "ceal-guide must not show a runnable cealctl fallback");
});

function runBinarySmoke(name: SmokeName) {
	const smoke = REAL_BINARY_SMOKES[name];
	assert.ok(smoke, `unknown real-binary smoke: ${name}`);
	const bin = path.join(BINARY_ROOT, "packages", WORKER.packageDir, "dist", "bin.js");
	const result = spawnSync(process.execPath, [bin, ...smoke.args], {
		encoding: "utf8",
		// `coverage:scripts` measures scripts/**. These retained process smokes run
		// only the worker package binary, so inherited collection writes large V8
		// profiles that c8 discards during remap. Keep the real process boundary and
		// stop producing evidence the owning coverage target cannot consume.
		env: { ...process.env, HOME: ISOLATED_HOME, NODE_V8_COVERAGE: "" },
	});
	assert.equal(result.status, smoke.expectedStatus, result.stderr || result.stdout);
	assert.equal(result.stderr, "");
	return result;
}

function readCapabilityGuide() {
	return `${readFileSync(path.join(GUIDE_ROOT, "SKILL.md"), "utf8")}\n${readFileSync(CAPABILITY_WORKFLOW, "utf8")}`;
}

async function runCommand(args: readonly string[]): Promise<CommandResult> {
	let stdout = "";
	let stderr = "";
	const code = await runCealCommand(args, {
		stdout: { write: (chunk) => (stdout += String(chunk)) },
		stderr: { write: (chunk) => (stderr += String(chunk)) },
	});
	assert.equal(code, 0, stderr || stdout);
	assert.equal(stderr, "");
	return { code, stdout, stderr };
}

function parseSubcommands(help: string): string[] {
	const lines = help.split("\n");
	const start = lines.indexOf("Subcommands:");
	if (start < 0) return [];
	const rows: string[] = [];
	for (const line of lines.slice(start + 1)) {
		if (line === "") break;
		const match = /^ {2}([a-z][a-z0-9-]*(?: [a-z][a-z0-9-]*)*)\s{2,}\S/u.exec(line);
		if (match) rows.push(requiredCapture(match, 1, "subcommand_name"));
	}
	return rows;
}

function parseRoutes(help: string): Route[] {
	return help.split("\n").flatMap((line): Route[] => {
		const match = /^ {2}([a-z][a-z0-9-]*)\s{2,}(.+)$/u.exec(line);
		return match ? [{ name: requiredCapture(match, 1, "route_name"), description: requiredCapture(match, 2, "route_description") }] : [];
	});
}
