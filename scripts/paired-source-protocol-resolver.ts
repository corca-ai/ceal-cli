import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { type LoadHookSync, registerHooks, type ResolveHookSync } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const PAIRED_PROTOCOL_PACKAGE = "@corca-ai/ceal-protocol";
export const PAIRED_PROTOCOL_DIST_ENV = "CEAL_PAIRED_SOURCE_PROTOCOL_DIST";
export const PAIRED_PROTOCOL_DIST_SHA256_ENV = "CEAL_PAIRED_SOURCE_PROTOCOL_DIST_SHA256";
export const PAIRED_PROTOCOL_GATEWAY_ROOT_ENV = "CEAL_PAIRED_SOURCE_GATEWAY_ROOT";
export const PAIRED_PROTOCOL_LOADER_ENV = "CEAL_PAIRED_SOURCE_PROTOCOL_LOADER";
export const PAIRED_PROTOCOL_ENTRYPOINTS = {
	"": "index.js",
} as const;

type JsonRecord = Record<string, unknown>;

export type PairedSourceProtocol = {
	gateway_repo_root: string;
	package_root: string;
	dist_root: string;
	entrypoint: string;
	package_name: typeof PAIRED_PROTOCOL_PACKAGE;
	package_version: string;
	dist_sha256: string;
	entrypoint_sha256: string;
	source_commit: string | null;
	source_dirty: boolean | null;
};

export type PairedSourceProtocolResolution =
	| { ok: true; protocol: PairedSourceProtocol }
	| { ok: false; code: string; message: string; next_action: string };

function isRecord(value: unknown): value is JsonRecord {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
}

function buildCommand(packageRoot: string): string {
	return `npm --prefix ${shellQuote(packageRoot)} run build`;
}

function failure(code: string, message: string, packageRoot?: string): PairedSourceProtocolResolution {
	return {
		ok: false,
		code,
		message,
		next_action: packageRoot
			? `Run ${buildCommand(packageRoot)}; this lane does not build or copy Gateway Protocol output.`
			: "Pass a Gateway repository root containing packages/ceal-protocol/package.json and its dist directory.",
	};
}

function regularFile(file: string): boolean {
	return existsSync(file) && statSync(file).isFile();
}

function regularDirectory(directory: string): boolean {
	return existsSync(directory) && statSync(directory).isDirectory();
}

function filesUnder(directory: string): string[] {
	const files: string[] = [];
	const visit = (current: string): void => {
		for (const entry of readdirSync(current, { withFileTypes: true })) {
			const target = path.join(current, entry.name);
			if (entry.isDirectory()) visit(target);
			else if (entry.isFile()) files.push(target);
			else throw new Error(`unsupported non-regular file under ${directory}`);
		}
	};
	visit(directory);
	return files.sort();
}

function directorySha256(directory: string): string {
	const digest = createHash("sha256");
	for (const file of filesUnder(directory)) {
		digest.update(path.relative(directory, file));
		digest.update("\0");
		digest.update(readFileSync(file));
	}
	return digest.digest("hex");
}

