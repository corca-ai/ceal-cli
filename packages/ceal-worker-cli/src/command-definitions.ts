export interface CealCommandDefinition {
	name: "version" | "commands" | "update" | "guide" | "capabilities" | "session" | "call" | "receipt" | "observe" | "acceptance";
	description: string;
	usage: string;
	/**
	 * What a route changes, and it is the only machine-readable safety field an
	 * operator or an agent is told to read before typing one.
	 *
	 * `remote_write` is here because the vocabulary used to stop at this machine.
	 * Everything a route could do to the Gateway or to a provider had to be
	 * spelled `read_only` or `local_write`, so `call` — the one route that
	 * executes a governed provider capability — declared the same effect as
	 * `version`, and `session logout` declared the same effect as linking a guide
	 * symlink. The incident that created this field was a state change hiding in
	 * a batch of read-only spot checks; a vocabulary that cannot name a remote
	 * change encodes half of that lesson and leaves the rest to prose.
	 *
	 * The classification is what a route MAY do, never what a particular
	 * invocation happens to do. `call` is `remote_write` even for a capability
	 * whose own effect is `read`: the route cannot promise which capability it
	 * will be handed, and a field that is right most of the time is one nobody
	 * can act on.
	 */
	effect: "read_only" | "local_write" | "read_only_or_local_write" | "remote_write";
	evidence: "surface" | "surface_or_host_decision";
	result_schema: string;
	recovery: string;
}

export const CEAL_CREDENTIAL_CONTEXT = "gateway_issued_client_session" as const;

export const CEAL_COMMANDS: readonly CealCommandDefinition[] = [
	{
		name: "version",
		description: "Show CLI and protocol versions.",
		usage: "ceal version",
		effect: "read_only",
		evidence: "surface",
		result_schema: "ceal.version.v1",
		recovery: "Run 'ceal version' again after installing or updating the CLI.",
	},
	{
		name: "commands",
		description: "Discover worker-facing commands.",
		usage: "ceal commands",
		effect: "read_only",
		evidence: "surface",
		result_schema: "ceal.commands.v1",
		recovery: "Descend with 'ceal <command> --help' before invoking a command.",
	},
	{
		name: "update",
		description: "Install the latest stable signed worker release into this local prefix.",
		usage: "ceal update",
		effect: "local_write",
		evidence: "surface",
		result_schema: "ceal.update.v1",
		recovery: "Reinstall an explicitly approved signed worker release if this installed CLI cannot update itself.",
	},
	{
		name: "session",
		description: "Enroll an approved client device and inspect its renewable Gateway session.",
		usage:
			"ceal session [status | enroll --gateway <https-url> [--code-stdin] [--force] | adopt --gateway <https-url> --email <address> [--force] | logout]",
		// The widest of its children. Enrolling and adopting consume a one-time
		// approval at the Gateway and logging out revokes a live session there;
		// none of the three is undone by deleting a local file.
		effect: "remote_write",
		evidence: "surface_or_host_decision",
		result_schema: "ceal.client_session.v1",
		recovery: "Ask the organization administrator to confirm approved access and issue a replacement device-enrollment code, then retry.",
	},
	{
		name: "guide",
		description: "Inspect or register the signed agent guide for this installed Ceal release.",
		usage: "ceal guide [status | register codex | register claude]",
		effect: "read_only_or_local_write",
		evidence: "surface",
		result_schema: "ceal.guide.v1",
		recovery: "Run 'ceal guide status', then register only through an explicitly supported local agent host.",
	},
	{
		name: "capabilities",
		description: "Discover Gateway-issued capabilities and select bounded targets.",
		usage:
			"ceal capabilities [--profile <profile-ref>] [--fresh] [--detail] | ceal capabilities targets [--profile <profile-ref>] --capability <id> [--match <text-or-url> | --cursor <opaque>] [--limit <1-64>]",
		effect: "read_only",
		evidence: "surface_or_host_decision",
		result_schema: "ceal.capabilities.v1",
		recovery: "Configure a Gateway-issued client session, then run 'ceal capabilities' and descend to a bounded target selection.",
	},
	{
		name: "call",
		description: "Invoke an approved capability and read back its Gateway audit event.",
		usage: "ceal call <capability-id> --target <target-ref> [--profile <profile-ref>] [key=value ...]",
		// The one route that executes a governed provider capability. Some
		// capabilities only read, and the client does discover each capability's
		// own `read`/`write` effect — but that is per invocation, and this field
		// is read before the route is typed.
		effect: "remote_write",
		evidence: "surface_or_host_decision",
		result_schema: "ceal.result.v2",
		recovery:
			"Run 'ceal capabilities', then select a target for that same capability with 'ceal capabilities targets --capability <capability-id>'. Do not mix a target returned for another capability.",
	},
	{
		name: "receipt",
		description: "Inspect safe Gateway evidence for one audited capability call outcome.",
		usage: "ceal receipt show <request-ref> [--profile <profile-ref>]",
		effect: "read_only",
		evidence: "surface_or_host_decision",
		result_schema: "ceal.receipt.v1",
		recovery:
			"Use the 'receipt.request_ref' a call returned; a reference with no audited outcome answers 'audit_event_not_found' until the Gateway records one.",
	},
	{
		name: "observe",
		description: "Serve a loopback-only read-only page over this client's cached local state.",
		usage: "ceal observe [--port <0|1024-65535>]",
		effect: "read_only",
		evidence: "surface",
		result_schema: "ceal.observe.v1",
		recovery: "Open the printed 127.0.0.1 URL in a local browser; stop the observer with Ctrl-C.",
	},
	{
		name: "acceptance",
		description: "Emit installed-client acceptance evidence for this exact installed release.",
		usage: "ceal acceptance emit [--request-ref <ref>] [--profile <profile-ref>]",
		effect: "read_only",
		evidence: "surface_or_host_decision",
		result_schema: "ceal.worker_acceptance_result.v2",
		recovery:
			"Run 'ceal capabilities --fresh' to confirm the session, then re-run; an installed release is required and a build tree is refused.",
	},
];
