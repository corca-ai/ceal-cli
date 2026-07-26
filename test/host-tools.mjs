import { spawnSync } from "node:child_process";

// Some suites drive a shell installer, or simulate a restricted host by faking
// one tool on top of a real one. Those need the tool present on the test host
// itself, which is a property of the runner rather than of the code under test.
// Gate on the tool, not on process.platform: the requirement is what is true,
// and it stays honest if a runner image gains or loses a tool.
export function requireHostTools(...names) {
	const missing = names.filter((name) => spawnSync("/bin/sh", ["-c", `command -v ${name}`], { encoding: "utf8" }).status !== 0);
	return missing.length === 0 ? false : `host lacks ${missing.join(", ")}`;
}
