import assert from "node:assert/strict";
import fs, {
	chmodSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readlinkSync,
	realpathSync,
	renameSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createSkillDirectoryBundle } from "../../../scripts/lib/skill-directory-bundle.ts";
import { required as requiredValue } from "../../../test/required.ts";
import {
	type CealAgentGuideHost,
	type CealAgentGuideState,
	type CealAgentGuideStore,
	countRegisteredGuideHosts,
	createCealAgentGuideStore as createCealAgentGuideStoreRaw,
	detectCealAgentGuideHost,
} from "../dist/agent-guide.js";
import { decodeCealGuideBundle } from "../dist/guide-bundle.js";
import { sha256 } from "../dist/sha256.js";

type GuideHostState = NonNullable<CealAgentGuideState["hosts"]>[number];
type EmbeddedGuideFixture = ReturnType<typeof embeddedGuideFixture>;
type FixtureMutation = (root: string, fixture: EmbeddedGuideFixture) => void;
type TarHeaderOptions = { name?: string; type?: number; mode?: number };

function createCealAgentGuideStore(...args: Parameters<typeof createCealAgentGuideStoreRaw>): CealAgentGuideStore {
	const store = createCealAgentGuideStoreRaw(...args);
	assert.ok(store);
	return store;
}

function requireHosts(state: CealAgentGuideState): readonly GuideHostState[] {
	assert.ok(state.hosts);
	return state.hosts;
}

function requireHost(state: CealAgentGuideState, agent: CealAgentGuideHost): GuideHostState {
	const host = requireHosts(state).find((entry) => entry.agent === agent);
	assert.ok(host);
	return host;
}

function requireString(value: string | undefined): string {
	assert.ok(value);
	return value;
}

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
		assert.equal(requireHost(registeredResult, "codex").registered, true);
		assert.equal("agent_source" in registeredResult, false);
		const registration = path.join(codexHome, "skills", "ceal-guide");
		assert.equal(lstatSync(registration).isSymbolicLink(), true);
		assert.equal(readlinkSync(registration), path.join(state, "current", "guide"));

		createRelease(state, "second");
		rmSync(path.join(state, "current"));
		symlinkSync("releases/second", path.join(state, "current"));
		assert.equal(requireHost(store.inspect(), "codex").registered, true);
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
				const error = Object.assign(new Error("simulated concurrent EEXIST"), { code: "EEXIST" });
				throw error;
			}
			return originalSymlinkSync(...args);
		};
		syncBuiltinESMExports();
		const result = store.register("codex");
		assert.equal(injected, true);
		assert.equal(result.status, "available");
		assert.equal(requireHost(result, "codex").registered, true);
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
		assert.equal(requireHost(store.inspect("codex"), "codex").registration_path, path.join(root, ".codex", "skills", "ceal-guide"));
		const claudeRegistration = path.join(claudeConfig, "skills", "ceal-guide");
		const registered = store.register("claude");
		assert.equal(registered.status, "available");
		assert.equal(registered.agent, "claude");
		assert.equal(requireHost(registered, "claude").registration_path, claudeRegistration);
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
		assert.equal(
			requireHosts(store.inspect()).filter((host) => host.registration_path).length,
			2,
			"and the paths it must not count are present",
		);
		// There is no top-level per-host reading left to mistake for the whole answer.
		assert.equal("registered" in store.inspect(), false);
		assert.equal(requireHost(store.register("codex"), "codex").registered, true);
		assert.deepEqual(
			requireHosts(store.inspect()).map((host) => host.registered),
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
		assert.deepEqual(requireHost(result, "claude"), {
			agent: "claude",
			status: "unavailable",
			registration_path: path.join(root, ".claude", "skills", "ceal-guide"),
			registered: false,
		});
		assert.equal(requireHost(result, "codex").status, "staged");
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
		assert.match(requireString(result.error?.next_action), /CLAUDE_CONFIG_DIR/u);
		assert.equal(requireHost(result, "claude").registration_path, undefined);
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
			assert.match(requireString(result.error?.next_action), /Set CLAUDE_CONFIG_DIR to one absolute directory path/u);
			assert.equal(requireHost(result, "claude").registration_path, undefined);
			assert.equal(existsSync(path.join(process.cwd(), ".claude")), false, "no skill tree under the working directory");
		}
		// An empty override is no override: the HOME default still applies.
		const empty = createCealAgentGuideStore(path.join(release, "ceal-linux-arm64"), root, undefined, "");
		assert.equal(requireHost(empty.inspect("claude"), "claude").registration_path, path.join(root, ".claude", "skills", "ceal-guide"));
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
		assert.match(requireString(status.error?.next_action), /CODEX_HOME/u);
		assert.deepEqual(
			requireHosts(status).map((host) => host.status),
			["unresolved", "staged"],
		);
		assert.equal(requireHost(store.register("claude"), "claude").registered, true);
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
		for (const agent of ["codex", "claude"] satisfies readonly CealAgentGuideHost[]) {
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
		assert.match(requireString(result.error?.next_action), /Create that directory, or set CLAUDE_CONFIG_DIR/u);
		assert.doesNotMatch(requireString(result.error?.next_action), /existing skill directory/u);
		// Once the target exists, the same command succeeds through the link.
		mkdirSync(missing, { recursive: true });
		const retried = store.register("claude");
		assert.equal(requireHost(retried, "claude").registered, true);
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
		assert.equal(requireHost(status, "claude").registered, true);

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
		assert.match(requireString(status.error?.next_action), /Set HOME or CODEX_HOME/u);
		assert.doesNotMatch(requireString(status.error?.next_action), /Reinstall/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a missing guide remains unavailable without advising reinstall when no host resolves", () => {
	const store = createCealAgentGuideStore("/nonexistent/ceal", undefined, undefined, undefined);
	assert.ok(store);
	assert.equal(store.inspect().error?.kind, "guide_unavailable");
	assert.doesNotMatch(requireString(store.inspect().error?.next_action), /reinstall/u);
});

