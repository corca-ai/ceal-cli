import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { parse } from "yaml";
import type { CealStableUpdateResult, CealWorkerPlatform } from "./cli-runtime.js";

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
	return async () => {
		const startedAt = Date.now();
		let installed: InstalledWorkerRelease;
		try {
			installed = findInstalledWorkerRelease(executablePath);
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
		const run = await runProcess(
			"/bin/sh",
			[installed.installerPath],
			{
				...environment,
				CEAL_INSTALL_DIR: installed.installDirectory,
				CEAL_INSTALL_ROLE: "worker",
				CEAL_VERSION: "stable",
				CEAL_MINIMUM_VERSION: previous.version,
			},
			installed.generationDirectory,
			{ ...deadlines, timeoutMs: deadlines.installerMs },
		);
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
		const commandAfterUpdate = join(installed.installDirectory, "ceal");
		const current = await readVersion(commandAfterUpdate, deadlines);
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
		let artifactPath: string;
		try {
			artifactPath = realpathSync(commandAfterUpdate);
		} catch {
			return unavailable(
				"update_readback_failed",
				"The updated worker release is not reachable through its managed command link.",
				"Reinstall an explicitly approved signed worker release before retrying.",
			);
		}
		const elapsed_ms = Date.now() - startedAt;
		return {
			status: current.version === previous.version ? "unchanged" : "updated",
			previous_version: previous.version,
			installed_version: current.version,
			platform: current.platform,
			artifact_sha256: digest(readFileSync(artifactPath)),
			elapsed_ms,
		};
	};
}

export interface InstalledWorkerRelease {
	commandPath: string;
	installerPath: string;
	generationDirectory: string;
	installDirectory: string;
}

/** Observation-safe view of the managed install layout: null instead of throwing. */
export function inspectInstalledWorkerRelease(executablePath: string): InstalledWorkerRelease | null {
	try {
		return findInstalledWorkerRelease(executablePath);
	} catch {
		return null;
	}
}

function findInstalledWorkerRelease(executablePath: string): InstalledWorkerRelease {
	const commandPath = realpathSync(executablePath);
	const generationDirectory = dirname(commandPath);
	const releasesDirectory = dirname(generationDirectory);
	const workerDirectory = dirname(releasesDirectory);
	const stateDirectory = dirname(workerDirectory);
	const installDirectory = dirname(stateDirectory);
	if (!isManagedWorkerGeneration({ commandPath, generationDirectory, releasesDirectory, workerDirectory, stateDirectory }))
		throw new Error("unmanaged_release");
	const inventoryPath = join(generationDirectory, "SHA256SUMS");
	if (!lstatSync(inventoryPath).isFile()) throw new Error("unsafe_installer");
	const installerPath = findVerifiedInstaller(generationDirectory, readFileSync(inventoryPath, "utf8"));
	return { commandPath, installerPath, generationDirectory, installDirectory };
}

function findVerifiedInstaller(generationDirectory: string, inventory: string): string {
	const candidates = ["install-ceal.sh", "install.sh"].flatMap((name) => {
		const file = join(generationDirectory, name);
		try {
			const stat = lstatSync(file);
			if (!stat.isFile() || stat.isSymbolicLink()) return [];
			const expected = new RegExp(`^([a-f0-9]{64}) {2}${escapePattern(name)}$`, "mu").exec(inventory)?.[1];
			return expected === digest(readFileSync(file)) ? [file] : [];
		} catch {
			return [];
		}
	});
	if (candidates.length !== 1) throw new Error("installer_digest_mismatch");
	return candidates[0]!;
}

function isManagedWorkerGeneration(
	paths: Pick<InstalledWorkerRelease, "commandPath" | "generationDirectory"> & {
		releasesDirectory: string;
		workerDirectory: string;
		stateDirectory: string;
	},
): boolean {
	const commandName = basename(paths.commandPath);
	return (
		isWorkerBinary(commandName) &&
		paths.commandPath === join(paths.generationDirectory, commandName) &&
		basename(paths.stateDirectory) === ".ceal-cli" &&
		basename(paths.workerDirectory) === "worker" &&
		basename(paths.releasesDirectory) === "releases" &&
		realpathSync(join(paths.workerDirectory, "current")) === paths.generationDirectory
	);
}

