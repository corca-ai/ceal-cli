#!/usr/bin/env node
// Probe guard for the checkout-built CLI surfaces.
//
// An ad hoc probe ("does this route render its help / what does it answer now?")
// is a read-only question, but nothing stopped it from being typed against a
// route that changes state, in the operator's real HOME. That is how a
// verification loop revoked a live Gateway client session: `session logout` sat
// in a list of otherwise read-only spot checks.
//
// The CLI declares an `effect` per command and per subcommand, so the guard
// is derivable rather than a habit: resolve the route through the declaration,
// refuse anything that is not `read_only`, and run in a throwaway HOME so even a
// read-only route cannot touch real local state.
//
// Usage:
//   node scripts/probe-surface.ts ceal capabilities targets --help
//   node scripts/probe-surface.ts --allow-effect local_write ceal guide status
//
// `--allow-effect <effect>` is the deliberate escape hatch: it still runs in the
// throwaway HOME, so it can prove a local-write route's shape without touching
// the operator's session. No flag ever grants the real HOME; an installed live
// readback is a separate deliberate operation.
//
// `remote_write` is the one effect the hatch refuses. A throwaway HOME is what
// makes the hatch safe, and it neutralizes LOCAL state only: it cannot take back
// a revoked Gateway session, a consumed enrollment code, or a message posted to
// a provider. An escape hatch whose safety argument does not cover the effect it
// is being asked to permit is not an escape hatch.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { exitWith } from "./lib/exit-with.ts";
import { isAgentHostEnvironmentVariables, isProbeModule, lookupProbeBinary, resolveProbeRoute } from "./probe-surface-contract.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// `cealctl` was a second entry here until its source left this repository. The
// map stays a map: the guard is about resolving a binary's declared routes, not
// about there being exactly one binary.
const BINARIES = {
	ceal: {
		packageDir: "ceal-worker-cli",
		// The agent-host table declares which environment variables can redirect a
		// host's state root, and this guard is the caller that must neutralize all
		// of them. It used to name two of them by hand, which is the copy the
		// declaration's own comment warns goes stale the moment a host row is
		// added — silently, by aiming a declared local write at the operator's real
		// configuration directory. Read the set from the declaration instead.
		agentHosts: "CEAL_AGENT_HOST_ENVIRONMENT_VARIABLES",
	},
};

function fail(message: string): never {
	exitWith("probe-surface", message, 2);
}

const argv = process.argv.slice(2);
const allowed = new Set(["read_only"]);
// Named rather than derived from the declarations: this is the list the throwaway
// HOME cannot make safe, so it must not widen just because a new route picked up
// a new effect string.
const NEVER_ALLOWED = new Set(["remote_write"]);

while (argv[0] === "--allow-effect") {
	const effect = argv[1];
	if (!effect) fail("--allow-effect needs an effect name");
	if (NEVER_ALLOWED.has(effect))
		fail(`--allow-effect ${effect} is refused: a throwaway HOME neutralizes local state only, and cannot undo a Gateway or provider change`);
	allowed.add(effect);
	argv.splice(0, 2);
}

const [binary, command, ...tail] = argv;
const target = lookupProbeBinary(BINARIES, binary);
if (!target) fail(`first argument must be one of: ${Object.keys(BINARIES).join(", ")}`);
if (!command) fail(`usage: probe-surface.mjs [--allow-effect <effect>] ${binary} <command> [route/options ...]`);

const dist = path.join(ROOT, "packages", target.packageDir, "dist", "index.js");
const importedModule: unknown = await import(dist).catch(() => fail(`build first: ${dist} is missing`));
if (!isProbeModule(importedModule)) fail(`${dist} does not export a valid probe declaration module`);
const module = importedModule;
const agentHostVariables = module.CEAL_AGENT_HOST_ENVIRONMENT_VARIABLES;
// Refuse rather than probe with nothing pinned: an empty set would mean every
// inherited host variable still reaches the operator's real state, which is the
// failure this guard exists to prevent.
if (!isAgentHostEnvironmentVariables(agentHostVariables)) {
	fail(`${dist} declares no ${target.agentHosts} to neutralize`);
}
const commands = module.CEAL_COMMANDS;
const definition = commands.find((entry) => entry.name === command);
if (!definition) fail(`${binary} has no command '${command}'`);

// Use the same resolver as dispatch. This includes a parent's declared default
// leaf: bare `guide` and `session` are their read-only status routes, not the
// wider parent effect that summarizes every child in the family.
const resolvedRoute = resolveProbeRoute(module, definition.name, tail);
if (!resolvedRoute) fail("built module returned an invalid subcommand route");
const route = resolvedRoute.subcommand ?? definition;

const name = "route" in route && route.route.length > 0 ? `${command} ${route.route.join(" ")}` : command;
const isHelp = tail.some((token) => token === "--help" || token === "-h");
if (!isHelp && !allowed.has(route.effect)) {
	// The two refusals differ in what they offer, because offering a hatch this
	// guard would then refuse is worse than offering none: it reads as "retry
	// with a flag" for the one class of route where retrying is the mistake.
	const remedy = NEVER_ALLOWED.has(route.effect)
		? "  A probe must not change state, and no flag runs this one: a throwaway HOME\n" +
			"  neutralizes local state only. Run the installed binary directly and\n" +
			"  deliberately, against the session you mean to change."
		: `  A probe must not change state. Pass --allow-effect ${route.effect} to run it in the\n` +
			"  throwaway HOME anyway, or run the installed binary directly and deliberately.";
	fail(`refusing '${binary} ${name}': declared effect is ${route.effect}, not read_only.\n${remedy}`);
}
if (!isHelp && "lifecycle" in route && route.lifecycle === "until_interrupted") {
	fail(
		`refusing '${binary} ${name}': declared lifecycle is until_interrupted, so a synchronous surface probe would not settle.\n` +
			"  Inspect its help through this guard, or run the installed binary directly and stop it deliberately.",
	);
}

const home = mkdtempSync(path.join(tmpdir(), "ceal-probe-home-"));
try {
	const result = spawnSync(process.execPath, [path.join(ROOT, "packages", target.packageDir, "dist", "bin.js"), command, ...tail], {
		encoding: "utf8",
		// Every inherited variable that can redirect the probed binary at real
		// local state is pinned inside the throwaway HOME: the agent-host overrides
		// (or an inherited one aims a declared local write at the operator's real
		// agent configuration directory) and XDG_RUNTIME_DIR (or an operator-real
		// admin Gateway socket stays reachable from a probe).
		env: {
			...process.env,
			HOME: home,
			// One throwaway directory per declared variable. Which leaf name each
			// gets does not matter — the whole tree is removed below; that every
			// declared variable gets one does.
			...Object.fromEntries(agentHostVariables.map((variable) => [variable, path.join(home, variable)])),
			XDG_RUNTIME_DIR: path.join(home, "run"),
		},
	});
	process.stderr.write(`probe-surface: ${binary} ${name} (effect: ${route.effect}${isHelp ? ", help" : ""}) in throwaway HOME\n`);
	if (result.stdout) process.stdout.write(result.stdout);
	if (result.stderr) process.stderr.write(result.stderr);
	process.exitCode = result.status ?? 1;
} finally {
	rmSync(home, { recursive: true, force: true });
}
