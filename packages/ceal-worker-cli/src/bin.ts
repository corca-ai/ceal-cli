#!/usr/bin/env node

import { runCealStaticCommand } from "./command-surface.js";
import { LEASED_CONSUMER_ATTACHMENT_STREAM_ENTRYPOINT_ARGV } from "./generated/leased-consumer-attachment-stream-contract.js";
import { LEASED_CONSUMER_CARRIER_ENTRYPOINT_ARGV } from "./generated/leased-consumer-carrier-contract.js";
import { LEASED_CONSUMER_CONTROL_SESSION_ENTRYPOINT_ARGV } from "./generated/leased-consumer-control-session-contract.js";
import { renderPlainYamlDocument } from "./yaml.js";

const PRIVATE_ENTRYPOINTS = new Set<string>([
	LEASED_CONSUMER_CARRIER_ENTRYPOINT_ARGV,
	LEASED_CONSUMER_CONTROL_SESSION_ENTRYPOINT_ARGV,
	LEASED_CONSUMER_ATTACHMENT_STREAM_ENTRYPOINT_ARGV,
]);

const args = process.argv.slice(2);
void dispatch(args).then(
	(code) => {
		process.exitCode = code;
	},
	() => {
		writeUnexpectedFailure();
	},
);

async function dispatch(args: readonly string[]): Promise<number> {
	if (privateEntrypointCandidate(args)) {
		const { runPrivateCli } = await import("./private-bin-runtime.js");
		const privateResult = await runPrivateCli(args[0]);
		if (privateResult !== undefined) return privateResult;
	}
	// The diagnostic flag is deliberately prefix-only. Stripping arbitrary
	// `--timing` operands from inside a command would make malformed route input
	// look valid, and applying it to a private entrypoint would turn a public
	// diagnostic option into a private bootstrap path.
	const timingRequested = args[0] === "--timing";
	const publicArgs = timingRequested ? args.slice(1) : args;
	const timing = timingRequested ? (await import("./timing.js")).createCealTimingRecorder(process.stderr) : undefined;
	// `performance.now()` is monotonic from Node process start, so this includes
	// module/bootstrap work that happened before option parsing without exposing a
	// wall-clock timestamp or inventing a second process-start clock.
	timing?.completed("cli_bootstrap", process.uptime() * 1_000);
	const staticResult = await runCealStaticCommand(publicArgs, { stdout: process.stdout, stderr: process.stderr });
	if (staticResult !== undefined) return staticResult;
	const importSpan = timing?.start("runtime_import");
	try {
		const { runPublicCli } = await import("./public-bin-runtime.js");
		importSpan?.finish("ok");
		return await runPublicCli(publicArgs, timing);
	} catch (error) {
		importSpan?.finish("error");
		throw error;
	}
}

function privateEntrypointCandidate(args: readonly string[]): args is readonly [string] {
	return args.length === 1 && typeof args[0] === "string" && PRIVATE_ENTRYPOINTS.has(args[0]);
}

function writeUnexpectedFailure(): void {
	process.stdout.write(
		renderPlainYamlDocument({
			schema_version: "ceal.error.v1",
			command: "ceal",
			ok: false,
			status: "error",
			credential_context: "gateway_issued_client_session",
			error: {
				kind: "unexpected_failure",
				message: "The Ceal command could not be completed.",
				next_action: "Retry once, then inspect the installed version and Gateway reachability.",
			},
		}),
	);
	process.exitCode = 3;
}
