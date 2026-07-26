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

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONSUMER_MANIFESTS = ["packages/ceal-client/package.json", "packages/ceal-worker-cli/package.json"];
const OWNED_SCOPE = "@corca-ai/";

// Every dependency field that can put a package into an install. `optional` is
// included deliberately: npm installs a matching optional dependency rather than
// skipping it, so an optional transitive that is absent from the cache fails an
// `--offline` install exactly like a required one. No package in today's closure
// declares one, which is precisely why omitting it would go unnoticed until a new
// transitive arrived.
const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];

function dependencyNames(record, fields) {
	const names = new Set();
	for (const field of fields) {
		for (const name of Object.keys(record?.[field] ?? {})) names.add(name);
	}
	return names;
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
export function lockPackages(lock) {
	const byName = new Map();
	for (const [location, record] of Object.entries(lock.packages ?? {})) {
		const marker = location.lastIndexOf("node_modules/");
		if (marker === -1) continue;
		const name = location.slice(marker + "node_modules/".length);
		if (!byName.has(name)) byName.set(name, new Map());
		if (record?.version) byName.get(name).set(record.version, record);
	}
	return byName;
}

/**
 * The full non-@corca name@version set the consumer proofs can resolve against.
 *
 * @param byName index from `lockPackages`
 * @param manifests consumer manifests, as parsed objects
 * @returns array of `{ name, version }`, sorted for a stable log and diff
 */
export function consumerDependencyClosure(byName, manifests) {
	const queue = [];
	for (const manifest of manifests) {
		for (const name of dependencyNames(manifest, DEPENDENCY_FIELDS)) {
			if (!name.startsWith(OWNED_SCOPE)) queue.push(name);
		}
	}
	const visited = new Set();
	const closure = [];
	const missing = [];
	while (queue.length > 0) {
		const name = queue.shift();
		if (visited.has(name)) continue;
		visited.add(name);
		const versions = byName.get(name);
		if (!versions || versions.size === 0) {
			missing.push(name);
			continue;
		}
		// Walk every pinned version: each carries its own dependency edges, so
		// taking one version's edges for another's would miss packages entirely.
		for (const [version, record] of versions) {
			closure.push({ name, version });
			for (const dependency of dependencyNames(record, DEPENDENCY_FIELDS)) {
				if (!dependency.startsWith(OWNED_SCOPE)) queue.push(dependency);
			}
		}
	}
	if (missing.length > 0) {
		const error = new Error(`not pinned by package-lock.json: ${missing.sort().join(", ")}`);
		error.code = "unpinned_dependency";
		error.missing = missing.sort();
		throw error;
	}
	closure.sort((left, right) => left.name.localeCompare(right.name) || left.version.localeCompare(right.version));
	return closure;
}

export function readConsumerClosure(root = ROOT) {
	const lock = JSON.parse(readFileSync(path.join(root, "package-lock.json"), "utf8"));
	const manifests = CONSUMER_MANIFESTS.map((relative) => JSON.parse(readFileSync(path.join(root, relative), "utf8")));
	return consumerDependencyClosure(lockPackages(lock), manifests);
}

function main() {
	let closure;
	try {
		closure = readConsumerClosure();
	} catch (error) {
		if (error?.code !== "unpinned_dependency") throw error;
		console.error(`prewarm: ${error.message}`);
		process.exit(1);
		return;
	}
	for (const { name, version } of closure) {
		execFileSync("npm", ["cache", "add", `${name}@${version}`], { stdio: "inherit" });
	}
	console.log(`Prewarmed offline consumer cache: ${closure.map(({ name, version }) => `${name}@${version}`).join(", ")}`);
}

// Importing this module must not reach the network, so the walk only runs when
// the file is the entry point.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
