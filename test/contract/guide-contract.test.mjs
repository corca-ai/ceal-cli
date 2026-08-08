import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseAllDocuments } from "yaml";

// This gate needs only the workspace build output, never a release artifact, so it
// belongs in the contract tier the pre-push hook actually runs rather than in the
// release tier that materializes packed and native artifacts for nothing.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BINARY_ROOT = existsSync(path.join(ROOT, "packages")) ? ROOT : path.resolve(ROOT, "..", "..");
const ISOLATED_HOME = mkdtempSync(path.join(tmpdir(), "ceal-guide-contract-home-"));
// The teaching contracts below cover the frozen operator guide only. Both guides
// were asserted here and in `worker-guide-contract.test.mjs` from the lane split
// until this file was narrowed; the worker suite — the one the pre-push and CI
// gates actually run — carries every `ceal` assertion that used to be here except
// the release-contract digest, which stays in this file (see below).
const CASES = [{ skill: "cealctl-guide", binary: "cealctl", packageDir: "ceal-operator-cli" }];
// The sibling the fallback contract is about is worker-owned and not a case here.
const SIBLING_BINARY = "ceal";

test.after(() => rmSync(ISOLATED_HOME, { recursive: true, force: true }));

// `release-contract.json` records a digest per guide, and `build-platform-binaries.mjs`
// fails `guide_drift` when it does not match the file it is about to ship. That is a
// live input to the frozen legacy lane, not a hand-maintained derived value with no
// consumer — so it is asserted for *both* guides here, where the frozen lane is
// tested, rather than in the worker suite that must not read this contract at all.
// The cost is real and accepted: editing `skills/ceal-guide/SKILL.md` breaks a suite
// no gate runs, and is only seen by whoever runs `npm run test:legacy-compatibility`.
test("the release contract's guide digests match the guides the frozen lane would ship", () => {
	const releaseContract = JSON.parse(readFileSync(path.join(ROOT, "release-contract.json"), "utf8"));
	const digests = Object.entries(releaseContract.guides);
	assert.ok(digests.length >= 2, "the contract must still declare both guide assets");
	for (const [skill, declared] of digests) {
		const guide = readFileSync(path.join(ROOT, declared.path), "utf8");
		assert.equal(declared.sha256, createHash("sha256").update(guide).digest("hex"), `${skill} digest is stale`);
	}
});

test("guide packages teach help-driven discovery without command snapshots", () => {
	for (const item of CASES) {
		const guide = readFileSync(path.join(ROOT, "skills", item.skill, "SKILL.md"), "utf8");
		assert.match(guide, new RegExp(`^name: ${item.skill}$`, "mu"));
		assert.match(guide, new RegExp(`\\b${item.binary} --help\\b`, "u"));
		assert.match(guide, new RegExp(`${item.binary} <command> --help`, "u"));
		assert.doesNotMatch(guide, /--json|--format json/u);
		const top = runBinary(item, ["--help"]);
		const routes = parseRoutes(top.stdout);
		// `parseRoutes` is anchored to exactly two leading spaces, so a help-layout
		// change would return [] and make the snapshot ban below vacuous.
		assert.ok(routes.length > 0, `${item.binary} --help advertised no route; the help parser is not matching`);
		for (const route of routes) {
			assert.doesNotMatch(guide, new RegExp(`\\b${item.binary}\\s+${route.name}(?:\\s|\u0060)`, "u"));
		}
	}
});

test("cold-start customer intents select semantic leaves and preserve proof limits", () => {
	const scenarios = [
		{
			...CASES[0],
			prompt: "Check whether cealctl is ready.",
			purpose: /Check this binary and protocol surface/u,
			schema: "cealctl.doctor.v1",
			assertResult: (value) => {
				assert.equal(value.status, "surface_ready");
				assert.equal(value.proof_level, "surface");
				assert.deepEqual(value.setup, { status: "not_checked" });
				assert.deepEqual(value.runtime, { status: "not_checked" });
				assert.equal(value.writes_external, false);
			},
		},
	];
	for (const scenario of scenarios) exerciseCustomerScenario(scenario);
});

// The guide's Bootstrap tells an agent to descend and read four fields at the
// leaf it lands on. Depth-1 help is not enough: assert the same contract for
// every child route the installed help itself advertises, so a guide-mandated
// descent can never dead-end in an argument error (corca-ai/ceal-cli#1).
test("every advertised subcommand route renders its own four-field leaf help", () => {
	for (const item of CASES) {
		const guide = readFileSync(path.join(ROOT, "skills", item.skill, "SKILL.md"), "utf8");
		assert.match(guide, /`Subcommands:`/u);
		let advertised = 0;
		for (const route of parseRoutes(runBinary(item, ["--help"]).stdout)) {
			for (const child of parseSubcommands(runBinary(item, [route.name, "--help"]).stdout)) {
				advertised += 1;
				const childRoute = [route.name, ...child.split(" ")];
				for (const args of [
					[...childRoute, "--help"],
					["help", ...childRoute],
				]) {
					const help = runBinary(item, args).stdout;
					for (const field of ["Usage:", "Effect:", "Evidence:", "Result schema:", "Recovery/readback:"]) {
						assert.match(help, new RegExp(`^${field} \\S`, "mu"), `${item.binary} ${args.join(" ")} is missing ${field}`);
					}
					assert.match(help, new RegExp(`^Usage: ${item.binary} ${childRoute.join(" ")}`, "mu"));
				}
			}
		}
		assert.ok(advertised > 0, `${item.binary} advertises no subcommand route to descend into`);
	}
});

