#!/usr/bin/env node

// The packed-consumer proofs install with `npm install --offline` so the proof
// itself can never reach the registry. Offline resolution needs the packument
// and tarball of every non-@corca dependency (including transitives such as
// undici-types) in the local npm cache. A checkout that only ran `npm ci` has
// tarballs keyed for lockfile replay but not offline range resolution, so a
// cold host (fresh CI runner, new laptop) fails with ENOTCACHED. This explicit
// online prewarm derives the exact name@version closure from the committed
// root package-lock.json and caches it once; run it after `npm ci` on a cold
// host, before `npm run check` or a release build.
//
// Every export here is pure so the closure can be tested without touching the
// network or the npm cache: the module used to run its whole walk at import
// time, which left the one script whose failure surfaces as a mid-release
// ENOTCACHED with no test at all.

import { isJsonRecord } from "../packages/ceal-worker-cli/src/json-record.ts";
import { isStringMap } from "./lib/string-map.ts";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONSUMER_MANIFESTS = ["packages/ceal-client/package.json", "packages/ceal-worker-cli/package.json"];
const OWNED_SCOPE = "@corca-ai/";
type DependencyField = "dependencies" | "devDependencies" | "optionalDependencies" | "peerDependencies";
const DEPENDENCY_FIELDS = [
	"dependencies",
	"devDependencies",
	"optionalDependencies",
	"peerDependencies",
] satisfies readonly DependencyField[];
const NPM_PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u;

type JsonRecord = Record<string, unknown>;
type PackageRecord = JsonRecord & { name?: string; version: string };
type Lockfile = { packages: JsonRecord };
type Manifest = JsonRecord;
type PackageIndex = Map<string, Map<string, PackageRecord>>;

// Every dependency field that can put a package into an install. `optional` is
// included deliberately: npm installs a matching optional dependency rather than
// skipping it, so an optional transitive that is absent from the cache fails an
// `--offline` install exactly like a required one. No package in today's closure
// declares one, which is precisely why omitting it would go unnoticed until a new
// transitive arrived.
function isPackageName(value: unknown): value is string {
	return typeof value === "string" && value.length <= 214 && NPM_PACKAGE_NAME.test(value);
}

function isPackageRecord(value: unknown): value is PackageRecord {
	return isJsonRecord(value) && typeof value.version === "string" && (value.name === undefined || isPackageName(value.name));
}

function isLockfile(value: unknown): value is Lockfile {
	return isJsonRecord(value) && isJsonRecord(value.packages);
}

function validateDependencyFields(record: JsonRecord, context: string): void {
	for (const field of DEPENDENCY_FIELDS) {
		const value = record[field];
		if (value !== undefined && !isStringMap(value)) throw new TypeError(`${context}.${field} must be an object of string ranges`);
	}
}

function dependencyNames(record: JsonRecord): string[] {
	validateDependencyFields(record, "dependency record");
	const names = new Set<string>();
	for (const field of DEPENDENCY_FIELDS) {
		const dependencies = record[field];
		if (isStringMap(dependencies)) for (const name of Object.keys(dependencies)) names.add(name);
	}
	return [...names];
}

/**
 * Indexes the lockfile by bare package name, keeping *every* pinned version.
 *
 * Keyed by name because that is what a dependency edge names, but a name can
 * appear at several nested locations with different versions. Keeping only the
 * first record silently cached one version and left the other uncached, so an
 * `--offline` install that resolved the other one failed as ENOTCACHED. There are
 * no such collisions in the committed lockfile today; this keeps that from being
 * load-bearing.
 */
export function lockPackages(lock: Lockfile): PackageIndex {
	if (!isJsonRecord(lock) || !isJsonRecord(lock.packages)) throw new TypeError("package-lock.json must contain a packages object");
	const byName: PackageIndex = new Map();
	for (const [location, value] of Object.entries(lock.packages)) {
		const marker = location.lastIndexOf("node_modules/");
		if (marker === -1) continue;
		const name = location.slice(marker + "node_modules/".length);
		if (!isPackageName(name)) throw new TypeError(`package-lock entry ${location} must contain a valid package name`);
		if (name.startsWith(OWNED_SCOPE)) continue;
		if (!isPackageRecord(value)) throw new TypeError(`package-lock entry ${location} must contain a version`);
		validateDependencyFields(value, `package-lock entry ${location}`);
		if (!byName.has(name)) byName.set(name, new Map());
		byName.get(name)?.set(value.version, value);
	}
	return byName;
}

