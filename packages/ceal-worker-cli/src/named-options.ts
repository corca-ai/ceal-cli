export interface ParsedNamedOptions {
	values: Map<string, string>;
	flags: Set<string>;
	operands: string[];
}

/**
 * Parses the named-option part of one command grammar without assigning meaning
 * to its positional operands. Named options may appear anywhere in the argv
 * tail; each option may appear only once. `--` is intentionally not a delimiter
 * in this CLI contract, so it and every unknown option-looking token fail.
 */
export function parseNamedOptions(
	options: readonly string[], valueOptions: ReadonlySet<string>, flagOptions: ReadonlySet<string>,
): ParsedNamedOptions | null {
	const values = new Map<string, string>();
	const flags = new Set<string>();
	const operands: string[] = [];
	for (let index = 0; index < options.length; index += 1) {
		const option = options[index]!;
		if (flagOptions.has(option)) {
			if (flags.has(option)) return null;
			flags.add(option);
			continue;
		}
		if (valueOptions.has(option)) {
			if (values.has(option)) return null;
			const value = options[index + 1];
			if (!value || value.startsWith("--")) return null;
			values.set(option, value);
			index += 1;
			continue;
		}
		if (option === "--" || option.startsWith("--")) return null;
		operands.push(option);
	}
	return { values, flags, operands };
}
