#!/usr/bin/env node
// Front door for the store-lock census. `npm run lint:store-lock`.
//
// Reports every writer that reaches a lock-guarded local store without the
// module's own lock, and exits non-zero when there is anything to report. See
// `lib/store-lock-census.ts` for the measurement that produced this check and
// for the narrow rule it enforces.
//
// The census line is not progress chatter. This check can only be trusted while
// it is reading the modules it claims to, and a lock helper renamed out of the
// `with…Lock` shape would otherwise empty it in silence — which is the failure
// mode `docs/gates.md` describes as worse than an absent gate.
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { exitWith } from "./lib/exit-with.ts";
import { analyzeStoreLockCensus } from "./lib/store-lock-census.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const report = analyzeStoreLockCensus({ repoRoot: ROOT });

process.stderr.write(
	`check-store-lock-census: ${report.considered.length} modules considered, ${report.guarded.length} own a lock, ${report.skipped.length} declare none\n`,
);
for (const module of report.guarded) {
	process.stderr.write(`  ${module.file} [${module.guards.join(", ")}] ${module.clean.length} writer(s) under the lock\n`);
}
for (const { file, line, symbol } of report.exempt) {
	process.stderr.write(`  ${file}:${line}: ${symbol} is @lockFree by declaration\n`);
}

if (report.findings.length === 0) process.exit(0);

for (const { file, line, symbol, mutations, guards } of report.findings) {
	process.stdout.write(`${file}:${line}: ${symbol} mutates ${mutations.join(", ")} on a path that never enters ${guards.join("/")}\n`);
}
exitWith(
	"check-store-lock-census",
	"each is a question, not a verdict: take the module's lock, or tag the declaration @lockFree with the reason it does not need one",
	1,
);
