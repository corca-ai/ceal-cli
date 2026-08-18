#!/usr/bin/env node
// Gate-tier parity derivation (three-repo release loop S1, corca-ai/ceal#717).
//
// `config/gate-contract.json` is this repository's one declarative statement of
// which proof tiers exist: which hook runner owns the commit/push boundary,
// what each hook tier runs, and which workflow jobs run on which runners with
// which gate commands. Before it existed, answering "how many times does one
// release re-run `npm run check`" meant reading a hook, two workflow files, and
// a three-leg release matrix — the count came out at seven. The contract makes
// that inventory readable in one file and its drift a test failure.
//
// The contract is NOT a second source of truth: `hook_tiers` and `workflows`
// are derived from `.githooks/` and the workflow YAML, and
// `test/contract/repo-gates.test.ts` fails when declaration and derivation
// disagree. What the file adds is a reviewable diff at the moment a tier
// changes, plus a stable machine-readable home for the pre-push/tag-lane
// attestation work, which must not re-parse YAML to learn a job's runner.
//
// The check lives in `repo-gates.test.ts` rather than in a lint of its own,
// because that file is already this repository's home for "what the gates are";
// this module is the derivation it calls. Running it directly CHECKS and prints
// the readback; `--write` is the maintainer's regeneration path.
//
// Deliberate limits of the command extractor, stated so a reader does not
// mistake it for a shell parser. It skips whole-line `#` comments and segments
// whose head is `echo`/`printf`; it splits on `&&`, `||`, `;`, `|`, and on the
// `$(`/`)` and backtick boundaries of a command substitution; and it reads
// `npm run <script>`, `npm test`, and `node <...> <script-file>` invocations.
// Environment prefixes and redirections are dropped. What it does NOT see, and
// what a reader must not take an empty `gate_commands` to mean is absent:
//   - `uses:` steps. A job whose whole body is a marketplace or composite
//     action reads here as `gate_commands: []`, which means "nothing this
//     extractor reads", not "this job proves nothing".
//   - `npm exec` / `npx` invocations, which AGENTS.md sanctions as a
//     first-class command form.
//   - `node -e` inline programs, which carry no script file to name.
//   - bare shell scripts (`bash x.sh`, `./x.sh`).

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

import { isMainModule } from "../scripts/lib/is-main-module.ts";

export const GATE_CONTRACT_SCHEMA = "ceal.gate_contract.v1";
export const GATE_CONTRACT_PATH = "config/gate-contract.json";

