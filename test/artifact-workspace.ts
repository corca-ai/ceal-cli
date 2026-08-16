import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePackageBin } from "../scripts/lib/package-bin.ts";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TSC = resolvePackageBin(join(REPO_ROOT, "node_modules", "@typescript", "native"));

function compile(packageName: string, artifactRoot: string, paths?: Record<string, string[]>): string {
	const checkoutRoot = join(REPO_ROOT, "packages", packageName);
	const sourceRoot = join(artifactRoot, "input", "packages", packageName);
	const packageRoot = join(artifactRoot, "output", "packages", packageName);
	mkdirSync(sourceRoot, { recursive: true });
	mkdirSync(packageRoot, { recursive: true });
	cpSync(join(checkoutRoot, "src"), join(sourceRoot, "src"), { recursive: true });
	for (const name of ["package.json", "tsconfig.json", "tsconfig.build.json"]) cpSync(join(checkoutRoot, name), join(sourceRoot, name));
	cpSync(join(checkoutRoot, "package.json"), join(packageRoot, "package.json"));
	for (const name of ["leased-consumer-carrier-contract.json", "leased-consumer-control-session-contract.json"]) {
		const source = join(checkoutRoot, name);
		if (!existsSync(source)) continue;
		cpSync(source, join(sourceRoot, name));
		cpSync(source, join(packageRoot, name));
	}
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
					...(paths ? { paths } : {}),
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

type WorkspaceArtifacts = {
	root: string;
	client: string;
	protocol: string;
	worker: string | null;
	provenance: {
		client_source_sha256: string;
		client_artifact_sha256: string;
	};
	cleanup: () => void;
};

type WorkerWorkspaceArtifacts = Omit<WorkspaceArtifacts, "worker"> & { worker: string };

export function buildIsolatedWorkspaceArtifacts(options?: { includeWorker?: false }): WorkspaceArtifacts;
export function buildIsolatedWorkspaceArtifacts(options: { includeWorker: true }): WorkerWorkspaceArtifacts;
export function buildIsolatedWorkspaceArtifacts({ includeWorker = false }: { includeWorker?: boolean } = {}): WorkspaceArtifacts {
	const root = mkdtempSync(join(tmpdir(), "ceal-cli-artifact-"));
	try {
		const dependencies = join(root, "output", "node_modules");
		mkdirSync(dependencies, { recursive: true });
		symlinkSync(join(REPO_ROOT, "node_modules", "yaml"), join(dependencies, "yaml"), "dir");
		mkdirSync(join(root, "input", "node_modules"), { recursive: true });
		symlinkSync(join(REPO_ROOT, "node_modules", "yaml"), join(root, "input", "node_modules", "yaml"), "dir");
		const protocol = compile("ceal-protocol", root);
		const client = compile("ceal-client", root, {
			"@corca-ai/ceal-protocol": [join(protocol, "dist", "index.d.ts")],
		});
		const worker = includeWorker
			? compile("ceal-worker-cli", root, {
					"@corca-ai/ceal-protocol": [join(protocol, "dist", "index.d.ts")],
					"@corca-ai/ceal": [join(client, "dist", "index.d.ts")],
				})
			: null;
		const scope = join(root, "output", "node_modules", "@corca-ai");
		mkdirSync(scope, { recursive: true });
		symlinkSync(protocol, join(scope, "ceal-protocol"), "dir");
		symlinkSync(client, join(scope, "ceal"), "dir");
		return {
			root,
			client,
			protocol,
			worker,
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

export function buildIsolatedClientArtifact() {
	return buildIsolatedWorkspaceArtifacts();
}

export function sha256(bytes: Uint8Array) {
	return createHash("sha256").update(bytes).digest("hex");
}
