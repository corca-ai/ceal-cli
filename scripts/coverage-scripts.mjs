#!/usr/bin/env node
// The third coverage target. `packages/*/.c8rc.json` measure the two owned
// packages; this measures `scripts/`, which is where the release lane's
// production code lives and where nothing was measured at all — about 4.9k lines
// of guards whose reachability had to be audited by hand, which is how
// `assertWorkerReleaseSourcePath` and `resolveLockedGatewayHandoffArchive` came
// to hold nothing without anything going red.
//
// Why a runner rather than a `c8` prefix in package.json:
//
//   1. A floor only holds where the proof set it was measured against runs.
//      `platformProofSkip` (test/platform-proof.mjs:16-17) decides from
//      `process.platform` and `process.arch` alone, so the macOS leg of
//      `check.yml` skips the installed-binary and installer proofs whatever
//      `CEAL_REQUIRE_PLATFORM_PROOFS` says — that variable only turns an
//      already-decided skip into a failure. The scripts those proofs reach
//      therefore report lower on macOS through no defect of anyone's, and a floor
//      applied there would fail a run for skipping what it is right to skip,
//      which is the shape that burned `ceal-v0.67.0`. macOS runs the tiers
//      plainly, and says which measurement it is not carrying.
//   2. `test:contract` and `test:release` have to keep starting with
//      `node --test`; `repo-gates.test.mjs` reads their file inventories, and a
//      `c8` prefix would have to be parsed around.
//
// Coverage is collected across BOTH tiers because it takes both: the contract
// tier alone reaches about 55%. That is why this belongs to `npm run check` and
// not to `npm run check:unit`.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { exitWith } from "./lib/exit-with.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG = ".c8rc.scripts.json";
const TIERS = "test:tiers";

// Where the floor is enforced. It has to include `PLATFORM_PROOF_PLATFORM` from
// `test/platform-proof.mjs` — the host carrying the full proof set, and so the
// one whose numbers must never be allowed to drop unnoticed — and
// `repo-gates.test.mjs` asserts that it does.
//
// `linux-arm64` is here as well, and is in fact where the floors were measured,
// because the maintainer host is arm64 and a gate no maintainer can run before
// pushing is one CI discovers for them. Extending an arm64 measurement to x64 is
// an extrapolation, and a small one: the arm64 run skips
// `platformProofTest` proofs that only add coverage on x64, and the whole
// arch-conditional surface under scripts/ is the one ternary at
// build-worker-native-artifact.mjs:372, whose covered and uncovered branch counts
// are symmetric between the two. So x64 should measure at or above arm64. If a
// CI run ever shows otherwise, that is the measurement talking and the floor
// moves to what it says.
const MEASURED_PLATFORMS = Object.freeze(["linux-arm64", "linux-x64"]);

function runTiers(prefix) {
	const argv = [...prefix, "npm", "run", TIERS];
	return spawnSync(argv[0], argv.slice(1), { cwd: ROOT, stdio: "inherit" });
}

const host = `${process.platform}-${process.arch}`;
if (!MEASURED_PLATFORMS.includes(host)) {
	// Not a skip of the tests — they run in full. What is skipped is the
	// measurement, and saying so is the difference between a declared gap and a
	// green run that quietly proved less.
	process.stderr.write(
		`coverage-scripts: running ${TIERS} without the scripts/ coverage floor — that measurement is set on ${MEASURED_PLATFORMS.join(" and ")} and this run is ${host}\n`,
	);
	const plain = runTiers([]);
	if (plain.error) exitWith("coverage-scripts", `could not run ${TIERS} (${plain.error.message})`, 2);
	process.exit(plain.status ?? 1);
}

if (!existsSync(path.join(ROOT, CONFIG))) {
	exitWith("coverage-scripts", `${CONFIG} is missing; the floor it carries is what makes this a gate rather than a report`, 2);
}
// Read rather than restated. These used to be named here and in the config
// independently, which is one edit away from this deleting a directory the run
// never wrote and leaving 100MB of profiles behind under the real one.
const config = JSON.parse(readFileSync(path.join(ROOT, CONFIG), "utf8"));
const temporary = config["temp-directory"];
const reports = config["reports-dir"];
if (!temporary || !reports) exitWith("coverage-scripts", `${CONFIG} must declare both temp-directory and reports-dir`, 2);

/** Every script the config claims to measure — the report has to name all of them. */
function measurableScripts() {
	return readdirSync(path.join(ROOT, "scripts"), { recursive: true })
		.map((name) => `scripts/${name}`.replaceAll(path.sep, "/"))
		.filter((name) => config.extension.some((suffix) => name.endsWith(suffix)) && !config.exclude.includes(name));
}

// The floor's one vacuity mode, and it is the one `gates.md` already calls the
// worst: c8 exits 0 when its file set is EMPTY. Verified — `include` pointed at a
// glob matching nothing prints `All files | 0 | 0 | 0 | 0` and still exits 0,
// because istanbul computes the ratios from 0/0 totals and never compares them.
// So a rename, a `src`/`include` typo, or a cwd change would leave the gate green
// while measuring nothing at all. Nothing in the printed report distinguishes that
// from a pass, which is why the check is against the inventory rather than the
// output.
function assertReportIsNotEmpty() {
	const summaryPath = path.join(ROOT, reports, "coverage-summary.json");
	if (!existsSync(summaryPath)) exitWith("coverage-scripts", `c8 wrote no ${summaryPath}; the run measured nothing`, 2);
	const named = new Set(
		Object.keys(JSON.parse(readFileSync(summaryPath, "utf8")))
			.filter((key) => key !== "total")
			.map((key) => path.relative(ROOT, key).replaceAll(path.sep, "/")),
	);
	const missing = measurableScripts().filter((name) => !named.has(name));
	if (missing.length > 0) {
		exitWith(
			"coverage-scripts",
			`the report does not name ${missing.length} script(s) the config claims to measure: ${missing.join(", ")}`,
			2,
		);
	}
}

// Resolved rather than trusted to PATH. `node_modules/.bin` is on PATH only
// because an npm script put it there; run this file directly and `c8` would not
// resolve. That failure is loud either way — `spawnSync` returns ENOENT and the
// exit handling below turns it into 2 — but the message should name the cause.
const c8 = path.join(ROOT, "node_modules", "c8", "bin", "c8.js");
if (!existsSync(c8)) exitWith("coverage-scripts", "c8 is not installed; run npm ci", 2);

const measured = runTiers([process.execPath, c8, "--config", CONFIG]);
if (measured.error) exitWith("coverage-scripts", `could not run c8 over ${TIERS} (${measured.error.message})`, 2);

if ((measured.status ?? 1) === 0) {
	// Only on a pass: a failing run has already said something truer than "the
	// report was empty", and this must not overwrite it.
	assertReportIsNotEmpty();
	// The raw V8 profiles are ~100MB per run: every process the release tier
	// spawns writes one, including the package managers and compilers whose
	// coverage is discarded on remap. c8 clears this at the start of the next run,
	// so keeping it buys nothing but a working tree 100MB larger. Kept after a
	// failure, where it is the only way to re-report without paying for the tiers
	// again.
	rmSync(path.join(ROOT, temporary), { recursive: true, force: true });
}

process.exit(measured.status ?? 1);
