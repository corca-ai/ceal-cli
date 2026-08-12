import assert from "node:assert/strict";
import fs, {
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readlinkSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { countRegisteredGuideHosts, createCealAgentGuideStore, detectCealAgentGuideHost } from "../dist/agent-guide.js";

test("Codex guide registration follows the role current pointer across releases", () => {
	const root = realpathSync(mkdtempSync(path.join(tmpdir(), "ceal-agent-guide-")));
	const state = path.join(root, "install", ".ceal-cli", "worker");
	const firstRelease = createRelease(state, "first");
	const codexHome = path.join(root, "codex");
	const claudeConfig = path.join(root, "claude");
	symlinkSync("releases/first", path.join(state, "current"));
	try {
		const store = createCealAgentGuideStore(path.join(firstRelease, "ceal-linux-arm64"), root, codexHome, claudeConfig);
		assert.ok(store);
		assert.deepEqual(store.inspect(), {
			status: "available",
			agent: "codex",
			guide_id: "ceal-guide",
			guide_path: path.join(state, "current", "guide"),
			update_safe: true,
			agent_source: "default",
			hosts: [
				{ agent: "codex", status: "staged", registration_path: path.join(codexHome, "skills", "ceal-guide"), registered: false },
				{ agent: "claude", status: "staged", registration_path: path.join(claudeConfig, "skills", "ceal-guide"), registered: false },
			],
		});
		const registeredResult = store.register();
		assert.equal(registeredResult.hosts.find((host) => host.agent === "codex").registered, true);
		assert.equal("agent_source" in registeredResult, false);
		const registration = path.join(codexHome, "skills", "ceal-guide");
		assert.equal(lstatSync(registration).isSymbolicLink(), true);
		assert.equal(readlinkSync(registration), path.join(state, "current", "guide"));

		createRelease(state, "second");
		rmSync(path.join(state, "current"));
		symlinkSync("releases/second", path.join(state, "current"));
		assert.equal(store.inspect().hosts.find((host) => host.agent === "codex").registered, true);
		assert.match(readFile(path.join(registration, "SKILL.md")), /release: second/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a concurrent registration that created the requested link is reported as success", () => {
	const root = realpathSync(mkdtempSync(path.join(tmpdir(), "ceal-agent-guide-race-")));
	const state = path.join(root, "install", ".ceal-cli", "worker");
	const release = createRelease(state, "first");
	const codexHome = path.join(root, "codex");
	symlinkSync("releases/first", path.join(state, "current"));
	const registration = path.join(codexHome, "skills", "ceal-guide");
	const originalSymlinkSync = fs.symlinkSync;
	try {
		const store = createCealAgentGuideStore(path.join(release, "ceal-linux-arm64"), root, codexHome, undefined);
		assert.ok(store);
		let injected = false;
		fs.symlinkSync = (...args) => {
			if (!injected && args[1] === registration) {
				injected = true;
				originalSymlinkSync(...args);
				const error = new Error("simulated concurrent EEXIST");
				error.code = "EEXIST";
				throw error;
			}
			return originalSymlinkSync(...args);
		};
		syncBuiltinESMExports();
		const result = store.register("codex");
		assert.equal(injected, true);
		assert.equal(result.status, "available");
		assert.equal(result.hosts.find((host) => host.agent === "codex").registered, true);
		assert.equal(realpathSync(registration), realpathSync(path.join(state, "current", "guide")));
	} finally {
		fs.symlinkSync = originalSymlinkSync;
		syncBuiltinESMExports();
		rmSync(root, { recursive: true, force: true });
	}
});

test("guide registration refuses to replace an existing Codex skill directory", () => {
	const root = realpathSync(mkdtempSync(path.join(tmpdir(), "ceal-agent-guide-conflict-")));
	const state = path.join(root, "install", ".ceal-cli", "worker");
	const release = createRelease(state, "first");
	const codexHome = path.join(root, "codex");
	symlinkSync("releases/first", path.join(state, "current"));
	mkdirSync(path.join(codexHome, "skills", "ceal-guide"), { recursive: true });
	try {
		const store = createCealAgentGuideStore(path.join(release, "ceal-linux-arm64"), root, codexHome);
		assert.ok(store);
		const result = store.register();
		assert.equal(result.status, "unavailable");
		assert.equal(result.error?.kind, "registration_conflict");
		assert.equal(lstatSync(path.join(codexHome, "skills", "ceal-guide")).isDirectory(), true);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

// Adoption includes Claude Code, so the same update-safe link must be
// registrable per host, independently, and a `status` read must report every
// host instead of only the one it registered last.
test("each agent host registers independently and status reports both", () => {
	const root = realpathSync(mkdtempSync(path.join(tmpdir(), "ceal-agent-guide-claude-")));
	const state = path.join(root, "install", ".ceal-cli", "worker");
	const release = createRelease(state, "first");
	const claudeConfig = path.join(root, "claude-config");
	symlinkSync("releases/first", path.join(state, "current"));
	const guidePath = path.join(state, "current", "guide");
	try {
		const store = createCealAgentGuideStore(path.join(release, "ceal-linux-arm64"), root, undefined, claudeConfig);
		assert.ok(store);
		// No CODEX_HOME override: the Codex root still derives from HOME.
		assert.equal(
			store.inspect("codex").hosts.find((host) => host.agent === "codex").registration_path,
			path.join(root, ".codex", "skills", "ceal-guide"),
		);
		const claudeRegistration = path.join(claudeConfig, "skills", "ceal-guide");
		const registered = store.register("claude");
		assert.equal(registered.status, "available");
		assert.equal(registered.agent, "claude");
		assert.equal(registered.hosts.find((host) => host.agent === "claude").registration_path, claudeRegistration);
		assert.equal(lstatSync(claudeRegistration).isSymbolicLink(), true);
		assert.equal(readlinkSync(claudeRegistration), guidePath);
		assert.match(readFile(path.join(claudeRegistration, "SKILL.md")), /release: first/u);
		// Registering one host leaves the other staged, and both are visible.
		assert.deepEqual(store.inspect().hosts, [
			{ agent: "codex", status: "staged", registration_path: path.join(root, ".codex", "skills", "ceal-guide"), registered: false },
			{ agent: "claude", status: "registered", registration_path: claudeRegistration, registered: true },
		]);
		// The count the acceptance record publishes follows `registered`, not the
		// presence of a path — a `staged` host carries a path too, and counting
		// paths made a host that was never registered read as one that was. This
		// asserts the derivation against a real store rather than an injected
		// number, which is how the wrong count survived a passing suite.
		assert.equal(countRegisteredGuideHosts(store.inspect()), 1);
		assert.equal(store.inspect().hosts.filter((host) => host.registration_path).length, 2, "and the paths it must not count are present");
		// There is no top-level per-host reading left to mistake for the whole answer.
		assert.equal("registered" in store.inspect(), false);
		assert.equal(store.register("codex").hosts.find((host) => host.agent === "codex").registered, true);
		assert.deepEqual(
			store.inspect().hosts.map((host) => host.registered),
			[true, true],
		);
		// Re-registering an already-linked host is idempotent, not a conflict.
		assert.equal(store.register("claude").status, "available");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("guide registration refuses to replace an existing Claude Code skill directory", () => {
	const root = realpathSync(mkdtempSync(path.join(tmpdir(), "ceal-agent-guide-claude-conflict-")));
	const state = path.join(root, "install", ".ceal-cli", "worker");
	const release = createRelease(state, "first");
	symlinkSync("releases/first", path.join(state, "current"));
	mkdirSync(path.join(root, ".claude", "skills", "ceal-guide"), { recursive: true });
	try {
		const store = createCealAgentGuideStore(path.join(release, "ceal-linux-arm64"), root, undefined, undefined);
		assert.ok(store);
		const result = store.register("claude");
		assert.equal(result.status, "unavailable");
		assert.equal("agent_source" in result, false);
		assert.equal(result.error?.kind, "registration_conflict");
		assert.match(result.error?.message, /Claude Code/u);
		assert.equal(lstatSync(path.join(root, ".claude", "skills", "ceal-guide")).isDirectory(), true);
		// A reader that treats `hosts` as the per-host truth must not see the
		// refusing path reported as "staged", which reads as ready to link.
		assert.deepEqual(
			result.hosts.find((host) => host.agent === "claude"),
			{
				agent: "claude",
				status: "unavailable",
				registration_path: path.join(root, ".claude", "skills", "ceal-guide"),
				registered: false,
			},
		);
		assert.equal(result.hosts.find((host) => host.agent === "codex").status, "staged");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

// A host whose configuration root cannot be located must say which variable
// would resolve it rather than claim a registration path it never inspected.
test("an unresolvable agent host reports the variable that would resolve it", () => {
	const root = realpathSync(mkdtempSync(path.join(tmpdir(), "ceal-agent-guide-unresolved-")));
	const state = path.join(root, "install", ".ceal-cli", "worker");
	const release = createRelease(state, "first");
	symlinkSync("releases/first", path.join(state, "current"));
	try {
		const store = createCealAgentGuideStore(path.join(release, "ceal-linux-arm64"), undefined, path.join(root, "codex"), undefined);
		assert.ok(store);
		const result = store.register("claude");
		assert.equal(result.status, "unavailable");
		assert.equal(result.error?.kind, "registration_failed");
		assert.match(result.error?.next_action, /CLAUDE_CONFIG_DIR/u);
		assert.equal(result.registration_path, undefined);
		// The resolvable host is unaffected and stays the default projection.
		assert.equal(store.inspect().agent, "codex");
		// Every advertised host stays in `hosts`: dropping the unresolved one would
		// make a route the help still advertises look unsupported by this build.
		assert.deepEqual(store.inspect().hosts, [
			{ agent: "codex", status: "staged", registration_path: path.join(root, "codex", "skills", "ceal-guide"), registered: false },
			{ agent: "claude", status: "unresolved", registered: false },
		]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

// A relative or list-shaped override must be refused, never joined: joining it
// would build a skill tree under the current working directory and then report
// that as a real registration.
test("a non-absolute or list-shaped host directory is refused, not guessed", () => {
	const root = realpathSync(mkdtempSync(path.join(tmpdir(), "ceal-agent-guide-relative-")));
	const state = path.join(root, "install", ".ceal-cli", "worker");
	const release = createRelease(state, "first");
	symlinkSync("releases/first", path.join(state, "current"));
	try {
		for (const override of [".claude", `${path.join(root, "a")}:${path.join(root, "b")}`]) {
			const store = createCealAgentGuideStore(path.join(release, "ceal-linux-arm64"), root, undefined, override);
			assert.ok(store);
			const result = store.register("claude");
			assert.equal(result.status, "unavailable", override);
			assert.equal(result.error?.kind, "registration_failed");
			assert.match(result.error?.next_action, /Set CLAUDE_CONFIG_DIR to one absolute directory path/u);
			assert.equal(result.hosts.find((host) => host.agent === "claude").registration_path, undefined);
			assert.equal(existsSync(path.join(process.cwd(), ".claude")), false, "no skill tree under the working directory");
		}
		// An empty override is no override: the HOME default still applies.
		const empty = createCealAgentGuideStore(path.join(release, "ceal-linux-arm64"), root, undefined, "");
		assert.equal(
			empty.inspect("claude").hosts.find((host) => host.agent === "claude").registration_path,
			path.join(root, ".claude", "skills", "ceal-guide"),
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

// The Codex host is the default projection whether or not it resolved: a
// Codex-only reader of ceal.guide.v1 must never be handed another host's path
// in the top-level fields.
test("the default projection stays the Codex host even when only Claude resolves", () => {
	const root = realpathSync(mkdtempSync(path.join(tmpdir(), "ceal-agent-guide-default-")));
	const state = path.join(root, "install", ".ceal-cli", "worker");
	const release = createRelease(state, "first");
	symlinkSync("releases/first", path.join(state, "current"));
	try {
		const store = createCealAgentGuideStore(path.join(release, "ceal-linux-arm64"), undefined, undefined, path.join(root, "claude"));
		assert.ok(store);
		const status = store.inspect();
		assert.equal(status.agent, "codex");
		assert.equal(status.status, "unavailable");
		assert.match(status.error?.next_action, /CODEX_HOME/u);
		assert.deepEqual(
			status.hosts.map((host) => host.status),
			["unresolved", "staged"],
		);
		assert.equal(store.register("claude").hosts.find((host) => host.agent === "claude").registered, true);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

// Only the "existing directory" occupant was gated; the dangling-symlink branch
// is the one with the non-obvious `existsSync`-is-false behavior.
test("a foreign file, foreign link, or dangling link is refused without replacement", () => {
	for (const occupant of ["file", "foreign-link", "dangling-link"]) {
		const root = realpathSync(mkdtempSync(path.join(tmpdir(), "ceal-agent-guide-occupant-")));
		const state = path.join(root, "install", ".ceal-cli", "worker");
		const release = createRelease(state, "first");
		symlinkSync("releases/first", path.join(state, "current"));
		const registration = path.join(root, ".claude", "skills", "ceal-guide");
		mkdirSync(path.dirname(registration), { recursive: true });
		if (occupant === "file") writeFileSync(registration, "operator content\n");
		if (occupant === "foreign-link") symlinkSync(path.join(root, "install"), registration, "dir");
		if (occupant === "dangling-link") symlinkSync(path.join(root, "gone"), registration, "dir");
		try {
			const store = createCealAgentGuideStore(path.join(release, "ceal-linux-arm64"), root, undefined, undefined);
			const result = store.register("claude");
			assert.equal(result.status, "unavailable", occupant);
			assert.equal(result.error?.kind, "registration_conflict", occupant);
			// The occupant survives untouched: this command never replaces state.
			if (occupant === "file") assert.equal(readFile(registration), "operator content\n");
			else assert.equal(readlinkSync(registration), path.join(root, occupant === "foreign-link" ? "install" : "gone"));
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	}
});

// Caught by probing the built surface: the shared guide-unavailable answer must
// still name the host the operator asked to register.
test("a missing guide asset answers as the requested host", () => {
	const root = realpathSync(mkdtempSync(path.join(tmpdir(), "ceal-agent-guide-missing-")));
	try {
		const store = createCealAgentGuideStore(path.join(root, "ceal-linux-arm64"), root, undefined, undefined);
		assert.ok(store);
		for (const agent of ["codex", "claude"]) {
			const state = store.register(agent);
			assert.equal(state.status, "unavailable");
			assert.equal(state.agent, agent);
			assert.equal("agent_source" in state, false);
			assert.equal(state.error?.kind, "guide_unavailable");
			// No guide asset means no path was inspected, so no per-host list is
			// claimed either.
			assert.equal(state.hosts, undefined);
		}
		// An unnamed host keeps the default projection.
		assert.equal(store.inspect().agent, "codex");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

// Found on a real host: `~/.claude/skills` linked to a directory that did not
// exist, so `mkdir -p` failed and the generic advice sent the operator looking
// for a skill directory that was never there.
test("a skills directory linked to nothing names the missing target", () => {
	const root = realpathSync(mkdtempSync(path.join(tmpdir(), "ceal-agent-guide-dangling-parent-")));
	const state = path.join(root, "install", ".ceal-cli", "worker");
	const release = createRelease(state, "first");
	symlinkSync("releases/first", path.join(state, "current"));
	const missing = path.join(root, "elsewhere", "skills");
	mkdirSync(path.join(root, ".claude"), { recursive: true });
	symlinkSync(missing, path.join(root, ".claude", "skills"), "dir");
	try {
		const store = createCealAgentGuideStore(path.join(release, "ceal-linux-arm64"), root, undefined, undefined);
		const result = store.register("claude");
		assert.equal(result.status, "unavailable");
		assert.equal(result.error?.kind, "registration_failed");
		assert.match(result.error?.message, new RegExp(`${missing.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}', which does not exist`, "u"));
		assert.match(result.error?.next_action, /Create that directory, or set CLAUDE_CONFIG_DIR/u);
		assert.doesNotMatch(result.error?.next_action, /existing skill directory/u);
		// Once the target exists, the same command succeeds through the link.
		mkdirSync(missing, { recursive: true });
		const retried = store.register("claude");
		assert.equal(retried.hosts.find((host) => host.agent === "claude").registered, true);
		assert.equal(realpathSync(path.join(missing, "ceal-guide")), realpathSync(path.join(state, "current", "guide")));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

// corca-ai/ceal-cli#4: a Claude Code session read `agent: codex` with
// `registered: false` while its own registration was live, and wrote that into a
// durable note. The running host identifies itself in the environment, so the
// summary should name it instead of the first table row.
test("the projection names the running host when the environment identifies it", () => {
	const root = realpathSync(mkdtempSync(path.join(tmpdir(), "ceal-agent-guide-detect-")));
	const state = path.join(root, "install", ".ceal-cli", "worker");
	const release = createRelease(state, "first");
	symlinkSync("releases/first", path.join(state, "current"));
	try {
		assert.equal(detectCealAgentGuideHost({ CLAUDECODE: "1" }), "claude");
		assert.equal(detectCealAgentGuideHost({ CLAUDE_CODE_ENTRYPOINT: "cli" }), "claude");
		assert.equal(detectCealAgentGuideHost({ CODEX_THREAD_ID: "t" }), "codex");
		assert.equal(detectCealAgentGuideHost({}), undefined);
		// A nested agent inherits the outer host's markers. Picking by table order
		// there would advise registering a host that is not the one running.
		assert.equal(detectCealAgentGuideHost({ CLAUDECODE: "1", CODEX_THREAD_ID: "t" }), undefined);

		const binary = path.join(release, "ceal-linux-arm64");
		const detected = createCealAgentGuideStore(binary, root, undefined, undefined, "claude");
		detected.register("claude");
		const status = detected.inspect();
		// The host that is running answers first, and says so.
		assert.equal(status.agent, "claude");
		assert.equal(status.agent_source, "detected");
		assert.equal(status.hosts.find((host) => host.agent === "claude").registered, true);

		// With no detection the fallback is unchanged, and marked as a fallback.
		const undetected = createCealAgentGuideStore(binary, root, undefined, undefined, undefined);
		assert.equal(undetected.inspect().agent, "codex");
		assert.equal(undetected.inspect().agent_source, "default");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("an installed guide without a resolvable host reports the missing configuration root", () => {
	const root = realpathSync(mkdtempSync(path.join(tmpdir(), "ceal-agent-guide-no-home-")));
	const state = path.join(root, "install", ".ceal-cli", "worker");
	const release = createRelease(state, "first");
	symlinkSync("releases/first", path.join(state, "current"));
	try {
		const store = createCealAgentGuideStore(path.join(release, "ceal-linux-arm64"), undefined, undefined, undefined);
		assert.ok(store);
		const status = store.inspect();
		assert.equal(status.error?.kind, "registration_failed");
		assert.match(status.error?.next_action, /Set HOME or CODEX_HOME/u);
		assert.doesNotMatch(status.error?.next_action, /Reinstall/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a missing guide remains an install failure even when no host resolves", () => {
	const store = createCealAgentGuideStore("/nonexistent/ceal", undefined, undefined, undefined);
	assert.ok(store);
	assert.equal(store.inspect().error?.kind, "guide_unavailable");
});

function createRelease(state, name) {
	const release = path.join(state, "releases", name);
	mkdirSync(path.join(release, "guide"), { recursive: true });
	writeFileSync(path.join(release, "ceal-linux-arm64"), "binary\n");
	writeFileSync(path.join(release, "guide", "SKILL.md"), `name: ceal-guide\nrelease: ${name}\n`);
	return release;
}

function readFile(file) {
	assert.equal(existsSync(file), true);
	return readFileSync(file, "utf8");
}
