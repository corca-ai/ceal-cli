import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
	buildWorkerReleasePackage,
	buildWorkerReleasePackageFromDevelopmentInputs,
	runCli,
	WorkerReleasePackageError,
} from "../scripts/build-worker-release-package.ts";
import { parseNpmPackMetadata } from "../scripts/lib/npm-pack-metadata.ts";
import { assertReleaseGuideArchive, assertReleaseManifestProvenance, execReleaseTestProcess } from "./release-process-bounds.ts";
import { packedProtocolFixture, ROOT } from "./worker-release-package-fixture.ts";

let packedFixture: {
	root: string;
	repoRoot: string;
	protocolTarball: string;
	protocolProvenance: string;
	controlConformance: string;
	handoffManifest: string;
	provenance: { artifact: { sha256: string } };
	expectedHandoffSha256: string;
};
type WorkerReleasePackageFixture = typeof packedFixture;
test.before((context) => {
	packedFixture = packedProtocolFixture(context);
});

test("worker package build stages recursive dependencies, consumes a packed Protocol, and emits no operator material", (context) => {
	const fixture = packedFixture;
	const output = path.join(fixture.root, "worker-package");
	const packageJsonPath = path.join(fixture.repoRoot, "node_modules", "typescript", "package.json");
	const nestedPackage = path.join(fixture.repoRoot, "node_modules", "ceal-release-fixture-nested");
	const original = readFileSync(packageJsonPath, "utf8");
	context.after(() => {
		writeFileSync(packageJsonPath, original);
		rmSync(nestedPackage, { recursive: true, force: true });
	});
	mkdirSync(nestedPackage, { recursive: true });
	writeFileSync(path.join(nestedPackage, "package.json"), `${JSON.stringify({ name: "ceal-release-fixture-nested", version: "1.0.0" })}\n`);
	const compilerManifest = readJsonRecord(original);
	compilerManifest.dependencies = { ...(asRecord(compilerManifest.dependencies) ?? {}), "ceal-release-fixture-nested": "1.0.0" };
	writeFileSync(packageJsonPath, `${JSON.stringify(compilerManifest)}\n`);
	let compilerCalls = 0;
	const result = buildWorkerReleasePackageFromDevelopmentInputs(
		{ outputDirectory: output, ...fixture },
		{
			runCompiler: (file, args, options) => {
				compilerCalls += 1;
				const typeRootsIndex = args.indexOf("--typeRoots");
				assert.ok(typeRootsIndex >= 0);
				const typeRoots = args[typeRootsIndex + 1];
				assert.equal(typeof typeRoots, "string");
				const dependencyRoot = path.dirname(typeRoots);
				assert.equal(
					readFileSync(path.join(dependencyRoot, "ceal-release-fixture-nested", "package.json"), "utf8").includes(
						'"name":"ceal-release-fixture-nested"',
					),
					true,
				);
				execFileSync(file, args, options);
			},
		},
	);
	assert.equal(compilerCalls, 2);
	assert.equal(result.ok, true);
	assert.deepEqual(result.consumer_smoke, {
		command: "ceal",
		installed_from_packed_archives: true,
		source_or_workspace_fallback_used: false,
	});
	assert.equal(result.artifact.path, undefined);
	assert.equal(result.client.package, "@corca-ai/ceal");
	assert.equal(result.client.version, result.version);
	assert.match(result.client.sha256, /^[a-f0-9]{64}$/u);
	const files = readdirSync(output).sort();
	assert.deepEqual(
		files,
		[
			".ceal-worker-release-package",
			"SHA256SUMS",
			"THIRD_PARTY_NOTICES.txt",
			"ceal-guide.tar",
			"ceal-worker-release-package-manifest.json",
			result.artifact.name,
		].sort(),
	);
	assert.equal(
		files.some((name) => name.includes("cealctl")),
		false,
	);
	const manifest = JSON.parse(readFileSync(path.join(output, "ceal-worker-release-package-manifest.json"), "utf8"));
	assertReleaseManifestProvenance(manifest, result, fixture.provenance.artifact.sha256);
	assertReleaseGuideArchive(manifest, output, "references/linked-private-context.md");
	const sums = readFileSync(path.join(output, "SHA256SUMS"), "utf8");
	for (const name of files.filter((name) => name !== ".ceal-worker-release-package" && name !== "SHA256SUMS")) {
		assert.equal(
			sums.split("\n").some((line) => /^[a-f0-9]{64} {2}/u.test(line) && line.endsWith(`  ${name}`)),
			true,
		);
	}
	const packedPaths = String(execReleaseTestProcess("tar", ["-tzf", path.join(output, result.artifact.name)], { encoding: "utf8" }));
	assert.match(packedPaths, /^package\/dist\/bin[.]js$/mu);
	assert.doesNotMatch(packedPaths, /(?:^|\/)src\//u);
	assert.doesNotMatch(packedPaths, /cealctl|operator/u);
});

// The compile failure used to report one sentence for every way tsc can fail,
// including the ways that are not about the source — an OOM kill read as "your
// TypeScript does not compile", and the diagnosis cost a re-run of the tier.
test("a failed worker compile carries the compiler's own output and its terminating signal", () => {
	const fixture = packedFixture;
	const output = path.join(fixture.root, "worker-package-compile-failure");
	const killed = Object.assign(new Error("Command failed"), {
		stdout: "src/index.ts(1,1): error TS2307: Cannot find module '@corca-ai/ceal-protocol'.",
		stderr: "",
		signal: "SIGKILL",
	});
	assert.throws(
		() =>
			buildWorkerReleasePackageFromDevelopmentInputs(
				{ outputDirectory: output, ...fixture },
				{
					runCompiler: () => {
						throw killed;
					},
				},
			),
		(error) =>
			error instanceof WorkerReleasePackageError &&
			error.code === "worker_package_build_failed" &&
			/SIGKILL/u.test(error.message) &&
			/TS2307/u.test(error.message),
	);
});

test("compiler rejects string-form TypeScript bin metadata", () => {
	const fixture = packedFixture;
	const packageJsonPath = path.join(fixture.repoRoot, "node_modules", "typescript", "package.json");
	const original = readFileSync(packageJsonPath, "utf8");
	try {
		const manifest = readJsonRecord(original);
		manifest.bin = "./bin/tsc6";
		writeFileSync(packageJsonPath, `${JSON.stringify(manifest)}\n`);
		assertMissingBuildDependency(fixture, "worker-package-string-bin");
	} finally {
		writeFileSync(packageJsonPath, original);
	}
});

test("recursive dependency staging fails closed for traversal and missing nested names", () => {
	const fixture = packedFixture;
	const packageJsonPath = path.join(fixture.repoRoot, "node_modules", "typescript", "package.json");
	const original = readFileSync(packageJsonPath, "utf8");
	for (const [dependency, version] of [
		["../escape", "*"],
		["@typescript/missing", "*"],
		["@typescript/old", null],
	] as const) {
		try {
			const manifest = readJsonRecord(original);
			manifest.dependencies = { ...(asRecord(manifest.dependencies) ?? {}), [dependency]: version };
			writeFileSync(packageJsonPath, `${JSON.stringify(manifest)}\n`);
			assertMissingBuildDependency(fixture, `worker-package-${dependency.replaceAll("/", "-")}`);
		} finally {
			writeFileSync(packageJsonPath, original);
		}
	}
});

test("npm pack metadata requires a non-empty version", () => {
	assert.throws(
		() =>
			parseNpmPackMetadata([
				{
					name: "@corca-ai/ceal",
					filename: "corca-ai-ceal.tgz",
					integrity: "sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
					shasum: "a".repeat(40),
				},
			]),
		/version/u,
	);
});

test("production package build accepts only the locked archive lane", (context) => {
	const root = realpathSync(mkdtempSync(path.join(tmpdir(), "ceal-worker-package-boundary-")));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	assert.throws(
		() =>
			buildWorkerReleasePackage({ repoRoot: ROOT, outputDirectory: path.join(root, "release-only"), protocolTarball: "/tmp/protocol.tgz" }),
		(error) => error instanceof WorkerReleasePackageError && error.code === "gateway_handoff_archive_required",
	);
	const messages: string[] = [];
	const io: Pick<Console, "log" | "error"> = {
		log: (message: unknown) => messages.push(String(message)),
		error: (message: unknown) => messages.push(String(message)),
	};
	assert.equal(runCli(["--out", path.join(root, "cli"), "--protocol-tarball", "/tmp/protocol.tgz", "--json"], io), 2);
	const cliMessage = messages.pop();
	if (cliMessage === undefined) throw new Error("expected CLI error message");
	assert.equal(readJsonRecord(cliMessage).error_code, "invalid_argument");
});

function readJsonRecord(value: string): Record<string, unknown> {
	const parsed: unknown = JSON.parse(value);
	const record = asRecord(parsed);
	if (!record) throw new Error("expected JSON object");
	return record;
}

function assertMissingBuildDependency(fixture: WorkerReleasePackageFixture, outputName: string): void {
	assert.throws(
		() =>
			buildWorkerReleasePackageFromDevelopmentInputs({
				outputDirectory: path.join(fixture.root, outputName),
				...fixture,
			}),
		(error) => error instanceof WorkerReleasePackageError && error.code === "missing_build_dependency",
	);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : undefined;
}
