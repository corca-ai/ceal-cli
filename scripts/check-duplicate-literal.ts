#!/usr/bin/env node
// Front door for the duplicate-literal check. `npm run lint:duplicate-literal`.
//
// Reports every non-trivial regex literal spelled in two or more owned modules,
// and exits non-zero when there is anything to report. See
// `lib/duplicate-literal.ts` for why `check:duplication` cannot answer this and
// for the two escape hatches, which mean different things.
//
// The scanned counts are printed for the same reason the store-lock census
// prints its module list: a broken directory glob would otherwise report zero
// duplicates over zero files and read exactly like a clean tree.
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { analyzeDuplicateLiterals } from "./lib/duplicate-literal.ts";
import { exitWith } from "./lib/exit-with.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const report = analyzeDuplicateLiterals({ repoRoot: ROOT });

process.stderr.write(`check-duplicate-literal: ${report.considered.length} modules, ${report.scanned} distinct patterns above the floor\n`);
for (const { literal, boundary } of report.exempt) {
	process.stderr.write(`  ${literal} has a second home on purpose: ${boundary}\n`);
}

if (report.findings.length === 0 && report.staleExemptions.length === 0) process.exit(0);

for (const literal of report.staleExemptions) {
	process.stdout.write(`${literal}: exempted, but no longer spelled in two modules — the exemption has outlived its reason\n`);
}
for (const { literal, sites, partiallyTagged, escapedExemption } of report.findings) {
	process.stdout.write(`${literal} is spelled in ${new Set(sites.map((site) => site.file)).size} modules:\n`);
	for (const { file, line, separateGrammar } of sites) {
		process.stdout.write(`  ${file}:${line}${separateGrammar ? " (@separateGrammar)" : ""}\n`);
	}
	if (escapedExemption) {
		process.stdout.write(
			`  exempted for ${escapedExemption.declared.join(", ")} — it has since spread to ${escapedExemption.covered.join(", ")}\n`,
		);
	}
	if (partiallyTagged) {
		process.stdout.write("  @separateGrammar is on some sites and not others; every site in a group must claim the coincidence\n");
	}
}
exitWith(
	"check-duplicate-literal",
	"give the fact one home and import it; tag every site @separateGrammar when the match is a coincidence; add an exemption only when a boundary forbids the shared declaration",
	1,
);
