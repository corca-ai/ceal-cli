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
	/** Whether this route may renew the locally stored Gateway session as part of its work. */
	session_effect?: CealSessionEffect;
	/** Omitted commands settle on their own; this command serves until stopped. */
	lifecycle?: "until_interrupted";
	evidence: "surface" | "surface_or_host_decision";
	result_schema: string;
	recovery: string;
}

export type CealSessionEffect = "none" | "refresh_if_needed";

export type CealSessionRefreshOutcome = "none" | "refreshed" | "refresh_failed" | "quarantined";

export const CEAL_CREDENTIAL_CONTEXT = "gateway_issued_client_session" as const;

const SESSION_SETUP_ROUTE_CHOICES =
	"'ceal session enroll --help' for an operator-issued code or 'ceal session adopt --help' if you have a current verified-mailbox invitation";

export const SESSION_SETUP_NEXT_ACTION = `Run 'ceal session status'. If it is unconfigured, choose ${SESSION_SETUP_ROUTE_CHOICES}.`;

export const SESSION_REPLACEMENT_NEXT_ACTION = `Ask the organization administrator to approve a replacement session. Choose ${SESSION_SETUP_ROUTE_CHOICES}.`;

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
		recovery: "Retry the signed binary update; guide staging and registration are separate explicit local actions.",
	},
	{
		name: "session",
		description: "Enroll an approved client device, inspect it, and explicitly refresh its Gateway session.",
		usage:
			"ceal session [status | refresh | enroll --gateway <https-url> [--code-stdin] [--force] | adopt --gateway <https-url> --email <address> [--force] | logout]",
		// The widest of its children. Enrolling, adopting, and refreshing consume
		// Gateway-issued one-time credentials, while logging out revokes a live
		// session there; none of these remote actions is undone by deleting a local file.
		effect: "remote_write",
		evidence: "surface_or_host_decision",
		result_schema: "ceal.client_session.v1",
		recovery: SESSION_SETUP_NEXT_ACTION,
	},
	{
		name: "guide",
		description: "Inspect or register the Ceal guide available to this command runtime.",
		usage: "ceal guide [status | register codex | register claude]",
		effect: "read_only_or_local_write",
		evidence: "surface",
		result_schema: "ceal.guide.v1",
		recovery: "Run 'ceal guide status', then register only through an explicitly supported local agent host.",
	},
	{
		name: "capabilities",
		description: "Discover Gateway-issued capabilities and select bounded targets with connector/kind metadata and per-capability readiness.",
		usage:
			"ceal capabilities [--profile <profile-ref>] [--fresh] [--detail] | ceal capabilities targets [--profile <profile-ref>] --capability <id> [--match <selector> | --cursor <opaque>] [--limit <1-64>]",
		// Discovery remains read-only at the Gateway boundary, while a stale stored
		// access token is renewed through the existing locked session path before
		// the read begins. The two effects are intentionally independent.
		effect: "read_only",
		session_effect: "refresh_if_needed",
		evidence: "surface_or_host_decision",
		result_schema: "ceal.capabilities.v1",
		recovery: `${SESSION_SETUP_NEXT_ACTION} Then run 'ceal capabilities' and descend to a bounded target selection.`,
	},
	{
		name: "call",
		description: "Invoke a capability and read back its Gateway audit event.",
		usage: "ceal call <capability-id> --target <target-ref> [--profile <profile-ref>] [--approval-ref <ref>] [key=value ...]",
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
		description: "Inspect safe Gateway evidence for one audited call outcome with the stored access token.",
		usage: "ceal receipt show <request-ref> [--profile <profile-ref>]",
		// Receipt readback never refreshes the stored session. An expired or rejected
		// access token is reported, and `ceal session refresh` owns the rotation.
		effect: "read_only",
		evidence: "surface_or_host_decision",
		result_schema: "ceal.receipt.v1",
		recovery:
			"Use the 'receipt.request_ref' a call returned; if the stored access token is rejected, run 'ceal session refresh' and retry. A reference with no audited outcome answers 'audit_event_not_found' until the Gateway records one.",
	},
	{
		name: "observe",
		description: "Serve a loopback-only read-only page over this client's cached local state.",
		usage: "ceal observe [--port <0|1024-65535>]",
		effect: "read_only",
		lifecycle: "until_interrupted",
		evidence: "surface",
		result_schema: "ceal.observe.v1",
		recovery: "Open the printed 127.0.0.1 URL in a local browser; stop the observer with Ctrl-C.",
	},
	{
		name: "acceptance",
		description: "Emit installed-client acceptance evidence with the stored access token.",
		usage: "ceal acceptance emit [--request-ref <ref>] [--profile <profile-ref>]",
		// Acceptance evidence reads the installed release, live discovery, and an
		// optional prior receipt. It never rotates the stored session.
		effect: "read_only",
		evidence: "surface_or_host_decision",
		result_schema: "ceal.worker_acceptance_result.v2",
		recovery:
			"If the stored access token is rejected, run 'ceal session refresh', then re-run; an installed release is required and a build tree is refused.",
	},
];
