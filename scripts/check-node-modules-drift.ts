#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// Critical packages where node_modules drift turns into cryptic failures. Add a
// package here when its version skew has ALREADY cost a debug session — not
// pre-emptively; the list earns its entries.
//
// Ported from the Gateway checkout on 2026-08-18 with this repository's own
// evidence rather than its allowlist. The 2026-08-18 pre-push investigation found
// this checkout running TypeScript 5.9.3 against a declared 7.0.2, which made a
// whole type-ratchet lane answer for a compiler nobody had chosen; the same sweep
// found absent installs in all three sibling checkouts. Both compilers are listed
// because the ratchets compare their outputs against each other, so a skew in
// either silently re-baselines the other.
export const DEFAULT_NODE_MODULES_DRIFT_ALLOWLIST = ["typescript", "@typescript/native", "@biomejs/biome", "knip"];

type PackageLock = { packages?: Record<string, { version?: string } | undefined> };
type InstalledPackage = { version?: string };
type VersionedPackage = { pkg: string; declared: string; installed: string };
type MissingInstall = { pkg: string; declared: string };

export type NodeModulesDriftResult = {
	repoRoot: string;
	lockfileFound: boolean;
	drift: VersionedPackage[];
	missingFromLockfile: string[];
	missingFromInstall: MissingInstall[];
	checked: VersionedPackage[];
};

function readJsonOrNull<T>(filePath: string): T | null {
	if (!existsSync(filePath)) {
		return null;
	}
	try {
		return JSON.parse(readFileSync(filePath, "utf-8")) as T;
	} catch {
		return null;
	}
}

function lockfileVersion(lock: PackageLock, pkgName: string): string | null {
	const entry = lock?.packages?.[`node_modules/${pkgName}`];
	return entry?.version ?? null;
}

function installedVersion(repoRoot: string, pkgName: string): string | null {
	const path = resolve(repoRoot, "node_modules", pkgName, "package.json");
	const pkg = readJsonOrNull<InstalledPackage>(path);
	return pkg?.version ?? null;
}

export function checkNodeModulesDrift(options: { repoRoot?: string; allowlist?: readonly string[] } = {}): NodeModulesDriftResult {
	const repoRoot = resolve(options.repoRoot ?? process.cwd());
	const allowlist = options.allowlist ?? DEFAULT_NODE_MODULES_DRIFT_ALLOWLIST;
	const lock = readJsonOrNull<PackageLock>(resolve(repoRoot, "package-lock.json"));
	if (!lock) {
		return {
			repoRoot,
			lockfileFound: false,
			drift: [],
			missingFromLockfile: [],
			missingFromInstall: [],
			checked: [],
		};
	}
	const drift: VersionedPackage[] = [];
	const missingFromLockfile: string[] = [];
	const missingFromInstall: MissingInstall[] = [];
	const checked: VersionedPackage[] = [];
	for (const pkgName of allowlist) {
		const declared = lockfileVersion(lock, pkgName);
		if (declared === null) {
			missingFromLockfile.push(pkgName);
			continue;
		}
		const installed = installedVersion(repoRoot, pkgName);
		if (installed === null) {
			missingFromInstall.push({ pkg: pkgName, declared });
			continue;
		}
		checked.push({ pkg: pkgName, declared, installed });
		if (declared !== installed) {
			drift.push({ pkg: pkgName, declared, installed });
		}
	}
	return {
		repoRoot,
		lockfileFound: true,
		drift,
		missingFromLockfile,
		missingFromInstall,
		checked,
	};
}

function summarize(result: NodeModulesDriftResult): string {
	if (!result.lockfileFound) {
		return "package-lock.json not found; node_modules drift check skipped.";
	}
	if (result.drift.length === 0 && result.missingFromInstall.length === 0) {
		return `node_modules drift: OK (checked ${result.checked.length} packages)`;
	}
	const lines = ["node_modules out of sync; run `npm install` (or `npm ci`)."];
	for (const item of result.drift) {
		lines.push(`  drift: ${item.pkg}  installed=${item.installed}  lockfile=${item.declared}`);
	}
	for (const item of result.missingFromInstall) {
		lines.push(`  missing: ${item.pkg}  lockfile=${item.declared}  installed=(absent)`);
	}
	return lines.join("\n");
}

function usage(): string {
	return [
		"Usage: node scripts/check-node-modules-drift.ts [options]",
		"",
		"Options:",
		"  --repo-root <path>   Ceal repo root (defaults to cwd)",
		"  --json               Emit JSON instead of human summary",
		"  --help               Show this help",
	].join("\n");
}

function parseArgs(argv: readonly string[]): { repoRoot: string; json: boolean } | null {
	const args = { repoRoot: process.cwd(), json: false };
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === "--repo-root") {
			args.repoRoot = resolve(argv[i + 1] ?? "");
			i += 1;
			continue;
		}
		if (arg === "--json") {
			args.json = true;
			continue;
		}
		if (arg === "--help" || arg === "-h") {
			return null;
		}
		throw new Error(`Unknown argument: ${arg}`);
	}
	return args;
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
	try {
		const args = parseArgs(process.argv.slice(2));
		if (!args) {
			console.log(usage());
			process.exit(0);
		}
		const result = checkNodeModulesDrift(args);
		if (args.json) {
			process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
		} else {
			process.stdout.write(`${summarize(result)}\n`);
		}
		const hasDrift = result.drift.length > 0 || result.missingFromInstall.length > 0;
		process.exit(hasDrift ? 1 : 0);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}
