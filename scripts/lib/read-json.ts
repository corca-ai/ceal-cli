import { readFileSync } from "node:fs";

export type JsonReadFailure = (code: string, message: string) => never;
export type JsonReader = (filePath: string, code: string) => unknown;

/** Build a JSON reader while leaving the caller's error class and code policy in charge. */
export function createJsonReader(fail: JsonReadFailure, invalidMessage: string): JsonReader {
	return (filePath, code) => {
		try {
			const value: unknown = JSON.parse(readFileSync(filePath, "utf8"));
			return value;
		} catch {
			fail(code, invalidMessage);
		}
	};
}