/**
 * Returns the lockfile-owned package identity npm must fetch.
 *
 * An npm alias is indexed by its dependency/installation name, but lockfile
 * v3 records the resolved package name in `name`. Fetching the index name for
 * an alias asks npm for a package that does not exist (for example,
 * `@typescript/old@6.0.3` instead of `typescript@6.0.3`). Ordinary entries do
 * not carry `name`, so their index name remains the fetch identity.
 */
export function packageFetchIdentity(indexName: string, record: PackageRecord): { name: string; version: string } {
	if (!isPackageName(indexName) || !isPackageRecord(record))
		throw new TypeError("package-lock entry must contain a valid package name and version");
	return { name: record.name ?? indexName, version: record.version };
}

/**
 * The full non-@corca name@version set the consumer proofs can resolve against.
 *
 * @param byName index from `lockPackages`
 * @param manifests consumer manifests, as parsed objects
 * @returns array of `{ name, version }`, sorted for a stable log and diff
 */
export class UnpinnedDependencyError extends Error {
	readonly code = "unpinned_dependency" as const;
	readonly missing: string[];

	constructor(missing: string[]) {
		const sorted = [...missing].sort();
		super(`not pinned by package-lock.json: ${sorted.join(", ")}`);
		this.name = "UnpinnedDependencyError";
		this.missing = sorted;
	}
}

export function consumerDependencyClosure(byName: PackageIndex, manifests: readonly Manifest[]) {
	const queue: string[] = [];
	for (const manifest of manifests) {
		if (!isJsonRecord(manifest)) throw new TypeError("consumer manifest must be an object");
		for (const name of dependencyNames(manifest)) {
			if (!name.startsWith(OWNED_SCOPE)) queue.push(name);
		}
	}
	const visited = new Set<string>();
	const fetched = new Set<string>();
	const closure: Array<{ name: string; version: string }> = [];
	const missing: string[] = [];
	while (queue.length > 0) {
		const name = queue.shift();
		if (name === undefined) break;
		if (visited.has(name)) continue;
		visited.add(name);
		const versions = byName.get(name);
		if (!versions || versions.size === 0) {
			missing.push(name);
			continue;
		}
		// Walk every pinned version: each carries its own dependency edges, so
		// taking one version's edges for another's would miss packages entirely.
		for (const [, record] of versions) {
			const identity = packageFetchIdentity(name, record);
			if (identity.name.startsWith(OWNED_SCOPE)) continue;
			const identityKey = `${identity.name}\0${identity.version}`;
			if (!fetched.has(identityKey)) {
				fetched.add(identityKey);
				closure.push(identity);
			}
			for (const dependency of dependencyNames(record)) {
				if (!dependency.startsWith(OWNED_SCOPE)) queue.push(dependency);
			}
		}
	}
	if (missing.length > 0) {
		throw new UnpinnedDependencyError(missing);
	}
	closure.sort((left, right) => left.name.localeCompare(right.name) || left.version.localeCompare(right.version));
	return closure;
}

export function readConsumerClosure(root = ROOT) {
	const lockValue: unknown = JSON.parse(readFileSync(path.join(root, "package-lock.json"), "utf8"));
	if (!isLockfile(lockValue)) throw new TypeError("package-lock.json must contain a packages object");
	const manifests: Manifest[] = CONSUMER_MANIFESTS.map((relative) => {
		const value: unknown = JSON.parse(readFileSync(path.join(root, relative), "utf8"));
		if (!isJsonRecord(value)) throw new TypeError(`${relative} must contain a manifest object`);
		return value;
	});
	return consumerDependencyClosure(lockPackages(lockValue), manifests);
}

function main() {
	try {
		const closure = readConsumerClosure();
		for (const { name, version } of closure) {
			execFileSync("npm", ["cache", "add", `${name}@${version}`], { stdio: "inherit" });
		}
		console.log(`Prewarmed offline consumer cache: ${closure.map(({ name, version }) => `${name}@${version}`).join(", ")}`);
	} catch (error) {
		if (!(error instanceof UnpinnedDependencyError)) throw error;
		console.error(`prewarm: ${error.message}`);
		process.exit(1);
		return;
	}
}

// Importing this module must not reach the network, so the walk only runs when
// the file is the entry point.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
