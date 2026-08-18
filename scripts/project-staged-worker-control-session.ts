#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type {
	CealLeasedConsumerDispositionControlRequest,
	CealLeasedConsumerDispositionControlResponse,
} from "../packages/ceal-protocol/src/leased-consumer-disposition-control.ts";
import { contractModule, controlSessionContractFromVerifiedConformance } from "./generate-leased-consumer-handoff-runtime.ts";
import type { JsonRecord } from "./lib/json-record.ts";

export const PROJECT_STAGED_WORKER_CONTROL_SESSION_PATH = fileURLToPath(import.meta.url);

type ProtocolModule = {
	decodeCealLeasedConsumerDispositionControlRequest: (value: unknown) => CealLeasedConsumerDispositionControlRequest;
	decodeCealLeasedConsumerDispositionControlResponse: (value: unknown) => CealLeasedConsumerDispositionControlResponse;
};

type ProjectStagedWorkerControlSessionOptions = {
	workerStage: string;
	protocolModule: string;
	controlConformance: string;
	handoff: JsonRecord;
};

export async function projectStagedWorkerControlSession({
	workerStage,
	protocolModule,
	controlConformance,
	handoff,
}: ProjectStagedWorkerControlSessionOptions) {
	const protocol: ProtocolModule = await import(pathToFileURL(protocolModule).href);
	const contractPath = path.join(workerStage, "leased-consumer-control-session-contract.json");
	const generatedPath = path.join(workerStage, "src/generated/leased-consumer-control-session-contract.ts");
	const projected = controlSessionContractFromVerifiedConformance(
		JSON.parse(readFileSync(contractPath, "utf8")),
		readFileSync(controlConformance),
		{
			decodeRequest: protocol.decodeCealLeasedConsumerDispositionControlRequest,
			decodeResponse: protocol.decodeCealLeasedConsumerDispositionControlResponse,
		},
		{ materialize: true, handoff },
	);
	const bytes = Buffer.from(`${JSON.stringify(projected, null, "\t")}\n`, "utf8");
	const contract = { bytes, value: projected, sha256: createHash("sha256").update(bytes).digest("hex") };
	writeFileSync(contractPath, bytes);
	writeFileSync(
		generatedPath,
		contractModule(
			"The private control-session release contract is validated before it is embedded.",
			"LEASED_CONSUMER_CONTROL_SESSION",
			contract,
		),
	);
	return contract;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		if (process.argv.length !== 6) throw new Error("invalid_arguments");
		const result = await projectStagedWorkerControlSession({
			workerStage: process.argv[2],
			protocolModule: process.argv[3],
			controlConformance: process.argv[4],
			handoff: JSON.parse(process.argv[5]),
		});
		console.log(JSON.stringify({ ok: true, sha256: result.sha256 }));
	} catch {
		console.error(JSON.stringify({ ok: false, error_code: "staged_control_projection_failed" }));
		process.exitCode = 2;
	}
}
