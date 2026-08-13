// npm 12 treats --json as a global option and returns an object keyed by package
// name; older supported npm releases returned an array. Decode both shapes.
export function npmPackArgs(...args) {
	return ["--json", "pack", ...args];
}

export function parseNpmPackMetadata(stdout, expectedName) {
	const decoded = JSON.parse(stdout);
	const candidates = Array.isArray(decoded) ? decoded : decoded && typeof decoded === "object" ? Object.values(decoded) : [];
	const metadata = expectedName ? candidates.find((candidate) => candidate?.name === expectedName) : candidates[0];
	if (!metadata || typeof metadata.name !== "string" || typeof metadata.filename !== "string") {
		throw new TypeError("npm pack metadata has no package identity");
	}
	return metadata;
}
