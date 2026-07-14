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
	if (!Array.isArray(value)) return false;
	const features = new Map<string, unknown>();
	for (const feature of value) {
		if (!isRecord(feature) || typeof feature.id !== "string" || features.has(feature.id)) return false;
		features.set(feature.id, feature.routes);
	}
	for (const [id, expectedRoutes] of REQUIRED_FEATURES) {
		const routes = features.get(id);
		if (!Array.isArray(routes) || routes.length !== expectedRoutes.length) return false;
		const actual = new Set<string>();
		for (const route of routes) {
			if (!isRecord(route) || typeof route.method !== "string" || typeof route.path !== "string"
				|| !(route.required_scope === null || typeof route.required_scope === "string")) return false;
			const key = `${route.method}\u0000${route.path}\u0000${route.required_scope ?? ""}`;
			if (actual.has(key)) return false;
			actual.add(key);
		}
		for (const [method, path, scope] of expectedRoutes) {
			if (!actual.has(`${method}\u0000${path}\u0000${scope ?? ""}`)) return false;
		}
	}
	return true;
}

async function readBoundedJson(response: Response): Promise<Record<string, unknown>> {
	if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json") || !response.body) incompatible();
	const declared = response.headers.get("content-length");
	if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)) incompatible();
	const reader = response.body.getReader();
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
