#!/usr/bin/env node
// Front door for the gate receipt. See `lib/gate-attestation.ts` for what the
// record binds and why.
//
// Three verbs, and the split between them is the interesting part:
//
//   record   Called by `postcheck`, so it runs inside every green `npm run check`.
//            It NEVER fails. A receipt is evidence, not a gate: a full disk, an
//            unwritable `.charness/`, or a checkout too dirty to describe must
//            cost a later re-run, never redden a gate that just passed. The same
//            rule the pre-push timing log learned the hard way.
//   verify   Called by the pre-push hook before it spends the full gate on a tag
//            push. Exit 0 means "this exact source already passed this exact gate
//            on this host"; every other outcome is a non-zero the caller reads as
//            "run it".
//   publish  Called by `check.yml` after a green gate. Prints the artifact name
//            the receipt earns, and unlike `record` it FAILS loudly: a CI
//            checkout is clean by construction, so a receipt that does not
//            describe it is a defect in this script, not a fact about the host.
import { exitWith } from "./lib/exit-with.ts";
import {
	attestationArtifactName,
	ATTESTED_PROFILE,
	buildGateAttestation,
	GATE_ATTESTATION_PATH,
	type GateAttestation,
	gateAttestationDifferences,
	readGateAttestationFile,
	serializeGateAttestation,
} from "./lib/gate-attestation.ts";
import { isMainModule } from "./lib/is-main-module.ts";
import { parseScriptArgs } from "./lib/parse-script-args.ts";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const PREFIX = "gate-attestation";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VERBS = ["record", "verify", "publish"] as const;
type Verb = (typeof VERBS)[number];

const USAGE = `Usage: node scripts/gate-attestation.ts <${VERBS.join("|")}> [--profile <name>] [--file <path>]

  record   write the receipt for the gate that just passed (never fails)
  verify   exit 0 only if the stored receipt describes this exact source and gate
  publish  verify, then print the artifact name the receipt earns
`;

export interface GateAttestationCliOptions {
	readonly repoRoot?: string;
	readonly env?: NodeJS.ProcessEnv;
	readonly stdout?: (text: string) => void;
	readonly stderr?: (text: string) => void;
}

function say(write: (text: string) => void, message: string): void {
	write(`${PREFIX}: ${message}\n`);
}

/**
 * The receipt and the reasons it does not apply, in one place: `verify` and
 * `publish` differ only in what they do with the verdict, and a second copy of
 * this sequence is how the two would drift apart.
 */
function resolveStoredAttestation(
	repoRoot: string,
	profile: string,
	filePath: string,
	env: NodeJS.ProcessEnv,
): { attestation: GateAttestation | null; refusals: string[] } {
	const expected = buildGateAttestation({ repoRoot, profile, env });
	if (!expected.ok) return { attestation: null, refusals: [`${expected.reason} — ${expected.detail}`] };
	const stored = readGateAttestationFile(filePath);
	if (!stored.ok) return { attestation: null, refusals: [`${stored.reason} — nothing readable at ${filePath}`] };
	const differences = gateAttestationDifferences(expected.attestation, stored.attestation);
	if (differences.length > 0) return { attestation: null, refusals: differences };
	return { attestation: expected.attestation, refusals: [] };
}

function runRecord(repoRoot: string, profile: string, filePath: string, env: NodeJS.ProcessEnv, stderr: (text: string) => void): number {
	const built = buildGateAttestation({ repoRoot, profile, env });
	if (!built.ok) {
		say(stderr, `not recording a receipt for ${profile}: ${built.reason} — ${built.detail}. A later run will pay the gate again.`);
		return 0;
	}
	try {
		mkdirSync(path.dirname(filePath), { recursive: true });
		writeFileSync(filePath, serializeGateAttestation(built.attestation));
	} catch (error) {
		say(stderr, `could not write ${filePath}: ${(error as Error).message}. A later run will pay the gate again.`);
		return 0;
	}
	say(stderr, `recorded ${profile} on ${built.attestation.runner_identity} for tree ${built.attestation.tree.slice(0, 12)} at ${filePath}`);
	return 0;
}

export function main(argv: readonly string[] = process.argv.slice(2), options: GateAttestationCliOptions = {}): number {
	const repoRoot = options.repoRoot ?? ROOT;
	const env = options.env ?? process.env;
	const stdout = options.stdout ?? ((text: string) => process.stdout.write(text));
	const stderr = options.stderr ?? ((text: string) => process.stderr.write(text));
	const [verb, ...rest] = argv;
	if (verb === "--help" || verb === "-h" || verb === undefined) {
		stdout(USAGE);
		return verb === undefined ? 2 : 0;
	}
	if (!(VERBS as readonly string[]).includes(verb)) {
		say(stderr, `unknown verb ${JSON.stringify(verb)}; expected one of ${VERBS.join(", ")}`);
		return 2;
	}
	const parsed = parseScriptArgs(rest, {
		fail: (_code, message) => exitWith(PREFIX, message, 2),
		values: { "--profile": "profile", "--file": "file" },
		defaults: { profile: ATTESTED_PROFILE, file: GATE_ATTESTATION_PATH },
		valueMessage: "--profile and --file each need a value",
		unknownMessage: `unrecognized argument; ${USAGE}`,
	});
	if (parsed.help) {
		stdout(USAGE);
		return 0;
	}
	const profile = String(parsed.options.profile);
	const filePath = path.resolve(repoRoot, String(parsed.options.file));

	if ((verb as Verb) === "record") return runRecord(repoRoot, profile, filePath, env, stderr);

	const { attestation, refusals } = resolveStoredAttestation(repoRoot, profile, filePath, env);
	if (!attestation) {
		say(stderr, `no reusable ${profile} receipt for this checkout:`);
		for (const refusal of refusals) stderr(`  ${refusal}\n`);
		return 1;
	}
	if ((verb as Verb) === "verify") {
		say(stderr, `reusing the ${profile} receipt earned on ${attestation.runner_identity} for tree ${attestation.tree.slice(0, 12)}`);
		return 0;
	}
	stdout(`artifact_name=${attestationArtifactName(attestation)}\n`);
	stdout(`attestation_path=${path.relative(repoRoot, filePath)}\n`);
	say(stderr, `published ${attestationArtifactName(attestation)}`);
	return 0;
}

if (isMainModule(import.meta.url)) {
	process.exitCode = main();
}
