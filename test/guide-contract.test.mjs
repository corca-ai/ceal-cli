import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseAllDocuments } from "yaml";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BINARY_ROOT = existsSync(path.join(ROOT, "packages")) ? ROOT : path.resolve(ROOT, "..", "..");
const ISOLATED_HOME = mkdtempSync(path.join(tmpdir(), "ceal-guide-contract-home-"));
const CASES = [
	{ skill: "ceal-guide", binary: "ceal", packageDir: "ceal-worker-cli" },
	{ skill: "cealctl-guide", binary: "cealctl", packageDir: "ceal-operator-cli" },
];

test.after(() => rmSync(ISOLATED_HOME, { recursive: true, force: true }));

test("guide packages teach help-driven discovery without command snapshots", () => {
	const releaseContract = JSON.parse(readFileSync(path.join(ROOT, "release-contract.json"), "utf8"));
	for (const item of CASES) {
		const guide = readFileSync(path.join(ROOT, "skills", item.skill, "SKILL.md"), "utf8");
		assert.equal(releaseContract.guides?.[item.skill]?.sha256, createHash("sha256").update(guide).digest("hex"));
		assert.match(guide, new RegExp(`^name: ${item.skill}$`, "mu"));
		assert.match(guide, new RegExp(`\\b${item.binary} --help\\b`, "u"));
		assert.match(guide, new RegExp(`${item.binary} <command> --help`, "u"));
		assert.doesNotMatch(guide, /--json|--format json/u);
		const top = runBinary(item, ["--help"]);
		for (const route of parseRoutes(top.stdout)) {
			const stableWorkerFlow = item.skill === "ceal-guide" && ["capabilities", "call", "receipt"].includes(route.name);
			if (!stableWorkerFlow) assert.doesNotMatch(guide, new RegExp(`\\b${item.binary}\\s+${route.name}(?:\\s|\u0060)`, "u"));
		}
		if (item.skill === "ceal-guide") {
			assert.match(guide, /ceal capabilities --profile <profile-ref> --fresh[\s\S]+ceal capabilities targets --profile <profile-ref>[\s\S]+ceal call <capability-id> --target <target-ref>[\s\S]+--profile <profile-ref>[\s\S]+ceal receipt show <request-ref> --profile <profile-ref>/u);
			assert.match(guide, /catalog grant is not backend\s+readiness/u);
			assert.match(guide, /not interchangeable with\s+legacy worker fixtures/u);
		}
	}
});

test("cold-start customer intents select semantic leaves and preserve proof limits", () => {
	const scenarios = [
		{
			...CASES[0],
			prompt: "Find what Ceal can do safely.",
			purpose: /Gateway-issued capabilities/u,
			schema: "ceal.capabilities.v1",
			assertResult: (value) => {
				assert.equal(value.status, "unavailable");
				assert.equal(value.proof_level, "surface");
				assert.equal(value.live_gateway_checked, false);
				assert.ok(value.non_claims.some((claim) => /No live Gateway discovery/u.test(claim)));
			},
		},
		{
			...CASES[1],
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
				for (const args of [[...childRoute, "--help"], ["help", ...childRoute]]) {
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
		const missing = spawnSync(process.execPath, [path.join(ROOT, "missing", item.binary), "--help"], { encoding: "utf8" });
		assert.notEqual(missing.status, 0);
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
	const selected = candidates.find((candidate) => scenario.purpose.test(candidate.description)
		&& candidate.help.includes(`Result schema: ${scenario.schema}`));
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

function runBinary(item, args, { allowFailure = false } = {}) {
	const bin = path.join(BINARY_ROOT, "packages", item.packageDir, "dist", "bin.js");
	const result = spawnSync(process.execPath, [bin, ...args], {
		encoding: "utf8",
		env: { ...process.env, HOME: ISOLATED_HOME },
	});
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
