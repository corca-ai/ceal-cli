import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TSC = join(REPO_ROOT, "node_modules", "typescript", "bin", "tsc");

function compile(packageName, artifactRoot, paths = undefined) {
	const checkoutRoot = join(REPO_ROOT, "packages", packageName);
	const sourceRoot = join(artifactRoot, "input", "packages", packageName);
	const packageRoot = join(artifactRoot, "output", "packages", packageName);
	mkdirSync(sourceRoot, { recursive: true });
	mkdirSync(packageRoot, { recursive: true });
	cpSync(join(checkoutRoot, "src"), join(sourceRoot, "src"), { recursive: true });
	for (const name of ["package.json", "tsconfig.json", "tsconfig.build.json"]) cpSync(join(checkoutRoot, name), join(sourceRoot, name));
	cpSync(join(checkoutRoot, "package.json"), join(packageRoot, "package.json"));
	const config = join(artifactRoot, `${packageName}.tsconfig.json`);
	writeFileSync(
		config,
		`${JSON.stringify(
			{
				extends: join(sourceRoot, "tsconfig.build.json"),
				compilerOptions: {
					outDir: join(packageRoot, "dist"),
					tsBuildInfoFile: join(artifactRoot, ".cache", `${packageName}.tsbuildinfo`),
					typeRoots: [join(REPO_ROOT, "node_modules", "@types")],
					types: ["node"],
					...(paths ? { baseUrl: artifactRoot, paths } : {}),
				},
			},
			null,
			2,
		)}\n`,
	);
	const result = spawnSync(process.execPath, [TSC, "-p", config], { cwd: artifactRoot, encoding: "utf8" });
	if (result.error || result.status !== 0) {
		throw result.error ?? new Error(`isolated ${packageName} artifact build failed (${result.status})\n${result.stdout}\n${result.stderr}`);
	}
	return packageRoot;
}

export function buildIsolatedClientArtifact() {
	const root = mkdtempSync(join(tmpdir(), "ceal-cli-artifact-"));
	try {
		const protocol = compile("ceal-protocol", root);
		const client = compile("ceal-client", root, {
			"@corca-ai/ceal-protocol": [join(protocol, "dist", "index.d.ts")],
		});
		const scope = join(root, "output", "node_modules", "@corca-ai");
		mkdirSync(scope, { recursive: true });
		symlinkSync(protocol, join(scope, "ceal-protocol"), "dir");
		return {
			root,
			client,
			protocol,
			provenance: {
				client_source_sha256: sha256(readFileSync(join(REPO_ROOT, "packages", "ceal-client", "src", "index.ts"))),
				client_artifact_sha256: sha256(readFileSync(join(client, "dist", "index.js"))),
			},
			cleanup: () => rmSync(root, { recursive: true, force: true }),
		};
	} catch (error) {
		rmSync(root, { recursive: true, force: true });
		throw error;
	}
}

export function sha256(bytes) {
	return createHash("sha256").update(bytes).digest("hex");
}
