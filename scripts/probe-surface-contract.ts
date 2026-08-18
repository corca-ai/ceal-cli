import type { CealCommandDefinition } from "../packages/ceal-worker-cli/src/command-definitions.ts";
import type { CealSubcommandDefinition } from "../packages/ceal-worker-cli/src/subcommands.ts";
import { isObjectRecord } from "./lib/object-record.ts";

export type ProbeCommandDefinition = Pick<
	CealCommandDefinition,
	"description" | "effect" | "evidence" | "lifecycle" | "recovery" | "result_schema" | "usage"
> & { name: string };
export type ProbeSubcommandDefinition = Pick<
	CealSubcommandDefinition,
	"default" | "description" | "effect" | "evidence" | "recovery" | "result_schema" | "route" | "usage"
> & { parent: string };

export type SplitSubcommandResult = {
	subcommand?: ProbeSubcommandDefinition;
	rest: readonly string[];
};

export type ProbeModule = {
	CEAL_COMMANDS: readonly ProbeCommandDefinition[];
	CEAL_AGENT_HOST_ENVIRONMENT_VARIABLES: readonly string[];
	splitSubcommandRoute: (parent: string, options: readonly string[]) => unknown;
};

export function lookupProbeBinary<T>(binaries: Readonly<Record<string, T>>, name: string | undefined): T | undefined {
	return typeof name === "string" && Object.hasOwn(binaries, name) ? binaries[name] : undefined;
}

function isStringArray(value: unknown): value is readonly string[] {
	return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isEffect(value: unknown): value is CealCommandDefinition["effect"] {
	return value === "read_only" || value === "local_write" || value === "read_only_or_local_write" || value === "remote_write";
}

function hasProbeDefinitionFields(value: unknown): value is Record<string, unknown> {
	return (
		isObjectRecord(value) &&
		typeof value.description === "string" &&
		typeof value.usage === "string" &&
		isEffect(value.effect) &&
		(value.evidence === "surface" || value.evidence === "surface_or_host_decision") &&
		typeof value.result_schema === "string" &&
		typeof value.recovery === "string"
	);
}

function isCliRouteToken(value: unknown): value is string {
	return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(value);
}

export function isAgentHostEnvironmentVariables(value: unknown): value is readonly string[] {
	return (
		Array.isArray(value) &&
		value.length > 0 &&
		value.every((entry) => typeof entry === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/u.test(entry)) &&
		new Set(value).size === value.length
	);
}

function isCommandDefinition(value: unknown): value is ProbeCommandDefinition {
	return (
		hasProbeDefinitionFields(value) &&
		typeof value.name === "string" &&
		(value.lifecycle === undefined || value.lifecycle === "until_interrupted")
	);
}

function isSubcommandDefinition(value: unknown, parent: string): value is ProbeSubcommandDefinition {
	return (
		hasProbeDefinitionFields(value) &&
		value.parent === parent &&
		isStringArray(value.route) &&
		value.route.length > 0 &&
		value.route.every(isCliRouteToken) &&
		(value.default === undefined || value.default === true)
	);
}

export function isSplitSubcommandResult(value: unknown, parent: string): value is SplitSubcommandResult {
	return (
		isObjectRecord(value) && (value.subcommand === undefined || isSubcommandDefinition(value.subcommand, parent)) && isStringArray(value.rest)
	);
}

export function isProbeModule(value: unknown): value is ProbeModule {
	return (
		isObjectRecord(value) &&
		Array.isArray(value.CEAL_COMMANDS) &&
		value.CEAL_COMMANDS.every(isCommandDefinition) &&
		isAgentHostEnvironmentVariables(value.CEAL_AGENT_HOST_ENVIRONMENT_VARIABLES) &&
		typeof value.splitSubcommandRoute === "function"
	);
}

export function resolveProbeRoute(moduleValue: ProbeModule, command: string, tail: readonly string[]): SplitSubcommandResult | undefined {
	const result: unknown = moduleValue.splitSubcommandRoute(command, tail);
	if (!isSplitSubcommandResult(result, command)) return undefined;
	return result;
}
