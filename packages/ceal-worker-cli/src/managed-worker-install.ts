import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { isSha256Digest, sha256 } from "./sha256.js";

export interface InstalledWorkerRelease {
	commandPath: string;
	installerPath: string;
	generationDirectory: string;
	installDirectory: string;
}

/**
 * Resolve the one installer-owned worker topology.
 *
 * A manifest and checksum file beside arbitrary bytes are only mutually
 * consistent self-reports. The current pointer, generation path, platform
 * binary name, and checksum-bound installer are what distinguish a managed
 * installation from a scratch directory assembled to look like one.
 */
export function resolveInstalledWorkerRelease(executablePath: string): InstalledWorkerRelease {
	const commandPath = realpathSync(executablePath);
	const generationDirectory = dirname(commandPath);
	const releasesDirectory = dirname(generationDirectory);
	const workerDirectory = dirname(releasesDirectory);
	const stateDirectory = dirname(workerDirectory);
	const installDirectory = dirname(stateDirectory);
	if (!isManagedWorkerGeneration({ commandPath, generationDirectory, releasesDirectory, workerDirectory, stateDirectory })) {
		throw new Error("unmanaged_release");
	}
	const inventoryPath = join(generationDirectory, "SHA256SUMS");
	if (!lstatSync(inventoryPath).isFile()) throw new Error("unsafe_installer");
	const inventory = readFileSync(inventoryPath, "utf8");
	const commandName = basename(commandPath);
	const platform = /^ceal-((?:linux|darwin)-(?:arm64|amd64))$/u.exec(commandName)?.[1];
	const generation = /^(?:0|[1-9][0-9]*)[.](?:0|[1-9][0-9]*)[.](?:0|[1-9][0-9]*)-((?:linux|darwin)-(?:arm64|amd64))-([^-]+)$/u.exec(
		basename(generationDirectory),
	);
	if (!platform || generation?.[1] !== platform || !isSha256Digest(generation[2]) || generation[2] !== sha256(inventory))
		throw new Error("unmanaged_generation_identity");
	const commandLink = join(installDirectory, "ceal");
	if (!lstatSync(commandLink).isSymbolicLink() || realpathSync(commandLink) !== commandPath) throw new Error("unmanaged_command_link");
	const installerPath = findVerifiedInstaller(generationDirectory, inventory);
	return { commandPath, installerPath, generationDirectory, installDirectory };
}

function findVerifiedInstaller(generationDirectory: string, inventory: string): string {
	const candidates = ["install-ceal.sh", "install.sh"].flatMap((name) => {
		const file = join(generationDirectory, name);
		try {
			const stat = lstatSync(file);
			if (!stat.isFile() || stat.isSymbolicLink()) return [];
			const expected = new RegExp(`^([^ ]+) {2}${escapePattern(name)}$`, "mu").exec(inventory)?.[1];
			return isSha256Digest(expected) && expected === sha256(readFileSync(file)) ? [file] : [];
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