test("missing matching binary fails closed without a guessed fallback", () => {
	for (const item of CASES) {
		const guide = readFileSync(path.join(ROOT, "skills", item.skill, "SKILL.md"), "utf8");
		assert.match(guide, /stop and request installation or update of the matching binary/u);
		assert.match(guide, /Do not fall\s+back to another guide, another binary, or a guessed command/u);

		// The rule above is prose, so prove the guide obeys it rather than only
		// stating it: the sibling binary may be *named* — `cealctl-guide` names
		// `ceal` to refuse worker work — but never as a command to run, which is
		// exactly the guessed fallback the rule forbids. This replaces an
		// assertion that spawned a path which never existed and so only proved
		// that node exits non-zero on a missing script.
		const sibling = { binary: SIBLING_BINARY };
		assert.doesNotMatch(
			guide,
			new RegExp(`\\b${sibling.binary}\\s+(?!--help\\b)[a-z][a-z-]*`, "u"),
			`${item.skill} must not show a runnable ${sibling.binary} invocation as a fallback`,
		);
	}
});

function exerciseCustomerScenario(scenario) {
	const guide = readFileSync(path.join(ROOT, "skills", scenario.skill, "SKILL.md"), "utf8");
	assert.match(guide, /command registry is navigation only|Command discovery is navigation only/u);
	const top = runBinary(scenario, ["--help"]);
	const candidates = parseRoutes(top.stdout).map((route) => ({
		...route,
		help: runBinary(scenario, [route.name, "--help"]).stdout,
	}));
	const selected = candidates.find(
		(candidate) => scenario.purpose.test(candidate.description) && candidate.help.includes(`Result schema: ${scenario.schema}`),
	);
	assert.ok(selected, `no semantic leaf found for customer prompt: ${scenario.prompt}`);
	for (const field of ["Usage:", "Effect: read_only", "Evidence:", "Result schema:", "Recovery/readback:"]) {
		assert.match(selected.help, new RegExp(field, "u"));
	}
	const result = runBinary(scenario, [selected.name], { allowFailure: true });
	const documents = parseAllDocuments(result.stdout, { uniqueKeys: true });
	assert.equal(documents.length, 1);
	assert.deepEqual(documents[0].errors, []);
	const value = documents[0].toJS();
	assert.equal(value.command, scenario.binary);
	scenario.assertResult(value);
}

// Help rendering is a pure function of the argv here — same binary, same isolated
// HOME, no writes — and the four tests below walk overlapping route trees, so a
// third of the spawns were re-running an identical process. The cache keeps the
// assertions untouched and drops the tier's dominant cost.
const SPAWNS = new Map();

function runBinary(item, args, { allowFailure = false } = {}) {
	const bin = path.join(BINARY_ROOT, "packages", item.packageDir, "dist", "bin.js");
	const key = JSON.stringify([bin, args]);
	const cached = SPAWNS.get(key);
	const result =
		cached ??
		spawnSync(process.execPath, [bin, ...args], {
			encoding: "utf8",
			env: { ...process.env, HOME: ISOLATED_HOME },
		});
	SPAWNS.set(key, result);
	// A cold-start scenario runs in an isolated HOME with no session, and a
	// surface that cannot answer without one now fails closed. The document is
	// still the single YAML answer this gate reads.
	if (!allowFailure) assert.equal(result.status, 0, result.stderr);
	assert.equal(result.stderr, "");
	return result;
}

// Child routes are read from the leaf's own `Subcommands:` block, so the gate
// follows what the installed binary advertises rather than a repo-side list.
function parseSubcommands(help) {
	const lines = help.split("\n");
	const start = lines.indexOf("Subcommands:");
	if (start < 0) return [];
	const rows = [];
	for (const line of lines.slice(start + 1)) {
		if (line === "") break;
		const match = /^ {2}([a-z][a-z0-9-]*(?: [a-z][a-z0-9-]*)*)\s{2,}\S/u.exec(line);
		if (match) rows.push(match[1]);
	}
	return rows;
}

function parseRoutes(help) {
	return help.split("\n").flatMap((line) => {
		const match = /^ {2}([a-z][a-z0-9-]*)\s{2,}(.+)$/u.exec(line);
		return match ? [{ name: match[1], description: match[2] }] : [];
	});
}
