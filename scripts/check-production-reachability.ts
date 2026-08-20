#!/usr/bin/env node
// Front door for the production-reachability check. `npm run lint:reachability`.
//
// Reports what no production path under `scripts/` reaches, and exits non-zero
// when there is anything to report. See `lib/production-reachability.ts` for
// why neither coverage nor `knip` answers this question here.
import { exitWith } from "./lib/exit-with.ts";
import { analyzeProductionReachability } from "./lib/production-reachability.ts";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const report = analyzeProductionReachability({ repoRoot: ROOT });

process.stderr.write(`check-production-reachability: ${report.entries.length} entries, ${report.reachable.length} modules reached\n`);
if (report.unreachableFiles.length === 0 && report.findings.length === 0) process.exit(0);

for (const file of report.unreachableFiles) {
	process.stdout.write(`${file}: no production entry reaches this file\n`);
}
for (const { file, line, symbol } of report.findings) {
	process.stdout.write(`${file}:${line}: ${symbol} is exported and reached by no production path\n`);
}
exitWith(
	"check-production-reachability",
	"each is a question, not a verdict: wire it into the real path, mark it @testOnly if a suite is its only legitimate caller, or delete it",
	1,
);
