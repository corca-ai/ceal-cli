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

// `as const satisfies` rather than a plain annotation: the annotation still holds
// (a malformed row is an error here, not at a call site), but the literal route
// tuples survive, and those literals are what `CealSubcommandRouteKey` turns into
// the compile-time exhaustiveness a runner's handler table must satisfy. Without
// them a table-only row type-checks and misroutes in the shipped binary.
export const CEAL_SUBCOMMANDS = [
	{
		parent: "guide",
		route: ["status"],
		description: "Inspect the signed guide and its registration in every supported agent host.",
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
		parent: "guide",
		route: ["register", "claude"],
		description: "Link the update-safe signed guide into the configured Claude Code skill directory.",
		usage: "ceal guide register claude",
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
		route: ["adopt"],
		description: "Adopt this device as a first device using a verified mailbox, with no operator-issued code.",
		usage: "ceal session adopt --gateway <https-url> --email <address>",
		effect: "local_write",
		evidence: "surface_or_host_decision",
		result_schema: "ceal.session_adoption.v1",
		recovery:
			"Run 'ceal session' to confirm whether a session exists; every failure of this command leaves the store untouched, so it is always safe to start again.",
		notes: [
			"The mailbox is verified by the employee in a browser. This command never opens",
			"the verifier, submits its form, or handles the mailbox token.",
			"Compare both printed fingerprints against the verification page before",
			"confirming. If either differs, stop.",
			"Device keys live in this process only. Interrupting the command discards them",
			"and requires a fresh adoption; nothing partial is left on disk.",
			"The wait is paced by the Gateway alone and stops at the challenge's expiry.",
		],
		options: [
			"  --gateway <https-url>   Gateway client endpoint your organization published.",
			"  --email <address>       Mailbox that received the invitation.",
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
		usage:
			"ceal capabilities targets --capability <id> [--profile <profile-ref>] [--match <text-or-url> | --cursor <opaque>] [--limit <1-64>]",
		effect: "read_only",
		evidence: "surface_or_host_decision",
		result_schema: "ceal.capabilities.v1",
		recovery:
			"Run 'ceal capabilities' to re-read current capability ids, re-select for that same capability, and continue one page only with the 'target_catalog.next_cursor' this route returned.",
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
		description: "Read the caller's safe Gateway audit receipt for one audited call outcome, including a rejected one.",
		usage: "ceal receipt show <request-ref> [--profile <profile-ref>]",
		effect: "read_only",
		evidence: "surface_or_host_decision",
		result_schema: "ceal.receipt.v1",
		recovery:
			"Use the request reference a 'ceal call' returned; while no audited outcome exists for it the Gateway answers 'audit_event_not_found'.",
		options: [
			"  <request-ref>           Request reference returned by a call, audited or rejected.",
			"  --profile <profile-ref> Select the Profile that issued the receipt request.",
		],
	},
	{
		parent: "acceptance",
		route: ["emit"],
		description: "Emit installed-client acceptance evidence for this exact installed release.",
		usage: "ceal acceptance emit [--request-ref <ref>] [--profile <profile-ref>]",
		effect: "read_only",
		evidence: "surface_or_host_decision",
		result_schema: "ceal.worker_acceptance_result.v1",
		recovery:
			"Run 'ceal capabilities --fresh' to confirm the session, then re-run; a build tree is refused because it is not an installed release.",
		notes: [
			"Measures the running binary, so there is no --binary option to substitute.",
			"Performs a live discovery. It never performs a provider call; --request-ref reads back a receipt 'ceal call' already produced.",
			"Emits no filesystem paths, so the record describes an installation without locating one.",
		],
	},
] as const satisfies readonly CealSubcommandDefinition[];

export function subcommandsOf(parent: CealCommandName): readonly CealSubcommandDefinition[] {
	return CEAL_SUBCOMMANDS.filter((subcommand) => subcommand.parent === parent);
}

export function findSubcommand(parent: CealCommandName, route: readonly string[]): CealSubcommandDefinition | undefined {
	return subcommandsOf(parent).find(
		(subcommand) => subcommand.route.length === route.length && subcommand.route.every((token, index) => token === route[index]),
	);
}

/**
 * Splits a command tail into the declared subcommand route its leading
 * positionals name and the options that follow it. Every runner resolves its
 * route through this one function, so a route the table does not declare is not
 * accepted anywhere — dispatch and help cannot disagree about which routes
 * exist, which is the invariant issue #1 was missing.
 */
export function splitSubcommandRoute(
	parent: CealCommandName,
	options: readonly string[],
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

/** The declared route as one key: `["register", "codex"]` becomes `register codex`. */
type JoinRoute<Route extends readonly string[]> = Route extends readonly [
	infer Head extends string,
	...infer Tail extends readonly string[],
]
	? Tail extends readonly []
		? Head
		: `${Head} ${JoinRoute<Tail>}`
	: never;

/** Every route key one parent declares, as a literal union read off the table. */
export type CealSubcommandRouteKey<Parent extends CealCommandName> = JoinRoute<
	Extract<(typeof CEAL_SUBCOMMANDS)[number], { parent: Parent }>["route"]
>;

/**
 * A runner's dispatch table: one handler per route the declaration advertises for
 * that parent. `Record` over the literal key union is the whole point — a route
 * added to `CEAL_SUBCOMMANDS` without a handler here fails `tsc`, which runs
 * inside `npm run build` and therefore inside both gates.
 */
export type CealSubcommandHandlers<Parent extends CealCommandName, Handler> = Readonly<Record<CealSubcommandRouteKey<Parent>, Handler>>;

/**
 * Resolves a command tail to the handler its *own* declared route names.
 *
 * This exists because every runner used to dispatch by testing one token and
 * falling through: `runSession` sent every non-`logout` route to enrollment and
 * `runGuide` sent every non-`register` route to status. Help, acceptance, and the
 * machine-readable inventory all derived from the table, so a new row passed
 * `check:unit` — which proves help and refusal, not routing — and then misrouted
 * in the shipped binary. Dispatch now derives from the same declaration.
 *
 * Declaring a route *under* an existing one is only safe where the shorter
 * route's first operand cannot collide with the new token: `splitSubcommandRoute`
 * prefers the longest declared prefix, so `receipt show all` would take that argv
 * away from `receipt show <request-ref>`, which accepts `all` as a reference. The
 * gate cannot see that — it is a naming decision, not a missing handler.
 */
export function resolveSubcommandRoute<Parent extends CealCommandName, Handler>(
	parent: Parent,
	options: readonly string[],
	handlers: CealSubcommandHandlers<Parent, Handler>,
): { subcommand: CealSubcommandDefinition; handler: Handler; rest: readonly string[] } | undefined {
	const { subcommand, rest } = splitSubcommandRoute(parent, options);
	if (!subcommand) return undefined;
	const handler = (handlers as Readonly<Record<string, Handler>>)[subcommandRouteKey(subcommand)];
	// Unreachable while the table above type-checks: `handlers` is total over this
	// parent's declared keys and `splitSubcommandRoute` returns only those rows.
	// Failing closed rather than throwing keeps the worst case an argument refusal.
	return handler === undefined ? undefined : { subcommand, handler, rest };
}

/** The runtime half of `JoinRoute`; the two must agree on the separator. */
export function subcommandRouteKey(subcommand: CealSubcommandDefinition): string {
	return subcommand.route.join(" ");
}
