export interface ParsedNamedOptions {
	values: Map<string, string>;
	flags: Set<string>;
	operands: string[];
}

type NamedOptionOutcome = "flag" | "value" | "unknown" | "invalid";

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
		const outcome = consumeNamedOption(option, options[index + 1], valueOptions, flagOptions, values, flags);
		if (outcome === "invalid") return null;
		if (outcome === "flag") continue;
		if (outcome === "value") {
			index += 1;
			continue;
		}
		if (option === "--" || option.startsWith("--")) return null;
		operands.push(option);
	}
	return { values, flags, operands };
}

function consumeNamedOption(
	option: string,
	following: string | undefined,
	valueOptions: ReadonlySet<string>,
	flagOptions: ReadonlySet<string>,
	values: Map<string, string>,
	flags: Set<string>,
): NamedOptionOutcome {
	if (flagOptions.has(option)) {
		if (flags.has(option)) return "invalid";
		flags.add(option);
		return "flag";
	}
	if (!valueOptions.has(option)) return "unknown";
	if (values.has(option) || !following) return "invalid";
	values.set(option, following);
	return "value";
}
