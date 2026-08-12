import { readFileSync } from "node:fs";
import { runBoundedProcess } from "../packages/ceal-worker-cli/dist/bounded-process.js";

const payload = JSON.parse(readFileSync(0, "utf8"));
const result = await runBoundedProcess(payload.command, payload.args, payload.bounds);
process.stdout.write(JSON.stringify(result));