test("embedded guide status is read-only and explicit registration materializes the complete directory", () => {
	const fixture = embeddedGuideFixture();
	try {
		const store = createCealAgentGuideStore(
			fixture.command,
			fixture.root,
			fixture.codexHome,
			fixture.claudeHome,
			"codex",
			fixture.bundle.bytes,
		);
		const before = store.inspect();
		assert.equal(before.status, "available");
		assert.equal(before.carrier, "embedded");
		assert.equal(before.materialized, false);
		assert.equal(before.update_safe, false);
		assert.equal("guide_path" in before, false);
		assert.match(requireString(before.next_action), /ceal guide register codex/u);
		assert.equal(existsSync(path.join(fixture.worker, "guides")), false, "status must not stage guide state");

		const registered = store.register("codex");
		assert.equal(registered.status, "available");
		assert.equal(registered.materialized, true);
		assert.equal(requireHost(registered, "codex").registered, true);
		assert.equal(requireHost(registered, "claude").registered, false);
		assert.match(readFile(path.join(requireString(registered.guide_path), "references", "workflow.md")), /complete directory/u);
		assert.equal(existsSync(path.join(fixture.claudeHome, "skills", "ceal-guide")), false);
	} finally {
		fixture.cleanup();
	}
});

test("embedded registration conflict writes no guide state and leaves another host untouched", () => {
	const fixture = embeddedGuideFixture();
	try {
		const store = createCealAgentGuideStore(
			fixture.command,
			fixture.root,
			fixture.codexHome,
			fixture.claudeHome,
			undefined,
			fixture.bundle.bytes,
		);
		const claude = store.register("claude");
		const claudeTarget = realpathSync(requireString(claude.guide_path));
		const codexRegistration = path.join(fixture.codexHome, "skills", "ceal-guide");
		mkdirSync(codexRegistration, { recursive: true });
		writeFileSync(path.join(codexRegistration, "foreign"), "owned elsewhere\n");
		const alternateSource = path.join(fixture.root, "alternate-guide");
		mkdirSync(alternateSource);
		writeFileSync(path.join(alternateSource, "SKILL.md"), "---\nname: ceal-guide\n---\nalternate\n");
		const alternate = createSkillDirectoryBundle(alternateSource);
		const alternateStore = createCealAgentGuideStore(
			fixture.command,
			fixture.root,
			fixture.codexHome,
			fixture.claudeHome,
			undefined,
			alternate.bytes,
		);
		const versionsBefore = fs.readdirSync(path.join(fixture.worker, "guides", "versions"));

		const refused = alternateStore.register("codex");
		assert.equal(refused.error?.kind, "registration_conflict");
		assert.deepEqual(fs.readdirSync(path.join(fixture.worker, "guides", "versions")), versionsBefore);
		assert.equal(realpathSync(path.join(fixture.claudeHome, "skills", "ceal-guide")), claudeTarget);
		assert.equal(readFile(path.join(codexRegistration, "foreign")), "owned elsewhere\n");
	} finally {
		fixture.cleanup();
	}
});

