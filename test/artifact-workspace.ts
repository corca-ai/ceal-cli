import { sha256 } from "../packages/ceal-worker-cli/src/sha256.ts";
import { resolvePackageBin } from "../scripts/lib/package-bin.ts";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export { sha256 };

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TSC = resolvePackageBin(join(REPO_ROOT, "node_modules", "@typescript", "native"));

/**
 * Unpack the vendored Protocol archive into the artifact workspace instead of
 * compiling it.
 *
 * `compile` exists to prove that a package builds from ITS OWN source under a
 * clean program. That question does not apply to the Protocol any more: this
 * repository has no Protocol source, and the archive already carries the `dist`
 * a consumer resolves. Compiling a copy would prove something about a local
 * recompilation rather than about the bytes a release consumes.
 */
function unpackVendoredProtocol(artifactRoot: string): string {
	const lock = JSON.parse(readFileSync(join(REPO_ROOT, "gateway-protocol-handoff-lock.json"), "utf8"));
	const packageRoot = join(artifactRoot, "output", "packages", "ceal-protocol");
	mkdirSync(packageRoot, { recursive: true });
	const extracted = spawnSync(
		"tar",
		["-xzf", join(REPO_ROOT, "vendor", "ceal-protocol", lock.protocol.filename), "-C", packageRoot, "--strip-components=1"],
		{ encoding: "utf8" },
	);
	if (extracted.status !== 0) throw new Error(`vendored protocol archive could not be unpacked: ${extracted.stderr}`);
	return packageRoot;
}

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
					// Artifact builds execute under Node; keep the temporary program to ES2022 and Node types.
					outDir: join(packageRoot, "dist"),
					tsBuildInfoFile: join(artifactRoot, ".cache", `${packageName}.tsbuildinfo`),
					lib: ["ES2022"],
					skipLibCheck: true,
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
		const protocol = unpackVendoredProtocol(root);
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
