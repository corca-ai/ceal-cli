/**
 * The one declaration and projection for an acceptance receipt row.
 *
 * The installed emitter and the checkout acceptance script both consume this
 * built module. Keeping it narrow avoids making the whole acceptance-record
 * implementation a repository-script entry merely to share this schema fact.
 */
export const CEAL_ACCEPTANCE_RECEIPT_KEYS = Object.freeze([
	"readback_status",
	"gateway_audit_readback",
	"provider_state_readback",
	"outcome",
	"authorization",
	"audit_refs",
	"gateway_elapsed_ms",
	"exit_code",
	"elapsed_ms",
]);

export function projectAcceptanceReceipt(source: Record<string, unknown>): Record<string, unknown> {
	return Object.fromEntries(CEAL_ACCEPTANCE_RECEIPT_KEYS.map((key) => [key, source[key] ?? null]));
}