test("embedded registration preserves an exact legacy managed link and asks for explicit cleanup", () => {
	const fixture = embeddedGuideFixture();
	try {
		const registration = path.join(fixture.codexHome, "skills", "ceal-guide");
		mkdirSync(path.dirname(registration), { recursive: true });
		symlinkSync(path.join(fixture.worker, "current", "guide"), registration, "dir");
		const store = createCealAgentGuideStore(
			fixture.command,
			fixture.root,
			fixture.codexHome,
			fixture.claudeHome,
			undefined,
			fixture.bundle.bytes,
		);
		const result = store.register("codex");
		assert.equal(result.error?.kind, "registration_conflict");
		assert.equal(readlinkSync(registration), path.join(fixture.worker, "current", "guide"));
		assert.match(result.error?.next_action ?? "", /Remove the existing link/u);
		assert.match(result.error?.next_action ?? "", /ceal guide register codex/u);
		assert.equal(existsSync(path.join(fixture.worker, "guides")), false, "a refused migration must not materialize guide state");
	} finally {
		fixture.cleanup();
	}
});

test("a missing embedded SEA guide never falls back to the compatibility projection", () => {
	const fixture = embeddedGuideFixture();
	try {
		const store = createCealAgentGuideStore(fixture.command, fixture.root, fixture.codexHome, fixture.claudeHome, undefined, null);
		assert.equal(store.inspect().status, "unavailable");
		assert.equal(store.inspect().error?.kind, "guide_unavailable");
		assert.match(store.inspect().error?.message ?? "", /carried by this installed binary/u);
		assert.doesNotMatch(store.inspect().error?.message ?? "", /beside/u);
	} finally {
		fixture.cleanup();
	}
});

test("embedded registration refuses a symlink planted at the content-addressed version path", () => {
	const fixture = embeddedGuideFixture();
	try {
		const versions = path.join(fixture.worker, "guides", "versions");
		mkdirSync(versions, { recursive: true });
		const hostile = path.join(fixture.root, "hostile-guide");
		mkdirSync(hostile);
		symlinkSync(hostile, path.join(versions, fixture.bundle.sha256), "dir");
		const store = createCealAgentGuideStore(
			fixture.command,
			fixture.root,
			fixture.codexHome,
			fixture.claudeHome,
			undefined,
			fixture.bundle.bytes,
		);

		const result = store.register("codex");
		assert.equal(result.status, "unavailable");
		assert.equal(result.error?.kind, "registration_failed");
		assert.equal(existsSync(path.join(fixture.codexHome, "skills", "ceal-guide")), false);
		assert.equal(lstatSync(path.join(versions, fixture.bundle.sha256)).isSymbolicLink(), true);
	} finally {
		fixture.cleanup();
	}
});

