import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createCealAgentGuideStore } from "../dist/agent-guide.js";

test("Codex guide registration follows the role current pointer across releases", () => {
	const root = mkdtempSync(path.join(tmpdir(), "ceal-agent-guide-"));
	const state = path.join(root, "install", ".ceal-cli", "worker");
	const firstRelease = createRelease(state, "first");
	const codexHome = path.join(root, "codex");
	symlinkSync("releases/first", path.join(state, "current"));
	try {
		const store = createCealAgentGuideStore(path.join(firstRelease, "ceal-linux-arm64"), root, codexHome);
		assert.ok(store);
		assert.deepEqual(store.inspect(), {
			status: "staged", agent: "codex", guide_id: "ceal-guide",
			guide_path: path.join(state, "current", "guide"),
			registration_path: path.join(codexHome, "skills", "ceal-guide"),
			update_safe: true, registered: false,
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
	const root = mkdtempSync(path.join(tmpdir(), "ceal-agent-guide-conflict-"));
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
