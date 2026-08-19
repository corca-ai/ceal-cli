import { resolveWorkspaceSourceAuthority, WORKSPACE_PACKAGE_DIRECTORIES } from "../scripts/lib/workspace-source-authority.ts";
import { transformSync } from "esbuild";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { type LoadHookSync, registerHooks,type ResolveHookSync } from "node:module";
import { dirname, isAbsolute, join, relative as relativePath, resolve as resolvePath, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_REPO_ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = resolvePath(process.env.CEAL_SOURCE_TEST_REPO_ROOT ?? DEFAULT_REPO_ROOT);
const PACKAGES = new Map([
	["@corca-ai/ceal-protocol", "ceal-protocol"],
	["@corca-ai/ceal", "ceal-client"],
	["@corca-ai/ceal-worker-cli", "ceal-worker-cli"],
]);

const packageDirectories = new Set(PACKAGES.values());
if (
	packageDirectories.size !== WORKSPACE_PACKAGE_DIRECTORIES.length ||
	WORKSPACE_PACKAGE_DIRECTORIES.some((directory) => !packageDirectories.has(directory))
) {
	throw new Error("source-test package names drifted from workspace source authority");
}
const PACKAGE_SOURCE_ROOTS = WORKSPACE_PACKAGE_DIRECTORIES.map((directory) =>
	realpathSync(resolvePath(REPO_ROOT, "packages", directory, "src")),
);

function isEditablePackageSource(url: string): boolean {
	if (!url.startsWith("file:")) return false;
	const requested = fileURLToPath(url);
	if (!requested.endsWith(".ts")) return false;
	const file = realpathSync(requested);
	return PACKAGE_SOURCE_ROOTS.some((root) => {
		const relative = relativePath(root, file);
		return relative !== "" && relative !== ".." && !relative.startsWith(`..${sep}`) && !isAbsolute(relative);
	});
}

function packageSource(packageName: string, relativeSource = "index.ts"): string | null {
	const packageDirectory = PACKAGES.get(packageName);
	if (!packageDirectory) return null;
	const source = join(REPO_ROOT, "packages", packageDirectory, "src", relativeSource);
	if (!existsSync(source)) throw new Error(`source-test resolver could not resolve ${packageName}/${relativeSource}`);
	return pathToFileURL(source).href;
}

function mappedWorkspaceUrl(url: string): string | null {
	if (!url.startsWith("file:")) return null;
	const file = fileURLToPath(url);
	const source = resolveWorkspaceSourceAuthority(file, { repoRoot: REPO_ROOT });
	return source === file ? null : pathToFileURL(source).href;
}

function relativeTypeScriptUrl(specifier: string, parentURL: string | undefined): string | null {
	if (!parentURL?.startsWith("file:") || !specifier.startsWith(".") || !specifier.endsWith(".js")) return null;
	const candidate = fileURLToPath(new URL(specifier, parentURL));
	const source = resolveWorkspaceSourceAuthority(candidate, { repoRoot: REPO_ROOT });
	return source === candidate ? null : pathToFileURL(source).href;
}

export function resolveSourceTestSpecifier(specifier: string, parentURL: string | undefined): string | null {
	if (PACKAGES.has(specifier)) return packageSource(specifier);
	for (const [packageName] of PACKAGES) {
		if (!specifier.startsWith(`${packageName}/`)) continue;
		return packageSource(packageName, `${specifier.slice(packageName.length + 1)}.ts`);
	}
	const relativeTyped = relativeTypeScriptUrl(specifier, parentURL);
	if (relativeTyped) return relativeTyped;
	if (specifier.startsWith("file:")) return mappedWorkspaceUrl(specifier);
	if (parentURL?.startsWith("file:") && specifier.startsWith(".")) return mappedWorkspaceUrl(new URL(specifier, parentURL).href);
	return null;
}

const resolveSourceTest: ResolveHookSync = (specifier, context, nextResolve) => {
	const source = resolveSourceTestSpecifier(specifier, context.parentURL);
	if (source) return { url: source, shortCircuit: true };
	const resolved = nextResolve(specifier, context);
	if (mappedWorkspaceUrl(resolved.url)) {
		throw new Error(`source-test lane resolved through checkout dist: ${resolved.url}`);
	}
	return resolved;
};

const loadSourceTest: LoadHookSync = (url, context, nextLoad) => {
	if (!isEditablePackageSource(url)) return nextLoad(url, context);
	const source = readFileSync(fileURLToPath(url), "utf8");
	const transformed = transformSync(source, {
		format: "esm",
		loader: "ts",
		sourcemap: "inline",
		sourcefile: fileURLToPath(url),
		target: "node22",
	});
	return { format: "module", source: transformed.code, shortCircuit: true };
};

registerHooks({ resolve: resolveSourceTest, load: loadSourceTest });
