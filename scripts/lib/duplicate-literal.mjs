// Which grammar is spelled as its own literal in more than one owned module.
//
// `check:duplication` cannot answer this and it is worth being exact about why,
// because for a day a review file said the opposite. That ratchet detects clone
// *families* — repeated blocks of statements — so it read the
// `typeof value === "string" && REGEX.test(value)` predicate as one family and
// `charness-artifacts/quality/dup-review.json` accepted it with the reason "each
// site tests a different regex against a different domain". Six of those
// regexes were byte-identical. A block-level detector cannot see inside the
// block, so the accepted note ratified the exact duplicate it was dismissing.
// That is the failure `AGENTS.md` `## One Fact, One Home` names: a claim in
// prose that no gate checks.
//
// The unit here is therefore the literal, not the block. Two files spelling the
// same non-trivial pattern have two homes for one fact, and the copy that is
// wrong after the next edit is the silent one.
//
// Deliberately regex literals only. Extending the same walk to strings and
// numbers was measured rather than argued about: it takes the report from a
// handful of groups to well over a hundred, almost all error codes, import
// specifiers and unit conversions. A check that fires that often is switched
// off within a week, and `docs/gates.md` spends a section on why a gate nobody
// runs is worse than no gate.
import ts from "typescript";
import { forEachOwnedSource } from "./owned-package-sources.mjs";

/**
 * How long a pattern body must be before a repeat is a shared fact rather than
 * language idiom.
 *
 * Measured, not chosen: below this the population is `/\s/u`, `/\/$/u`,
 * `/^\d+$/u` and `/^\[|\]$/gu` — four genuine idioms — and above it every group
 * is a grammar with a domain. This declaration is the single home for the
 * number; the suite asserts the property that a floor is declared and enforced,
 * not a second copy of the figure, because a copy has no measurement behind it
 * and cannot tell a right value from a wrong one.
 */
export const DUPLICATE_LITERAL_MIN_BODY_LENGTH = 12;

/**
 * Literals allowed a second home, each with the reason one home is impossible.
 *
 * This is not a mute button, and it took a falsification run to make that true.
 * Keyed by literal alone it was one: planting a *third* copy of an exempted
 * grammar passed silently, because the entry said "this pattern may repeat"
 * rather than "these two sites hold it". An exemption therefore pins its exact
 * file set — a copy anywhere else is a finding — and an entry whose literal has
 * stopped being duplicated, or whose sites have moved, fails on its own.
 */
export const DUPLICATE_LITERAL_EXEMPTIONS = [
	{
		literal: "/^ceal_refresh_[A-Za-z0-9_-]{43}$/u",
		files: ["packages/ceal-client/src/personal-client-session-client.ts", "packages/ceal-worker-cli/src/profile-store.ts"],
		boundary: "packages/ceal-protocol owns this grammar and is frozen; the client SDK ships standalone and may not import the worker",
		reason:
			"the worker and the client each validate a refresh token before it reaches the Protocol, and test/contract/duplicate-literal.test.mjs binds the two declarations to the Protocol's own",
	},
];

/**
 * Whether this site declares the match to be a coincidence rather than a copy.
 *
 * Two escape hatches exist and they are deliberately not one, because they mean
 * different things and collapsing them would be the second failure mode in
 * `AGENTS.md` `## One Fact, One Home`. The table above is for *one fact* whose
 * single home a boundary forbids. This tag is for *two facts* that happen to
 * share a grammar — a Gateway reason code and a CLI operand key are both
 * lowercase-snake and merging them would be wrong.
 *
 * Read off the enclosing statement's own leading comment, the way
 * `production-reachability.mjs` reads `@testOnly`, so the reason sits at the
 * site a reader is already looking at. Every site in a group must carry it:
 * tagging one member of a six-file group would otherwise silence the other five.
 *
 * The walk stops at the first enclosing *statement*, and that bound is the
 * finding of this check's own fresh-eye review. Walking every ancestor let a tag
 * written to justify one literal silence an unrelated literal further down the
 * same function, which is a mute button wearing a reason. A tag now covers the
 * statement it sits above and nothing else.
 */
function isSeparateGrammar(source, node) {
	for (let current = node; current && current !== source; current = current.parent) {
		if (/@separateGrammar\b/u.test(source.text.slice(current.getFullStart(), current.getStart()))) return true;
		if (ts.isStatement(current)) return false;
	}
	return false;
}

/** The pattern between the delimiters, without the flags. */
function patternBody(literal) {
	const end = literal.lastIndexOf("/");
	return end > 0 ? literal.slice(1, end) : literal;
}

/**
 * Collect every regex literal in the owned packages and report each pattern
 * spelled in two or more files.
 *
 * `packages/ceal-protocol` is read only when asked, and never as a finding
 * target: it is frozen, it hand-copies its own `SAFE_REF` three times, and a
 * finding there names a site no agent in this lane may edit.
 */
export function analyzeDuplicateLiterals({ repoRoot, roots }) {
	const byLiteral = new Map();
	const considered = forEachOwnedSource({ repoRoot, roots }, (relative, source) => {
		const visit = (node) => {
			if (ts.isRegularExpressionLiteral(node)) {
				const literal = node.getText();
				if (patternBody(literal).length >= DUPLICATE_LITERAL_MIN_BODY_LENGTH) {
					if (!byLiteral.has(literal)) byLiteral.set(literal, []);
					byLiteral.get(literal).push({
						file: relative,
						line: ts.getLineAndCharacterOfPosition(source, node.getStart()).line + 1,
						separateGrammar: isSeparateGrammar(source, node),
					});
				}
			}
			ts.forEachChild(node, visit);
		};
		visit(source);
	});

	const exemptions = new Map(DUPLICATE_LITERAL_EXEMPTIONS.map((entry) => [entry.literal, entry]));
	const findings = [];
	const exempt = [];
	for (const [literal, sites] of [...byLiteral].sort(([a], [b]) => a.localeCompare(b))) {
		const distinctFiles = new Set(sites.map((site) => site.file));
		if (distinctFiles.size < 2) continue;
		const exemption = exemptions.get(literal);
		if (exemption) {
			const covered = [...distinctFiles].sort();
			const declared = [...exemption.files].sort();
			if (covered.length === declared.length && covered.every((file, index) => file === declared[index])) {
				exempt.push({ literal, sites, ...exemption });
				continue;
			}
			findings.push({
				literal,
				sites,
				partiallyTagged: false,
				escapedExemption: { declared, covered },
			});
			continue;
		}
		// Every site must claim the coincidence, not just one of them.
		if (sites.every((site) => site.separateGrammar)) {
			exempt.push({ literal, sites, boundary: "not one fact", reason: "@separateGrammar at every site" });
			continue;
		}
		findings.push({ literal, sites, partiallyTagged: sites.some((site) => site.separateGrammar) });
	}

	// An exemption whose literal is no longer duplicated has outlived its reason.
	// Reporting it is what stops the table from becoming a list nobody re-reads.
	const staleExemptions = DUPLICATE_LITERAL_EXEMPTIONS.filter(
		(entry) => !exempt.some((live) => live.literal === entry.literal) && !findings.some((finding) => finding.literal === entry.literal),
	).map((entry) => entry.literal);

	return { considered, scanned: byLiteral.size, findings, exempt, staleExemptions };
}