test("embedded guide status refuses content, mode, and symlink drift after registration", () => {
	for (const [label, mutate] of [
		["content", (root) => writeFileSync(path.join(root, "SKILL.md"), "tampered\n")],
		["mode", (root) => chmodSync(path.join(root, "SKILL.md"), 0o666)],
		["file special mode", (root) => chmodSync(path.join(root, "SKILL.md"), 0o4644)],
		["missing file", (root) => rmSync(path.join(root, "references", "workflow.md"))],
		["unexpected file", (root) => writeFileSync(path.join(root, "unexpected.md"), "not signed\n")],
		["root mode", (root) => chmodSync(root, 0o755)],
		["nested directory mode", (root) => chmodSync(path.join(root, "references"), 0o755)],
		["directory special mode", (root) => chmodSync(root, 0o2700)],
		[
			"symlink",
			(root, fixture) => {
				const file = path.join(root, "references", "workflow.md");
				rmSync(file);
				const foreign = path.join(fixture.root, "foreign-workflow.md");
				writeFileSync(foreign, "complete directory\n");
				symlinkSync(foreign, file);
			},
		],
	] satisfies Array<[string, FixtureMutation]>) {
		const fixture = embeddedGuideFixture();
		try {
			const store = createCealAgentGuideStore(
				fixture.command,
				fixture.root,
				fixture.codexHome,
				fixture.claudeHome,
				undefined,
				fixture.bundle.bytes,
			);
			const registered = store.register("codex");
			mutate(requireString(registered.guide_path), fixture);

			const status = store.inspect("codex");
			assert.equal(status.status, "unavailable", label);
			assert.equal(status.materialized, false, label);
			assert.equal(requireHost(status, "codex").registered, false, label);
			assert.equal(status.error?.kind, "registration_failed", label);
			assert.match(status.error?.message, /does not match the signed guide/u, label);
		} finally {
			fixture.cleanup();
		}
	}
});

test("embedded registration refuses a special-mode ownership marker", () => {
	const fixture = embeddedGuideFixture();
	try {
		const store = createCealAgentGuideStore(
			fixture.command,
			fixture.root,
			fixture.codexHome,
			fixture.claudeHome,
			undefined,
			fixture.bundle.bytes,
		);
		const registered = store.register("codex");
		const marker = path.join(fixture.worker, "guides", "ownership", path.basename(requireString(registered.guide_path)));
		chmodSync(marker, 0o4600);

		const result = store.register("claude");
		assert.equal(result.status, "unavailable");
		assert.equal(result.error?.kind, "registration_failed");
		assert.equal(existsSync(path.join(fixture.claudeHome, "skills", "ceal-guide")), false);
	} finally {
		fixture.cleanup();
	}
});

test("embedded guide decoder refuses traversal, duplicate paths, links, and damaged headers", () => {
	const fixture = embeddedGuideFixture();
	try {
		assert.deepEqual(
			decodeCealGuideBundle(fixture.bundle.bytes).files.map((file) => file.path),
			["SKILL.md", "references/workflow.md"],
		);
		for (const mutate of [
			(bytes) => rewriteTarHeader(bytes, "references/workflow.md", { name: "../escape" }),
			(bytes) => rewriteTarHeader(bytes, "references/workflow.md", { name: "docs/workflow.md" }),
			(bytes) => rewriteTarHeader(bytes, "references/workflow.md", { name: "SKILL.md" }),
			(bytes) => rewriteTarHeader(bytes, "references/workflow.md", { type: 0x32 }),
			(bytes) => rewriteTarHeader(bytes, "references/workflow.md", { mode: 0o600 }),
			(bytes) => {
				const first = requiredValue(bytes[0], "guide_bundle_first_byte");
				bytes[0] = first ^ 1;
			},
		] satisfies Array<(bytes: Buffer) => void>) {
			const hostile = Buffer.from(fixture.bundle.bytes);
			mutate(hostile);
			assert.throws(() => decodeCealGuideBundle(hostile), /invalid_guide_bundle/u);
		}
	} finally {
		fixture.cleanup();
	}
});

