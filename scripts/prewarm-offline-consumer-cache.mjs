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

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONSUMER_MANIFESTS = ["packages/ceal-client/package.json", "packages/ceal-worker-cli/package.json"];
const OWNED_SCOPE = "@corca-ai/";

function lockPackages() {
	const lock = JSON.parse(readFileSync(path.join(ROOT, "package-lock.json"), "utf8"));
	const byName = new Map();
	for (const [location, record] of Object.entries(lock.packages ?? {})) {
		const marker = location.lastIndexOf("node_modules/");
		if (marker === -1) continue;
		const name = location.slice(marker + "node_modules/".length);
		if (!byName.has(name)) byName.set(name, record);
	}
	return byName;
}

function consumerDependencyClosure(byName) {
	const queue = [];
	for (const manifestPath of CONSUMER_MANIFESTS) {
		const manifest = JSON.parse(readFileSync(path.join(ROOT, manifestPath), "utf8"));
		for (const name of Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })) {
			if (!name.startsWith(OWNED_SCOPE)) queue.push(name);
		}
	}
	const closure = new Map();
	while (queue.length > 0) {
		const name = queue.shift();
		if (closure.has(name)) continue;
		const record = byName.get(name);
		if (!record?.version) {
			console.error(`prewarm: ${name} is not pinned by package-lock.json`);
			process.exit(1);
		}
		closure.set(name, record.version);
		for (const dependency of Object.keys({ ...record.dependencies, ...record.peerDependencies })) {
			if (!dependency.startsWith(OWNED_SCOPE)) queue.push(dependency);
		}
	}
	return closure;
}

const closure = consumerDependencyClosure(lockPackages());
for (const [name, version] of closure) {
	execFileSync("npm", ["cache", "add", `${name}@${version}`], { stdio: "inherit" });
}
console.log(`Prewarmed offline consumer cache: ${[...closure].map(([name, version]) => `${name}@${version}`).join(", ")}`);
