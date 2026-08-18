#!/usr/bin/env node
// Asks GitHub whether this exact commit already passed `npm run check` on a
// runner like this one, and answers in one line the release lane can branch on.
//
// The lookup is by ARTIFACT NAME, not by artifact content. `check.yml` uploads
// its receipt under `ceal-gate-attestation-<digest of the record>`; this script
// builds the record it would want, digests it, and looks for that exact name on
// a successful `check.yml` run for `GITHUB_SHA`. One differing field — a
// different tree, a different runner, a different `CEAL_REQUIRE_PLATFORM_PROOFS`
// — is a different digest, so it misses, and a miss runs the gate. That is the
// fail-closed direction, and getting there costs no artifact download and no zip
// reader on the runner.
//
// It never exits non-zero. A missing token, an API outage, a rate limit, and a
// genuinely absent receipt are the same thing to the caller: no reuse, run the
// gate. Failing the job on a lookup error would convert a saved 640s into a
// burned tag, which is the wrong trade in a lane whose tags cannot be reused.
//
// The whole RUN must be green, not just its gate job. A release is cut from a
// commit whose check lane passed; if `check-native` is red for this commit, the
// question of whether to skip the amd64 gate is not the one that needs
// answering.
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { ATTESTATION_ARTIFACT_PREFIX, ATTESTED_PROFILE, attestationArtifactName, buildGateAttestation } from "./lib/gate-attestation.ts";
import { isMainModule } from "./lib/is-main-module.ts";

const PREFIX = "resolve-gate-attestation";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/** The lane that earns receipts. Asserted to exist by `repo-gates.test.ts`. */
export const SOURCE_WORKFLOW_FILE = "check.yml";
const DEFAULT_API = "https://api.github.com";
const REQUEST_TIMEOUT_MS = 20_000;
/** A commit with more successful check runs than this is not a case worth paging for. */
const RUN_PAGE_SIZE = 20;

export interface AttestationReuse {
	readonly reuse: boolean;
	readonly reason: string;
	readonly artifactName: string | null;
	readonly detail: readonly string[];
}

export interface ReuseLookupOptions {
	readonly repoRoot?: string;
	readonly profile?: string;
	readonly env?: NodeJS.ProcessEnv;
	readonly fetchImpl?: typeof fetch;
}

function refuse(reason: string, artifactName: string | null, detail: readonly string[]): AttestationReuse {
	return { reuse: false, reason, artifactName, detail };
}

async function getJson(url: string, token: string, fetchImpl: typeof fetch): Promise<Record<string, unknown>> {
	const response = await fetchImpl(url, {
		headers: {
			accept: "application/vnd.github+json",
			authorization: `Bearer ${token}`,
			"x-github-api-version": "2022-11-28",
		},
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	});
	if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
	return (await response.json()) as Record<string, unknown>;
}

function listOf(body: Record<string, unknown>, key: string): Record<string, unknown>[] {
	const value = body[key];
	return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

export async function resolveAttestationReuse(options: ReuseLookupOptions = {}): Promise<AttestationReuse> {
	const repoRoot = options.repoRoot ?? ROOT;
	const profile = options.profile ?? ATTESTED_PROFILE;
	const env = options.env ?? process.env;
	const fetchImpl = options.fetchImpl ?? fetch;

	const built = buildGateAttestation({ repoRoot, profile, env });
	if (!built.ok) return refuse(built.reason, null, [built.detail]);
	const artifactName = attestationArtifactName(built.attestation);

	const headSha = (env.GITHUB_SHA ?? "").trim();
	if (headSha !== built.attestation.commit) {
		// A checkout that is not on GITHUB_SHA means the receipt would describe
		// source the lane is not about to build.
		return refuse("checkout_is_not_the_run_commit", artifactName, [`GITHUB_SHA=${headSha || "unset"} HEAD=${built.attestation.commit}`]);
	}
	const repository = (env.GITHUB_REPOSITORY ?? "").trim();
	const token = (env.GITHUB_TOKEN ?? env.GH_TOKEN ?? "").trim();
	if (repository.length === 0 || token.length === 0) {
		return refuse("no_actions_api_credentials", artifactName, ["GITHUB_REPOSITORY and GITHUB_TOKEN are both required to read prior runs"]);
	}
	const api = (env.GITHUB_API_URL ?? DEFAULT_API).replace(/\/+$/u, "");

	try {
		const runsUrl = `${api}/repos/${repository}/actions/workflows/${SOURCE_WORKFLOW_FILE}/runs?head_sha=${encodeURIComponent(headSha)}&status=success&per_page=${RUN_PAGE_SIZE}`;
		const runs = listOf(await getJson(runsUrl, token, fetchImpl), "workflow_runs");
		if (runs.length === 0) return refuse("no_green_check_run", artifactName, [`no successful ${SOURCE_WORKFLOW_FILE} run for ${headSha}`]);

		const observed: string[] = [];
		for (const run of runs) {
			const runId = run.id;
			if (typeof runId !== "number") continue;
			const artifacts = listOf(
				await getJson(`${api}/repos/${repository}/actions/runs/${runId}/artifacts?per_page=100`, token, fetchImpl),
				"artifacts",
			);
			for (const artifact of artifacts) {
				if (typeof artifact.name !== "string" || !artifact.name.startsWith(ATTESTATION_ARTIFACT_PREFIX)) continue;
				// An expired artifact is a name with nothing behind it; treating it
				// as proof would make reuse depend on retention rather than on source.
				if (artifact.expired === true) continue;
				observed.push(`run ${runId}: ${artifact.name}`);
				if (artifact.name === artifactName) {
					return { reuse: true, reason: "attested_green", artifactName, detail: [`run ${runId} already proved this record`] };
				}
			}
		}
		return refuse(
			"no_matching_attestation",
			artifactName,
			observed.length > 0 ? observed : ["the green runs carried no gate receipt at all"],
		);
	} catch (error) {
		return refuse("lookup_failed", artifactName, [(error as Error).message]);
	}
}

export async function main(
	options: ReuseLookupOptions & { stdout?: (text: string) => void; stderr?: (text: string) => void } = {},
): Promise<number> {
	const stdout = options.stdout ?? ((text: string) => process.stdout.write(text));
	const stderr = options.stderr ?? ((text: string) => process.stderr.write(text));
	const verdict = await resolveAttestationReuse(options);
	// stdout is `$GITHUB_OUTPUT`, so it carries only single-line key=value pairs;
	// everything a human needs goes to stderr, which the step log keeps.
	stdout(`reuse=${verdict.reuse}\n`);
	stdout(`reason=${verdict.reason}\n`);
	stdout(`artifact_name=${verdict.artifactName ?? ""}\n`);
	stderr(`${PREFIX}: ${verdict.reuse ? "reusing" : "running"} the gate — ${verdict.reason}\n`);
	for (const line of verdict.detail) stderr(`  ${line}\n`);
	return 0;
}

if (isMainModule(import.meta.url)) {
	process.exitCode = await main();
}
