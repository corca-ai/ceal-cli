import { adminRequestUrl, normalizeAdminOrigin } from "./operator-session-store.js";

const CONTRACT_PATH = "/api/cealctl/contract";
const CONTRACT_SCHEMA = "ceal.admin_api_contract.v1";
const MINIMUM_CONTRACT_REVISION = 1;
const MAX_RESPONSE_BYTES = 64 * 1024;

const REQUIRED_FEATURES = new Map([
	["operator_session.v1", [
		["POST", "/api/cealctl/login/start", null],
		["POST", "/api/cealctl/login/poll", null],
		["POST", "/api/cealctl/token/refresh", null],
		["POST", "/api/cealctl/token/revoke", null],
	]],
	["personal_client_access.v1", [
		["GET", "/api/cealctl/v1/access", "ceal.access.manage"],
		["PUT", "/api/cealctl/v1/access", "ceal.access.manage"],
	]],
	["profile_connector_control.v1", [
		["GET", "/api/cealctl/v1/profile-connectors", "ceal.profile_connector.manage"],
		["PUT", "/api/cealctl/v1/profile-connectors", "ceal.profile_connector.manage"],
	]],
	["profile_connector_readiness.v1", [
		["POST", "/api/cealctl/v1/profile-connectors/check", "ceal.profile_connector.inspect"],
	]],
	["personal_client_enrollment.v1", [
		["POST", "/api/cealctl/v1/enrollments", "ceal.client.enroll"],
	]],
] as const);

export class AdminApiContractClientError extends Error {
	override readonly name = "AdminApiContractClientError";
	constructor(readonly code: "control_plane_upgrade_required" | "request_timeout" | "request_failed") {
		super(`Ceal Admin API contract ${code.replaceAll("_", " ")}.`);
	}
}

export async function requireCompatibleAdminApiContract(input: {
	adminOrigin: string;
	expectedDeploymentId?: string;
	fetchFn?: typeof globalThis.fetch;
}): Promise<{ deploymentId: string }> {
	const adminOrigin = normalizeAdminOrigin(input.adminOrigin);
	const fetchFn = input.fetchFn ?? globalThis.fetch;
	if (typeof fetchFn !== "function") throw new AdminApiContractClientError("request_failed");
	const controller = new AbortController();
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		const request = (async () => {
			const response = await fetchFn(adminRequestUrl(adminOrigin, CONTRACT_PATH), {
				headers: { accept: "application/json" }, redirect: "error", signal: controller.signal,
			});
			if (!response.ok) throw new AdminApiContractClientError("control_plane_upgrade_required");
			return decodeAndValidate(await readBoundedJson(response), adminOrigin, input.expectedDeploymentId);
		})();
		const timeout = new Promise<never>((_resolve, reject) => {
			timer = setTimeout(() => {
				controller.abort();
				reject(new AdminApiContractClientError("request_timeout"));
			}, 10_000);
		});
		return await Promise.race([request, timeout]);
	} catch (error) {
		if (error instanceof AdminApiContractClientError) throw error;
		throw new AdminApiContractClientError(controller.signal.aborted ? "request_timeout" : "request_failed");
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
}

function decodeAndValidate(value: Record<string, unknown>, adminOrigin: string, expectedDeploymentId?: string): { deploymentId: string } {
	if (value.schema_version !== CONTRACT_SCHEMA || !Number.isSafeInteger(value.contract_revision)
		|| Number(value.contract_revision) < MINIMUM_CONTRACT_REVISION) incompatible();
	const deploymentId = safeId(value.deployment_id);
	if (expectedDeploymentId !== undefined && deploymentId !== expectedDeploymentId) incompatible();
	let returnedOrigin: string;
	try { returnedOrigin = normalizeAdminOrigin(safeString(value.admin_api_origin, 2048)); } catch { incompatible(); }
	if (returnedOrigin !== adminOrigin || !hasRequiredFeatures(value.features)) incompatible();
	return { deploymentId };
}

function hasRequiredFeatures(value: unknown): boolean {
	const features = featureRoutesById(value);
	if (!features) return false;
	for (const [id, expectedRoutes] of REQUIRED_FEATURES) {
		if (!hasExpectedRoutes(features.get(id), expectedRoutes)) return false;
	}
	return true;
}

function featureRoutesById(value: unknown): Map<string, unknown> | null {
	if (!Array.isArray(value)) return null;
	const features = new Map<string, unknown>();
	for (const feature of value) {
		if (!isRecord(feature) || typeof feature.id !== "string" || features.has(feature.id)) return null;
		features.set(feature.id, feature.routes);
	}
	return features;
}

function hasExpectedRoutes(routes: unknown, expectedRoutes: readonly (readonly [string, string, string | null])[]): boolean {
	if (!Array.isArray(routes) || routes.length !== expectedRoutes.length) return false;
	const actual = routeKeys(routes);
	return actual !== null && expectedRoutes.every(([method, path, scope]) => actual.has(routeKey(method, path, scope)));
}

function routeKeys(routes: readonly unknown[]): Set<string> | null {
	const actual = new Set<string>();
	for (const route of routes) {
		if (!isRecord(route) || typeof route.method !== "string" || typeof route.path !== "string") return null;
		if (!(route.required_scope === null || typeof route.required_scope === "string")) return null;
		const key = routeKey(route.method, route.path, route.required_scope);
		if (actual.has(key)) return null;
		actual.add(key);
	}
	return actual;
}

function routeKey(method: string, path: string, scope: string | null): string {
	return `${method}\u0000${path}\u0000${scope ?? ""}`;
}

async function readBoundedJson(response: Response): Promise<Record<string, unknown>> {
	assertBoundedJsonResponse(response);
	const bytes = await readResponseBytes(response.body.getReader());
	return decodeJsonRecord(bytes);
}

function assertBoundedJsonResponse(response: Response): asserts response is Response & { body: ReadableStream<Uint8Array> } {
	if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json") || !response.body) incompatible();
	const declared = response.headers.get("content-length");
	if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)) incompatible();
}

async function readResponseBytes(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<Uint8Array> {
	const chunks: Uint8Array[] = [];
	let total = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		if (!value) continue;
		total += value.byteLength;
		if (total > MAX_RESPONSE_BYTES) { await reader.cancel(); incompatible(); }
		chunks.push(value);
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
	return bytes;
}

function decodeJsonRecord(bytes: Uint8Array): Record<string, unknown> {
	let value: unknown;
	try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { incompatible(); }
	if (!isRecord(value)) incompatible();
	return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeString(value: unknown, max: number): string {
	if (typeof value !== "string" || value.length === 0 || value.length > max || /[\r\n]/u.test(value)) incompatible();
	return value;
}

function safeId(value: unknown): string {
	const id = safeString(value, 128);
	if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(id)) incompatible();
	return id;
}

function incompatible(): never {
	throw new AdminApiContractClientError("control_plane_upgrade_required");
}
