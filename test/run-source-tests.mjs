import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LOADER_URL = pathToFileURL(resolve(REPO_ROOT, "test", "source-loader.mjs")).href;

const args = process.argv.slice(2);
if (args.length === 0) throw new Error("usage: node test/run-source-tests.mjs <test-file-or-glob> [...]");
const inherited = process.env.NODE_OPTIONS?.trim();
const result = spawnSync(process.execPath, ["--test", ...args], {
	stdio: "inherit",
	env: {
		...process.env,
		CEAL_SOURCE_TEST_REPO_ROOT: REPO_ROOT,
		NODE_OPTIONS: `${inherited ? `${inherited} ` : ""}--import=${LOADER_URL}`,
	},
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