export type GateCommand = { readonly name: string; readonly glob?: string; readonly gate_commands: readonly string[] };
export type HookTier = { readonly id: string; readonly commands: readonly GateCommand[] };
export type WorkflowJob = { readonly id: string; readonly runners: readonly string[]; readonly gate_commands: readonly string[] };
export type WorkflowTier = { readonly path: string; readonly triggers: readonly string[]; readonly jobs: readonly WorkflowJob[] };
export type GateContract = {
	readonly schema?: string;
	readonly hook_runner?: { readonly kind?: string; readonly config_path?: string; readonly install_command?: string };
	readonly full_gate_commands?: readonly string[];
	readonly hook_tiers?: readonly HookTier[];
	readonly workflows?: readonly WorkflowTier[];
};

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOOK_DIRECTORY = ".githooks";
const WORKFLOW_DIRECTORY = ".github/workflows";
const SCRIPT_FILE = /\.(?:ts|mts|cts|mjs|cjs|js)$/u;
const REDIRECTION = /^\d?[<>]/u;
// `$(`, `)`, and a backtick end a segment as surely as `&&` does. Without them
// `status="$(node scripts/x.ts put …)"` tokenizes with `status="$(node` as one
// word, so the invocation is silently dropped.
const SHELL_SEGMENT = /&&|\|\||;|\||\$\(|\)|`/u;
const QUIET_HEADS = new Set(["echo", "printf"]);

/**
 * Drop the redirection tail so `node x.ts >> log` and `node x.ts` are one
 * identity, then drop a trailing bare quote — the residue of cutting at a
 * nested `$(`, as in `--file "$(realpath "$source")"`.
 */
function joinInvocation(tokens: readonly string[]): string {
	const end = tokens.findIndex((token) => REDIRECTION.test(token));
	const kept = [...(end < 0 ? tokens : tokens.slice(0, end))];
	while (kept.length > 0 && /^["']+$/u.test(kept[kept.length - 1])) kept.pop();
	return kept.join(" ");
}

function segmentInvocation(segment: string): string | null {
	const tokens = segment.trim().split(/\s+/u).filter(Boolean);
	const npmIndex = tokens.findIndex((token, index) => token === "npm" && (tokens[index + 1] === "run" || tokens[index + 1] === "test"));
	if (npmIndex >= 0 && tokens[npmIndex + 1] === "test") return "npm test";
	if (npmIndex >= 0 && tokens[npmIndex + 2]) return joinInvocation(tokens.slice(npmIndex));
	const nodeIndex = tokens.indexOf("node");
	if (nodeIndex < 0) return null;
	const after = tokens.slice(nodeIndex);
	return after.some((token) => SCRIPT_FILE.test(token)) ? joinInvocation(after) : null;
}

// Shell line continuations first: a `\`-terminated line is half a command, and
// reading it as a whole one records `node x.ts \` as the gate command.
function logicalLines(text: string): string[] {
	return String(text ?? "")
		.replaceAll(/\\\n\s*/gu, " ")
		.split("\n");
}

export function extractGateCommands(text: string): string[] {
	const found = new Set<string>();
	for (const rawLine of logicalLines(text)) {
		if (/^\s*#/u.test(rawLine)) continue;
		for (const segment of rawLine.split(SHELL_SEGMENT)) {
			if (QUIET_HEADS.has(segment.trim().split(/\s+/u)[0] ?? "")) continue;
			const invocation = segmentInvocation(segment);
			if (invocation) found.add(invocation);
		}
	}
	return [...found].sort();
}

function read(repoRoot: string, relative: string): string {
	return readFileSync(path.join(repoRoot, relative), "utf8");
}

/**
 * A raw `.githooks` tier is one shell script, so it carries exactly one command
 * entry named after that script. The per-command shape matches the Lefthook
 * repository's so the three contracts stay one JSON shape rather than three.
 */
export function deriveHookTiers(repoRoot: string): HookTier[] {
	const directory = path.join(repoRoot, HOOK_DIRECTORY);
	if (!existsSync(directory)) return [];
	// Files only. A subdirectory would make `readFileSync` throw EISDIR from a
	// gate whose message could not explain it.
	return readdirSync(directory, { withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map((entry) => entry.name)
		.sort()
		.map((name) => ({
			id: name,
			commands: [{ name: `${HOOK_DIRECTORY}/${name}`, gate_commands: extractGateCommands(read(repoRoot, `${HOOK_DIRECTORY}/${name}`)) }],
		}));
}

/**
 * Every concrete runner label a job can land on. `runs-on: ${{ matrix.<key> }}`
 * is resolved through both matrix spellings — a plain value list and an
 * `include` table — because runner identity is what the attestation work has to
 * compare, and an unresolved expression would make every matrix job look like
 * it had no runner at all.
 */
function jobRunners(job: Record<string, unknown>): string[] {
	const matrix = ((job.strategy as { matrix?: Record<string, unknown> } | undefined)?.matrix ?? {}) as Record<string, unknown>;
	const include = (matrix.include ?? []) as Record<string, string>[];
	const declared = job["runs-on"];
	const resolved = (Array.isArray(declared) ? declared : [declared]).flatMap((value: unknown) => {
		if (typeof value !== "string") return [];
		const reference = /^\$\{\{\s*matrix\.([\w-]+)\s*\}\}$/u.exec(value.trim());
		if (!reference) return [value];
		const listed = Array.isArray(matrix[reference[1]]) ? (matrix[reference[1]] as unknown[]) : [];
		const values = [...listed, ...include.map((entry) => entry[reference[1]])].filter((entry): entry is string => typeof entry === "string");
		return values.length > 0 ? values : [value];
	});
	return [...new Set(resolved)].sort();
}

/** `on:` in any of its three spellings: a scalar, a list, or a mapping. */
function workflowTriggers(on: unknown): string[] {
	if (typeof on === "string") return [on];
	if (Array.isArray(on)) return [...new Set(on.filter((entry): entry is string => typeof entry === "string"))].sort();
	return Object.keys((on ?? {}) as Record<string, unknown>).sort();
}

export function deriveWorkflows(repoRoot: string): WorkflowTier[] {
	return readdirSync(path.join(repoRoot, WORKFLOW_DIRECTORY))
		.filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
		.sort()
		.map((name) => {
			const workflow = (parse(read(repoRoot, `${WORKFLOW_DIRECTORY}/${name}`)) ?? {}) as {
				on?: unknown;
				jobs?: Record<string, Record<string, unknown>>;
			};
			return {
				path: `${WORKFLOW_DIRECTORY}/${name}`,
				triggers: workflowTriggers(workflow.on),
				jobs: Object.entries(workflow.jobs ?? {})
					.map(([id, job]) => ({
						id,
						runners: jobRunners(job),
						gate_commands: extractGateCommands(((job.steps ?? []) as { run?: string }[]).map((step) => step.run ?? "").join("\n")),
					}))
					.sort((left, right) => left.id.localeCompare(right.id)),
			};
		});
}

export function deriveContract(repoRoot: string) {
	return { hook_tiers: deriveHookTiers(repoRoot), workflows: deriveWorkflows(repoRoot) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A list member's stable identity: its own name, or the string itself. */
function memberKey(value: unknown): string | null {
	if (typeof value === "string") return value;
	if (!isRecord(value)) return null;
	for (const field of ["id", "name", "path"]) if (typeof value[field] === "string") return `${field} ${value[field] as string}`;
	return null;
}

function arrayDiff(expected: unknown[], actual: unknown[], prefix: string): string[] {
	const expectedKeys = expected.map(memberKey);
	const actualKeys = actual.map(memberKey);
	if ([...expectedKeys, ...actualKeys].some((key) => key === null)) {
		const differences: string[] = [];
		for (let index = 0; index < Math.max(expected.length, actual.length); index += 1) {
			differences.push(...diffPaths(expected[index], actual[index], `${prefix}[${index}]`));
		}
		return differences;
	}
	const expectedByKey = new Map(expectedKeys.map((key, index) => [key, expected[index]]));
	const actualByKey = new Map(actualKeys.map((key, index) => [key, actual[index]]));
	const differences: string[] = [];
	for (const [key, entry] of expectedByKey) {
		if (!actualByKey.has(key)) differences.push(`${prefix}: declares ${key}, which this repository no longer has`);
		else if (isRecord(entry)) differences.push(...diffPaths(entry, actualByKey.get(key), `${prefix}[${key}]`));
	}
	for (const key of actualByKey.keys()) {
		if (!expectedByKey.has(key)) differences.push(`${prefix}: this repository has ${key}, which the contract does not declare`);
	}
	if (differences.length === 0) {
		differences.push(`${prefix}: declared order ${expectedKeys.join(", ")} but this repository orders ${actualKeys.join(", ")}`);
	}
	return differences;
}

/**
 * Dotted paths where `actual` diverges from `expected`. Arrays are aligned by
 * identity rather than by index: every list here is sorted, so the interesting
 * change is almost always an addition or a removal, and index alignment turns
 * one added hook command into a page of "declared X but the source says Y"
 * lines that each name an unchanged neighbour.
 */
export function diffPaths(expected: unknown, actual: unknown, prefix = ""): string[] {
	if (JSON.stringify(expected) === JSON.stringify(actual)) return [];
	if (Array.isArray(expected) && Array.isArray(actual)) return arrayDiff(expected, actual, prefix);
	if (isRecord(expected) && isRecord(actual)) {
		const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
		return keys.flatMap((key) => diffPaths(expected[key], actual[key], prefix ? `${prefix}.${key}` : key));
	}
	return [`${prefix}: declared ${JSON.stringify(expected)} but the source says ${JSON.stringify(actual)}`];
}

/**
 * The hook runner is an exclusivity claim, not a label: two installed hook
 * mechanisms is exactly the drift the contract exists to name, and only one of
 * them would be the one a maintainer reads.
 */
export function hookRunnerViolations(repoRoot: string, declared: GateContract): string[] {
	const runner = declared.hook_runner ?? {};
	const violations: string[] = [];
	if (runner.kind !== "githooks")
		violations.push(`hook_runner.kind must be "githooks" in this repository, not ${JSON.stringify(runner.kind)}`);
	if (!runner.config_path || !existsSync(path.join(repoRoot, runner.config_path))) {
		violations.push(`hook_runner.config_path ${JSON.stringify(runner.config_path)} does not exist`);
	}
	for (const lefthook of ["lefthook.yml", "lefthook.yaml"]) {
		if (existsSync(path.join(repoRoot, lefthook))) {
			violations.push(
				`${lefthook} exists alongside the declared .githooks runner; two hook mechanisms means the contract describes only one of them`,
			);
		}
	}
	// Every other hand-authored field is checked against its own authority. An
	// unchecked one is the second-source-of-truth shape the header disclaims.
	if (runner.install_command !== undefined) {
		violations.push(...resolvableCommandViolations(repoRoot, [runner.install_command], "hook_runner.install_command"));
	}
	return violations;
}

/**
 * A declared command resolves against its own authority: an npm script against
 * package.json, a script path against disk. A command that no longer resolves
 * is how a renamed entrypoint quietly stops being anybody's gate.
 */
function resolvableCommandViolations(repoRoot: string, commands: readonly string[], field: string): string[] {
	const scripts = (JSON.parse(read(repoRoot, "package.json")).scripts ?? {}) as Record<string, string>;
	return commands.flatMap((command) => {
		const npmRun = /^npm run ([\w:-]+)/u.exec(command);
		if (npmRun) return npmRun[1] in scripts ? [] : [`${field} names ${command}, but package.json has no ${npmRun[1]} script`];
		const nodeScript = command.split(/\s+/u).find((token) => SCRIPT_FILE.test(token));
		if (nodeScript && existsSync(path.join(repoRoot, nodeScript))) return [];
		return [`${field} names ${command}, which resolves to no package script and no file on disk`];
	});
}

export function fullGateViolations(repoRoot: string, declared: GateContract): string[] {
	const commands = declared.full_gate_commands ?? [];
	if (commands.length === 0) return ["full_gate_commands must name at least one command"];
	return resolvableCommandViolations(repoRoot, commands, "full_gate_commands");
}

/**
 * Where each declared full-gate command is invoked; the release-cost readback.
 * A SITE is not a RUN: a site whose invocation sits behind a matrix or shell
 * condition runs fewer times than once per site, and a site inside a matrix
 * without a condition runs more. See the spec's Fixed Decisions.
 */
export function fullGateInvocationSites(contract: GateContract): string[] {
	const commands = new Set(contract.full_gate_commands ?? []);
	const sites: string[] = [];
	for (const tier of contract.hook_tiers ?? []) {
		for (const command of tier.commands)
			if (command.gate_commands.some((gate) => commands.has(gate))) sites.push(`${tier.id}/${command.name}`);
	}
	for (const workflow of contract.workflows ?? []) {
		for (const job of workflow.jobs) if (job.gate_commands.some((gate) => commands.has(gate))) sites.push(`${workflow.path}:${job.id}`);
	}
	return sites;
}

export function readContract(repoRoot: string = REPO_ROOT): GateContract {
	return JSON.parse(read(repoRoot, GATE_CONTRACT_PATH)) as GateContract;
}

export function writeDerivedContract(repoRoot: string = REPO_ROOT): GateContract {
	const rewritten = { ...readContract(repoRoot), ...deriveContract(repoRoot) };
	writeFileSync(path.join(repoRoot, GATE_CONTRACT_PATH), `${JSON.stringify(rewritten, null, "\t")}\n`);
	return rewritten;
}

export function collectViolations(repoRoot: string = REPO_ROOT, declared: GateContract = readContract(repoRoot)): string[] {
	const violations: string[] = [];
	if (declared.schema !== GATE_CONTRACT_SCHEMA)
		violations.push(`schema must be ${GATE_CONTRACT_SCHEMA}, not ${JSON.stringify(declared.schema)}`);
	violations.push(...hookRunnerViolations(repoRoot, declared));
	violations.push(...fullGateViolations(repoRoot, declared));
	const derived = deriveContract(repoRoot);
	violations.push(...diffPaths(declared.hook_tiers, derived.hook_tiers, "hook_tiers"));
	violations.push(...diffPaths(declared.workflows, derived.workflows, "workflows"));
	return violations;
}

/**
 * Checks by default; writes only when asked. The first version wrote on a bare
 * invocation, which meant the natural probe — "run this and show me what it
 * says" — silently reconciled the contract to whatever the tree happened to
 * contain, at exactly the moment someone was investigating a red gate.
 */
export function main(argv: readonly string[] = process.argv.slice(2), repoRoot: string = REPO_ROOT): number {
	if (argv.includes("--write")) {
		writeDerivedContract(repoRoot);
		console.log(`gate contract: rewrote the derived sections of ${GATE_CONTRACT_PATH}`);
		return 0;
	}
	const declared = readContract(repoRoot);
	const violations = collectViolations(repoRoot, declared);
	if (violations.length > 0) {
		console.error(`gate contract: FAIL — ${GATE_CONTRACT_PATH} no longer describes this repository's gate tiers.`);
		console.error(
			"Re-derive with `node test/gate-contract-lib.ts --write` and review the diff; do not edit the file to match a change you did not intend.",
		);
		for (const violation of violations) console.error(`  ${violation}`);
		return 1;
	}
	const sites = fullGateInvocationSites(declared);
	console.log(`gate contract: PASS — ${(declared.hook_tiers ?? []).length} hook tier(s), ${(declared.workflows ?? []).length} workflow(s).`);
	console.log(
		`  full gate (${(declared.full_gate_commands ?? []).join(", ")}) is invoked at ${sites.length} declared site(s): ${sites.join(", ") || "none"}`,
	);
	console.log("  a site is not a run: a conditional invocation runs less often, an unconditional matrix job more.");
	return 0;
}

if (isMainModule(import.meta.url)) {
	process.exitCode = main();
}
