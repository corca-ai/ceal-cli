// Low-level Ceal wire-protocol validation primitives: the typed validation
// error, material/secret regexes, safe-JSON and public-safe-text assertions,
// and the shared require* shape guards. Kept as a leaf module (no imports from
// the validator entry) so the entry file stays under its length budget.
import type { CealClientOperation } from "./gateway-response-types.js";

export type CealProtocolValidationErrorCode = "invalid_gateway_request" | "invalid_client_response";

export class CealProtocolValidationError extends Error {
	override readonly name = "CealProtocolValidationError";
	readonly code: CealProtocolValidationErrorCode;

	constructor(code: CealProtocolValidationErrorCode) {
		super(code === "invalid_gateway_request"
			? "Ceal Gateway request is invalid."
			: "Ceal client response is invalid.");
		this.code = code;
	}
}

export const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
export const SAFE_CODE = /^[a-z][a-z0-9_]{0,63}$/u;
export function isSafeCode(value: unknown): value is string { return typeof value === "string" && SAFE_CODE.test(value); }
const SAFE_CONNECTOR_KIND = /^[a-z][a-z0-9-]{0,63}$/u;
const SAFE_TARGET_KIND = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+){0,7}$/u;
export function isSafeConnectorKind(value: unknown): value is string { return typeof value === "string" && SAFE_CONNECTOR_KIND.test(value); }
export function isSafeTargetKind(value: unknown): value is string { return typeof value === "string" && value.length <= 64 && SAFE_TARGET_KIND.test(value); }
export const RAW_PROVIDER_REF = /(?:\b[CDGUW][A-Z0-9]{8,}\b|(?:slack|github|notion|google-workspace):[^\s"']+|[0-9]{10}[.][0-9]{4,})/u;
export const SECRET_MATERIAL = /(?:xox[baprs]-[A-Za-z0-9-]+|gh[opusr]_[A-Za-z0-9_-]+|ntn_[A-Za-z0-9_-]+|sk-(?:proj-)?[A-Za-z0-9_-]{16,}|AIza[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16}|Bearer\s+\S+|BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|(?:api[_-]?key|token|password|secret)\s*[:=]\s*\S+)/iu;
export const OPAQUE_TEXT_MATERIAL = /(?:\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b|\b(?=[A-Za-z0-9_-]{24,}\b)(?=[A-Za-z0-9_-]*[A-Z])(?=[A-Za-z0-9_-]*[a-z])(?=[A-Za-z0-9_-]*[0-9])[A-Za-z0-9_-]{24,}\b)/u;
export const FORBIDDEN_SECRET_KEY = /^(?:[a-z0-9_]*(?:token|secret|password|credential(?:s)?|private_?key)|api_?key|authorization|bearer|raw_?provider_?payload|provider_?payload)$/iu;
export const FORBIDDEN_AUTHORITY_KEY = /^(?:actor_?ref|owner_?ref|registration_?ref|runner_?ref|auth_?decision|policy_?decision|host_?decision)$/iu;
export const FORBIDDEN_AUDIT_DETAIL_KEY = /^(?:arguments|body|content|input|payload|query|text|text_preview|url)$/iu;
export const TEXT_ENCODER = new TextEncoder();

export interface SafeJsonOptions {
	forbidAuthorityKeys: boolean;
	allowHttpsUrl?: boolean;
	allowResultContent?: boolean;
	/**
	 * Node budget for one safe-JSON walk. The default (512) suits bounded
	 * argument/detail records; a full discovery response walks every
	 * capability contract with ONE counter and legitimately exceeds it well
	 * inside the 64KiB byte cap (live incident 2026-08-05: a 17-op Slack
	 * policy pushed the catalog past ~23 capabilities and every bare
	 * `capabilities` discover failed as target_catalog_response_too_large).
	 */
	maxNodes?: number;
}

/**
 * Derives a safe-JSON node budget from an enforced byte cap (goal3 S5 rule:
 * guard budgets derive from their enforced bound instead of being frozen as
 * arbitrary constants). The floor is the smallest serialized JSON node — a
 * one-digit array element plus its separator (~4 bytes) — so a walk can never
 * exhaust its node budget before the byte cap would have rejected the value.
 */
export const SAFE_JSON_MIN_BYTES_PER_NODE = 4;
export function safeJsonNodeBudgetForBytes(maxBytes: number): number {
	if (!Number.isSafeInteger(maxBytes) || maxBytes < SAFE_JSON_MIN_BYTES_PER_NODE) throw new RangeError("safe-JSON byte cap is invalid");
	return Math.floor(maxBytes / SAFE_JSON_MIN_BYTES_PER_NODE);
}

export function assertSafeJsonValue(value: unknown, options: SafeJsonOptions, depth = 0, count = { value: 0 }): void {
	count.value += 1;
	if (depth > 8 || count.value > (options.maxNodes ?? 512)) invalidByContext(options);
	if (value === null || typeof value === "boolean") return;
	if (typeof value === "number") return assertSafeJsonNumber(value, options);
	if (typeof value === "string") return assertSafeJsonString(value, options);
	if (Array.isArray(value)) {
		return assertSafeJsonArray(value, options, depth, count);
	}
	assertSafeJsonRecord(requireRecord(value), options, depth, count);
}

export function assertSafeJsonNumber(value: number, options: SafeJsonOptions): void {
	if (!Number.isFinite(value)) invalidByContext(options);
}

export function assertSafeJsonString(value: string, options: SafeJsonOptions): void {
	if (byteLength(value) > 4096 || SECRET_MATERIAL.test(value) || RAW_PROVIDER_REF.test(value)) invalidByContext(options);
}

export function assertSafeJsonArray(value: unknown[], options: SafeJsonOptions, depth: number, count: { value: number }): void {
	if (value.length > 128) invalidByContext(options);
	for (const item of value) assertSafeJsonValue(item, options, depth + 1, count);
}

export function assertSafeJsonRecord(record: Record<string, unknown>, options: SafeJsonOptions, depth: number, count: { value: number }): void {
	const entries = Object.entries(record);
	if (entries.length > 128) invalidByContext(options);
	const sourceUrlColumn = options.allowHttpsUrl ? compactSourceUrlColumn(record.fields) : null;
	for (const [key, child] of entries) {
		if (key === "credential_material_included" && child !== false) invalidByContext(options);
		if (!isSafeNegativeMaterialAssertion(key, child)) assertSafeJsonKey(key, options);
		if (key === "rows" && sourceUrlColumn !== null) {
			assertSafeJsonCompactRows(child, sourceUrlColumn, options, depth, count);
			continue;
		}
		assertSafeJsonRecordChild(key, child, options, depth, count);
	}
}

export function assertSafeJsonRecordChild(key: string, child: unknown, options: SafeJsonOptions, depth: number, count: { value: number }): void {
	if (options.allowResultContent && (key === "text" || key === "text_preview")) {
		if (!isSafeResultContent(child, key)) invalidByContext(options);
		return;
	}
	if ((key === "url" || key === "source_url") && options.allowHttpsUrl && isSafeExternalHttpsUrl(child)) return;
	assertSafeJsonValue(child, options, depth + 1, count);
}

function compactSourceUrlColumn(fields: unknown): number | null {
	if (!Array.isArray(fields)) return null;
	const index = fields.indexOf("source_url");
	return index < 0 ? null : index;
}

function assertSafeJsonCompactRows(value: unknown, sourceUrlColumn: number, options: SafeJsonOptions, depth: number, count: { value: number }): void {
	if (!Array.isArray(value) || value.length > 128) invalidByContext(options);
	for (const row of value) {
		if (!Array.isArray(row) || row.length > 128) invalidByContext(options);
		for (const [index, cell] of row.entries()) {
			if (index === sourceUrlColumn && (cell === null || isSafeExternalHttpsUrl(cell))) continue;
			assertSafeJsonValue(cell, options, depth + 2, count);
		}
	}
}

export function isSafeNegativeMaterialAssertion(key: string, value: unknown): boolean {
	return key === "credential_material_included" && value === false;
}

export function assertSafeJsonKey(key: string, options: SafeJsonOptions): void {
	const invalid = !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(key)
		|| FORBIDDEN_SECRET_KEY.test(key)
		|| (options.forbidAuthorityKeys && FORBIDDEN_AUTHORITY_KEY.test(key));
	if (invalid) invalidByContext(options);
}

export function isSafeExternalHttpsUrl(value: unknown): boolean {
	if (!isSafeExternalHttpsUrlInput(value)) return false;
	try {
		const url = new URL(value);
		return isSafeExternalHttpsUrlShape(url) && hasSafeExternalHttpsQuery(url);
	} catch {
		return false;
	}
}

export function isSafeExternalHttpsUrlInput(value: unknown): value is string {
	return typeof value === "string" && byteLength(value) <= 2048 && !SECRET_MATERIAL.test(value);
}

export function isSafeExternalHttpsUrlShape(url: URL): boolean {
	return url.protocol === "https:" && url.username === "" && url.password === "" && url.hash === "";
}

export function hasSafeExternalHttpsQuery(url: URL): boolean {
	for (const [key, parameter] of url.searchParams) {
		if (FORBIDDEN_SECRET_KEY.test(key) || SECRET_MATERIAL.test(parameter)) return false;
	}
	return true;
}

export function isSafeResultContent(value: unknown, key: "text" | "text_preview"): boolean {
	const maximum = key === "text" ? 8192 : 1024;
	return typeof value === "string" && byteLength(value) <= maximum
		&& !SECRET_MATERIAL.test(value) && !hasControlCharacter(value);
}

export function requireSafeRef(value: unknown): asserts value is string {
	if (typeof value !== "string" || !SAFE_REF.test(value) || SECRET_MATERIAL.test(value) || RAW_PROVIDER_REF.test(value)) invalidRequestOrResponse();
}

/**
 * A capability result's schema name is DERIVED from its capability id, not
 * chosen. This is the whole rule, in one place, because it has two halves and
 * restating only the first is worse than not restating it at all: the safe-ref
 * GRAMMAR (which also refuses secret and raw-provider material) and the derived
 * PREFIX. A Gateway-side guard that checks the prefix alone accepts
 * `ceal.resource_resolve_result.C0123456789` — well-formed, correctly prefixed,
 * and carrying a raw Slack channel id that this decoder refuses.
 */
export function cealDerivedCapabilityResultSchemaPrefix(capabilityId: string): string {
	return `ceal.${capabilityId.replaceAll(".", "_")}_result.`;
}

export function isCealDerivedCapabilityResultSchema(value: unknown, capabilityId: string): boolean {
	return typeof value === "string" && SAFE_REF.test(value) && !SECRET_MATERIAL.test(value) && !RAW_PROVIDER_REF.test(value)
		&& value.startsWith(cealDerivedCapabilityResultSchemaPrefix(capabilityId));
}

export function requirePrefixedRef(value: unknown, prefix: string): asserts value is string {
	requireSafeRef(value);
	if (!value.startsWith(prefix)) invalidRequestOrResponse();
}

export function requireSafeText(value: unknown, maxBytes: number): asserts value is string {
	if (!isCealPublicSafeText(value, maxBytes)) invalidRequestOrResponse();
}

export function isCealPublicSafeText(value: unknown, maxBytes: number): value is string {
	return typeof value === "string" && value.trim() !== "" && byteLength(value) <= maxBytes && !hasControlCharacter(value)
		&& !SECRET_MATERIAL.test(value) && !RAW_PROVIDER_REF.test(value) && !OPAQUE_TEXT_MATERIAL.test(value);
}

/** Byte ceiling for one human-facing display name, shared by every boundary. */
export const CEAL_PUBLIC_DISPLAY_NAME_MAX_BYTES = 512;

/**
 * The ONE rule for a human-facing name: the same public-safe-text rule message
 * text uses, at the display-name ceiling.
 *
 * It exists as a named predicate rather than three copies of
 * `isCealPublicSafeText(value, 512)` because three boundaries apply it — the
 * protocol author decoder, the core message projection, and the leased result
 * projector — and every one of them THROWS or refuses on failure. The last time
 * these three carried their own copy of a display-name rule, one of them changed
 * and the other two turned a lost field into a failed read.
 */
export function isCealPublicSafeDisplayName(value: unknown): value is string {
	return isCealPublicSafeText(value, CEAL_PUBLIC_DISPLAY_NAME_MAX_BYTES);
}

export function redactCealPublicUnsafeText(value: string): string {
	return replaceAll(value, SECRET_MATERIAL, "[redacted-secret]").replace(new RegExp(RAW_PROVIDER_REF.source, `${RAW_PROVIDER_REF.flags}g`), "[provider-ref]")
		.replace(new RegExp(OPAQUE_TEXT_MATERIAL.source, `${OPAQUE_TEXT_MATERIAL.flags}g`), "[redacted-opaque]")
		.split("").map((character) => hasControlCharacter(character) ? " " : character).join("").trim();
}

export function replaceAll(value: string, pattern: RegExp, replacement: string): string {
	return value.replace(new RegExp(pattern.source, `${pattern.flags}g`), replacement);
}

export function requireJsonByteSize(value: unknown, maximum: number, fail: () => never): void {
	let serialized: string;
	try {
		serialized = JSON.stringify(value);
	} catch {
		fail();
	}
	if (serialized === undefined || byteLength(serialized) > maximum) fail();
}

export function byteLength(value: string): number {
	return TEXT_ENCODER.encode(value).byteLength;
}

export function hasControlCharacter(value: string): boolean {
	return [...value].some((character) => {
		const code = character.codePointAt(0) ?? 0;
		return code <= 31 || code === 127;
	});
}

export function requireExactKeys(record: Record<string, unknown>, allowedKeys: string[], optionalKeys: string[] = []): void {
	const allowed = new Set(allowedKeys);
	const optional = new Set(optionalKeys);
	if (Object.keys(record).some((key) => !allowed.has(key))) invalidRequestOrResponse();
	for (const key of allowed) if (!optional.has(key) && !Object.hasOwn(record, key)) invalidRequestOrResponse();
}

/**
 * Response-direction key handling for NON-AUTHORITY objects (#700 server half).
 *
 * Requires the declared contract exactly as `requireExactKeys` does, and then
 * REMOVES every other key instead of failing the response. Removal rather than
 * tolerance is the point: an ignored unknown key would still be sitting on the
 * object a consumer later reads, so the decoder would be vouching for a field
 * it never validated. After this runs, what the caller holds is exactly the
 * contract it decoded against.
 *
 * Use it only where an older peer that never sees the added key reaches the
 * same decision. Request envelopes, authority-bearing objects, notification
 * bindings, and every closed enum keep `requireExactKeys` and their own value
 * checks — a new enum MEMBER is still a breaking change, and nothing here
 * changes that.
 */
export function retainDeclaredResponseKeys(record: Record<string, unknown>, knownKeys: string[], optionalKeys: string[] = []): void {
	const known = new Set(knownKeys);
	const optional = new Set(optionalKeys);
	for (const key of known) if (!optional.has(key) && !Object.hasOwn(record, key)) invalidRequestOrResponse();
	for (const key of Object.keys(record)) {
		if (known.has(key)) continue;
		if (isAuthorityShapedKey(key)) invalidRequestOrResponse();
		delete record[key];
	}
}

/**
 * The enforced half of "additive means guidance, never authority".
 *
 * An undeclared key that NAMES an identity, decision, grant, policy, scope, or
 * credential is refused rather than stripped. Stripping would be safe for the
 * client — it never reaches a consumer either way — but it would let a Gateway
 * quietly start emitting authority-shaped state that no peer ever agreed to,
 * and the divergence would surface only when someone decided to read it. A
 * refusal makes that a release event, which is exactly what authority should
 * still cost.
 *
 * Scoped to this function on purpose: `FORBIDDEN_AUTHORITY_KEY` is reused for
 * the names it already owns, and the wider suffix rule applies only to keys
 * nobody declared. Every legitimate `*_ref` in this protocol is a declared key
 * and is retained by the check above before this runs.
 */
// The trailing metadata group is the half a `$` anchor alone missed, reported by
// the ceal-cli consumer against the built 0.72.14 decoder: `grant_revision`,
// `policy_version`, `scope_revision`, and `credential_version` are authority
// state carrying its own generation counter, and every one of them was being
// stripped as ordinary guidance. An authority noun does not stop naming
// authority because a version number follows it. Declared keys never reach
// here — `grant_revision` IS declared on the call response and is retained
// above — so this only widens the refusal for keys nobody agreed to.
// `refs?` belongs in the STATE suffix, not only in the handle rule: a reference
// TO authority is still authority. `grant_ref`, `policy_ref`, `scope_ref`, and
// `role_ref` reached the worker's delegated socket seam as undeclared arguments
// until the ceal-cli consumer reproduced it against 0.72.16. The noun is what
// decides — `message_ref` and `thread_ref` name a Gateway-minted handle and stay
// relayable, because `message` and `thread` are not authority nouns.
const AUTHORITY_METADATA_SUFFIX = "(?:_(?:refs?|revisions?|versions?|generations?|ids?))*$";
// Authority STATE: a value that decides what someone may do. This half applies
// in BOTH directions, because neither peer may invent it.
const UNDECLARED_AUTHORITY_STATE_KEY =
	new RegExp(`(?:^|_)(?:decisions?|authority|grants?|policy|policies|scopes?|tokens?|credentials?|secrets?|permissions?|roles?)${AUTHORITY_METADATA_SUFFIX}`, "iu");
// A bare `*_ref` is this protocol's HANDLE idiom, not authority state, and it is
// the dominant argument shape: ten of the declared capabilities take
// `message_ref`, `thread_ref`, `subject_ref`, `root_ref`, `upload_ref`, or
// `artifact_ref` inside `arguments`. It is authority-shaped on a RESPONSE, where
// an undeclared one would be a Gateway inventing state no peer agreed to, but
// refusing it on an undeclared REQUEST would refuse the next capability that
// takes a Gateway-minted handle — and a decode throw ends the frame loop, which
// is the dead session #700 exists to prevent. Named authority refs
// (`actor_ref`, `owner_ref`, `runner_ref`, `registration_ref`) stay refused in
// both directions through FORBIDDEN_AUTHORITY_KEY.
const UNDECLARED_HANDLE_REF_KEY = new RegExp(`(?:^|_)refs?${AUTHORITY_METADATA_SUFFIX}`, "iu");

/** Refused in both directions: no peer may invent authority state. */
export function isAuthorityStateKey(key: string): boolean {
	return FORBIDDEN_AUTHORITY_KEY.test(key) || UNDECLARED_AUTHORITY_STATE_KEY.test(key);
}

/** The response-side rule: authority state, plus the bare handle idiom. */
export function isAuthorityShapedKey(key: string): boolean {
	return isAuthorityStateKey(key) || UNDECLARED_HANDLE_REF_KEY.test(key);
}

export function requireRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) invalidRequestOrResponse();
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) invalidRequestOrResponse();
	return value as Record<string, unknown>;
}

export function isOperation(value: unknown): value is CealClientOperation {
	return ["handshake", "discover", "call", "readback"].includes(String(value));
}

export function invalidByContext(options: { forbidAuthorityKeys: boolean }): never {
	if (options.forbidAuthorityKeys) invalidRequest();
	invalidResponse();
}

export class InvalidWireShapeError extends Error {}

export function invalidRequestOrResponse(): never {
	throw new InvalidWireShapeError();
}

export function invalidRequest(): never {
	throw new CealProtocolValidationError("invalid_gateway_request");
}

export function invalidResponse(): never {
	throw new CealProtocolValidationError("invalid_client_response");
}
