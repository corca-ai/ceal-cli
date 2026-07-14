export type CealAccessStatus = "active" | "revoked";

export interface CealAccessRegistry {
	schema_version: "ceal.gateway_access_registry.v1";
	memberships: Array<{ membership_ref: string; profile_ref: string; subject_ref: string; revision: number; status: CealAccessStatus }>;
	clients: Array<{ client_ref: string; subject_ref: string; instance_ref: string; revision: number; status: CealAccessStatus }>;
	grants: Array<{ grant_ref: string; profile_ref: string; capability_id: string; target_ref: string; revision: number; status: CealAccessStatus }>;
}

export interface CealAccessState {
	status: "configured" | "not_configured" | "validated" | "applied";
	dry_run: boolean;
	registry: CealAccessRegistry;
	proof_level: "host_decision";
}

export class CealAccessAdminClientError extends Error {
	override readonly name = "CealAccessAdminClientError";
	constructor(readonly code: "invalid_configuration" | "request_timeout" | "request_failed" | "invalid_response" | "request_denied") {
		super(`Ceal access administration ${code.replaceAll("_", " ")}.`);
	}
}

const MAX_BODY_BYTES = 64 * 1024;
const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export function decodeCealAccessRegistry(value: unknown): CealAccessRegistry {
	if (!isRecord(value) || !hasExactKeys(value, ["clients", "grants", "memberships", "schema_version"])
		|| value.schema_version !== "ceal.gateway_access_registry.v1"
		|| !Array.isArray(value.memberships) || !Array.isArray(value.clients) || !Array.isArray(value.grants)) invalidConfiguration();
	const registry = structuredClone(value) as unknown as CealAccessRegistry;
	for (const membership of registry.memberships) assertRecord(membership, ["membership_ref", "profile_ref", "revision", "status", "subject_ref"], [membership.membership_ref, membership.profile_ref, membership.subject_ref]);
	for (const client of registry.clients) assertRecord(client, ["client_ref", "instance_ref", "revision", "status", "subject_ref"], [client.client_ref, client.instance_ref, client.subject_ref]);
	for (const grant of registry.grants) assertRecord(grant, ["capability_id", "grant_ref", "profile_ref", "revision", "status", "target_ref"], [grant.grant_ref, grant.profile_ref, grant.capability_id, grant.target_ref]);
	return registry;
}

export async function showCealAccess(input: AdminRequestInput): Promise<CealAccessState> {
	return requestAccess(input, "GET");
}

export async function applyCealAccess(input: AdminRequestInput & { registry: CealAccessRegistry; dryRun: boolean }): Promise<CealAccessState> {
	return requestAccess(input, "PUT", input.registry, input.dryRun);
}

interface AdminRequestInput { adminEndpoint: string; adminToken: string; fetchFn?: typeof globalThis.fetch; timeoutMs?: number }

async function requestAccess(
	input: AdminRequestInput,
	method: "GET" | "PUT",
	registry?: CealAccessRegistry,
	dryRun = false,
): Promise<CealAccessState> {
	const endpoint = safeEndpoint(input.adminEndpoint);
	if (!/^[A-Za-z0-9._~+/-]+=*$/u.test(input.adminToken) || input.adminToken.length < 16 || input.adminToken.length > 8192) invalidConfiguration();
	const fetchFn = input.fetchFn ?? globalThis.fetch;
	const timeoutMs = input.timeoutMs ?? 10_000;
	if (typeof fetchFn !== "function" || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) invalidConfiguration();
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetchFn(endpoint, {
			method,
			headers: { accept: "application/json", authorization: `Bearer ${input.adminToken}`, ...(method === "PUT" ? { "content-type": "application/json" } : {}) },
			...(method === "PUT" ? { body: JSON.stringify({ schema_version: "ceal.access_apply.v1", dry_run: dryRun, registry: decodeCealAccessRegistry(registry) }) } : {}),
			redirect: "error",
			signal: controller.signal,
		});
		const bytes = await readBounded(response);
		if (!response.ok) throw new CealAccessAdminClientError("request_denied");
		if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) invalidResponse();
		return decodeState(parseJson(bytes));
	} catch (error) {
		if (error instanceof CealAccessAdminClientError) throw error;
		if (controller.signal.aborted) throw new CealAccessAdminClientError("request_timeout");
		throw new CealAccessAdminClientError("request_failed");
	} finally { clearTimeout(timer); }
}

function decodeState(value: unknown): CealAccessState {
	if (!isRecord(value) || !hasExactKeys(value, ["dry_run", "ok", "proof_level", "registry", "schema_version", "status"])
		|| value.schema_version !== "ceal.access_state.v1" || value.ok !== true
		|| !new Set(["configured", "not_configured", "validated", "applied"]).has(String(value.status))
		|| typeof value.dry_run !== "boolean" || value.proof_level !== "host_decision") invalidResponse();
	return { status: value.status as CealAccessState["status"], dry_run: value.dry_run, registry: decodeCealAccessRegistry(value.registry), proof_level: "host_decision" };
}

function assertRecord(value: unknown, keys: readonly string[], refs: unknown[]): void {
	if (!isRecord(value) || !hasExactKeys(value, keys) || refs.some((ref) => typeof ref !== "string" || !SAFE_REF.test(ref))
		|| !Number.isSafeInteger(value.revision) || Number(value.revision) < 1 || !new Set(["active", "revoked"]).has(String(value.status))) invalidConfiguration();
}

function safeEndpoint(value: string): URL {
	let endpoint: URL;
	try { endpoint = new URL(value); } catch { invalidConfiguration(); }
	const host = endpoint.hostname.toLowerCase().replace(/^\[|\]$/gu, "");
	if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash
		|| (endpoint.protocol !== "https:" && !(endpoint.protocol === "http:" && (host === "127.0.0.1" || host === "::1")))) invalidConfiguration();
	return endpoint;
}

async function readBounded(response: Response): Promise<Uint8Array> {
	const declared = response.headers.get("content-length");
	if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > MAX_BODY_BYTES) || !response.body) invalidResponse();
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		if (!value) continue;
		total += value.byteLength;
		if (total > MAX_BODY_BYTES) { await reader.cancel(); invalidResponse(); }
		chunks.push(value);
	}
	const result = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
	return result;
}

function parseJson(bytes: Uint8Array): unknown {
	try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { invalidResponse(); }
}
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean { return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort()); }
function invalidConfiguration(): never { throw new CealAccessAdminClientError("invalid_configuration"); }
function invalidResponse(): never { throw new CealAccessAdminClientError("invalid_response"); }
