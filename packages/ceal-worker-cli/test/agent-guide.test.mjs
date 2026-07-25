import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createCealAgentGuideStore } from "../dist/agent-guide.js";

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
			status: "staged", agent: "codex", guide_id: "ceal-guide",
			guide_path: path.join(state, "current", "guide"),
			registration_path: path.join(codexHome, "skills", "ceal-guide"),
			update_safe: true, registered: false,
			hosts: [
				{ agent: "codex", status: "staged", registration_path: path.join(codexHome, "skills", "ceal-guide"), registered: false },
				{ agent: "claude", status: "staged", registration_path: path.join(claudeConfig, "skills", "ceal-guide"), registered: false },
			],
		});
		assert.equal(store.register().status, "registered");
		const registration = path.join(codexHome, "skills", "ceal-guide");
		assert.equal(lstatSync(registration).isSymbolicLink(), true);
		assert.equal(readlinkSync(registration), path.join(state, "current", "guide"));

		createRelease(state, "second");
		rmSync(path.join(state, "current"));
		symlinkSync("releases/second", path.join(state, "current"));
		assert.equal(store.inspect().status, "registered");
		assert.match(readFile(path.join(registration, "SKILL.md")), /release: second/u);
	} finally {
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
		assert.equal(store.inspect("codex").registration_path, path.join(root, ".codex", "skills", "ceal-guide"));
		const claudeRegistration = path.join(claudeConfig, "skills", "ceal-guide");
		const registered = store.register("claude");
		assert.equal(registered.status, "registered");
		assert.equal(registered.agent, "claude");
		assert.equal(registered.registration_path, claudeRegistration);
		assert.equal(lstatSync(claudeRegistration).isSymbolicLink(), true);
		assert.equal(readlinkSync(claudeRegistration), guidePath);
		assert.match(readFile(path.join(claudeRegistration, "SKILL.md")), /release: first/u);
		// Registering one host leaves the other staged, and both are visible.
		assert.deepEqual(store.inspect().hosts, [
			{ agent: "codex", status: "staged", registration_path: path.join(root, ".codex", "skills", "ceal-guide"), registered: false },
			{ agent: "claude", status: "registered", registration_path: claudeRegistration, registered: true },
		]);
		assert.equal(store.inspect().registered, false, "the top-level projection stays the Codex reading");
		assert.equal(store.register("codex").registered, true);
		assert.deepEqual(store.inspect().hosts.map((host) => host.registered), [true, true]);
		// Re-registering an already-linked host is idempotent, not a conflict.
		assert.equal(store.register("claude").status, "registered");
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
		assert.equal(result.error?.kind, "registration_conflict");
		assert.match(result.error?.message, /Claude Code/u);
		assert.equal(lstatSync(path.join(root, ".claude", "skills", "ceal-guide")).isDirectory(), true);
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
		assert.deepEqual(store.inspect().hosts.map((host) => host.agent), ["codex"]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a store needs at least one resolvable agent host", () => {
	assert.equal(createCealAgentGuideStore("/nonexistent/ceal", undefined, undefined, undefined), undefined);
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
