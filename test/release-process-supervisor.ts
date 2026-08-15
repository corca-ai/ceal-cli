import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type BoundedProcessOptions, runBoundedProcess } from "../packages/ceal-worker-cli/src/bounded-process.ts";

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const payload = parsePayload(JSON.parse(readFileSync(0, "utf8")));
	const result = await runBoundedProcess(payload.command, payload.args, payload.bounds);
	process.stdout.write(JSON.stringify(result));
}

interface SupervisorPayload {
	command: string;
	args: string[];
	bounds: BoundedProcessOptions;
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new Error(`release supervisor payload ${label} must be an object`);
	return Object.fromEntries(Object.entries(value));
}

function requiredString(record: Record<string, unknown>, key: string): string {
	const value = record[key];
	if (typeof value !== "string") throw new Error(`release supervisor payload ${key} must be a string`);
	return value;
}

function boundedNumber(record: Record<string, unknown>, key: string): number {
	const value = record[key];
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
		throw new Error(`release supervisor payload ${key} must be a finite non-negative number`);
	return value;
}

export function parsePayload(value: unknown): SupervisorPayload {
	const payload = objectValue(value, "root");
	const rawArgs = payload.args;
	if (!Array.isArray(rawArgs) || rawArgs.some((arg) => typeof arg !== "string"))
		throw new Error("release supervisor payload args must be a string array");
	const rawBounds = objectValue(payload.bounds, "bounds");
	const bounds: BoundedProcessOptions = {
		cwd: requiredString(rawBounds, "cwd"),
		env: parseEnv(rawBounds.env),
		timeoutMs: boundedNumber(rawBounds, "timeoutMs"),
		terminationGraceMs: boundedNumber(rawBounds, "terminationGraceMs"),
		postKillReportMs: boundedNumber(rawBounds, "postKillReportMs"),
		postExitDrainMs: boundedNumber(rawBounds, "postExitDrainMs"),
		maxCapturedOutputBytes: boundedNumber(rawBounds, "maxCapturedOutputBytes"),
	};
	if (rawBounds.timeoutStartMarker !== undefined) bounds.timeoutStartMarker = requiredString(rawBounds, "timeoutStartMarker");
	if (rawBounds.timeoutStartDeadlineMs !== undefined) bounds.timeoutStartDeadlineMs = boundedNumber(rawBounds, "timeoutStartDeadlineMs");
	return { command: requiredString(payload, "command"), args: rawArgs, bounds };
}

function parseEnv(value: unknown): NodeJS.ProcessEnv {
	const input = objectValue(value, "env");
	const env: NodeJS.ProcessEnv = {};
	for (const [key, entry] of Object.entries(input)) {
		if (entry !== undefined && typeof entry !== "string") throw new Error(`release supervisor payload env.${key} must be a string`);
		env[key] = entry;
	}
	return env;
}
