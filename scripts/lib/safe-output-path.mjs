// One symlink guard for the worker release lane.
//
// This check existed as four hand-copied functions, and two of them had drifted
// into a version that does not actually guard. Those two wrote
// `existsSync(current) && lstatSync(current).isSymbolicLink()`, but `existsSync`
// *follows* the link: for a component that is a symlink to a path which does not
// exist, `existsSync` returns false, the `lstatSync` arm never runs, and the
// dangling symlink is accepted. A later `mkdirSync`/`writeFileSync` through that
// component then creates the link's target, which is the exact redirection the
// guard exists to refuse.
//
// `lstatSync` never follows the link, so it is the only correct probe. A missing
// component is a real state and not a failure: nothing can be redirected through
// a path that does not exist yet, so the walk stops there.
//
// `scripts/build-platform-binaries.mjs` keeps its own copy on purpose — it is
// frozen compatibility material this lane may not amend.
import { lstatSync } from "node:fs";
import path from "node:path";

/**
 * Refuses an output path any of whose components is a symbolic link.
 *
 * @param target absolute or relative output path to walk
 * @param fail called as `fail("unsafe_output", message)`; must throw
 * @param subject names the path in the caller's own error vocabulary
 */
export function assertNoSymlinkComponents(target, fail, subject) {
	const root = path.parse(target).root;
	let current = root;
	for (const component of target.slice(root.length).split(path.sep).filter(Boolean)) {
		current = path.join(current, component);
		let stat;
		try {
			stat = lstatSync(current);
		} catch (error) {
			// A component that does not exist cannot redirect a write, and neither
			// can anything below it, so the walk is finished rather than failed.
			if (error?.code === "ENOENT") return;
			fail("unsafe_output", `Could not safely inspect ${subject}.`);
			return;
		}
		if (stat.isSymbolicLink()) fail("unsafe_output", `${subject} must not contain symbolic links.`);
	}
}
