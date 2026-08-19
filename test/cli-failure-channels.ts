import { asJsonRecord } from "../scripts/lib/json-record.ts";
import assert from "node:assert/strict";

type CliIo = Pick<Console, "log" | "error">;
type CliRunner = (argv: string[], io: CliIo) => number | Promise<number>;

export async function assertCliFailureChannels(
	runCli: CliRunner,
	argv: readonly string[],
	expectedCode: string,
	expectedText?: string,
): Promise<void> {
	const logs: unknown[] = [];
	const errors: unknown[] = [];
	const io: CliIo = {
		log: (message: unknown) => logs.push(message),
		error: (message: unknown) => errors.push(message),
	};

	assert.equal(await runCli([...argv, "--json"], io), 2);
	assert.equal(logs.length, 1);
	const jsonMessage = logs.pop();
	assert.equal(typeof jsonMessage, "string");
	if (typeof jsonMessage !== "string") throw new Error("expected JSON failure output");
	const parsed: unknown = JSON.parse(jsonMessage);
	const record = asJsonRecord(parsed);
	if (record === undefined) throw new Error("expected JSON failure record");
	assert.equal(record.error_code, expectedCode);
	assert.deepEqual(errors, []);

	assert.equal(await runCli([...argv], io), 2);
	assert.deepEqual(logs, []);
	assert.equal(errors.length, 1);
	const textMessage = errors.pop();
	assert.equal(typeof textMessage, "string");
	if (typeof textMessage !== "string") throw new Error("expected text failure output");
	if (expectedText === undefined) assert.match(textMessage, /\S/u);
	else assert.equal(textMessage, expectedText);
}
