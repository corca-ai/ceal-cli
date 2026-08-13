import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { buildIsolatedClientArtifact, REPO_ROOT, sha256 } from "./artifact-workspace.mjs";

function checkoutDistFingerprint() {
	const roots = ["ceal-protocol", "ceal-client"].map((name) => path.join(REPO_ROOT, "packages", name, "dist"));
	const hash = createHash("sha256");
	for (const root of roots) {
		hash.update(`${root}:${existsSync(root)}\n`);
		if (!existsSync(root)) continue;
		const visit = (directory) => {
			for (const name of readdirSync(directory).sort()) {
				const file = path.join(directory, name);
				const metadata = statSync(file);
				hash.update(`${path.relative(root, file)}:${metadata.mode}:${metadata.mtimeMs}\n`);
				if (metadata.isDirectory()) visit(file);
				else hash.update(readFileSync(file));
			}
		};
		visit(root);
	}
	return hash.digest("hex");
}

test("isolated client artifact proves emitted ABI and leaves checkout dist unchanged", async () => {
	const before = checkoutDistFingerprint();
	const artifact = buildIsolatedClientArtifact();
	try {
		const manifest = JSON.parse(readFileSync(path.join(artifact.client, "package.json"), "utf8"));
		assert.deepEqual(manifest.exports, { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } });
		assert.equal(manifest.main, "./dist/index.js");
		assert.equal(manifest.types, "./dist/index.d.ts");
		const declarations = readFileSync(path.join(artifact.client, "dist", "index.d.ts"), "utf8");
		const transportDeclarations = readFileSync(path.join(artifact.client, "dist", "http-transport.d.ts"), "utf8");
		assert.match(declarations, /request<I extends CealGatewayRequestInput>\([\s\S]*CealGatewayResponseFor<CealGatewayRequestForInput<I>>/u);
		assert.match(transportDeclarations, /send<R extends CealGatewayRequest>\([\s\S]*CealGatewayResponseFor<R>/u);
		assert.doesNotMatch(declarations, /\bTValue\b/u);
		const emitted = await import(pathToFileURL(path.join(artifact.client, manifest.exports["."].import)).href);
		assert.equal(typeof emitted.createCealClient, "function");
		assert.equal(
			artifact.provenance.client_source_sha256,
			sha256(readFileSync(path.join(REPO_ROOT, "packages", "ceal-client", "src", "index.ts"))),
		);
		assert.equal(artifact.provenance.client_artifact_sha256, sha256(readFileSync(path.join(artifact.client, "dist", "index.js"))));
	} finally {
		artifact.cleanup();
	}
	assert.equal(checkoutDistFingerprint(), before);
});
