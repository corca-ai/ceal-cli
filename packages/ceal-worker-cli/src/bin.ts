#!/usr/bin/env node

import { runCealCommand } from "./index.js";

process.exitCode = runCealCommand(process.argv.slice(2), {
	stdout: process.stdout,
	stderr: process.stderr,
});
