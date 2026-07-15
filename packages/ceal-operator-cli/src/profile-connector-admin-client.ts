import { adminRequestUrl } from "./operator-session-store.js";

export type CealProfileConnectorStatus = "active" | "revoked";
export interface CealProfileConnectorRegistry {
	schema_version: "ceal.gateway_profile_connector_registry.v1";
	generation: number;
	bindings: Array<{ connector_binding_ref: string; profile_ref: string; connector_kind: string; connector_principal_ref: string; revision: number; status: CealProfileConnectorStatus }>;
}
export interface CealProfileConnectorState { status: "configured" | "not_configured" | "validated" | "applied"; dry_run: boolean; registry: CealProfileConnectorRegistry; proof_level: "host_decision"; }
export type CealProfileConnectorReadiness = "ready" | "degraded" | "unavailable" | "unknown";
export interface CealProfileConnectorCheck {
	connector_binding_ref: string;
	profile_ref: string;
	operation: string;
	readiness: CealProfileConnectorReadiness;
	diagnostic_code: string;
	recovery: string;
	scope_revision: number | null;
	checked_at: string;
	expires_at: string;
}
export interface CealProfileConnectorCheckResult {
	status: "completed";
	checks: CealProfileConnectorCheck[];
	proof_level: "host_decision";
}
export class CealProfileConnectorAdminClientError extends Error {
	override readonly name = "CealProfileConnectorAdminClientError";
	constructor(readonly code: "invalid_configuration" | "request_timeout" | "request_failed" | "invalid_response" | "request_denied" | "stale_registry") { super(`Ceal Profile connector administration ${code.replaceAll("_", " ")}.`); }
}

const PATH = "/api/cealctl/v1/profile-connectors";
const CHECK_PATH = "/api/cealctl/v1/profile-connectors/check";
const MAX_BYTES = 64 * 1024;
const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export function decodeCealProfileConnectorRegistry(value: unknown): CealProfileConnectorRegistry {
	if (!isProfileConnectorRegistryEnvelope(value)) invalid();
	const registry = structuredClone(value) as unknown as CealProfileConnectorRegistry;
	for (const binding of registry.bindings) assertBinding(binding);
	return registry;
}

function isProfileConnectorRegistryEnvelope(value: unknown): value is Record<string, unknown> {
	return isRecord(value) && hasKeys(value, ["bindings", "generation", "schema_version"])
		&& value.schema_version === "ceal.gateway_profile_connector_registry.v1"
		&& Number.isSafeInteger(value.generation) && Number(value.generation) >= 0 && Array.isArray(value.bindings);
}

function assertBinding(value: unknown): void {
	if (!isBinding(value)) invalid();
}

function isBinding(value: unknown): boolean {
	return isRecord(value)
		&& hasKeys(value, ["connector_binding_ref", "connector_kind", "connector_principal_ref", "profile_ref", "revision", "status"])
		&& hasSafeRefs(value.connector_binding_ref, value.connector_principal_ref, value.profile_ref)
		&& typeof value.connector_kind === "string" && /^[a-z][a-z0-9-]{0,63}$/u.test(value.connector_kind)
		&& Number.isSafeInteger(value.revision) && Number(value.revision) >= 1
		&& (value.status === "active" || value.status === "revoked");
}

function hasSafeRefs(...refs: unknown[]): boolean {
	return refs.every((ref) => typeof ref === "string" && SAFE_REF.test(ref));
}

export async function showCealProfileConnectors(input: AdminInput): Promise<CealProfileConnectorState> { return requestProfileConnectors(input, "GET"); }
export async function applyCealProfileConnectors(input: AdminInput & { registry: CealProfileConnectorRegistry; dryRun: boolean }): Promise<CealProfileConnectorState> { return requestProfileConnectors(input, "PUT", input.registry, input.dryRun); }
export async function checkCealProfileConnectors(input: AdminInput): Promise<CealProfileConnectorCheckResult> {
	const prepared = prepareRequest(input, CHECK_PATH);
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), prepared.timeoutMs);
	try {
		const response = await prepared.fetchFn(prepared.endpoint, requestInit(input.adminToken, "POST", controller.signal));
		const bytes = await readBytes(response);
		if (!response.ok) throw new CealProfileConnectorAdminClientError(response.status >= 500 ? "request_failed" : "request_denied");
		if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) invalidResponse();
		return decodeCheckResult(parseJson(bytes));
	} catch (error) {
		mapRequestError(error, controller.signal.aborted);
	} finally { clearTimeout(timer); }
}
interface AdminInput { adminEndpoint: string; adminToken: string; fetchFn?: typeof globalThis.fetch; timeoutMs?: number }

