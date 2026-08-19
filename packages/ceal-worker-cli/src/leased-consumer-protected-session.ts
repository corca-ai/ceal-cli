import {
	closeReadable,
	onceAsync,
	openInheritedReadable,
	readBeforeDeadline,
	readBoundedStream,
	type TransportTimerSeams,
} from "./private-worker-transport.js";
import { parseStrictJson } from "./strict-json.js";
import { type CealLeasedConsumerControlSession, decodeCealLeasedConsumerControlSession } from "@corca-ai/ceal-protocol";
import { fstatSync } from "node:fs";

export interface ProtectedSessionContract {
	readonly child_fd: number;
	readonly schema_version: string;
	readonly maximum_bytes: number;
	readonly deadline_ms: number;
}

export interface ProtectedSessionRuntime extends TransportTimerSeams {
	/** Test seam only. Production reads the launcher's environment. */
	readonly env?: Readonly<Record<string, string | undefined>>;
	/** Test seam only. Production reads the launcher-owned descriptor. */
	readonly readProtectedSession?: () => Promise<Uint8Array>;
	/** Test seam only. Production closes the launcher-owned descriptor. */
	readonly closeProtectedSession?: () => Promise<void>;
}

/**
 * Reads the one protected Gateway session shared by private Worker modes.
 * Contract values are supplied by each generated contract, so the helper owns
 * only descriptor lifecycle and decoding—not a route, credential, or limit.
 */
export async function readLeasedConsumerProtectedSession(
	contract: ProtectedSessionContract,
	runtime: ProtectedSessionRuntime,
): Promise<CealLeasedConsumerControlSession> {
	assertProtectedSessionContract(contract);
	let close = onceAsync(async () => {});
	try {
		const fd = runtime.readProtectedSession ? undefined : createProtectedSessionFd(contract);
		close = onceAsync(runtime.closeProtectedSession ?? (() => fd?.close() ?? Promise.resolve()));
		const bytes = await readBeforeDeadline(
			runtime,
			contract.deadline_ms,
			runtime.readProtectedSession ?? (() => fd?.read() ?? Promise.reject(new Error("missing_session"))),
			close,
		);
		if (bytes === null) throw new Error("session_unavailable");
		return decodeCealLeasedConsumerControlSession(parseStrictJson(bytes, contract.maximum_bytes));
	} finally {
		await close();
	}
}

/**
 * Reusable bounded deadline validation for generated private contracts. The
 * environment variable is deliberately passed by the caller so this helper
 * cannot silently choose one mode's contract bounds for another.
 */
export function resolveLeasedConsumerOperationDeadlineMs(
	env: Readonly<Record<string, string | undefined>>,
	environmentVariable: string,
	bounds: Readonly<{ minimum: number; maximum: number }>,
): number {
	const raw = env[environmentVariable];
	if (raw === undefined) return bounds.minimum;
	if (!/^\d+$/u.test(raw)) throw new Error("invalid_operation_deadline");
	const value = Number(raw);
	if (!Number.isSafeInteger(value) || value < bounds.minimum || value > bounds.maximum) throw new Error("invalid_operation_deadline");
	return value;
}

function createProtectedSessionFd(contract: ProtectedSessionContract): Readonly<{
	readonly read: () => Promise<Uint8Array>;
	readonly close: () => Promise<void>;
}> {
	if (!fstatSync(contract.child_fd).isFIFO()) throw new Error("missing_session");
	const stream = openInheritedReadable(contract.child_fd);
	return Object.freeze({
		read: () => readBoundedStream(stream, contract.maximum_bytes, () => stream.destroy()),
		close: () => closeReadable(stream),
	});
}

function assertProtectedSessionContract(contract: ProtectedSessionContract): void {
	if (
		!Number.isSafeInteger(contract.child_fd) ||
		contract.child_fd < 0 ||
		typeof contract.schema_version !== "string" ||
		contract.schema_version.length === 0 ||
		!Number.isSafeInteger(contract.maximum_bytes) ||
		contract.maximum_bytes < 1 ||
		!Number.isSafeInteger(contract.deadline_ms) ||
		contract.deadline_ms < 1
	)
		throw new Error("invalid_protected_session_contract");
}
