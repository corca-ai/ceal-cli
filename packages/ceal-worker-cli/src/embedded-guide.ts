import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { getRawAsset, isSea } from "node:sea";
import { fileURLToPath } from "node:url";

// The native builder binds the complete skill directory to this SEA asset.
// Release packaging passes the same name into the SEA config and the native
// smoke executes `guide status`, so a packaging/runtime spelling drift fails
// before publication rather than producing a signed binary with no guide.
const CEAL_EMBEDDED_GUIDE_ASSET = "ceal-guide.tar";
const CEAL_SOURCE_REPOSITORY_PACKAGE = "@corca-ai/ceal-cli-repository";
const CEAL_SOURCE_GUIDE_RELATIVE_PATH = "skills/ceal-guide";

/**
 * Read the guide carried by the signed native binary, without materializing it.
 * `undefined` means this is a normal non-SEA development runtime; `null` means
 * a SEA binary is missing its required canonical directory carrier and must not
 * fall back to the legacy compatibility projection beside it.
 */
export function readEmbeddedCealGuideBundle(): Uint8Array | null | undefined {
	if (!isSea()) return undefined;
	try {
		return new Uint8Array(getRawAsset(CEAL_EMBEDDED_GUIDE_ASSET));
	} catch {
		return null;
	}
}

/**
 * Resolve the canonical guide for a checkout-built, non-SEA Worker.
 *
 * A source run has no signed SEA asset and must not pretend that the Node
 * executable is an installed Worker generation. The exact private repository
 * package marker keeps this development carrier from becoming a generic
 * cwd-relative or environment-selected guide import in an installed package.
 * SEA binaries return undefined here even when a source checkout happens to be
 * adjacent to them: a missing signed carrier remains fail-closed.
 */
export function readDevelopmentCealGuidePath(): string | undefined {
	if (isSea()) return undefined;
	const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
	try {
		const packageJson: unknown = JSON.parse(readFileSync(path.join(repositoryRoot, "package.json"), "utf8"));
		const packageRecord = packageJson !== null && typeof packageJson === "object" ? (packageJson as Record<string, unknown>) : undefined;
		if (packageRecord === undefined || packageRecord.name !== CEAL_SOURCE_REPOSITORY_PACKAGE || packageRecord.private !== true)
			return undefined;
		const guidePath = path.join(repositoryRoot, CEAL_SOURCE_GUIDE_RELATIVE_PATH);
		const guideStat = lstatSync(guidePath);
		const skillStat = lstatSync(path.join(guidePath, "SKILL.md"));
		if (!guideStat.isDirectory() || guideStat.isSymbolicLink() || !skillStat.isFile() || skillStat.isSymbolicLink()) return undefined;
		return realpathSync(guidePath);
	} catch {
		return undefined;
	}
}
