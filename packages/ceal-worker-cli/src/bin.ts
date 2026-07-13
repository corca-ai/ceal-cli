#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { renderPlainYamlDocument, runCealCommand } from "./index.js";
import { createCealProfileStore } from "./profile-store.js";

let profileStore: ReturnType<typeof createCealProfileStore> | undefined;
try { profileStore = createCealProfileStore(process.env.HOME); } catch { profileStore = undefined; }

void runCealCommand(process.argv.slice(2), {
	stdout: process.stdout,
	stderr: process.stderr,
}, {
	readSecret: readStdinSecret,
	loadProfile: profileStore ? () => profileStore.load() : undefined,
	saveProfile: profileStore ? (profile) => profileStore.save(profile) : undefined,
	nextRequestId: () => `ceal:${randomUUID()}`,
}).then((code) => {
	process.exitCode = code;
}, () => {
	process.stdout.write(renderPlainYamlDocument({
		schema_version: "ceal.error.v1",
		command: "ceal",
		ok: false,
		status: "error",
		credential_context: "gateway_issued_client_profile",
		error: {
			kind: "unexpected_failure",
			message: "The Ceal command could not be completed.",
			next_action: "Retry once, then inspect the installed version and Gateway reachability.",
		},
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
