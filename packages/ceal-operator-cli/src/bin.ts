#!/usr/bin/env node

import { runCealctlCommand } from "./index.js";

process.exitCode = runCealctlCommand(process.argv.slice(2), {
	stdout: process.stdout,
	stderr: process.stderr,
});
