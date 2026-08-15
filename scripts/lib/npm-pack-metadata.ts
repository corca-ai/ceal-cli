import path from "node:path";

export interface NpmPackMetadata {
	name: string;
	version: string;
	filename: string;
	integrity: string;
	shasum: string;
}

/** Parse the two npm pack --json shapes emitted by supported npm versions. */
export function parseNpmPackMetadata(input: unknown): NpmPackMetadata {
	const entry = extractEntry(input);
	const name = requiredString(entry, "name");
	const version = requiredString(entry, "version");
	const filename = requiredFilename(entry);
	const integrity = requiredString(entry, "integrity");
	const shasum = requiredString(entry, "shasum");
	if (!/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(integrity)) throw new Error("npm pack metadata integrity is malformed");
	if (!/^[a-f0-9]{40}$/iu.test(shasum)) throw new Error("npm pack metadata shasum is malformed");
	return { name, version, filename, integrity, shasum };
}

function extractEntry(input: unknown): Record<string, unknown> {
	if (Array.isArray(input)) {
		if (input.length !== 1) throw new Error("npm pack metadata must contain exactly one entry");
		return objectEntry(input[0]);
	}
	if (typeof input !== "object" || input === null) throw new Error("npm pack metadata must be an array or package map");
	const entries = Object.entries(input);
	if (entries.length !== 1) throw new Error("npm pack metadata package map must contain exactly one entry");
	const [key, value] = entries[0];
	const entry = objectEntry(value);
	if (entry.name !== key) throw new Error("npm pack metadata package key does not match name");
	return entry;
}

function objectEntry(value: unknown): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("npm pack metadata entry must be an object");
	return Object.fromEntries(Object.entries(value));
}

function requiredString(entry: Record<string, unknown>, key: string): string {
	const value = entry[key];
	if (typeof value !== "string" || value.length === 0) throw new Error(`npm pack metadata ${key} must be a non-empty string`);
	return value;
}

function requiredFilename(entry: Record<string, unknown>): string {
	const filename = requiredString(entry, "filename");
	if (filename !== path.basename(filename) || filename === "." || filename === ".." || path.isAbsolute(filename))
		throw new Error("npm pack metadata filename is unsafe");
	return filename;
}
