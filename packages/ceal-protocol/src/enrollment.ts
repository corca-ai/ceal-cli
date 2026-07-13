export const CEAL_ENROLLMENT_EXCHANGE_SCHEMA = "ceal.enrollment_exchange.v1" as const;
export const CEAL_ENROLLMENT_RESULT_SCHEMA = "ceal.enrollment_result.v1" as const;

export interface CealEnrollmentExchangeRequest {
	schema_version: typeof CEAL_ENROLLMENT_EXCHANGE_SCHEMA;
	code: string;
	client: { name: "ceal"; version: string };
}

export interface CealEnrollmentResult {
	schema_version: typeof CEAL_ENROLLMENT_RESULT_SCHEMA;
	ok: true;
	profile_ref: string;
	registration_ref: string;
	client_ref: string;
	runner_ref: string;
	access_token: string;
	expires_at: string;
}

export interface CealEnrollmentFailure {
	schema_version: typeof CEAL_ENROLLMENT_RESULT_SCHEMA;
	ok: false;
	error: {
		code: "enrollment_invalid" | "enrollment_expired" | "enrollment_used";
		message: string;
		next_action: string;
	};
}

export type CealEnrollmentResponse = CealEnrollmentResult | CealEnrollmentFailure;

const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SAFE_CODE = /^[A-Za-z0-9_-]{32,256}$/u;
const ACCESS_TOKEN = /^ceal_personal_[A-Za-z0-9_-]{43}$/u;

export function decodeCealEnrollmentExchangeRequest(value: unknown): CealEnrollmentExchangeRequest {
	const record = requireRecord(value);
	requireExactKeys(record, ["client", "code", "schema_version"]);
	const client = requireRecord(record.client);
	requireExactKeys(client, ["name", "version"]);
	if (record.schema_version !== CEAL_ENROLLMENT_EXCHANGE_SCHEMA
		|| typeof record.code !== "string" || !SAFE_CODE.test(record.code)
		|| client.name !== "ceal" || typeof client.version !== "string"
		|| !/^(0|[1-9][0-9]*)[.](0|[1-9][0-9]*)[.](0|[1-9][0-9]*)$/u.test(client.version)) {
		throw new TypeError("Invalid Ceal enrollment exchange request.");
	}
	return record as unknown as CealEnrollmentExchangeRequest;
}

export function decodeCealEnrollmentResponse(value: unknown): CealEnrollmentResponse {
	const record = requireRecord(value);
	if (record.schema_version !== CEAL_ENROLLMENT_RESULT_SCHEMA || typeof record.ok !== "boolean") invalidResponse();
	if (record.ok === false) return decodeFailure(record);
	requireExactKeys(record, ["access_token", "client_ref", "expires_at", "ok", "profile_ref", "registration_ref", "runner_ref", "schema_version"]);
	for (const key of ["profile_ref", "registration_ref", "client_ref", "runner_ref"] as const) {
		if (typeof record[key] !== "string" || !SAFE_REF.test(record[key])) invalidResponse();
	}
	if (typeof record.access_token !== "string" || !ACCESS_TOKEN.test(record.access_token)
		|| typeof record.expires_at !== "string" || !validFutureTimestampShape(record.expires_at)) invalidResponse();
	return record as unknown as CealEnrollmentResult;
}

function decodeFailure(record: Record<string, unknown>): CealEnrollmentFailure {
	requireExactKeys(record, ["error", "ok", "schema_version"]);
	const error = requireRecord(record.error);
	requireExactKeys(error, ["code", "message", "next_action"]);
	if (!new Set(["enrollment_invalid", "enrollment_expired", "enrollment_used"]).has(String(error.code))
		|| typeof error.message !== "string" || error.message.length === 0 || error.message.length > 256
		|| typeof error.next_action !== "string" || error.next_action.length === 0 || error.next_action.length > 256) invalidResponse();
	return record as unknown as CealEnrollmentFailure;
}

function validFutureTimestampShape(value: string): boolean {
	return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[.]\d{3}Z$/u.test(value) && Number.isFinite(Date.parse(value));
}

function requireRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Expected a mapping.");
	return value as Record<string, unknown>;
}

function requireExactKeys(record: Record<string, unknown>, expected: readonly string[]): void {
	const actual = Object.keys(record).sort();
	if (JSON.stringify(actual) !== JSON.stringify([...expected].sort())) throw new TypeError("Unexpected enrollment fields.");
}

function invalidResponse(): never {
	throw new TypeError("Invalid Ceal enrollment response.");
}
