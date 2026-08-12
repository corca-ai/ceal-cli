import { readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { parse } from "yaml";
import { detectCealAgentGuideHost } from "./agent-guide.js";
import { runBoundedProcess } from "./bounded-process.js";
import type { CealStableUpdateOptions, CealStableUpdateResult, CealWorkerPlatform } from "./cli-runtime.js";
import { type InstalledWorkerRelease, resolveInstalledWorkerRelease } from "./managed-worker-install.js";
import { sha256 } from "./sha256.js";

const MAX_CAPTURED_OUTPUT_BYTES = 64 * 1024;

// Every other wait in this CLI is bounded, and this one was not: `ceal update`
// spawns the staged installer and waits for `close` forever. A release origin
// that accepts the connection and then goes silent — or a concurrent update
// holding a resource — left the command with no deadline, no envelope, and
// nothing to report. An agent cannot distinguish that from slow work.
//
// Two bounds rather than one, because the two things being run are not alike.
// A version readback is a local `exec` of an installed binary with no network in
// it, so anything past a few seconds is already wrong.
//
// The installer's bound is a backstop for a wedged process, not a latency
// budget: `install-ceal.sh` bounds each of its own downloads on *stalling*
// rather than on total time, precisely so a slow-but-working link is not cut
// off, and this number must not quietly undo that. Nineteen signed assets over a
// link slow enough to be painful and still fine is comfortably more than ten
// minutes, so ten minutes here would fail installs the inner bounds deliberately
// allow. A black-holed origin does not reach this deadline at all — it fails at
// the connect or stall bound, in seconds.
const VERSION_READBACK_TIMEOUT_MS = 30_000;
const INSTALLER_TIMEOUT_MS = 30 * 60_000;
// A process that ignores SIGTERM must not turn a bounded wait back into an
// unbounded one, so the escalation to SIGKILL is itself on a clock. The grace is
// not politeness: `install-ceal.sh` traps TERM to roll back a half-staged
// generation and release its install lock, and that lock is a bare `mkdir` on
// hosts without `flock` — macOS — where nothing else will ever clear it.
const TERMINATION_GRACE_MS = 5_000;
// `exit` fires when the process is gone; `close` additionally waits for every
// inherited stdio pipe to reach EOF, which a grandchild that outlived it holds
// open indefinitely. Waiting for `close` therefore reintroduces exactly the hang
// this deadline exists to stop — on the success path too, not just after a kill.
// So the result is taken at `exit` plus a short drain for output still in flight.
const POST_EXIT_DRAIN_MS = 250;
// After SIGKILL there is nothing left to wait for, so the result is reported
// without waiting for pipes a surviving grandchild may still hold.
const POST_KILL_REPORT_MS_DEFAULT = 1_000;

export interface CealStableUpdateDeadlines {
	/** Bound on one `ceal version` readback of an installed binary. */
	versionReadbackMs: number;
	/** Backstop on the staged installer, whose own fetches are bounded inside it. */
	installerMs: number;
	/** How long a process gets to honour SIGTERM before it is killed outright. */
	terminationGraceMs: number;
	/** How long after SIGKILL the result is reported without waiting for `close`. */
	postKillReportMs: number;
}

const DEFAULT_DEADLINES: CealStableUpdateDeadlines = {
	versionReadbackMs: VERSION_READBACK_TIMEOUT_MS,
	installerMs: INSTALLER_TIMEOUT_MS,
	terminationGraceMs: TERMINATION_GRACE_MS,
	postKillReportMs: POST_KILL_REPORT_MS_DEFAULT,
};

export function createCealStableUpdateRunner(
	executablePath: string,
	environment: NodeJS.ProcessEnv,
	// Supplied by the caller for the same reason `withLocalStoreLock` takes its
	// `maxWaitMs` that way: the real bounds are minutes, and a test that had to
	// wait them out would not be run. `bin.ts` takes the defaults.
	overrides: Partial<CealStableUpdateDeadlines> = {},
): () => Promise<CealStableUpdateResult> {
	const deadlines = { ...DEFAULT_DEADLINES, ...overrides };
	const detectedGuideHost = detectCealAgentGuideHost(environment);
	return async (options: CealStableUpdateOptions = {}) => {
		const startedAt = Date.now();
		options.onProgress?.("check");
		let installed: InstalledWorkerRelease;
		try {
			installed = resolveInstalledWorkerRelease(executablePath);
		} catch {
			return unavailable(
				"update_unavailable",
				"This Ceal command is not running from a verified installed worker release.",
				"Install a signed stable worker release, then run 'ceal update' from that installed command.",
			);
		}
		const previous = await readVersion(installed.commandPath, deadlines);
		if (!previous)
			return unavailable(
				"update_readback_failed",
				"The installed worker release could not report its current version.",
				"Reinstall an explicitly approved signed worker release before retrying.",
			);
		options.onProgress?.("download_install");
		const run = await runBoundedProcess("/bin/sh", [installed.installerPath], {
			cwd: installed.generationDirectory,
			env: {
				...environment,
				CEAL_INSTALL_DIR: installed.installDirectory,
				CEAL_INSTALL_ROLE: "worker",
				CEAL_VERSION: "stable",
				CEAL_MINIMUM_VERSION: previous.version,
			},
			timeoutMs: deadlines.installerMs,
			terminationGraceMs: deadlines.terminationGraceMs,
			postKillReportMs: deadlines.postKillReportMs,
			postExitDrainMs: POST_EXIT_DRAIN_MS,
			maxCapturedOutputBytes: MAX_CAPTURED_OUTPUT_BYTES,
		});
		// Named separately from a failed install because the operator action
		// differs: a timeout says nothing about whether the release is sound, and
		// the useful next move is to check the network path rather than to reinstall.
		if (run.timedOut)
			return unavailable(
				"update_failed",
				"The stable signed worker update did not finish within its deadline and was stopped.",
				"Check connectivity to the worker release origin, then retry; the installer rolled back whatever it had staged.",
			);
		if (run.code !== 0 || run.truncated)
			return unavailable(
				"update_failed",
				"The stable signed worker update did not complete.",
				"Retry once, then reinstall an explicitly approved signed worker release.",
			);
		// The staged installer verifies its signed inventory before it switches the
		// managed command. Re-open the new managed generation as a separate local
		// verification step before executing it for the version readback.
		options.onProgress?.("verify");
		let updated: InstalledWorkerRelease;
		try {
			updated = resolveInstalledWorkerRelease(join(installed.installDirectory, "ceal"));
		} catch {
			return unavailable(
				"update_readback_failed",
				"The updated worker release is not reachable through its verified managed command link.",
				"Reinstall an explicitly approved signed worker release before retrying.",
			);
		}
		options.onProgress?.("installed_readback");
		const current = await readVersion(updated.commandPath, deadlines);
		if (!current)
			return unavailable(
				"update_readback_failed",
				"The updated worker release could not report its version.",
				"Reinstall an explicitly approved signed worker release before retrying.",
			);
		if (compareVersions(current.version, previous.version) < 0)
			return unavailable(
				"update_readback_failed",
				"The stable worker update resolved to an older release.",
				"Reinstall the current signed worker release and ask a maintainer to repair the stable release selection.",
			);
		const elapsed_ms = Date.now() - startedAt;
		return {
			status: current.version === previous.version ? "unchanged" : "updated",
			previous_version: previous.version,
			installed_version: current.version,
			platform: current.platform,
			artifact_sha256: sha256(readFileSync(updated.commandPath)),
			elapsed_ms,
			guide: {
				status: "registration_not_attempted",
				next_action: detectedGuideHost
					? `Run 'ceal guide register ${detectedGuideHost}' from the updated command to stage and register its signed guide.`
					: "Run 'ceal guide status', then run 'ceal guide register codex' or 'ceal guide register claude' for the agent host you use.",
				non_claim: "Guide staging and registration were not attempted and cannot change this binary update result.",
			},
		};
	};
}

async function readVersion(
	commandPath: string,
	deadlines: CealStableUpdateDeadlines,
): Promise<{ version: string; platform: CealWorkerPlatform } | null> {
	const run = await runBoundedProcess(commandPath, ["version"], {
		cwd: dirname(commandPath),
		env: {},
		timeoutMs: deadlines.versionReadbackMs,
		terminationGraceMs: deadlines.terminationGraceMs,
		postKillReportMs: deadlines.postKillReportMs,
		postExitDrainMs: POST_EXIT_DRAIN_MS,
		maxCapturedOutputBytes: MAX_CAPTURED_OUTPUT_BYTES,
	});
	// A readback that had to be killed is not a version, and it reaches the same
	// `update_readback_failed` envelope as a readback that answered nonsense.
	if (run.timedOut || run.code !== 0 || run.truncated || run.stderr !== "") return null;
	try {
		const payload = parse(run.stdout) as { schema_version?: unknown; command?: unknown; version?: unknown };
		return parseWorkerVersion(payload, commandPath);
	} catch {
		return null;
	}
}

function parseWorkerVersion(
	payload: { schema_version?: unknown; command?: unknown; version?: unknown },
	commandPath: string,
): { version: string; platform: CealWorkerPlatform } | null {
	const platform = /ceal-((?:linux|darwin)-(?:arm64|amd64))$/u.exec(realpathSync(commandPath))?.[1];
	if (
		payload?.schema_version !== "ceal.version.v1" ||
		payload.command !== "ceal" ||
		typeof payload.version !== "string" ||
		!/^\d+\.\d+\.\d+$/u.test(payload.version) ||
		!platform
	)
		return null;
	return { version: payload.version, platform: platform as CealWorkerPlatform };
}

function compareVersions(left: string, right: string): number {
	const leftParts = left.split(".").map(Number);
	const rightParts = right.split(".").map(Number);
	for (let index = 0; index < 3; index += 1) {
		if (leftParts[index] !== rightParts[index]) return leftParts[index]! - rightParts[index]!;
	}
	return 0;
}

function unavailable(
	kind: NonNullable<CealStableUpdateResult["error"]>["kind"],
	message: string,
	next_action: string,
): CealStableUpdateResult {
	return { status: "unavailable", error: { kind, message, next_action } };
}
