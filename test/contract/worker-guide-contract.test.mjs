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

test.after(() => rmSync(ISOLATED_HOME, { recursive: true, force: true }));

// The worker release lane declares its own guide asset in `worker-release-inputs.json`
// and digests the file it actually ships, so nothing here restates a digest: this
// suite asserts what the guide teaches, not that two files were hand-synchronized.
// `release-contract.json` is a forbidden worker release input, and the digest it
// records is the frozen legacy lane's own drift check — asserted for both guides
// in `guide-contract.test.mjs`, alongside the lane that consumes it.
test("the worker guide teaches help-driven discovery without command snapshots", () => {
	const guide = readFileSync(path.join(ROOT, "skills", WORKER.skill, "SKILL.md"), "utf8");
	assert.match(guide, /^name: ceal-guide$/mu);
	assert.match(guide, /\bceal --help\b/u);
	assert.match(guide, /ceal <command> --help/u);
	assert.doesNotMatch(guide, /--json|--format json/u);
	const routes = parseRoutes(runBinary(["--help"]).stdout);
	assert.ok(routes.length > 0, "ceal --help advertised no route; the help parser is not matching");
	for (const route of routes) {
		if (!["capabilities", "call", "receipt"].includes(route.name))
			assert.doesNotMatch(guide, new RegExp(`\\bceal\\s+${route.name}(?:\\s|\u0060)`, "u"));
	}
	// Order and profile-scoping are the contract: discover, then resolve a target,
	// then call, then read the receipt back, every step against a named profile.
	// The flags inside each step are the guide's to choose — this used to pin
	// `--fresh` on the first step, and `cc29047` broke it by deciding, with a
	// recorded reason, that a warm catalog should not pay the discovery probe.
	// A gate that a documented authoring decision breaks is not guarding behavior.
	assert.match(
		guide,
		/ceal capabilities[^\n]*--profile <profile-ref>[\s\S]+ceal capabilities targets[^\n]*--profile <profile-ref>[\s\S]+ceal call <capability-id> --target <target-ref>[\s\S]+--profile <profile-ref>[\s\S]+ceal receipt show <request-ref> --profile <profile-ref>/u,
	);
	// Two non-claims the guide has to state, not two sentences it has to keep:
	// reword them and this gate should be re-read, which is the point.
	assert.match(guide, /catalog grant is not backend\s+readiness/u);
	assert.match(guide, /not interchangeable with\s+legacy worker fixtures/u);
});

test("a cold-start worker intent selects capabilities and preserves proof limits", () => {
	const guide = readFileSync(path.join(ROOT, "skills", WORKER.skill, "SKILL.md"), "utf8");
	assert.match(guide, /command registry is navigation only|Command discovery is navigation only/u);
	const candidates = parseRoutes(runBinary(["--help"]).stdout).map((route) => ({
		...route,
		help: runBinary([route.name, "--help"]).stdout,
	}));
	const selected = candidates.find(
		(candidate) =>
			/Gateway-issued capabilities/u.test(candidate.description) && candidate.help.includes("Result schema: ceal.capabilities.v1"),
	);
	assert.ok(selected, "no semantic capabilities leaf found for a cold-start worker intent");
	for (const field of ["Usage:", "Effect: read_only", "Evidence:", "Result schema:", "Recovery/readback:"]) {
		assert.match(selected.help, new RegExp(field, "u"));
	}
	const result = runBinary([selected.name], { allowFailure: true });
	const documents = parseAllDocuments(result.stdout, { uniqueKeys: true });
	assert.equal(documents.length, 1);
	assert.deepEqual(documents[0].errors, []);
	const value = documents[0].toJS();
	assert.equal(value.command, "ceal");
	assert.equal(value.status, "unavailable");
	assert.equal(value.proof_level, "surface");
	assert.equal(value.live_gateway_checked, false);
	assert.ok(value.non_claims.some((claim) => /No live Gateway discovery/u.test(claim)));
});

test("every worker route advertised for descent renders four-field leaf help", () => {
	const guide = readFileSync(path.join(ROOT, "skills", WORKER.skill, "SKILL.md"), "utf8");
	assert.match(guide, /`Subcommands:`/u);
	let advertised = 0;
	for (const route of parseRoutes(runBinary(["--help"]).stdout)) {
		for (const child of parseSubcommands(runBinary([route.name, "--help"]).stdout)) {
			advertised += 1;
			const childRoute = [route.name, ...child.split(" ")];
			for (const args of [
				[...childRoute, "--help"],
				["help", ...childRoute],
			]) {
				const help = runBinary(args).stdout;
				for (const field of ["Usage:", "Effect:", "Evidence:", "Result schema:", "Recovery/readback:"]) {
					assert.match(help, new RegExp(`^${field} \\S`, "mu"), `ceal ${args.join(" ")} is missing ${field}`);
				}
				assert.match(help, new RegExp(`^Usage: ceal ${childRoute.join(" ")}`, "mu"));
			}
		}
	}
	assert.ok(advertised > 0, "ceal advertises no subcommand route to descend into");
});

test("the worker guide refuses a missing matching binary without a guessed fallback", () => {
	const guide = readFileSync(path.join(ROOT, "skills", WORKER.skill, "SKILL.md"), "utf8");
	assert.match(guide, /stop and request installation or update of the matching binary/u);
	assert.match(guide, /Do not fall\s+back to another guide, another binary, or a guessed command/u);
	assert.doesNotMatch(guide, /\bcealctl\s+(?!--help\b)[a-z][a-z-]*/u, "ceal-guide must not show a runnable cealctl fallback");
});

const SPAWNS = new Map();

function runBinary(args, { allowFailure = false } = {}) {
	const bin = path.join(BINARY_ROOT, "packages", WORKER.packageDir, "dist", "bin.js");
	const key = JSON.stringify([bin, args]);
	const cached = SPAWNS.get(key);
	const result =
		cached ??
		spawnSync(process.execPath, [bin, ...args], {
			encoding: "utf8",
			env: { ...process.env, HOME: ISOLATED_HOME },
		});
	SPAWNS.set(key, result);
	if (!allowFailure) assert.equal(result.status, 0, result.stderr);
	assert.equal(result.stderr, "");
	return result;
}

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
