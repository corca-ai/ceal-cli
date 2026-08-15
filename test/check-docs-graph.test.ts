import assert from "node:assert/strict";
import test from "node:test";
import { AWIKI_INSTALL_COMMAND, checkDocsGraph } from "../scripts/check-docs-graph.ts";

const summary = "// ok connected_graph documents=9 largest_component_ratio=1.0000 orphan_rate=0.0000 content_coverage=1.0000";
const lintFailed = (fields: string) => `// lint_failed documents=9 ${fields} largest_component_ratio=1.0000 content_coverage=1.0000`;

test("accepts a clean graph when awiki only reports style findings", () => {
	const messages: string[] = [];
	const code = checkDocsGraph({
		runAwiki: () => ({ status: 1, stdout: lintFailed("orphans=0 islands=0 link_only_lines=2"), stderr: "" }),
		write: (message) => messages.push(message),
	});
	assert.equal(code, 0);
	assert.match(messages.join("\n"), /style finding.* separately/u);
});

test("rejects graph failures and impossible clean-status combinations", () => {
	assert.equal(
		checkDocsGraph({
			runAwiki: () => ({ status: 1, stdout: lintFailed("orphans=1 islands=0 link_only_lines=0"), stderr: "" }),
			write: () => {},
		}),
		1,
	);
	assert.equal(
		checkDocsGraph({
			runAwiki: () => ({ status: 1, stdout: lintFailed("orphans=0 islands=1 link_only_lines=0"), stderr: "" }),
			write: () => {},
		}),
		1,
	);
	assert.equal(
		checkDocsGraph({
			runAwiki: () => ({ status: 1, stdout: lintFailed("orphans=0 islands=0 link_only_lines=0"), stderr: "" }),
			write: () => {},
		}),
		3,
	);
	assert.equal(checkDocsGraph({ runAwiki: () => ({ status: 1, stdout: summary, stderr: "" }), write: () => {} }), 3);
	assert.equal(
		checkDocsGraph({
			runAwiki: () => ({ status: 0, stdout: lintFailed("orphans=0 islands=0 link_only_lines=2"), stderr: "" }),
			write: () => {},
		}),
		3,
	);
});

test("fails closed for fatal exit or signal termination even with clean output", () => {
	assert.equal(checkDocsGraph({ runAwiki: () => ({ status: 2, stdout: summary, stderr: "" }), write: () => {} }), 3);
	assert.equal(checkDocsGraph({ runAwiki: () => ({ status: null, stdout: summary, stderr: "" }), write: () => {} }), 3);
});

test("fails closed for missing or malformed summaries", () => {
	assert.equal(checkDocsGraph({ runAwiki: () => ({ status: 0, stdout: "", stderr: "" }), write: () => {} }), 3);
	assert.equal(checkDocsGraph({ runAwiki: () => ({ status: 0, stdout: "documents=9", stderr: "" }), write: () => {} }), 3);
	assert.equal(
		checkDocsGraph({
			runAwiki: () => ({ status: 0, stdout: "// ok connected_graph documents=0 orphan_rate=0.0000", stderr: "" }),
			write: () => {},
		}),
		1,
	);
	assert.equal(
		checkDocsGraph({
			runAwiki: () => ({ status: 0, stdout: "// ok connected_graph documents=0.5 orphan_rate=0.0000", stderr: "" }),
			write: () => {},
		}),
		3,
	);
	assert.equal(checkDocsGraph({ runAwiki: () => ({ status: 0, stdout: `${summary} link_only_lines=2`, stderr: "" }), write: () => {} }), 3);
	assert.equal(
		checkDocsGraph({
			runAwiki: () => ({ status: 1, stdout: lintFailed("orphans=0 islands=0 link_only_lines=2 orphan_rate=0.5000"), stderr: "" }),
			write: () => {},
		}),
		3,
	);
});

test("reports the pinned install command when awiki is missing", () => {
	const messages: string[] = [];
	const error = Object.assign(new Error("missing"), { code: "ENOENT" });
	const code = checkDocsGraph({
		runAwiki: () => ({ status: null, stdout: "", stderr: "", error }),
		write: (message) => messages.push(message),
	});
	assert.equal(code, 3);
	assert.match(messages.join("\n"), new RegExp(AWIKI_INSTALL_COMMAND.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
});
