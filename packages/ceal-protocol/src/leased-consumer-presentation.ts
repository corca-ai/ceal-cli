export const CEAL_LEASED_CONSUMER_MESSAGE_PRESENTATION_SCHEMA = "ceal.gateway_leased_agent_message_presentation.v1" as const;
export const CEAL_LEASED_CONSUMER_MESSAGE_PRESENTATION_V2_SCHEMA = "ceal.gateway_leased_agent_message_presentation.v2" as const;
export const CEAL_LEASED_CONSUMER_MESSAGE_PRESENTATION_MAX_CONTROLS = 8;
export const CEAL_LEASED_CONSUMER_MESSAGE_PRESENTATION_CONTROL_TOKEN_MAX_BYTES = 512;
export const CEAL_LEASED_CONSUMER_MESSAGE_PRESENTATION_CONTROL_LABEL_MAX_BYTES = 256;
export const CEAL_LEASED_CONSUMER_PROGRESS_PHASES = Object.freeze([
	"request_review",
	"information_gathering",
	"work_execution",
	"result_check",
] as const);
export const CEAL_LEASED_CONSUMER_MESSAGE_PRESENTATION_MAX_COMPLETED_PHASES = CEAL_LEASED_CONSUMER_PROGRESS_PHASES.length - 1;
export type CealLeasedConsumerProgressPhase = typeof CEAL_LEASED_CONSUMER_PROGRESS_PHASES[number];

/** Shared relational grammar for the protocol decoder and Gateway resolver. */
export function validCealLeasedConsumerCompletedPhaseHistory(value: Record<string, unknown>): boolean {
	if (!Object.hasOwn(value, "completed_phases")) return true;
	const completed = value.completed_phases;
	if (value.intent !== "progress" || !Array.isArray(completed) || completed.length > CEAL_LEASED_CONSUMER_MESSAGE_PRESENTATION_MAX_COMPLETED_PHASES) return false;
	let priorIndex = -1;
	for (const phase of completed) {
		const phaseIndex = CEAL_LEASED_CONSUMER_PROGRESS_PHASES.indexOf(phase as never);
		if (phaseIndex < 0 || phaseIndex <= priorIndex) return false;
		priorIndex = phaseIndex;
	}
	if (completed.length === 0) return true;
	const activeIndex = CEAL_LEASED_CONSUMER_PROGRESS_PHASES.indexOf(value.phase as never);
	return activeIndex >= 0 && priorIndex < activeIndex;
}

/**
 * Closed semantic presentation DTO (S1 decision, 2026-08-04): the Agent
 * declares run semantics (intent, abortability, phase); the provider
 * connector owns rendering. Never provider block markup.
 */
export interface CealLeasedConsumerMessagePresentationV1 {
	schema_version: typeof CEAL_LEASED_CONSUMER_MESSAGE_PRESENTATION_SCHEMA;
	intent: "progress" | "final" | "stop" | "transient_notice";
	abortable: boolean;
	phase?: string;
	/** Semantic progress plan (S3): ordered bounded steps the connector
	 * renders; never provider markup. */
	plan?: readonly { text: string; status: "pending" | "active" | "completed" }[];
}

/**
 * Selected-v5 neutral control declaration. The token is Agent-owned and opaque
 * to Gateway/provider adapters; the label is presentation-only. Handler names,
 * action kinds, provider markup, and provider control values are deliberately
 * absent from this contract.
 */
export interface CealLeasedConsumerMessagePresentationControl {
	token: string;
	label: string;
}

export interface CealLeasedConsumerMessagePresentationV2Base {
	schema_version: typeof CEAL_LEASED_CONSUMER_MESSAGE_PRESENTATION_V2_SCHEMA;
	abortable: boolean;
	phase?: string;
	plan?: readonly { text: string; status: "pending" | "active" | "completed" }[];
	controls: readonly CealLeasedConsumerMessagePresentationControl[];
}

export interface CealLeasedConsumerMessageProgressPresentationV2 extends CealLeasedConsumerMessagePresentationV2Base {
	intent: "progress";
	/** Prior active phases recorded only when selected-v5 Agent state received
	 * a forward transition. This is a strict-forward subsequence, not an
	 * inferred prefix or provider-delivery claim. */
	completed_phases?: readonly CealLeasedConsumerProgressPhase[];
}

export interface CealLeasedConsumerMessageTerminalPresentationV2 extends CealLeasedConsumerMessagePresentationV2Base {
	intent: "final" | "stop" | "transient_notice";
	completed_phases?: never;
}

export type CealLeasedConsumerMessagePresentationV2 =
	| CealLeasedConsumerMessageProgressPresentationV2
	| CealLeasedConsumerMessageTerminalPresentationV2;

export type CealLeasedConsumerMessagePresentation =
	| CealLeasedConsumerMessagePresentationV1
	| CealLeasedConsumerMessagePresentationV2;