function basename(value: string): string {
	return value.slice(value.lastIndexOf("/") + 1);
}
function isWorkerBinary(value: string): boolean {
	return /^ceal-(?:linux|darwin)-(?:arm64|amd64)$/u.test(value);
}
function escapePattern(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

async function readVersion(
	commandPath: string,
	deadlines: CealStableUpdateDeadlines,
): Promise<{ version: string; platform: CealWorkerPlatform } | null> {
	const run = await runProcess(commandPath, ["version"], {}, dirname(commandPath), { ...deadlines, timeoutMs: deadlines.versionReadbackMs });
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

async function runProcess(
	command: string,
	args: readonly string[],
	env: NodeJS.ProcessEnv,
	cwd: string,
	bounds: { timeoutMs: number; terminationGraceMs: number; postKillReportMs: number },
): Promise<{ code: number | null; stdout: string; stderr: string; truncated: boolean; timedOut: boolean }> {
	return new Promise((resolveResult) => {
		// `detached` puts the child in its own process group so the whole tree can
		// be signalled. Signalling only `/bin/sh` does nothing useful: a POSIX shell
		// does not run a trap while blocked on a foreground child, so a SIGTERM
		// arriving while it waits on `curl` is merely queued, and the SIGKILL five
		// seconds later destroys the shell before its rollback ever runs — leaving a
		// staged generation, a temp directory of downloaded assets, and an install
		// lock that on macOS nothing clears. Killing the group takes `curl` down,
		// the shell's wait returns, and the trap runs the way it was written to.
		const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
		let stdout = "";
		let stderr = "";
		let truncated = false;
		let timedOut = false;
		let settled = false;
		let exitCode: number | null = null;
		const timers: NodeJS.Timeout[] = [];
		const settle = (code: number | null) => {
			if (settled) return;
			settled = true;
			for (const timer of timers) clearTimeout(timer);
			// Deciding the answer is not the same as being able to return it. A
			// process holding these pipes keeps the event loop alive, so `ceal update`
			// would print nothing and sit there having already decided. This was missed
			// the first time: the envelope arrived on time and the process still hung.
			//
			// Not covered by a test, deliberately recorded rather than implied: since
			// the deadline signals the whole process group, every descendant that
			// inherited these pipes dies with it, and only something that escaped the
			// group — a `setsid` — could still hold them. Removing these three lines
			// keeps the suite green. They stay as the cheap guard against the one
			// failure mode this whole deadline exists to prevent.
			child.stdout.destroy();
			child.stderr.destroy();
			child.unref();
			resolveResult({ code, stdout, stderr, truncated, timedOut });
		};
		const after = (delay: number, action: () => void) => {
			const timer = setTimeout(action, delay);
			// The deadline must not be the reason the process stays alive: an update
			// that finished has nothing left to wait for.
			timer.unref();
			timers.push(timer);
		};
		after(bounds.timeoutMs, () => {
			timedOut = true;
			signalGroup(child, "SIGTERM");
			after(bounds.terminationGraceMs, () => {
				signalGroup(child, "SIGKILL");
				after(bounds.postKillReportMs, () => settle(null));
			});
		});
		const capture = (stream: "stdout" | "stderr", chunk: Buffer) => {
			if (truncated) return;
			const next = (stream === "stdout" ? stdout : stderr) + chunk.toString("utf8");
			if (Buffer.byteLength(next) > MAX_CAPTURED_OUTPUT_BYTES) {
				truncated = true;
				return;
			}
			if (stream === "stdout") stdout = next;
			else stderr = next;
		};
		child.stdout.on("data", (chunk: Buffer) => capture("stdout", chunk));
		child.stderr.on("data", (chunk: Buffer) => capture("stderr", chunk));
		child.on("error", () => settle(null));
		child.on("exit", (code) => {
			exitCode = code;
			after(POST_EXIT_DRAIN_MS, () => settle(exitCode));
		});
		child.on("close", (code) => settle(code));
	});
}

// Signals the child's whole process group, falling back to the child alone if
// the group is already gone. `kill` on a departed child is a no-op rather than a
// throw, but the negated-pid form raises ESRCH once nothing in the group is left.
function signalGroup(child: ReturnType<typeof spawn>, signal: "SIGTERM" | "SIGKILL"): void {
	try {
		if (child.pid !== undefined) process.kill(-child.pid, signal);
	} catch {
		try {
			child.kill(signal);
		} catch {
			/* Already gone; the deadline has nothing left to stop. */
		}
	}
}

function digest(bytes: Buffer | string): string {
	return createHash("sha256").update(bytes).digest("hex");
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
