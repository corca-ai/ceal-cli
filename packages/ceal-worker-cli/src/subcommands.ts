import { type CealCommandDefinition, SESSION_SETUP_NEXT_ACTION } from "./command-definitions.js";

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
		route: ["status"],
		description: "Inspect this host's locally stored Gateway session without contacting the Gateway.",
		usage: "ceal session status",
		effect: "read_only",
		evidence: "surface",
		result_schema: "ceal.client_session.v1",
		recovery: `${SESSION_SETUP_NEXT_ACTION} If a session is configured, run 'ceal capabilities' for live Gateway proof.`,
	},
	{
		parent: "session",
		route: ["refresh"],
		description: "Explicitly rotate the stored Gateway session's one-time refresh credential.",
		usage: "ceal session refresh",
		effect: "remote_write",
		evidence: "surface_or_host_decision",
		result_schema: "ceal.session_refresh.v1",
		recovery: `${SESSION_SETUP_NEXT_ACTION} If a session is configured, retry 'ceal session refresh' after correcting the reported local state.`,
		notes: [
			"This is the only worker readback-adjacent action that explicitly rotates",
			"the stored one-time refresh credential. Discovery routes never refresh it",
			"implicitly; after a stale access token, run this action deliberately.",
		],
	},
	{
		parent: "session",
		route: ["enroll"],
		description: "Exchange a pre-approved one-time device-enrollment code for a local session.",
		usage: "ceal session enroll --gateway <https-url> [--code-stdin] [--force]",
		// Exchanging the one-time code consumes it at the Gateway and creates a
		// session there; deleting the local store does not give the code back.
		effect: "remote_write",
		evidence: "surface_or_host_decision",
		result_schema: "ceal.session_enrollment.v1",
		recovery: "Ask the organization administrator to confirm approved access and issue a replacement device-enrollment code, then retry.",
		notes: [
			"The code is never a command operand: it is read through a hidden terminal",
			"prompt, or from stdin only for approved non-interactive automation.",
			"This home holds one session. Enrolling an identity that differs from the",
			"stored one is refused, names the bindings that changed, and revokes the",
			"session the attempt created; renewing the same identity needs no flag.",
		],
		options: [
			"  --gateway <https-url>   Gateway client endpoint that approved this device.",
			"  --code-stdin            Read the code from stdin only for non-interactive approved automation.",
			"  --force                 Replace a stored session that names a different identity, revoking it first.",
			"  (default)               On a safe terminal, prompt for the code with hidden input.",
		],
	},
	{
		parent: "session",
		route: ["adopt"],
		description: "Adopt this device using a verified mailbox, with no operator-issued code.",
		usage: "ceal session adopt --gateway <https-url> --email <address> [--force]",
		// Same remote effect as enroll, reached through a verified mailbox instead
		// of an operator-issued code.
		effect: "remote_write",
		evidence: "surface_or_host_decision",
		result_schema: "ceal.session_adoption.v1",
		recovery:
			"Run 'ceal session status' to confirm which identity this host holds. Every failure before the store is written leaves it untouched; only a '--force' replacement can end the stored session, and a failure after that says so in its own next action.",
		notes: [
			"The mailbox is verified by the employee in a browser. This command never opens",
			"the verifier, submits its form, or handles the mailbox token.",
			"This home holds one session. Adopting an identity that differs from the",
			"stored one is refused, names the bindings that changed, and revokes the",
			"session the attempt created; re-adopting the same identity needs no flag.",
			"Compare both printed fingerprints against the verification page before",
			"confirming. If either differs, stop.",
			"Device keys live in this process only. Interrupting the command discards them",
			"and requires a fresh adoption; nothing partial is left on disk.",
			"The wait is paced by the Gateway alone and stops at the challenge's expiry.",
		],
		options: [
			"  --gateway <https-url>   Gateway client endpoint your organization published.",
			"  --email <address>       Mailbox that received the invitation.",
			"  --force                 Replace a stored session that names a different identity, revoking it first.",
		],
	},
	{
		parent: "session",
		route: ["logout"],
		description: "Revoke the Gateway session, then remove local session and cached state.",
		usage: "ceal session logout",
		// Revokes the live Gateway session. This is the exact route whose
		// misclassification put a state change inside a batch of read-only spot
		// checks, which is why the effect field exists at all.
		effect: "remote_write",
		evidence: "surface_or_host_decision",
		result_schema: "ceal.session_logout.v1",
		recovery: "Run 'ceal session status' to confirm the local session is gone; a revoke failure preserves local state for a retry.",
	},
	{
		parent: "capabilities",
		route: ["targets"],
		description: "Select bounded targets for one capability with the stored access token.",
		usage:
			"ceal capabilities targets --capability <id> [--profile <profile-ref>] [--match <text-or-url> | --cursor <opaque>] [--limit <1-64>] [--detail]",
		effect: "read_only",
		evidence: "surface_or_host_decision",
		result_schema: "ceal.capabilities.v1",
		recovery:
			"Run 'ceal capabilities' to re-read current capability ids, re-select for that same capability, and continue one page only with the 'target_catalog.next_cursor' this route returned.",
		notes: [
			"The target query and its session handling are read-only. A stale access",
			"token is reported; run 'ceal session refresh' to rotate it explicitly.",
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
			"  --detail                Include full per-capability input contracts.",
		],
	},
	{
		parent: "receipt",
		route: ["show"],
		description: "Read safe Gateway audit evidence; a stale Gateway session may be renewed.",
		usage: "ceal receipt show <request-ref> [--profile <profile-ref>]",
		effect: "remote_write",
		evidence: "surface_or_host_decision",
		result_schema: "ceal.receipt.v1",
		recovery:
			"Use the request reference a 'ceal call' returned; while no audited outcome exists for it the Gateway answers 'audit_event_not_found'.",
		options: [
			"  <request-ref>           Request reference returned by a call, audited or rejected.",
			"  --profile <profile-ref> Select the Profile that issued the receipt request.",
		],
		notes: [
			"Receipt readback never invokes a provider. Its remote_write declaration is",
			"conservative because this route may renew the stored Gateway session first.",
		],
	},
	{
		parent: "acceptance",
		route: ["emit"],
		description: "Emit installed-client acceptance evidence; a stale Gateway session may be renewed.",
		usage: "ceal acceptance emit [--request-ref <ref>] [--profile <profile-ref>]",
		effect: "remote_write",
		evidence: "surface_or_host_decision",
		result_schema: "ceal.worker_acceptance_result.v2",
		recovery:
			"Run 'ceal capabilities --fresh' to confirm the session, then re-run; a build tree is refused because it is not an installed release.",
		notes: [
			"The evidence reads do not invoke a provider. The remote_write declaration",
			"is conservative because this route may renew the Gateway session first.",
			"Measures the running binary, so there is no --binary option to substitute.",
			"Performs a live discovery. It never performs a provider call; --request-ref reads back a receipt 'ceal call' already produced.",
			"Emits no filesystem paths, so the record describes an installation without locating one.",
		],
	},
] as const satisfies readonly CealSubcommandDefinition[];

export function subcommandsOf(parent: CealCommandName): readonly CealSubcommandDefinition[] {
	return CEAL_SUBCOMMANDS.filter((subcommand) => subcommand.parent === parent);
}

function findSubcommand(parent: CealCommandName, route: readonly string[]): CealSubcommandDefinition | undefined {
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
