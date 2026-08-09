// Strict JSON parsing for the two private-mode transports, in one home.
//
// `JSON.parse` accepts a duplicate object key and silently keeps the last one,
// so a frame can decode to something other than what it reads as. Both private
// modes refuse that, and until 2026-08-09 both did it with their own copy of the
// same structural walk — identical text apart from one helper's name.
// `npm run lint:duplicate-literal` found the pair through the single regex
// literal they shared; nothing had ever compared the parser around it, which is
// what let two copies of a security-relevant validator sit in the tree.
//
// The byte ceiling is a parameter rather than a second function. The control
// session bounds every frame it parses; the carrier's callers bound the read
// upstream and pass none. One signature makes that difference a visible argument
// rather than a property of which file the reader happens to be in.

/**
 * Decode UTF-8 bytes as JSON, refusing what `JSON.parse` would accept and this
 * protocol does not: invalid UTF-8, a duplicate object key, trailing content,
 * and — only when `maximum` is given — an empty or oversized input.
 *
 * Throws `invalid_json` for every refusal. Callers translate that into their own
 * vocabulary; this module deliberately owns no error names beyond the one.
 */
export function parseStrictJson(bytes: Uint8Array, maximum?: number): unknown {
	if (maximum !== undefined && (bytes.byteLength === 0 || bytes.byteLength > maximum)) throw new Error("invalid_json");
	const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	const value = JSON.parse(text) as unknown;
	assertNoDuplicateJsonKeys(text);
	return value;
}

function assertNoDuplicateJsonKeys(text: string): void {
	let index = 0;
	const whitespace = () => {
		while (/\s/u.test(text[index] ?? "")) index += 1;
	};
	const string = () => {
		const start = index;
		if (text[index] !== '"') throw new Error("invalid_json");
		index += 1;
		while (index < text.length) {
			const character = text[index];
			if (character === "\\") index += 2;
			else {
				index += 1;
				if (character === '"') return JSON.parse(text.slice(start, index)) as string;
			}
		}
		throw new Error("invalid_json");
	};
	const value = (): void => {
		whitespace();
		if (text[index] === "{") {
			index += 1;
			const keys = new Set<string>();
			whitespace();
			if (text[index] === "}") {
				index += 1;
				return;
			}
			for (;;) {
				whitespace();
				const key = string();
				if (keys.has(key)) throw new Error("duplicate_json_key");
				keys.add(key);
				whitespace();
				if (text[index++] !== ":") throw new Error("invalid_json");
				value();
				whitespace();
				if (text[index] === "}") {
					index += 1;
					return;
				}
				if (text[index++] !== ",") throw new Error("invalid_json");
			}
		}
		if (text[index] === "[") {
			index += 1;
			whitespace();
			if (text[index] === "]") {
				index += 1;
				return;
			}
			for (;;) {
				value();
				whitespace();
				if (text[index] === "]") {
					index += 1;
					return;
				}
				if (text[index++] !== ",") throw new Error("invalid_json");
			}
		}
		if (text[index] === '"') {
			string();
			return;
		}
		const match = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/u.exec(text.slice(index));
		if (!match) throw new Error("invalid_json");
		index += match[0].length;
	};
	value();
	whitespace();
	if (index !== text.length) throw new Error("invalid_json");
}
