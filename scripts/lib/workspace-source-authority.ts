import { existsSync } from "node:fs";
import path from "node:path";

export const WORKSPACE_PACKAGE_DIRECTORIES = Object.freeze(["ceal-protocol", "ceal-client", "ceal-worker-cli"]);

type WorkspaceSourceAuthorityOptions = {
	repoRoot: string;
	fileExists?: (file: string) => boolean;
};

type WorkspacePackageLocation = {
	packageRoot: string;
	packageDirectory: string;
	tree: string;
	rest: string[];
};

function insideWorkspacePackage(repoRoot: string, absolute: string): WorkspacePackageLocation | null {
	const packageRoot = path.join(repoRoot, "packages");
	const packageRelative = path.relative(packageRoot, absolute);
	if (packageRelative === ".." || packageRelative.startsWith(`..${path.sep}`) || path.isAbsolute(packageRelative)) return null;
	const [packageDirectory, tree, ...rest] = packageRelative.split(path.sep);
	if (packageDirectory === undefined || tree === undefined || !WORKSPACE_PACKAGE_DIRECTORIES.includes(packageDirectory)) return null;
	return { packageRoot, packageDirectory, tree, rest };
}

/**
 * Resolve an editable workspace module without consulting mutable checkout
 * build output. Paths outside the declared workspace package trees are
 * returned unchanged.
 */
export function resolveWorkspaceSourceAuthority(
	absolute: string,
	{ repoRoot, fileExists = existsSync }: WorkspaceSourceAuthorityOptions,
): string {
	const resolved = path.resolve(absolute);
	const location = insideWorkspacePackage(path.resolve(repoRoot), resolved);
	if (!location) return resolved;
	const { packageRoot, packageDirectory, tree, rest } = location;
	const last = rest.at(-1);
	if (tree === "dist" && (last === undefined || !last.endsWith(".js"))) {
		throw new Error(`workspace source authority refuses compiled import ${path.relative(repoRoot, resolved)}`);
	}
	if (tree !== "dist" && tree !== "src") return resolved;
	if (last === undefined || !last.endsWith(".js")) return resolved;

	const sourceRest = [...rest];
	sourceRest[sourceRest.length - 1] = `${last.slice(0, -3)}.ts`;
	const source = path.join(packageRoot, packageDirectory, "src", ...sourceRest);
	if (!fileExists(source)) {
		throw new Error(`workspace source authority is missing for ${path.relative(repoRoot, resolved)}`);
	}
	return source;
}
