export const CEAL_LEASED_CONSUMER_SURVEY_DISPATCH_ARGUMENTS_SCHEMA = "ceal.gateway_leased_agent_survey_dispatch_arguments.v1" as const;
export const CEAL_LEASED_CONSUMER_SURVEY_DISPATCH_DATA_SCHEMA = "ceal.gateway_leased_agent_survey_dispatch_data.v1" as const;

export function decodeCealLeasedConsumerSurveyDispatchArguments(value: unknown): void {
	const record = requireRecord(value);
	if (!exactKeys(record, ["dispatch_fingerprint", "run_id", "schema_version"])
		|| record.schema_version !== CEAL_LEASED_CONSUMER_SURVEY_DISPATCH_ARGUMENTS_SCHEMA
		|| typeof record.run_id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(record.run_id)
		|| typeof record.dispatch_fingerprint !== "string" || !/^[a-f0-9]{64}$/u.test(record.dispatch_fingerprint)) invalid();
}

export function decodeCealLeasedConsumerSurveyDispatchData(value: unknown): boolean {
	if (!plainRecord(value) || !exactKeys(value, ["failed_count", "replayed_count", "schema_version", "sent_count", "terminal", "uncertain_count"])) return false;
	if (value.schema_version !== CEAL_LEASED_CONSUMER_SURVEY_DISPATCH_DATA_SCHEMA || !["completed", "ack_uncertain"].includes(value.terminal as string)) return false;
	const counts = [value.sent_count, value.replayed_count, value.failed_count, value.uncertain_count];
	if (!counts.every((count) => typeof count === "number" && Number.isSafeInteger(count) && count >= 0)) return false;
	return value.terminal === "completed" ? value.uncertain_count === 0 : (value.uncertain_count as number) > 0;
}

function requireRecord(value: unknown): Record<string, unknown> { if (!record(value)) invalid(); return value; }
function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean { const keys = Object.keys(value).sort(); return keys.length === expected.length && keys.every((key, index) => key === expected[index]); }
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function plainRecord(value: unknown): value is Record<string, unknown> { return record(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null); }
function invalid(): never { throw new TypeError("Ceal leased-consumer control record is invalid"); }