async function requestProfileConnectors(input: AdminInput, method: "GET" | "PUT", registry?: CealProfileConnectorRegistry, dryRun = false): Promise<CealProfileConnectorState> {
	const prepared = prepareRequest(input, PATH);
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), prepared.timeoutMs);
	try {
		const response = await prepared.fetchFn(prepared.endpoint, requestInit(input.adminToken, method, controller.signal, registry, dryRun));
		const bytes = await readBytes(response);
		if (!response.ok) throw new CealProfileConnectorAdminClientError(response.status === 409 ? "stale_registry" : response.status >= 500 ? "request_failed" : "request_denied");
		if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) invalidResponse();
		return decodeState(parseJson(bytes));
	} catch (error) {
		mapRequestError(error, controller.signal.aborted);
	} finally { clearTimeout(timer); }
}

function prepareRequest(input: AdminInput, path: string): { endpoint: string; fetchFn: typeof globalThis.fetch; timeoutMs: number } {
	if (!isSafeToken(input.adminToken)) invalid();
	const fetchFn = input.fetchFn ?? globalThis.fetch;
	const timeoutMs = input.timeoutMs ?? 10_000;
	if (typeof fetchFn !== "function" || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) invalid();
	try { return { endpoint: adminRequestUrl(input.adminEndpoint, path), fetchFn, timeoutMs }; }
	catch { invalid(); }
}

function isSafeToken(value: string): boolean {
	return /^[A-Za-z0-9._~+/-]+=*$/u.test(value) && value.length >= 16 && value.length <= 8192;
}

function requestInit(token: string, method: "GET" | "PUT" | "POST", signal: AbortSignal, registry?: CealProfileConnectorRegistry, dryRun = false): RequestInit {
	const common = { method, redirect: "error" as const, signal };
	if (method === "GET" || method === "POST") return { ...common, headers: { accept: "application/json", authorization: `Bearer ${token}` } };
	return {
		...common,
		headers: { accept: "application/json", authorization: `Bearer ${token}`, "content-type": "application/json" },
		body: JSON.stringify({ schema_version: "ceal.profile_connector_apply.v1", dry_run: dryRun, registry: decodeCealProfileConnectorRegistry(registry) }),
	};
}

function mapRequestError(error: unknown, aborted: boolean): never {
	if (error instanceof CealProfileConnectorAdminClientError) throw error;
	throw new CealProfileConnectorAdminClientError(aborted ? "request_timeout" : "request_failed");
}

async function readBytes(response: Response): Promise<Uint8Array> {
	const declared = response.headers.get("content-length"); if ((declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > MAX_BYTES)) || !response.body) invalidResponse();
	const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let total = 0;
	while (true) { const { done, value } = await reader.read(); if (done) break; if (!value) continue; total += value.byteLength; if (total > MAX_BYTES) { await reader.cancel(); invalidResponse(); } chunks.push(value); }
	const result = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; } return result;
}

function decodeState(value: unknown): CealProfileConnectorState {
	if (!isRecord(value) || value.schema_version !== "ceal.profile_connector_state.v1" || value.ok !== true || !["configured", "not_configured", "validated", "applied"].includes(String(value.status)) || typeof value.dry_run !== "boolean" || value.proof_level !== "host_decision") invalidResponse();
	return { status: value.status as CealProfileConnectorState["status"], dry_run: value.dry_run, registry: decodeCealProfileConnectorRegistry(value.registry), proof_level: "host_decision" };
}
function decodeCheckResult(value: unknown): CealProfileConnectorCheckResult {
	if (!isRecord(value) || !hasKeys(value, ["checks", "ok", "proof_level", "schema_version", "status"])
		|| value.schema_version !== "ceal.profile_connector_check.v1" || value.ok !== true || value.status !== "completed"
		|| value.proof_level !== "host_decision" || !Array.isArray(value.checks)) invalidResponse();
	return { status: "completed", checks: value.checks.map(decodeCheck), proof_level: "host_decision" };
}
function decodeCheck(value: unknown): CealProfileConnectorCheck {
	if (!isRecord(value) || !hasKeys(value, ["checked_at", "connector_binding_ref", "diagnostic_code", "expires_at", "operation", "profile_ref", "readiness", "recovery", "scope_revision"])
		|| !hasSafeRefs(value.connector_binding_ref, value.profile_ref) || typeof value.operation !== "string" || !SAFE_REF.test(value.operation)
		|| !["ready", "degraded", "unavailable", "unknown"].includes(String(value.readiness))
		|| typeof value.diagnostic_code !== "string" || !SAFE_REF.test(value.diagnostic_code)
		|| typeof value.recovery !== "string" || value.recovery.length < 1 || value.recovery.length > 512
		|| !(value.scope_revision === null || (Number.isSafeInteger(value.scope_revision) && Number(value.scope_revision) >= 1))
		|| !isIsoTimestamp(value.checked_at) || !isIsoTimestamp(value.expires_at)) invalidResponse();
	return structuredClone(value) as unknown as CealProfileConnectorCheck;
}
function hasKeys(value: Record<string, unknown>, keys: readonly string[]) { return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort()); }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function isIsoTimestamp(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value; }
function parseJson(bytes: Uint8Array): unknown {
	try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
	catch { invalidResponse(); }
}
function invalid(): never { throw new CealProfileConnectorAdminClientError("invalid_configuration"); }
function invalidResponse(): never { throw new CealProfileConnectorAdminClientError("invalid_response"); }
