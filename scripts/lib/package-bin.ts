import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { asJsonRecord } from "./json-record.ts";

type JsonRecord = Record<string, unknown>;

/** Resolve a package's compiler bin without following links or leaving its root. */
export function resolvePackageBin(packageDirectory: string): string {
	const root = path.resolve(packageDirectory);
	let manifest: unknown;
	try {
		manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
	} catch {
		throw new Error("Package metadata is unavailable or invalid.");
	}
	const record = asJsonRecord(manifest);
	const bin = record?.bin;
	if (!record || !isObjectRecord(bin)) throw new Error("Package metadata must declare an object-form bin.");
	const entry = Object.entries(bin).find(
		(candidate): candidate is [string, string] => /^tsc\d*$/u.test(candidate[0]) && typeof candidate[1] === "string",
	);
	if (!entry) throw new Error("Package metadata does not declare a supported compiler entrypoint.");
	const relative = entry[1];
	if (path.isAbsolute(relative) || /^[A-Za-z]:[/]/u.test(relative) || relative.includes("\\"))
		throw new Error("Compiler entrypoint is unsafe.");
	const parts = relative.split("/");
	if (parts.some((part) => part === "" || part === "..")) throw new Error("Compiler entrypoint is unsafe.");
	const candidate = path.resolve(root, relative);
	const outside = path.relative(root, candidate);
	if (outside === "" || outside.startsWith(`..${path.sep}`) || path.isAbsolute(outside))
		throw new Error("Compiler entrypoint escapes its package.");
	assertNoSymlinks(root, candidate);
	let metadata: ReturnType<typeof lstatSync>;
	try {
		metadata = lstatSync(candidate);
	} catch {
		throw new Error("Compiler entrypoint is unavailable.");
	}
	if (!metadata.isFile()) throw new Error("Compiler entrypoint is not a regular file.");
	return candidate;
}

function assertNoSymlinks(root: string, target: string): void {
	let current = root;
	const components = path.relative(root, target).split(path.sep);
	for (const component of components) {
		let metadata: ReturnType<typeof lstatSync>;
		try {
			metadata = lstatSync(current);
		} catch {
			throw new Error("Compiler entrypoint is unavailable.");
		}
		if (metadata.isSymbolicLink()) throw new Error("Compiler entrypoint must not use symbolic links.");
		current = path.join(current, component);
	}
	let metadata: ReturnType<typeof lstatSync>;
	try {
		metadata = lstatSync(current);
	} catch {
		throw new Error("Compiler entrypoint is unavailable.");
	}
	if (metadata.isSymbolicLink()) throw new Error("Compiler entrypoint must not use symbolic links.");
}

export function isObjectRecord(value: unknown): value is JsonRecord {
	return asJsonRecord(value) !== undefined;
}
