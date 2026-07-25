import type { CealCommandDefinition } from "./index.js";

export type CealCommandName = CealCommandDefinition["name"];

// A subcommand the dispatcher accepts is a leaf an agent is told to descend
// into, so it owes the same four-field contract as a top-level command. Keeping
// the children declarative next to `CEAL_COMMANDS` is what lets one gate assert
// "every advertised route renders its own Effect/Evidence/Result schema/
// Recovery" instead of patching help per route (issue #1).
export interface CealSubcommandDefinition {
	parent: CealCommandName;
	route: readonly string[];
	description: string;
	usage: string;
	effect: CealCommandDefinition["effect"];
	evidence: CealCommandDefinition["evidence"];
	result_schema: string;
	recovery: string;
	notes?: readonly string[];
	options?: readonly string[];
}

export const CEAL_SUBCOMMANDS: readonly CealSubcommandDefinition[] = [
	{
		parent: "guide",
		route: ["status"],
		description: "Inspect the signed guide and its Codex registration.",
		usage: "ceal guide status",
		effect: "read_only",
		evidence: "surface",
		result_schema: "ceal.guide.v1",
		recovery: "Reinstall a signed Ceal worker release, then run 'ceal guide status' again.",
	},
	{
		parent: "guide",
		route: ["register", "codex"],
		description: "Link the update-safe signed guide into the configured Codex skill directory.",
		usage: "ceal guide register codex",
		effect: "local_write",
		evidence: "surface",
		result_schema: "ceal.guide.v1",
		recovery: "Run 'ceal guide status' to read back the registration this command claims.",
	},
	{
		parent: "session",
		route: ["enroll"],
		description: "Exchange a pre-approved one-time device-enrollment code for a local session.",
		usage: "ceal session enroll --gateway <https-url> [--code-stdin]",
		effect: "local_write",
		evidence: "surface_or_host_decision",
		result_schema: "ceal.session_enrollment.v1",
		recovery: "Ask the organization administrator to confirm approved access and issue a replacement device-enrollment code, then retry.",
		notes: [
			"The code is never a command operand: it is read through a hidden terminal",
			"prompt, or from stdin only for approved non-interactive automation.",
		],
		options: [
			"  --gateway <https-url>   Gateway client endpoint that approved this device.",
			"  --code-stdin            Read the code from stdin only for non-interactive approved automation.",
			"  (default)               On a safe terminal, prompt for the code with hidden input.",
		],
	},
	{
		parent: "session",
		route: ["logout"],
		description: "Revoke the Gateway session, then remove local session and cached state.",
		usage: "ceal session logout",
		effect: "local_write",
		evidence: "surface_or_host_decision",
		result_schema: "ceal.session_logout.v1",
		recovery: "Run 'ceal session' to confirm the local session is gone; a revoke failure preserves local state for a retry.",
	},
	{
		parent: "capabilities",
		route: ["targets"],
		description: "Select bounded targets for one discovered capability.",
		usage: "ceal capabilities targets --capability <id> [--profile <profile-ref>] [--match <text-or-url> | --cursor <opaque>] [--limit <1-64>]",
		effect: "read_only",
		evidence: "surface_or_host_decision",
		result_schema: "ceal.capabilities.v1",
		recovery: "Run 'ceal capabilities' to re-read current capability ids, re-select for that same capability, and continue one page only with the 'target_catalog.next_cursor' this route returned.",
		notes: [
			"An unfiltered page is permitted: omit --match to request the Gateway's own",
			"bounded page, and constrain it with --limit <1-64>. The Gateway stays",
			"authoritative: when it needs a narrower selection it answers",
			"'target_catalog.selection_required' with no targets and no cursor, so follow",
			"the returned 'next_action' rather than assuming a page is always available.",
			"--match and --cursor are mutually exclusive. This route is always a live",
			"query and is never served from the client discovery cache; the catalog-only",
			"cache flag is rejected here.",
		],
		options: [
			"  --capability <id>       Capability returned by 'ceal capabilities'.",
			"  --profile <profile-ref> Select one assigned Profile for target discovery.",
			"  --match <text-or-url>   Select current target labels, or an approved source URL.",
			"  --cursor <opaque>       Continue one Gateway-issued selected target page.",
			"  --limit <1-64>          Bound one selected target page (default: Gateway choice).",
		],
	},
	{
		parent: "receipt",
		route: ["show"],
		description: "Read the caller's safe Gateway audit receipt for one completed call.",
		usage: "ceal receipt show <request-ref> [--profile <profile-ref>]",
		effect: "read_only",
		evidence: "surface_or_host_decision",
		result_schema: "ceal.receipt.v1",
		recovery: "Use the request reference returned by a completed 'ceal call', then retry after renewing the client session if needed.",
		options: [
			"  <request-ref>           Request reference returned by a completed call.",
			"  --profile <profile-ref> Select the Profile that issued the receipt request.",
		],
	},
];


export function subcommandsOf(parent: CealCommandName): readonly CealSubcommandDefinition[] {
	return CEAL_SUBCOMMANDS.filter((subcommand) => subcommand.parent === parent);
}

export function findSubcommand(parent: CealCommandName, route: readonly string[]): CealSubcommandDefinition | undefined {
	return subcommandsOf(parent).find((subcommand) => subcommand.route.length === route.length
		&& subcommand.route.every((token, index) => token === route[index]));
}

/**
 * Splits a command tail into the declared subcommand route its leading
 * positionals name and the options that follow it. Every runner resolves its
 * route through this one function, so a route the table does not declare is not
 * accepted anywhere — dispatch and help cannot disagree about which routes
 * exist, which is the invariant issue #1 was missing.
 */
export function splitSubcommandRoute(
	parent: CealCommandName, options: readonly string[],
): { subcommand?: CealSubcommandDefinition; rest: readonly string[] } {
	const leading: string[] = [];
	for (const option of options) {
		if (option.startsWith("-")) break;
		leading.push(option);
	}
	for (let length = leading.length; length > 0; length -= 1) {
		const subcommand = findSubcommand(parent, leading.slice(0, length));
		if (subcommand) return { subcommand, rest: options.slice(length) };
	}
	return { rest: options };
}
