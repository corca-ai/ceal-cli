import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";
import { buildIsolatedWorkspaceArtifacts, REPO_ROOT, sha256 } from "./artifact-workspace.ts";

let artifact: ReturnType<typeof buildIsolatedWorkspaceArtifacts>;
let checkoutBeforeArtifactBuild: string;
test.before(() => {
	checkoutBeforeArtifactBuild = checkoutDistFingerprint();
	artifact = buildIsolatedWorkspaceArtifacts({ includeWorker: true });
	assert.equal(checkoutDistFingerprint(), checkoutBeforeArtifactBuild, "isolated artifact build must not change checkout dist");
});
test.after(() => artifact?.cleanup());

function checkoutDistFingerprint() {
	const roots = ["ceal-protocol", "ceal-client", "ceal-worker-cli"].map((name) => path.join(REPO_ROOT, "packages", name, "dist"));
	const hash = createHash("sha256");
	for (const root of roots) {
		hash.update(`${root}:${existsSync(root)}\n`);
		if (!existsSync(root)) continue;
		const visit = (directory: string) => {
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
	assert.equal(checkoutDistFingerprint(), checkoutBeforeArtifactBuild);
});

test("isolated Protocol artifact proves its exact public export surface", async () => {
	const manifest = JSON.parse(readFileSync(path.join(artifact.protocol, "package.json"), "utf8"));
	assert.deepEqual(manifest.exports, {
		".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
		"./conformance": { types: "./dist/conformance.d.ts", import: "./dist/conformance.js" },
	});
	const root = await import(pathToFileURL(path.join(artifact.protocol, manifest.exports["."].import)).href);
	const conformance = await import(pathToFileURL(path.join(artifact.protocol, manifest.exports["./conformance"].import)).href);
	assert.equal(typeof root.decodeCealClientResponse, "function");
	assert.equal(typeof conformance.runCanonicalConformance, "function");
});

test("isolated worker artifact proves the public package and executable surface", async () => {
	const manifest = JSON.parse(readFileSync(path.join(artifact.worker, "package.json"), "utf8"));
	assert.deepEqual(manifest.exports, {
		".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
		"./session-store": { types: "./dist/profile-store.d.ts", import: "./dist/profile-store.js" },
	});
	assert.deepEqual(manifest.bin, { ceal: "./dist/bin.js" });
	const root = await import(pathToFileURL(path.join(artifact.worker, manifest.exports["."].import)).href);
	assert.equal(typeof root.runCealCommand, "function");
	const binPath = path.join(artifact.worker, manifest.bin.ceal);
	const binSource = readFileSync(binPath, "utf8");
	assert.match(binSource, /^#!\/usr\/bin\/env node/u);
	const emittedLibrary = readFileSync(path.join(artifact.worker, manifest.exports["."].import), "utf8");
	assert.doesNotMatch(emittedLibrary, /node:(?:fs|http|https|net)|process[.]env|\bHOME\b/u);
	const home = mkdtempSync(path.join(tmpdir(), "ceal-artifact-bin-"));
	try {
		const child = spawnSync(process.execPath, [binPath, "--help"], { encoding: "utf8", env: { ...process.env, HOME: home } });
		assert.equal(child.status, 0, child.stderr);
		assert.match(child.stdout, /Usage: ceal/u);
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
});

test("isolated worker executable keeps every static/private branch ahead of the public runtime failure handler", () => {
	const root = mkdtempSync(path.join(artifact.root, "output", "packages", "ceal-bin-fault-"));
	try {
		const stubDist = path.join(root, "dist");
		cpSync(path.join(artifact.worker, "dist"), stubDist, { recursive: true });
		cpSync(path.join(artifact.worker, "package.json"), path.join(root, "package.json"));
		const runtimeMarker = path.join(root, "full-runtime-loaded");
		const privateRuntimeMarker = path.join(root, "private-runtime-loaded");
		writeFileSync(
			path.join(stubDist, "index.js"),
			[
				'import { writeFileSync } from "node:fs";',
				`writeFileSync(${JSON.stringify(runtimeMarker)}, "loaded");`,
				`export * from ${JSON.stringify(pathToFileURL(path.join(artifact.worker, "dist", "index.js")).href)};`,
				'export function runCealCommand() { return Promise.reject(new Error("injected unexpected failure")); }',
			].join("\n"),
		);
		writeFileSync(
			path.join(stubDist, "private-bin-runtime.js"),
			[
				'import { writeFileSync } from "node:fs";',
				`writeFileSync(${JSON.stringify(privateRuntimeMarker)}, "loaded");`,
				"export function runPrivateCli() { return Promise.resolve(undefined); }",
			].join("\n"),
		);
		const home = path.join(root, "home");
		const runStub = (args: string[]) =>
			spawnSync(process.execPath, [path.join(stubDist, "bin.js"), ...args], {
				encoding: "utf8",
				env: { ...process.env, HOME: home },
			});
		for (const staticArgs of [
			["--help"],
			["session", "enroll", "--gateway", "--help"],
			["commands"],
			["version"],
			["not-a-command"],
			["version", "unexpected"],
		]) {
			const result = runStub(staticArgs);
			assert.ok(result.status === 0 || result.status === 2, `${staticArgs.join(" ")}: ${result.stderr}`);
			assert.equal(existsSync(runtimeMarker), false, `${staticArgs.join(" ")} evaluated the full runtime`);
			assert.equal(existsSync(privateRuntimeMarker), false, `${staticArgs.join(" ")} evaluated the private runtime`);
		}
		const privateArg = JSON.parse(readFileSync(path.join(artifact.worker, "leased-consumer-carrier-contract.json"), "utf8")).argv[0];
		assert.equal(runStub([privateArg]).status, 2, "the marker stub deliberately declines the private request");
		assert.equal(existsSync(privateRuntimeMarker), true, "the contract-derived private argv must evaluate its private runtime");
		assert.equal(existsSync(runtimeMarker), false, "a private argv must not evaluate the public runtime");
		const failed = spawnSync(process.execPath, [path.join(stubDist, "bin.js"), "capabilities"], {
			encoding: "utf8",
			env: { ...process.env, HOME: home },
		});
		assert.equal(failed.status, 3, failed.stderr);
		assert.equal(existsSync(runtimeMarker), true);
		const payload = parse(failed.stdout);
		assert.equal(payload.schema_version, "ceal.error.v1");
		assert.equal(payload.ok, false);
		assert.equal(payload.status, "error");
		assert.equal(payload.error.kind, "unexpected_failure");
		assert.equal(typeof payload.error.next_action, "string");
		assert.doesNotMatch(failed.stdout, /injected/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
