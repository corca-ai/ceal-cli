import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, join, relative, resolve as resolvePath, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { transformSync } from "esbuild";

const DEFAULT_REPO_ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = resolvePath(process.env.CEAL_SOURCE_TEST_REPO_ROOT ?? DEFAULT_REPO_ROOT);
const PACKAGES = new Map([
	["@corca-ai/ceal-protocol", "ceal-protocol"],
	["@corca-ai/ceal", "ceal-client"],
	["@corca-ai/ceal-worker-cli", "ceal-worker-cli"],
]);

function packageSource(packageName, relativeSource = "index.ts") {
	const packageDirectory = PACKAGES.get(packageName);
	if (!packageDirectory) return null;
	const source = join(REPO_ROOT, "packages", packageDirectory, "src", relativeSource);
	if (!existsSync(source)) throw new Error(`source-test resolver could not resolve ${packageName}/${relativeSource}`);
	return pathToFileURL(source).href;
}

function mappedWorkspaceUrl(url) {
	if (!url.startsWith("file:")) return null;
	const file = fileURLToPath(url);
	const packageRoot = join(REPO_ROOT, "packages");
	const packageRelative = relative(packageRoot, file);
	if (packageRelative.startsWith(`..${sep}`) || packageRelative === "..") return null;
	const [packageDirectory, tree, ...rest] = packageRelative.split(sep);
	if (![...PACKAGES.values()].includes(packageDirectory)) return null;
	if (tree === "dist") {
		if (rest.length === 0 || !rest.at(-1).endsWith(".js")) {
			throw new Error(`source-test lane refuses compiled workspace import ${url}`);
		}
		const source = join(packageRoot, packageDirectory, "src", ...rest);
		const typedSource = source.slice(0, -3) + ".ts";
		if (!existsSync(typedSource)) throw new Error(`source-test resolver found no source authority for ${url}`);
		return pathToFileURL(typedSource).href;
	}
	return null;
}

function relativeTypeScriptUrl(specifier, parentURL) {
	if (!parentURL?.startsWith("file:") || !specifier.startsWith(".") || !specifier.endsWith(".js")) return null;
	const candidate = fileURLToPath(new URL(specifier, parentURL));
	const typedSource = candidate.slice(0, -3) + ".ts";
	if (!existsSync(typedSource)) return null;
	return pathToFileURL(typedSource).href;
}

export function resolveSourceTestSpecifier(specifier, parentURL) {
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

registerHooks({
	resolve(specifier, context, nextResolve) {
		const source = resolveSourceTestSpecifier(specifier, context.parentURL);
		if (source) return { url: source, shortCircuit: true };
		const resolved = nextResolve(specifier, context);
		if (mappedWorkspaceUrl(resolved.url)) {
			throw new Error(`source-test lane resolved through checkout dist: ${resolved.url}`);
		}
		return resolved;
	},
	load(url, context, nextLoad) {
		if (!url.endsWith(".ts")) return nextLoad(url, context);
		const source = readFileSync(fileURLToPath(url), "utf8");
		const transformed = transformSync(source, {
			format: "esm",
			loader: "ts",
			sourcemap: "inline",
			sourcefile: fileURLToPath(url),
			target: "node22",
		});
		return { format: "module", source: transformed.code, shortCircuit: true };
	},
});
