import { adminRequestUrl } from "./operator-session-store.js";

export type CealProfileConnectorStatus = "active" | "revoked";
export interface CealProfileConnectorRegistry {
	schema_version: "ceal.gateway_profile_connector_registry.v1";
	generation: number;
	bindings: Array<{ connector_binding_ref: string; profile_ref: string; connector_kind: string; connector_principal_ref: string; revision: number; status: CealProfileConnectorStatus }>;
}
export interface CealProfileConnectorState { status: "configured" | "not_configured" | "validated" | "applied"; dry_run: boolean; registry: CealProfileConnectorRegistry; proof_level: "host_decision"; }
export class CealProfileConnectorAdminClientError extends Error {
	override readonly name = "CealProfileConnectorAdminClientError";
	constructor(readonly code: "invalid_configuration" | "request_timeout" | "request_failed" | "invalid_response" | "request_denied" | "stale_registry") { super(`Ceal Profile connector administration ${code.replaceAll("_", " ")}.`); }
}

const PATH = "/api/cealctl/v1/profile-connectors";
const MAX_BYTES = 64 * 1024;
const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export function decodeCealProfileConnectorRegistry(value: unknown): CealProfileConnectorRegistry {
	if (!isRecord(value) || value.schema_version !== "ceal.gateway_profile_connector_registry.v1" || !Number.isSafeInteger(value.generation) || Number(value.generation) < 0 || !Array.isArray(value.bindings)
		|| !hasKeys(value, ["bindings", "generation", "schema_version"])) invalid();
	const registry = structuredClone(value) as unknown as CealProfileConnectorRegistry;
	for (const binding of registry.bindings) {
		if (!isRecord(binding) || !hasKeys(binding, ["connector_binding_ref", "connector_kind", "connector_principal_ref", "profile_ref", "revision", "status"])
			|| ![binding.connector_binding_ref, binding.connector_kind, binding.connector_principal_ref, binding.profile_ref].every((item) => typeof item === "string" && SAFE_REF.test(item))
			|| !/^[a-z][a-z0-9-]{0,63}$/u.test(binding.connector_kind) || !Number.isSafeInteger(binding.revision) || binding.revision < 1 || !["active", "revoked"].includes(binding.status)) invalid();
	}
	return registry;
}

export async function showCealProfileConnectors(input: AdminInput): Promise<CealProfileConnectorState> { return request(input, "GET"); }
export async function applyCealProfileConnectors(input: AdminInput & { registry: CealProfileConnectorRegistry; dryRun: boolean }): Promise<CealProfileConnectorState> { return request(input, "PUT", input.registry, input.dryRun); }
interface AdminInput { adminEndpoint: string; adminToken: string; fetchFn?: typeof globalThis.fetch; timeoutMs?: number }

async function request(input: AdminInput, method: "GET" | "PUT", registry?: CealProfileConnectorRegistry, dryRun = false): Promise<CealProfileConnectorState> {
	if (!/^[A-Za-z0-9._~+/-]+=*$/u.test(input.adminToken) || input.adminToken.length < 16 || input.adminToken.length > 8192) invalid();
	const fetchFn = input.fetchFn ?? globalThis.fetch;
	if (typeof fetchFn !== "function") invalid();
	const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 10_000);
	try {
		const response = await fetchFn(adminRequestUrl(input.adminEndpoint, PATH), method === "GET"
			? { headers: { accept: "application/json", authorization: `Bearer ${input.adminToken}` }, redirect: "error", signal: controller.signal }
			: { method, headers: { accept: "application/json", authorization: `Bearer ${input.adminToken}`, "content-type": "application/json" }, body: JSON.stringify({ schema_version: "ceal.profile_connector_apply.v1", dry_run: dryRun, registry: decodeCealProfileConnectorRegistry(registry) }), redirect: "error", signal: controller.signal });
		const bytes = await readBytes(response);
		if (!response.ok) throw new CealProfileConnectorAdminClientError(response.status === 409 ? "stale_registry" : response.status >= 500 ? "request_failed" : "request_denied");
		if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) invalidResponse();
		return decodeState(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
	} catch (error) { if (error instanceof CealProfileConnectorAdminClientError) throw error; throw new CealProfileConnectorAdminClientError(controller.signal.aborted ? "request_timeout" : "request_failed"); }
	finally { clearTimeout(timer); }
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
function hasKeys(value: Record<string, unknown>, keys: readonly string[]) { return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort()); }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function invalid(): never { throw new CealProfileConnectorAdminClientError("invalid_configuration"); }
function invalidResponse(): never { throw new CealProfileConnectorAdminClientError("invalid_response"); }
