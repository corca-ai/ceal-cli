import assert from "node:assert/strict";
import test from "node:test";
import {
	CEAL_LEASED_CONSUMER_FILE_UPLOAD_ARGUMENTS_SCHEMA,
	CEAL_LEASED_CONSUMER_FILE_UPLOAD_DATA_SCHEMA,
	decodeCealLeasedConsumerFileUploadArguments,
	validCealLeasedConsumerFileUploadData,
} from "../dist/leased-consumer-file-upload.js";

const argumentsValue = Object.freeze({
	schema_version: CEAL_LEASED_CONSUMER_FILE_UPLOAD_ARGUMENTS_SCHEMA,
	artifact_ref: `artifact:${"a".repeat(64)}`,
	name: "report.pdf",
});

test("file.upload has one provider-neutral staged-file argument grammar", () => {
	assert.doesNotThrow(() => decodeCealLeasedConsumerFileUploadArguments(argumentsValue));
	for (const invalid of [
		{ ...argumentsValue, name: "../report.pdf" },
		{ ...argumentsValue, name: "" },
		{ ...argumentsValue, title: "report.pdf" },
		{ ...argumentsValue, reply_to: `message:${"b".repeat(64)}` },
	]) assert.throws(() => decodeCealLeasedConsumerFileUploadArguments(invalid), /invalid/u);
});

test("file.upload result carries only the verified terminal", () => {
	for (const terminal of ["readback_confirmed", "idempotency_replayed"]) {
		assert.equal(validCealLeasedConsumerFileUploadData({ schema_version: CEAL_LEASED_CONSUMER_FILE_UPLOAD_DATA_SCHEMA, terminal }), true);
	}
	assert.equal(validCealLeasedConsumerFileUploadData({ schema_version: CEAL_LEASED_CONSUMER_FILE_UPLOAD_DATA_SCHEMA, terminal: "readback_confirmed", message_ref: "message:leak" }), false);
});
