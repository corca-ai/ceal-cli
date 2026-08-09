import { performance } from "node:perf_hooks";

// One fixed vocabulary for the opt-in performance surface. A phase name is a
// contract readers can aggregate, so callers may not invent one at the point of
// measurement. The values describe client-side boundaries only; Gateway-owned
// processing time remains the separate `gateway_elapsed_ms` receipt field.
export const CEAL_TIMING_STAGES = [
	"cli_bootstrap",
	"runtime_import",
	"runtime_prepare",
	"session_load",
	"local_store_lock_wait",
	"session_refresh",
	"session_revoke",
	"session_enrollment_exchange",
	"session_adoption_start",
	"session_adoption_poll",
	"discovery_cache_load",
	"gateway_handshake",
	"gateway_discovery",
	"gateway_call",
	"gateway_readback",
	"receipt_spool_append",
	"receipt_spool_load",
	"observer_transcript_scan",
	"observer_session_scan",
	"guide_inspect",
	"guide_register",
	"update_check",
	"update_download_install",
	"update_verify",
	"update_installed_readback",
] as const;

export type CealTimingStage = (typeof CEAL_TIMING_STAGES)[number];
export type CealTimingOutcome = "ok" | "error";

export interface CealTimingSpan {
	finish(outcome?: CealTimingOutcome): void;
}

export interface CealTimingRecorder {
	start(stage: CealTimingStage): CealTimingSpan;
	completed(stage: CealTimingStage, elapsedMs: number, outcome?: CealTimingOutcome): void;
}

export function startCealTiming(recorder: CealTimingRecorder | undefined, stage: CealTimingStage): CealTimingSpan | undefined {
	try {
		return recorder?.start(stage);
	} catch {
		return undefined;
	}
}

export function finishCealTiming(span: CealTimingSpan | undefined, outcome: CealTimingOutcome = "ok"): void {
	try {
		span?.finish(outcome);
	} catch {
		/* observation-only, as start is */
	}
}

interface TimingWriter {
	write(chunk: string): unknown;
}

/**
 * JSON Lines on stderr keeps the command's one-YAML stdout contract intact.
 * Only fixed tokens and monotonic durations cross this boundary: no route
 * operands, endpoint, identity, request reference, payload, or error prose.
 */
export function createCealTimingRecorder(stderr: TimingWriter, now: () => number = () => performance.now()): CealTimingRecorder {
	let sequence = 0;
	const event = (value: Record<string, unknown>) => {
		try {
			stderr.write(`${JSON.stringify(value)}\n`);
		} catch {
			// Diagnostics are observation-only. A closed or rejecting stderr may
			// drop timing evidence, but it must never change the command result —
			// especially after an updater has already committed a new generation.
		}
	};
	const begin = (stage: CealTimingStage, startedAt: number, currentSequence: number) => {
		event({ schema_version: "ceal.timing.v1", sequence: currentSequence, event: "start", stage });
		let finished = false;
		return (outcome: CealTimingOutcome = "ok") => {
			if (finished) return;
			finished = true;
			event({
				schema_version: "ceal.timing.v1",
				sequence: currentSequence,
				event: "finish",
				stage,
				elapsed_ms: boundedElapsed(now() - startedAt),
				outcome,
			});
		};
	};
	return {
		start(stage) {
			sequence += 1;
			const finish = begin(stage, now(), sequence);
			return { finish };
		},
		completed(stage, elapsedMs, outcome = "ok") {
			sequence += 1;
			event({ schema_version: "ceal.timing.v1", sequence, event: "start", stage });
			event({
				schema_version: "ceal.timing.v1",
				sequence,
				event: "finish",
				stage,
				elapsed_ms: boundedElapsed(elapsedMs),
				outcome,
			});
		},
	};
}

function boundedElapsed(value: number): number {
	if (!Number.isFinite(value) || value < 0) return 0;
	return Math.round(value * 1_000) / 1_000;
}

export async function withCealTiming<T>(
	recorder: CealTimingRecorder | undefined,
	stage: CealTimingStage,
	action: () => Promise<T>,
): Promise<T> {
	const span = startCealTiming(recorder, stage);
	try {
		const result = await action();
		finishCealTiming(span, "ok");
		return result;
	} catch (error) {
		finishCealTiming(span, "error");
		throw error;
	}
}

export function withCealTimingSync<T>(recorder: CealTimingRecorder | undefined, stage: CealTimingStage, action: () => T): T {
	const span = startCealTiming(recorder, stage);
	try {
		const result = action();
		finishCealTiming(span, "ok");
		return result;
	} catch (error) {
		finishCealTiming(span, "error");
		throw error;
	}
}
