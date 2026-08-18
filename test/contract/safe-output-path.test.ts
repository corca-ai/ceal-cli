import assert from "node:assert/strict";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { assertNoSymlinkComponents, type SafetyFailure } from "../../scripts/lib/safe-output-path.ts";
import { scratchDir } from "../scratch-dir.ts";

class GuardError extends Error {
	readonly code: Parameters<SafetyFailure>[0];

	constructor(code: Parameters<SafetyFailure>[0], message: string) {
		super(message);
		this.code = code;
	}
}

function fail(code: Parameters<SafetyFailure>[0], message: string): never {
	throw new GuardError(code, message);
}

// `realpathSync`, because this guard's whole job is to find symlink components
// and macOS hands them to every fixture for free: `tmpdir()` there is under
// `/var/folders/...` and `/var` is a link to `/private/var`. Without this the
// accept-cases fail on macOS for a reason that has nothing to do with the code
// under test, and the refuse-cases pass for the wrong one. It burned the
// `ceal-v0.66.0` tag, since the release lane is the only lane that runs macOS.
function scratch(context: TestContext): string {
	return scratchDir(context, "ceal-safe-output-");
}

// The regression this guard was rewritten for. Three of five hand-copied
// versions gated lstatSync behind existsSync, which *follows* the link: a
// component symlinked to a path that does not exist made existsSync false, the
// lstat arm never ran, and the write proceeded through the link. A guard that
// only catches resolvable symlinks is not the guard the release lane needs.
test("a dangling symlink component is refused, not skipped", (context: TestContext) => {
	const root = scratch(context);
	symlinkSync(path.join(root, "no-such-target"), path.join(root, "dangling"));
	assert.throws(
		() => assertNoSymlinkComponents(path.join(root, "dangling", "out"), fail, "Output"),
		(error: unknown) => error instanceof GuardError && error.code === "unsafe_output",
	);
});

test("a symlink component that does resolve is refused", (context: TestContext) => {
	const root = scratch(context);
	mkdirSync(path.join(root, "real"));
	symlinkSync(path.join(root, "real"), path.join(root, "link"));
	assert.throws(
		() => assertNoSymlinkComponents(path.join(root, "link", "out"), fail, "Output"),
		(error: unknown) => error instanceof GuardError && error.code === "unsafe_output",
	);
	// The final component is checked too, not just the parents.
	assert.throws(
		() => assertNoSymlinkComponents(path.join(root, "link"), fail, "Output"),
		(error: unknown) => error instanceof GuardError && error.code === "unsafe_output",
	);
});

// A path that does not exist yet is the normal case for an output directory:
// nothing can be redirected through it, so the walk must stop rather than fail.
test("a plain path is accepted whether or not it exists yet", (context: TestContext) => {
	const root = scratch(context);
	mkdirSync(path.join(root, "a", "b"), { recursive: true });
	assertNoSymlinkComponents(path.join(root, "a", "b"), fail, "Output");
	assertNoSymlinkComponents(path.join(root, "a", "b", "not-created-yet", "deeper"), fail, "Output");
	writeFileSync(path.join(root, "a", "file"), "x");
	assertNoSymlinkComponents(path.join(root, "a", "file"), fail, "Output");
});

// A symlink below the first missing component cannot be reached by a write that
// had to create the missing parent first, so stopping early stays honest.
test("the walk stops at the first missing component", (context: TestContext) => {
	const root = scratch(context);
	assertNoSymlinkComponents(path.join(root, "missing", "anything", "at", "all"), fail, "Output");
});
