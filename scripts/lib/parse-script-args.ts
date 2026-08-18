// The release scripts all take the same argv shape — `--help`/`-h`, `--json`,
// zero or more boolean flags, and zero or more `--name value` pairs — and each
// had hand-written the same loop, including the same `argv[++index]` value read
// and the same two refusals.
//
// Keeping it one function means a grammar fix (a missing value, an unknown
// option, a duplicate) lands once rather than in whichever copies someone
// remembers. Two frozen scripts kept their own loops because importing a local
// module would have broken their sync to corca-ai/ceal; both are deleted, so
// there is no longer a sanctioned second copy of this grammar.

/**
 * Parses one release script's argv.
 *
 * @param argv arguments after the script path
 * @param spec.fail called as `fail("invalid_argument", message)`; must throw
 * @param spec.values map of `--option` to the options key its value lands in
 * @param spec.flags map of `--option` to the options key it sets true
 * @param spec.defaults starting options object, copied not shared
 * @param spec.valueMessage refusal when a value option has no value
 * @param spec.unknownMessage refusal for an unrecognized argument
 * @returns `{ help, json, options }`
 */
type ScriptFail = (code: "invalid_argument", message: string) => never;

export interface ScriptArgSpec {
	fail: ScriptFail;
	values?: Record<string, string>;
	flags?: Record<string, string>;
	defaults?: Record<string, unknown>;
	valueMessage: string;
	unknownMessage: string;
}

export interface ScriptArgs {
	help: boolean;
	json: boolean;
	options: Record<string, unknown>;
}

function requiredArgument(value: string | undefined, fail: ScriptFail, message: string): string {
	if (value === undefined) fail("invalid_argument", message);
	return value;
}

export function parseScriptArgs(argv: readonly string[], spec: ScriptArgSpec): ScriptArgs {
	const { fail, values = {}, flags = {}, defaults = {}, valueMessage, unknownMessage } = spec;
	const options = { ...defaults };
	let json = false;
	for (let index = 0; index < argv.length; index += 1) {
		const arg = requiredArgument(argv[index], fail, unknownMessage);
		if (arg === "--help" || arg === "-h") return { help: true, json, options };
		if (arg === "--json") {
			json = true;
			continue;
		}
		const flagKey = Object.hasOwn(flags, arg) ? flags[arg] : undefined;
		if (flagKey !== undefined) {
			options[flagKey] = true;
			continue;
		}
		const valueKey = Object.hasOwn(values, arg) ? values[arg] : undefined;
		if (valueKey !== undefined) {
			const value = argv[++index];
			// A missing value must not silently consume the next option: reading
			// `undefined` here is the whole reason this check exists.
			if (typeof value !== "string") fail("invalid_argument", valueMessage);
			options[valueKey] = value;
			continue;
		}
		fail("invalid_argument", unknownMessage);
	}
	return { help: false, json, options };
}
