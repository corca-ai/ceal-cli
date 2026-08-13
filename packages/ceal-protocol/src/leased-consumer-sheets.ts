/**
 * Bounded Google Sheets value arguments and result terminals for the leased
 * Agent carrier.  These records carry only the caller's bounded A1 range and
 * cell values; spreadsheet ids, provider locators, credentials, and grants
 * remain Gateway-private.
 */

export const CEAL_LEASED_CONSUMER_SHEETS_VALUES_READ_ARGUMENTS_SCHEMA = "ceal.gateway_leased_agent_sheets_values_read_arguments.v1" as const;
export const CEAL_LEASED_CONSUMER_SHEETS_VALUES_UPDATE_ARGUMENTS_SCHEMA = "ceal.gateway_leased_agent_sheets_values_update_arguments.v1" as const;
export const CEAL_LEASED_CONSUMER_SHEETS_VALUES_CLEAR_ARGUMENTS_SCHEMA = "ceal.gateway_leased_agent_sheets_values_clear_arguments.v1" as const;
export const CEAL_LEASED_CONSUMER_SHEETS_VALUES_READ_DATA_SCHEMA = "ceal.gateway_leased_agent_sheets_values_read_data.v1" as const;
export const CEAL_LEASED_CONSUMER_SHEETS_VALUES_UPDATE_DATA_SCHEMA = "ceal.gateway_leased_agent_sheets_values_update_data.v1" as const;
export const CEAL_LEASED_CONSUMER_SHEETS_VALUES_CLEAR_DATA_SCHEMA = "ceal.gateway_leased_agent_sheets_values_clear_data.v1" as const;

const MAX_RANGE_BYTES = 256;
const MAX_SHEET_NAME_BYTES = 80;
const MAX_ROWS = 100;
const MAX_COLUMNS = 26;
const MAX_CELL_BYTES = 4_096;
const MAX_WRITE_BYTES = 8_192;

export type CealLeasedConsumerSheetCell = string | number | boolean;
export type CealLeasedConsumerSheetMatrix = readonly (readonly CealLeasedConsumerSheetCell[])[];

export type CealLeasedConsumerSheetsReadArguments = {
	schema_version: typeof CEAL_LEASED_CONSUMER_SHEETS_VALUES_READ_ARGUMENTS_SCHEMA;
	range: string;
};

export type CealLeasedConsumerSheetsUpdateArguments = {
	schema_version: typeof CEAL_LEASED_CONSUMER_SHEETS_VALUES_UPDATE_ARGUMENTS_SCHEMA;
	range: string;
	values: CealLeasedConsumerSheetMatrix;
	idempotency_key: string;
} & ({ expected_before_values: CealLeasedConsumerSheetMatrix; require_empty?: never } | { require_empty: true; expected_before_values?: never });

export type CealLeasedConsumerSheetsClearArguments = {
	schema_version: typeof CEAL_LEASED_CONSUMER_SHEETS_VALUES_CLEAR_ARGUMENTS_SCHEMA;
	range: string;
	expected_before_values: CealLeasedConsumerSheetMatrix;
	idempotency_key: string;
};

export type CealLeasedConsumerSheetsReadData = {
	schema_version: typeof CEAL_LEASED_CONSUMER_SHEETS_VALUES_READ_DATA_SCHEMA;
	range: string;
	values: CealLeasedConsumerSheetMatrix;
};

export type CealLeasedConsumerSheetsUpdateData = {
	schema_version: typeof CEAL_LEASED_CONSUMER_SHEETS_VALUES_UPDATE_DATA_SCHEMA;
	terminal: "readback_confirmed" | "idempotency_replayed";
};

export type CealLeasedConsumerSheetsClearData = {
	schema_version: typeof CEAL_LEASED_CONSUMER_SHEETS_VALUES_CLEAR_DATA_SCHEMA;
	terminal: "readback_confirmed" | "idempotency_replayed";
};

export function decodeCealLeasedConsumerSheetsReadArguments(value: unknown): void {
	const record = exactRecord(value, ["range", "schema_version"]);
	if (record.schema_version !== CEAL_LEASED_CONSUMER_SHEETS_VALUES_READ_ARGUMENTS_SCHEMA || readCealLeasedConsumerSheetsRange(record.range) === null) invalid();
}

export function decodeCealLeasedConsumerSheetsUpdateArguments(value: unknown): void {
	const record = requireRecord(value);
	const hasExpected = Object.hasOwn(record, "expected_before_values");
	const hasRequireEmpty = Object.hasOwn(record, "require_empty");
	if (hasExpected === hasRequireEmpty || !exactKeys(record, ["idempotency_key", "range", "schema_version", "values", ...(hasExpected ? ["expected_before_values"] : ["require_empty"]) ])) invalid();
	if (record.schema_version !== CEAL_LEASED_CONSUMER_SHEETS_VALUES_UPDATE_ARGUMENTS_SCHEMA || !safeIdempotencyKey(record.idempotency_key)) invalid();
	const range = readCealLeasedConsumerSheetsRange(record.range);
	if (range === null || !sheetMatrix(record.values, range, false)) invalid();
	if (hasExpected ? !sheetMatrix(record.expected_before_values, range, true) : record.require_empty !== true) invalid();
}

