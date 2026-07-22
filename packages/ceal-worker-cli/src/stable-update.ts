import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { parse } from "yaml";
import type { CealStableUpdateResult } from "./cli-runtime.js";

const MAX_CAPTURED_OUTPUT_BYTES = 64 * 1024;

export function createCealStableUpdateRunner(executablePath: string, environment: NodeJS.ProcessEnv): () => Promise<CealStableUpdateResult> {
	return async () => {
		const startedAt = Date.now();
		let installed: InstalledWorkerRelease;
		try {
			installed = findInstalledWorkerRelease(executablePath);
		} catch {
			return unavailable("update_unavailable", "This Ceal command is not running from a verified installed worker release.", "Install a signed stable worker release, then run 'ceal update' from that installed command.");
		}
		const previous = await readVersion(installed.commandPath);
		if (!previous) return unavailable("update_readback_failed", "The installed worker release could not report its current version.", "Reinstall an explicitly approved signed worker release before retrying.");
		const run = await runProcess("/bin/sh", [installed.installerPath], {
			...environment,
			CEAL_INSTALL_DIR: installed.installDirectory,
			CEAL_INSTALL_ROLE: "worker",
			CEAL_VERSION: "stable",
			CEAL_MINIMUM_VERSION: previous.version,
		}, installed.generationDirectory);
		if (run.code !== 0 || run.truncated) return unavailable("update_failed", "The stable signed worker update did not complete.", "Retry once, then reinstall an explicitly approved signed worker release.");
		const commandAfterUpdate = join(installed.installDirectory, "ceal");
		const current = await readVersion(commandAfterUpdate);
		if (!current) return unavailable("update_readback_failed", "The updated worker release could not report its version.", "Reinstall an explicitly approved signed worker release before retrying.");
		if (compareVersions(current.version, previous.version) < 0) return unavailable("update_readback_failed", "The stable worker update resolved to an older release.", "Reinstall the current signed worker release and ask a maintainer to repair the stable release selection.");
		let artifactPath: string;
		try { artifactPath = realpathSync(commandAfterUpdate); } catch {
			return unavailable("update_readback_failed", "The updated worker release is not reachable through its managed command link.", "Reinstall an explicitly approved signed worker release before retrying.");
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

interface InstalledWorkerRelease {
	commandPath: string;
	installerPath: string;
	generationDirectory: string;
	installDirectory: string;
}

function findInstalledWorkerRelease(executablePath: string): InstalledWorkerRelease {
	const commandPath = realpathSync(executablePath);
	const generationDirectory = dirname(commandPath);
	const releasesDirectory = dirname(generationDirectory);
	const workerDirectory = dirname(releasesDirectory);
	const stateDirectory = dirname(workerDirectory);
	const installDirectory = dirname(stateDirectory);
	if (!isManagedWorkerGeneration({ commandPath, generationDirectory, releasesDirectory, workerDirectory, stateDirectory })) throw new Error("unmanaged_release");
	const installerPath = join(generationDirectory, "install.sh");
	const inventoryPath = join(generationDirectory, "SHA256SUMS");
	if (!lstatSync(installerPath).isFile() || !lstatSync(inventoryPath).isFile()) throw new Error("unsafe_installer");
	const expected = /^([a-f0-9]{64}) {2}install[.]sh$/mu.exec(readFileSync(inventoryPath, "utf8"))?.[1];
	if (!expected || expected !== digest(readFileSync(installerPath))) throw new Error("installer_digest_mismatch");
	return { commandPath, installerPath, generationDirectory, installDirectory };
}

function isManagedWorkerGeneration(paths: Pick<InstalledWorkerRelease, "commandPath" | "generationDirectory"> & { releasesDirectory: string; workerDirectory: string; stateDirectory: string }): boolean {
	const commandName = basename(paths.commandPath);
	return isWorkerBinary(commandName)
		&& paths.commandPath === join(paths.generationDirectory, commandName)
		&& basename(paths.stateDirectory) === ".ceal-cli"
		&& basename(paths.workerDirectory) === "worker"
		&& basename(paths.releasesDirectory) === "releases"
		&& realpathSync(join(paths.workerDirectory, "current")) === paths.generationDirectory;
}

function basename(value: string): string { return value.slice(value.lastIndexOf("/") + 1); }
function isWorkerBinary(value: string): boolean { return /^ceal-linux-(?:arm64|amd64)$/u.test(value); }

async function readVersion(commandPath: string): Promise<{ version: string; platform: "linux-arm64" | "linux-amd64" } | null> {
	const run = await runProcess(commandPath, ["version"], {}, dirname(commandPath));
	if (run.code !== 0 || run.truncated || run.stderr !== "") return null;
	try {
		const payload = parse(run.stdout) as { schema_version?: unknown; command?: unknown; version?: unknown };
		return parseWorkerVersion(payload, commandPath);
	} catch { return null; }
}

function parseWorkerVersion(payload: { schema_version?: unknown; command?: unknown; version?: unknown }, commandPath: string): { version: string; platform: "linux-arm64" | "linux-amd64" } | null {
	const platform = /ceal-linux-(arm64|amd64)$/u.exec(realpathSync(commandPath))?.[1];
	if (payload?.schema_version !== "ceal.version.v1" || payload.command !== "ceal" || typeof payload.version !== "string" || !/^\d+\.\d+\.\d+$/u.test(payload.version) || !platform) return null;
	return { version: payload.version, platform: `linux-${platform}` as "linux-arm64" | "linux-amd64" };
}

async function runProcess(command: string, args: readonly string[], env: NodeJS.ProcessEnv, cwd: string): Promise<{ code: number | null; stdout: string; stderr: string; truncated: boolean }> {
	return new Promise((resolveResult) => {
		const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		let truncated = false;
		const capture = (stream: "stdout" | "stderr", chunk: Buffer) => {
			if (truncated) return;
			const next = (stream === "stdout" ? stdout : stderr) + chunk.toString("utf8");
			if (Buffer.byteLength(next) > MAX_CAPTURED_OUTPUT_BYTES) { truncated = true; return; }
			if (stream === "stdout") stdout = next; else stderr = next;
		};
		child.stdout.on("data", (chunk: Buffer) => capture("stdout", chunk));
		child.stderr.on("data", (chunk: Buffer) => capture("stderr", chunk));
		child.on("error", () => resolveResult({ code: null, stdout, stderr, truncated }));
		child.on("close", (code) => resolveResult({ code, stdout, stderr, truncated }));
	});
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

function unavailable(kind: NonNullable<CealStableUpdateResult["error"]>["kind"], message: string, next_action: string): CealStableUpdateResult {
	return { status: "unavailable", error: { kind, message, next_action } };
}
