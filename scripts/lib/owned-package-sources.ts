// Which TypeScript modules the owned packages hold — one home for the walk two
// static checks need.
//
// `store-lock-census.ts` and `duplicate-literal.ts` ask different questions of
// the same file set, and each began with its own copy of this traversal. The
// duplicate ratchet caught that on the run that armed them, which is exactly the
// shape both checks exist to find: the fix for this class is the most reliable
// generator of the next instance of it. Having the traversal in one place also
// means a directory either check must skip is skipped by both.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

/** The packages this lane owns. `packages/ceal-protocol` is frozen and is not one. */
const OWNED_PACKAGE_SOURCE_ROOTS = ["packages/ceal-worker-cli/src", "packages/ceal-client/src"];

type OwnedPackageSourceOptions = {
	repoRoot: string;
	roots?: readonly string[];
	skipFile?: (name: string) => boolean;
};

type OwnedSourceVisitor = (relative: string, source: ts.SourceFile) => void;

function filesUnder(directory: string, skipFile: (name: string) => boolean): string[] {
	const found: string[] = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const absolute = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			// `generated/` is build output. A finding there names no editable site,
			// and it is the one directory both callers must ignore for that reason.
			if (entry.name !== "generated") found.push(...filesUnder(absolute, skipFile));
			continue;
		}
		if (entry.name.endsWith(".ts") && !skipFile(entry.name)) found.push(absolute);
	}
	return found;
}

/**
 * Absolute paths of every owned `.ts` module, sorted so a report's order is a
 * property of the tree rather than of the filesystem.
 *
 * A root that does not exist is skipped rather than thrown on, because both
 * callers are also run against scratch fixtures that hold only one package.
 */
function ownedPackageSources({ repoRoot, roots, skipFile = () => false }: OwnedPackageSourceOptions): string[] {
	const found: string[] = [];
	for (const relative of roots ?? OWNED_PACKAGE_SOURCE_ROOTS) {
		const directory = path.join(repoRoot, relative);
		if (!statSync(directory, { throwIfNoEntry: false })?.isDirectory()) continue;
		found.push(...filesUnder(directory, skipFile));
	}
	return found.sort();
}

/**
 * Parse each owned module once and hand the caller its repo-relative path and
 * its AST.
 *
 * Both static checks parse the same tree with the same settings, and the pair of
 * `createSourceFile` calls was the second duplicate the ratchet found between
 * them. The settings matter and are the reason this is shared rather than
 * retyped: `setParentNodes` must be true, because both checks walk *upwards*
 * from a node — to its enclosing function, to an enclosing guard call — and a
 * tree parsed without parents makes that walk silently find nothing rather than
 * fail.
 *
 * @param {(relative: string, source: import("typescript").SourceFile) => void} visit
 */
export function forEachOwnedSource({ repoRoot, roots, skipFile }: OwnedPackageSourceOptions, visit: OwnedSourceVisitor): string[] {
	const files = ownedPackageSources({ repoRoot, roots, skipFile });
	for (const absolute of files) {
		const relative = path.relative(repoRoot, absolute);
		visit(relative, ts.createSourceFile(relative, readFileSync(absolute, "utf8"), ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS));
	}
	return files.map((absolute) => path.relative(repoRoot, absolute));
}