export function decodeCealLeasedConsumerSheetsClearArguments(value: unknown): void {
	const record = exactRecord(value, ["expected_before_values", "idempotency_key", "range", "schema_version"]);
	const range = readCealLeasedConsumerSheetsRange(record.range);
	if (record.schema_version !== CEAL_LEASED_CONSUMER_SHEETS_VALUES_CLEAR_ARGUMENTS_SCHEMA || range === null || !safeIdempotencyKey(record.idempotency_key) || !sheetMatrix(record.expected_before_values, range, true)) invalid();
}

export function validCealLeasedConsumerSheetsReadData(value: unknown): value is CealLeasedConsumerSheetsReadData {
	if (!plainRecord(value) || !exactKeys(value, ["range", "schema_version", "values"]) || value.schema_version !== CEAL_LEASED_CONSUMER_SHEETS_VALUES_READ_DATA_SCHEMA) return false;
	const range = readCealLeasedConsumerSheetsRange(value.range);
	return range !== null && rectangularSheetMatrix(value.values, range, true);
}

export function validCealLeasedConsumerSheetsUpdateData(value: unknown): value is CealLeasedConsumerSheetsUpdateData {
	return plainRecord(value) && exactKeys(value, ["schema_version", "terminal"]) && value.schema_version === CEAL_LEASED_CONSUMER_SHEETS_VALUES_UPDATE_DATA_SCHEMA && validTerminal(value.terminal);
}

export function validCealLeasedConsumerSheetsClearData(value: unknown): value is CealLeasedConsumerSheetsClearData {
	return plainRecord(value) && exactKeys(value, ["schema_version", "terminal"]) && value.schema_version === CEAL_LEASED_CONSUMER_SHEETS_VALUES_CLEAR_DATA_SCHEMA && validTerminal(value.terminal);
}

export function readCealLeasedConsumerSheetsRange(value: unknown): { range: string; rows: number; columns: number } | null {
	if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > MAX_RANGE_BYTES || !wellFormed(value)) return null;
	const match = /^(?:([^!\r\n]{1,80})!)?([A-Z]{1,2})([1-9]\d{0,5}):([A-Z]{1,2})([1-9]\d{0,5})$/u.exec(value);
	if (match === null || !boundedSheetName(match[1])) return null;
	const startColumn = columnIndex(match[2]); const endColumn = columnIndex(match[4]);
	const rows = Number(match[5]) - Number(match[3]) + 1; const columns = endColumn - startColumn + 1;
	return boundedDimensions({ startColumn, endColumn, rows, columns }) ? { range: value, rows, columns } : null;
}
function boundedSheetName(value: string | undefined): boolean {
	return value === undefined || Buffer.byteLength(value, "utf8") <= MAX_SHEET_NAME_BYTES && safeSheetText(value);
}
function boundedDimensions({ startColumn, endColumn, rows, columns }: { startColumn: number; endColumn: number; rows: number; columns: number }): boolean {
	return endColumn >= startColumn && rows >= 1 && rows <= MAX_ROWS && columns >= 1 && columns <= MAX_COLUMNS && rows * columns <= MAX_ROWS * MAX_COLUMNS;
}

function sheetMatrix(value: unknown, range: { rows: number; columns: number }, allowEmpty: boolean): value is CealLeasedConsumerSheetMatrix {
	return rectangularSheetMatrix(value, range, allowEmpty) && Buffer.byteLength(JSON.stringify(value), "utf8") <= MAX_WRITE_BYTES;
}

function rectangularSheetMatrix(value: unknown, range: { rows: number; columns: number }, allowEmpty: boolean): value is CealLeasedConsumerSheetMatrix {
	return Array.isArray(value) && value.length === range.rows && value.every((row) => Array.isArray(row) && row.length === range.columns && row.every((cell) => validCell(cell, allowEmpty)));
}

function validCell(value: unknown, allowEmpty: boolean): value is CealLeasedConsumerSheetCell {
	return typeof value === "string" ? wellFormed(value) && safeSheetText(value) && (allowEmpty || value.length > 0) && Buffer.byteLength(value, "utf8") <= MAX_CELL_BYTES
		: typeof value === "boolean" || typeof value === "number" && Number.isFinite(value);
}

function safeSheetText(value: string): boolean {
	return ![...value].some((character) => {
		const code = character.codePointAt(0);
		return code !== undefined && (code < 32 || code === 127);
	});
}

function safeIdempotencyKey(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && Buffer.byteLength(value, "utf8") <= 128 && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value);
}
function validTerminal(value: unknown): value is "readback_confirmed" | "idempotency_replayed" { return value === "readback_confirmed" || value === "idempotency_replayed"; }
function columnIndex(value: string): number { let result = 0; for (const character of value) result = result * 26 + character.charCodeAt(0) - 64; return result; }
function wellFormed(value: string): boolean {
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code >= 0xd800 && code <= 0xdbff) {
			const next = value.charCodeAt(index + 1);
			if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
			index += 1;
		} else if (code >= 0xdc00 && code <= 0xdfff) return false;
	}
	return true;
}
function exactRecord(value: unknown, expected: readonly string[]): Record<string, unknown> { const record = requireRecord(value); if (!exactKeys(record, expected)) invalid(); return record; }
function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean { const actual = Object.keys(value).sort(); const ordered = [...expected].sort(); return actual.length === ordered.length && actual.every((key, index) => key === ordered[index]); }
function requireRecord(value: unknown): Record<string, unknown> { if (!plainRecord(value)) invalid(); return value; }
function plainRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null); }
function invalid(): never { throw new TypeError("Ceal leased-consumer Sheets record is invalid"); }
