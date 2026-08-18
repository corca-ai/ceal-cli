import { readFileSync, writeFileSync } from "node:fs";

/** Write generated text only when its bytes differ from the existing file. */
export function writeIfChanged(file: string, rendered: string): boolean {
	let prior: string | undefined;
	try {
		prior = readFileSync(file, "utf8");
	} catch {
		prior = undefined;
	}
	if (prior === rendered) return false;
	writeFileSync(file, rendered);
	return true;
}
