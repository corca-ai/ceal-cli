import { createHash } from "node:crypto";

const BLOCK_SIZE = 512;
const MAX_BUNDLE_BYTES = 4 * 1024 * 1024;
const PORTABLE_COMPONENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const SUPPORTED_ROOTS = new Set(["agents", "assets", "references", "scripts"]);

interface CealGuideBundleFile {
	path: string;
	bytes: Uint8Array;
	mode: 0o644 | 0o755;
}

export interface CealGuideBundle {
	sha256: string;
	files: readonly CealGuideBundleFile[];
}

/**
 * Decode the deterministic ustar subset emitted by skill-directory-bundle.mjs.
 *
 * The binary signature already authenticates these bytes. This parser owns the
 * separate path/type boundary before explicit guide registration writes them to
 * disk: regular files only, portable relative paths, no duplicates, and one
 * root SKILL.md.
 */
export function decodeCealGuideBundle(input: Uint8Array): CealGuideBundle {
	const bytes = Buffer.from(input);
	if (bytes.length < BLOCK_SIZE * 2 || bytes.length > MAX_BUNDLE_BYTES || bytes.length % BLOCK_SIZE !== 0)
		throw new Error("invalid_guide_bundle");
	const files: CealGuideBundleFile[] = [];
	const seen = new Set<string>();
	let offset = 0;
	let endBlocks = 0;
	while (offset < bytes.length) {
		const header = bytes.subarray(offset, offset + BLOCK_SIZE);
		if (header.every((value) => value === 0)) {
			endBlocks += 1;
			offset += BLOCK_SIZE;
			continue;
		}
		if (endBlocks !== 0 || offset + BLOCK_SIZE > bytes.length) throw new Error("invalid_guide_bundle");
		if (header.subarray(257, 263).toString("ascii") !== "ustar\0" || header.subarray(263, 265).toString("ascii") !== "00")
			throw new Error("invalid_guide_bundle");
		const type = header[156];
		if (type !== 0 && type !== 0x30) throw new Error("invalid_guide_bundle");
		const expectedChecksum = parseOctal(header.subarray(148, 156));
		const checksumHeader = Buffer.from(header);
		checksumHeader.fill(0x20, 148, 156);
		if (checksumHeader.reduce((sum, value) => sum + value, 0) !== expectedChecksum) throw new Error("invalid_guide_bundle");
		const name = readString(header.subarray(0, 100));
		assertPortableGuidePath(name);
		if (seen.has(name)) throw new Error("invalid_guide_bundle");
		seen.add(name);
		const size = parseOctal(header.subarray(124, 136));
		const modeValue = parseOctal(header.subarray(100, 108));
		if (!Number.isSafeInteger(size) || size < 0 || (modeValue !== 0o644 && modeValue !== 0o755)) throw new Error("invalid_guide_bundle");
		const dataStart = offset + BLOCK_SIZE;
		const dataEnd = dataStart + size;
		if (dataEnd > bytes.length) throw new Error("invalid_guide_bundle");
		files.push({ path: name, bytes: Uint8Array.from(bytes.subarray(dataStart, dataEnd)), mode: modeValue });
		offset = dataStart + Math.ceil(size / BLOCK_SIZE) * BLOCK_SIZE;
	}
	if (endBlocks !== 2 || !seen.has("SKILL.md") || files.length !== seen.size) throw new Error("invalid_guide_bundle");
	return { sha256: createHash("sha256").update(bytes).digest("hex"), files };
}

function assertPortableGuidePath(value: string): void {
	if (!value || value.startsWith("/") || value.includes("\\")) throw new Error("invalid_guide_bundle");
	const components = value.split("/");
	if (components.some((component) => !PORTABLE_COMPONENT.test(component))) throw new Error("invalid_guide_bundle");
	if (components.length === 1) {
		if (components[0] !== "SKILL.md") throw new Error("invalid_guide_bundle");
		return;
	}
	if (!SUPPORTED_ROOTS.has(components[0]!)) throw new Error("invalid_guide_bundle");
}

function readString(bytes: Uint8Array): string {
	const nul = bytes.indexOf(0);
	return Buffer.from(bytes.subarray(0, nul === -1 ? bytes.length : nul)).toString("utf8");
}

function parseOctal(bytes: Uint8Array): number {
	const value = Buffer.from(bytes).toString("ascii").replace(/\0.*$/u, "").trim();
	if (!/^[0-7]+$/u.test(value)) throw new Error("invalid_guide_bundle");
	return Number.parseInt(value, 8);
}
