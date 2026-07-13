#!/usr/bin/env node

import { renderPlainYamlDocument, runCealctlCommand } from "./index.js";

void Promise.resolve(runCealctlCommand(process.argv.slice(2), {
	stdout: process.stdout,
	stderr: process.stderr,
}, { readSecret: readStdinSecret })).then((code) => { process.exitCode = code; }, () => {
	process.stdout.write(renderPlainYamlDocument({
		schema_version: "cealctl.error.v1", command: "cealctl", ok: false, status: "error",
		credential_context: "cealctl_operator_admin_profile",
		error: { kind: "unexpected_failure", message: "The Ceal operator command could not be completed.", next_action: "Retry once, then inspect Gateway status." },
	}));
	process.exitCode = 3;
});

async function readStdinSecret(): Promise<string> {
	let value = "";
	for await (const chunk of process.stdin) {
		value += String(chunk);
		if (value.length > 4097) throw new Error("stdin_secret_too_large");
	}
	return value.replace(/\r?\n$/u, "");
}
