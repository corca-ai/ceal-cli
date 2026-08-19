import { sha256 } from "../../packages/ceal-worker-cli/src/sha256.ts";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const BLOCK_SIZE = 512;
const ROOT_ENTRIES = new Set(["SKILL.md", "agents", "assets", "references", "scripts"]);
const PORTABLE_COMPONENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
type SkillFile = { path: string; bytes: Buffer; mode: number };
type SkillBundle = { bytes: Buffer; files: Array<{ path: string; bytes: number; sha256: string; mode: number }>; sha256: string };

/**
 * Build a byte-stable POSIX ustar archive from one complete skill directory.
 *
 * Release manifests and signatures bind the returned bytes. The archive stores
 * paths relative to the skill root so the installer can materialize the whole
 * directory at its update-safe `guide/` location without a second source list.
 */
export function createSkillDirectoryBundle(skillDirectory: string): SkillBundle {
	const root = path.resolve(skillDirectory);
	const files = collectFiles(root);
	if (!files.some((file) => file.path === "SKILL.md")) throw new Error("skill directory must contain a regular SKILL.md");
	const chunks = [];
	for (const file of files) {
		chunks.push(tarHeader(file.path, file.bytes.length, file.mode), file.bytes);
		const padding = (BLOCK_SIZE - (file.bytes.length % BLOCK_SIZE)) % BLOCK_SIZE;
		if (padding > 0) chunks.push(Buffer.alloc(padding));
	}
	chunks.push(Buffer.alloc(BLOCK_SIZE * 2));
	const bytes = Buffer.concat(chunks);
	return {
		bytes,
		files: files.map((file) => ({ path: file.path, bytes: file.bytes.length, sha256: sha256(file.bytes), mode: file.mode })),
		sha256: sha256(bytes),
	};
}

function collectFiles(root: string): SkillFile[] {
	const files: SkillFile[] = [];
	const visit = (directory: string, prefix: string): void => {
		for (const entry of readdirSync(directory).sort()) {
			if (!PORTABLE_COMPONENT.test(entry)) throw new Error(`skill bundle path is not portable: ${entry}`);
			const relative = prefix ? `${prefix}/${entry}` : entry;
			if (!prefix && !ROOT_ENTRIES.has(entry)) throw new Error(`skill bundle has an unsupported root entry: ${entry}`);
			if (Buffer.byteLength(relative) > 100) throw new Error(`skill bundle path is too long for ustar: ${relative}`);
			const absolute = path.join(directory, entry);
			const stat = lstatSync(absolute);
			if (stat.isSymbolicLink()) throw new Error(`skill bundle refuses symlink: ${relative}`);
			if (!prefix && entry === "SKILL.md" && !stat.isFile()) throw new Error("skill bundle SKILL.md must be a regular file");
			if (!prefix && entry !== "SKILL.md" && !stat.isDirectory())
				throw new Error(`skill bundle support root must be a directory: ${relative}`);
			if (stat.isDirectory()) {
				visit(absolute, relative);
				continue;
			}
			if (!stat.isFile()) throw new Error(`skill bundle refuses non-file: ${relative}`);
			files.push({ path: relative, bytes: readFileSync(absolute), mode: stat.mode & 0o111 ? 0o755 : 0o644 });
		}
	};
	visit(root, "");
	return files;
}

function tarHeader(name: string, size: number, mode: number): Buffer {
	const header = Buffer.alloc(BLOCK_SIZE);
	header.write(name, 0, 100, "utf8");
	writeOctal(header, 100, 8, mode);
	writeOctal(header, 108, 8, 0);
	writeOctal(header, 116, 8, 0);
	writeOctal(header, 124, 12, size);
	writeOctal(header, 136, 12, 0);
	header.fill(0x20, 148, 156);
	header[156] = 0x30;
	header.write("ustar\0", 257, 6, "ascii");
	header.write("00", 263, 2, "ascii");
	const checksum = header.reduce((sum, byte) => sum + byte, 0);
	const encoded = checksum.toString(8).padStart(6, "0");
	header.write(encoded, 148, 6, "ascii");
	header[154] = 0;
	header[155] = 0x20;
	return header;
}

function writeOctal(buffer: Buffer, offset: number, width: number, value: number): void {
	const encoded = value.toString(8).padStart(width - 1, "0");
	if (encoded.length >= width) throw new Error("skill bundle value exceeds ustar field");
	buffer.write(encoded, offset, width - 1, "ascii");
	buffer[offset + width - 1] = 0;
}
