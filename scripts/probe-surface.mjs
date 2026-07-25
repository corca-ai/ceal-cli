#!/usr/bin/env node
// Probe guard for the installed CLI surfaces.
//
// An ad hoc probe ("does this route render its help / what does it answer now?")
// is a read-only question, but nothing stopped it from being typed against a
// route that changes state, in the operator's real HOME. That is how a
// verification loop revoked a live Gateway client session: `session logout` sat
// in a list of otherwise read-only spot checks.
//
// Both CLIs now declare an `effect` per command and per subcommand, so the guard
// is derivable rather than a habit: resolve the route through the declaration,
// refuse anything that is not `read_only`, and run in a throwaway HOME so even a
// read-only route cannot touch real local state.
//
// Usage:
//   node scripts/probe-surface.mjs ceal capabilities targets --help
//   node scripts/probe-surface.mjs cealctl connectors show
//   node scripts/probe-surface.mjs --allow-effect local_write ceal guide status
//
// `--allow-effect <effect>` is the deliberate escape hatch: it still runs in the
// throwaway HOME, so it can prove a local-write route's shape without touching
// the operator's session. No flag ever grants the real HOME; use the installed
// binary directly, on purpose, for that.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BINARIES = {
	ceal: { packageDir: "ceal-worker-cli", commands: "CEAL_COMMANDS", subcommands: "CEAL_SUBCOMMANDS" },
	cealctl: { packageDir: "ceal-operator-cli", commands: "CEALCTL_COMMANDS", subcommands: "CEALCTL_SUBCOMMANDS" },
};

function fail(message) {
	process.stderr.write(`probe-surface: ${message}\n`);
	process.exit(2);
}

const argv = process.argv.slice(2);
const allowed = new Set(["read_only"]);
while (argv[0] === "--allow-effect") {
	const effect = argv[1];
	if (!effect) fail("--allow-effect needs an effect name");
	allowed.add(effect);
	argv.splice(0, 2);
}

const [binary, command, ...tail] = argv;
const target = BINARIES[binary];
if (!target) fail(`first argument must be one of: ${Object.keys(BINARIES).join(", ")}`);
if (!command) fail(`usage: probe-surface.mjs [--allow-effect <effect>] ${binary} <command> [route/options ...]`);

const dist = path.join(ROOT, "packages", target.packageDir, "dist", "index.js");
const module = await import(dist).catch(() => fail(`build first: ${dist} is missing`));
const commands = module[target.commands];
const subcommands = module[target.subcommands];
const definition = commands.find((entry) => entry.name === command);
if (!definition) fail(`${binary} has no command '${command}'`);

// The declaration decides which route this is, exactly as the dispatcher does.
const leading = [];
for (const token of tail) {
	if (token.startsWith("-")) break;
	leading.push(token);
}
let route = definition;
for (let length = leading.length; length > 0; length -= 1) {
	const match = subcommands.find((entry) => entry.parent === command
		&& entry.route.length === length
		&& entry.route.every((token, index) => token === leading[index]));
	if (match) { route = match; break; }
}

const name = route.route ? `${command} ${route.route.join(" ")}` : command;
const isHelp = tail.some((token) => token === "--help" || token === "-h");
if (!isHelp && !allowed.has(route.effect)) {
	fail(`refusing '${binary} ${name}': declared effect is ${route.effect}, not read_only.\n`
		+ `  A probe must not change state. Pass --allow-effect ${route.effect} to run it in the\n`
		+ `  throwaway HOME anyway, or run the installed binary directly and deliberately.`);
}

const home = mkdtempSync(path.join(tmpdir(), "ceal-probe-home-"));
try {
	const result = spawnSync(process.execPath, [path.join(ROOT, "packages", target.packageDir, "dist", "bin.js"), command, ...tail], {
		encoding: "utf8",
		env: { ...process.env, HOME: home, CODEX_HOME: path.join(home, ".codex") },
	});
	process.stderr.write(`probe-surface: ${binary} ${name} (effect: ${route.effect}${isHelp ? ", help" : ""}) in throwaway HOME\n`);
	if (result.stdout) process.stdout.write(result.stdout);
	if (result.stderr) process.stderr.write(result.stderr);
	process.exitCode = result.status ?? 1;
} finally {
	rmSync(home, { recursive: true, force: true });
}