function fileSha256(file: string): string {
	return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function distFileDigests(directory: string): ReadonlyMap<string, string> {
	return new Map(filesUnder(directory).map((file) => [path.resolve(file), fileSha256(file)]));
}

function gitCommit(repoRoot: string): string | null {
	const result = spawnSync("git", ["-C", repoRoot, "rev-parse", "HEAD"], {
		encoding: "utf8",
		maxBuffer: 1024,
		timeout: 10_000,
	});
	const commit = result.status === 0 ? result.stdout.trim() : "";
	return /^[0-9a-f]{40,64}$/u.test(commit) ? commit : null;
}

function gitDirty(repoRoot: string): boolean | null {
	const result = spawnSync("git", ["-C", repoRoot, "status", "--porcelain", "--untracked-files=no"], {
		encoding: "utf8",
		maxBuffer: 1024 * 1024,
		timeout: 10_000,
	});
	return result.status === 0 ? result.stdout.trim().length > 0 : null;
}

function staleRuntimeSource(sourceRoot: string, distRoot: string): string | null {
	for (const sourceFile of filesUnder(sourceRoot)) {
		if (path.extname(sourceFile) !== ".ts") continue;
		const relativeSource = path.relative(sourceRoot, sourceFile);
		const runtimeFile = path.join(distRoot, relativeSource.replace(/[.]ts$/u, ".js"));
		if (!regularFile(runtimeFile) || statSync(sourceFile).mtimeMs > statSync(runtimeFile).mtimeMs) return relativeSource;
	}
	return null;
}

export function resolvePairedSourceProtocol(gatewayRepoRoot: string): PairedSourceProtocolResolution {
	const repoRoot = path.resolve(gatewayRepoRoot);
	const packageRoot = path.join(repoRoot, "packages", "ceal-protocol");
	const packageJsonPath = path.join(packageRoot, "package.json");
	const sourceRoot = path.join(packageRoot, "src");
	const distRoot = path.join(packageRoot, "dist");
	const entrypoint = path.join(distRoot, "index.js");

	if (!regularDirectory(repoRoot)) return failure("gateway_repo_root_missing", "The paired Gateway repository root is not a directory.");
	if (!regularFile(packageJsonPath)) return failure("gateway_protocol_package_missing", "The paired Gateway Protocol package.json is missing.", packageRoot);

	try {
		const manifest = JSON.parse(readFileSync(packageJsonPath, "utf8")) as unknown;
		if (!isRecord(manifest) || manifest.name !== PAIRED_PROTOCOL_PACKAGE)
			return failure("gateway_protocol_package_identity_mismatch", `The paired package must be named ${PAIRED_PROTOCOL_PACKAGE}.`, packageRoot);
		if (typeof manifest.version !== "string" || manifest.version.length === 0)
			return failure("gateway_protocol_package_identity_invalid", "The paired Protocol package version is missing or invalid.", packageRoot);
		if (manifest.type !== "module")
			return failure("gateway_protocol_package_type_mismatch", "The paired Protocol package type must be module.", packageRoot);
		if (manifest.main !== "./dist/index.js")
			return failure("gateway_protocol_package_main_mismatch", "The paired Protocol package main must be ./dist/index.js.", packageRoot);
		if (!regularDirectory(sourceRoot)) return failure("gateway_protocol_source_missing", "The paired Gateway Protocol source directory is missing.", packageRoot);
		if (!regularDirectory(distRoot) || !regularFile(entrypoint))
			return failure(
				"gateway_protocol_dist_missing",
				"The paired Gateway Protocol dist/index.js is missing.",
				packageRoot,
			);

		const staleSource = staleRuntimeSource(sourceRoot, distRoot);
		if (staleSource !== null)
			return failure("gateway_protocol_dist_stale", `The paired Gateway Protocol runtime dist is missing or older than src/${staleSource}.`, packageRoot);

		const distSha256 = directorySha256(distRoot);
		return {
			ok: true,
			protocol: {
				gateway_repo_root: repoRoot,
				package_root: packageRoot,
				dist_root: distRoot,
				entrypoint,
				package_name: PAIRED_PROTOCOL_PACKAGE,
				package_version: manifest.version,
				dist_sha256: distSha256,
				entrypoint_sha256: fileSha256(entrypoint),
				source_commit: gitCommit(repoRoot),
				source_dirty: gitDirty(repoRoot),
			},
		};
	} catch (error) {
		if (error instanceof SyntaxError)
			return failure("gateway_protocol_package_invalid", "The paired Protocol package.json is not valid JSON.", packageRoot);
		return failure("gateway_protocol_inspection_failed", "The paired Gateway Protocol package could not be inspected safely.", packageRoot);
	}
}

export function resolvePairedProtocolSpecifier(specifier: string, distRoot: string): string | null {
	if (specifier === PAIRED_PROTOCOL_PACKAGE) return path.join(distRoot, PAIRED_PROTOCOL_ENTRYPOINTS[""]);
	const prefix = `${PAIRED_PROTOCOL_PACKAGE}/`;
	if (!specifier.startsWith(prefix)) return null;
	const subpath = specifier.slice(prefix.length);
	const entrypoint = PAIRED_PROTOCOL_ENTRYPOINTS[subpath as keyof typeof PAIRED_PROTOCOL_ENTRYPOINTS];
	if (entrypoint === undefined) throw new Error(`paired Protocol resolver refuses unsupported subpath: ${specifier}`);
	return path.join(distRoot, entrypoint);
}

if (process.env[PAIRED_PROTOCOL_LOADER_ENV] === "1") {
	const configuredDist = process.env[PAIRED_PROTOCOL_DIST_ENV];
	const configuredGatewayRoot = process.env[PAIRED_PROTOCOL_GATEWAY_ROOT_ENV];
	const expectedDistSha256 = process.env[PAIRED_PROTOCOL_DIST_SHA256_ENV];
	if (!configuredDist || !configuredGatewayRoot || !/^[a-f0-9]{64}$/u.test(expectedDistSha256 ?? ""))
		throw new Error("paired Protocol resolver requires a validated Gateway root, dist directory, and digest");
	const childResolution = resolvePairedSourceProtocol(configuredGatewayRoot);
	if (
		!childResolution.ok
		|| path.resolve(configuredDist) !== childResolution.protocol.dist_root
		|| expectedDistSha256 !== childResolution.protocol.dist_sha256
	)
		throw new Error("paired Protocol resolver child validation does not match the parent-validated canonical dist");
	const expectedFiles = distFileDigests(configuredDist);
	const distPrefix = `${path.resolve(configuredDist)}${path.sep}`;
	const resolvePairedProtocol: ResolveHookSync = (specifier, context, nextResolve) => {
		const target = resolvePairedProtocolSpecifier(specifier, configuredDist);
		return target === null ? nextResolve(specifier, context) : { url: pathToFileURL(target).href, shortCircuit: true };
	};
	const loadPairedProtocol: LoadHookSync = (url, context, nextLoad) => {
		if (!url.startsWith("file:")) return nextLoad(url, context);
		const file = path.resolve(fileURLToPath(url));
		if (!file.startsWith(distPrefix)) return nextLoad(url, context);
		const source = readFileSync(file);
		if (expectedFiles.get(file) !== createHash("sha256").update(source).digest("hex"))
			throw new Error(`paired Protocol resolver refuses changed or unvalidated dist file: ${path.basename(file)}`);
		return { format: "module", source, shortCircuit: true };
	};
	registerHooks({ load: loadPairedProtocol, resolve: resolvePairedProtocol });
}