function createRelease(state: string, name: string): string {
	const release = path.join(state, "releases", name);
	mkdirSync(path.join(release, "guide"), { recursive: true });
	writeFileSync(path.join(release, "ceal-linux-arm64"), "binary\n");
	writeFileSync(path.join(release, "guide", "SKILL.md"), `name: ceal-guide\nrelease: ${name}\n`);
	return release;
}

function embeddedGuideFixture() {
	const root = realpathSync(mkdtempSync(path.join(tmpdir(), "ceal-embedded-guide-")));
	const install = path.join(root, "install");
	const worker = path.join(install, ".ceal-cli", "worker");
	const staged = path.join(worker, "releases", ".staged");
	const source = path.join(root, "source-guide");
	const codexHome = path.join(root, "codex");
	const claudeHome = path.join(root, "claude");
	mkdirSync(staged, { recursive: true });
	mkdirSync(path.join(source, "references"), { recursive: true });
	writeFileSync(path.join(source, "SKILL.md"), "---\nname: ceal-guide\n---\nRead references/workflow.md.\n");
	writeFileSync(path.join(source, "references", "workflow.md"), "complete directory\n");
	writeFileSync(path.join(staged, "ceal-linux-arm64"), "binary\n");
	writeFileSync(path.join(staged, "install-ceal.sh"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
	const inventory = `${sha256(readFileSync(path.join(staged, "ceal-linux-arm64")))}  ceal-linux-arm64\n${sha256(
		readFileSync(path.join(staged, "install-ceal.sh")),
	)}  install-ceal.sh\n`;
	writeFileSync(path.join(staged, "SHA256SUMS"), inventory);
	const release = path.join(worker, "releases", `0.76.2-linux-arm64-${sha256(inventory)}`);
	renameSync(staged, release);
	symlinkSync(path.join("releases", path.basename(release)), path.join(worker, "current"));
	symlinkSync(path.join(".ceal-cli", "worker", "current", "ceal-linux-arm64"), path.join(install, "ceal"));
	return {
		root,
		worker,
		command: path.join(install, "ceal"),
		codexHome,
		claudeHome,
		bundle: createSkillDirectoryBundle(source),
		cleanup: () => rmSync(root, { recursive: true, force: true }),
	};
}

function readFile(file: string): string {
	assert.equal(existsSync(file), true);
	return readFileSync(file, "utf8");
}

function rewriteTarHeader(bytes: Buffer, member: string, { name, type, mode }: TarHeaderOptions = {}): void {
	for (let offset = 0; offset + 512 <= bytes.length; ) {
		const header = bytes.subarray(offset, offset + 512);
		const observed = header.subarray(0, 100).toString("utf8").replace(/\0.*$/u, "");
		if (observed === member) {
			if (name) {
				header.fill(0, 0, 100);
				header.write(name, 0, 100, "utf8");
			}
			if (type !== undefined) header[156] = type;
			if (mode !== undefined) {
				header.fill(0, 100, 108);
				header.write(mode.toString(8).padStart(7, "0"), 100, 7, "ascii");
			}
			header.fill(0x20, 148, 156);
			const checksum = header
				.reduce((sum: number, byte: number) => sum + byte, 0)
				.toString(8)
				.padStart(6, "0");
			header.write(checksum, 148, 6, "ascii");
			header[154] = 0;
			header[155] = 0x20;
			return;
		}
		const size = Number.parseInt(header.subarray(124, 136).toString("ascii").replace(/\0.*$/u, "").trim() || "0", 8);
		offset += 512 + Math.ceil(size / 512) * 512;
	}
	assert.fail(`tar member not found: ${member}`);
}
