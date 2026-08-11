/* global process */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readlinkSync,
	renameSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { sha256 } from "../dist/sha256.js";
import { createCealStableUpdateRunner } from "../dist/stable-update.js";

test("stable updater only launches a current managed worker generation and reads back its replacement", async (context) => {
	const root = mkdtempSync(path.join(tmpdir(), "ceal-stable-update-"));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const install = path.join(root, "prefix");
	const worker = path.join(install, ".ceal-cli", "worker");
	const releases = path.join(worker, "releases");
	const stagedFirst = path.join(releases, ".first");
	const second = nextGenerationPath(worker, "0.65.1", "linux-amd64");
	mkdirSync(stagedFirst, { recursive: true });
	writeWorkerBinary(path.join(stagedFirst, "ceal-linux-amd64"), "0.65.0");
	writeFileSync(path.join(stagedFirst, "install.sh"), updateScript(second));
	chmodSync(path.join(stagedFirst, "install.sh"), 0o755);
	writeInventory(stagedFirst);
	const first = finalizeGeneration(stagedFirst, "0.65.0", "linux-amd64");
	symlinkSync(path.join("releases", path.basename(first)), path.join(worker, "current"));
	mkdirSync(install, { recursive: true });
	symlinkSync(".ceal-cli/worker/current/ceal-linux-amd64", path.join(install, "ceal"));

	const stages = [];
	const result = await createCealStableUpdateRunner(path.join(install, "ceal"), { PATH: process.env.PATH })({
		onProgress: (stage) => stages.push(stage),
	});
	assert.equal(result.status, "updated");
	assert.equal(result.previous_version, "0.65.0");
	assert.equal(result.installed_version, "0.65.1");
	assert.equal(result.platform, "linux-amd64");
	assert.equal(result.artifact_sha256, sha256(readFileSync(path.join(second, "ceal-linux-amd64"))));
	assert.equal(typeof result.elapsed_ms, "number");
	assert.equal(readlinkSync(path.join(install, "ceal")), ".ceal-cli/worker/current/ceal-linux-amd64");
	assert.deepEqual(stages, ["check", "download_install", "verify", "installed_readback"]);
});

test("stable updater recognizes a managed darwin worker generation", async (context) => {
	const root = mkdtempSync(path.join(tmpdir(), "ceal-stable-update-darwin-"));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const install = path.join(root, "prefix");
	const worker = path.join(install, ".ceal-cli", "worker");
	const stagedFirst = path.join(worker, "releases", ".first");
	const second = nextGenerationPath(worker, "0.65.2", "darwin-arm64");
	mkdirSync(stagedFirst, { recursive: true });
	writeWorkerBinary(path.join(stagedFirst, "ceal-darwin-arm64"), "0.65.1");
	writeFileSync(path.join(stagedFirst, "install-ceal.sh"), updateScript(second, "0.65.2", "ceal-darwin-arm64"));
	chmodSync(path.join(stagedFirst, "install-ceal.sh"), 0o755);
	writeInventory(stagedFirst, "install-ceal.sh");
	const first = finalizeGeneration(stagedFirst, "0.65.1", "darwin-arm64");
	symlinkSync(path.join("releases", path.basename(first)), path.join(worker, "current"));
	mkdirSync(install, { recursive: true });
	symlinkSync(".ceal-cli/worker/current/ceal-darwin-arm64", path.join(install, "ceal"));
	const result = await createCealStableUpdateRunner(path.join(install, "ceal"), { PATH: process.env.PATH })();
	assert.equal(result.status, "updated");
	assert.equal(result.installed_version, "0.65.2");
	assert.equal(result.platform, "darwin-arm64");
	assert.equal(readlinkSync(path.join(install, "ceal")), ".ceal-cli/worker/current/ceal-darwin-arm64");
});

test("stable updater fails closed for an unmanaged or tampered staged installer", async (context) => {
	const root = mkdtempSync(path.join(tmpdir(), "ceal-stable-update-unsafe-"));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const binary = path.join(root, "ceal-linux-amd64");
	writeWorkerBinary(binary, "0.65.0");
	const stages = [];
	const unmanaged = await createCealStableUpdateRunner(binary, { PATH: process.env.PATH })({ onProgress: (stage) => stages.push(stage) });
	assert.equal(unmanaged.status, "unavailable");
	assert.equal(unmanaged.error.kind, "update_unavailable");
	assert.deepEqual(stages, ["check"]);
});

test("stable updater rejects a verified installer result that would downgrade the worker", async (context) => {
	const root = mkdtempSync(path.join(tmpdir(), "ceal-stable-update-downgrade-"));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const install = path.join(root, "prefix");
	const worker = path.join(install, ".ceal-cli", "worker");
	const releases = path.join(worker, "releases");
	const stagedFirst = path.join(releases, ".first");
	mkdirSync(stagedFirst, { recursive: true });
	writeWorkerBinary(path.join(stagedFirst, "ceal-linux-amd64"), "0.65.1");
	writeFileSync(path.join(stagedFirst, "install.sh"), downgradeScript());
	chmodSync(path.join(stagedFirst, "install.sh"), 0o755);
	writeInventory(stagedFirst);
	const first = finalizeGeneration(stagedFirst, "0.65.1", "linux-amd64");
	symlinkSync(path.join("releases", path.basename(first)), path.join(worker, "current"));
	mkdirSync(install, { recursive: true });
	symlinkSync(".ceal-cli/worker/current/ceal-linux-amd64", path.join(install, "ceal"));
	const stages = [];
	const result = await createCealStableUpdateRunner(path.join(install, "ceal"), { PATH: process.env.PATH })({
		onProgress: (stage) => stages.push(stage),
	});
	assert.equal(result.status, "unavailable");
	assert.equal(result.error.kind, "update_failed");
	assert.deepEqual(stages, ["check", "download_install"]);
});

test("stable updater runs only the checksum-bound migrated worker installer", async (context) => {
	const root = mkdtempSync(path.join(tmpdir(), "ceal-stable-update-migrated-"));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const install = path.join(root, "prefix");
	const worker = path.join(install, ".ceal-cli", "worker");
	const stagedFirst = path.join(worker, "releases", ".first");
	const second = nextGenerationPath(worker, "0.65.2", "linux-amd64");
	mkdirSync(stagedFirst, { recursive: true });
	writeWorkerBinary(path.join(stagedFirst, "ceal-linux-amd64"), "0.65.1");
	writeFileSync(path.join(stagedFirst, "install-ceal.sh"), updateScript(second, "0.65.2"));
	chmodSync(path.join(stagedFirst, "install-ceal.sh"), 0o755);
	writeInventory(stagedFirst, "install-ceal.sh");
	const first = finalizeGeneration(stagedFirst, "0.65.1", "linux-amd64");
	symlinkSync(path.join("releases", path.basename(first)), path.join(worker, "current"));
	mkdirSync(install, { recursive: true });
	symlinkSync(".ceal-cli/worker/current/ceal-linux-amd64", path.join(install, "ceal"));
	const result = await createCealStableUpdateRunner(path.join(install, "ceal"), { PATH: process.env.PATH })();
	assert.equal(result.status, "updated");
	assert.equal(result.installed_version, "0.65.2");
});

// `ceal update` had no deadline at all: it spawned the staged installer and
// waited for `close`, which never comes from an origin that accepts the
// connection and then goes silent. The command sat there with no envelope, and
// an agent cannot tell that apart from slow work. Every other wait in this CLI
// is bounded.
//
// The fixtures below sleep 20 seconds rather than forever, and each test carries
// its own bound. Both are about how a regression *fails*: with the deadline
// removed, an unbounded sleep hangs the runner until CI's job timeout kills it
// with no TAP output at all, which reads as infrastructure trouble rather than
// as the regression it is.
const DEADLINE_TEST_TIMEOUT_MS = 20_000;

test("a staged installer that never finishes is stopped and reported, not waited on", {
	timeout: DEADLINE_TEST_TIMEOUT_MS,
}, async (context) => {
	const root = scratch(context, "deadline");
	const install = installedGeneration(root, "sleep 20\n");

	const started = Date.now();
	const result = await createCealStableUpdateRunner(install, { PATH: process.env.PATH }, deadlines({ installerMs: 150 }))();
	const elapsed = Date.now() - started;

	assert.equal(result.status, "unavailable");
	assert.equal(result.error.kind, "update_failed");
	// The message has to say the deadline stopped it. "did not complete" would
	// send an operator to reinstall a release that is very likely fine.
	assert.match(result.error.message, /deadline/u);
	// The bound is the assertion: without it this resolves in 20 seconds.
	assert.ok(elapsed < 5_000, `the update took ${elapsed}ms; its deadline did not bound it`);
});

// `install-ceal.sh` traps TERM to roll back a half-staged generation and release
// its install lock — a bare `mkdir` on hosts without flock, where nothing else
// will ever clear it. A POSIX shell does not run a trap while blocked on a
// foreground child, so signalling only the shell leaves the trap queued forever
// and the SIGKILL then destroys it unrun. Killing the process group takes the
// child down, the shell's wait returns, and the rollback happens. This is the
// difference between a bounded command and a bounded command that wedges the
// next install, and it was wrong in the first version of this deadline.
test("a timed-out installer still gets to run its rollback trap", { timeout: DEADLINE_TEST_TIMEOUT_MS }, async (context) => {
	const root = scratch(context, "trap");
	const marker = path.join(root, "rolled-back");
	const lock = path.join(root, "install.lock.d");
	const install = installedGeneration(
		root,
		`set -eu
cleanup() { : > '${marker}'; rmdir '${lock}' 2>/dev/null || true; exit 1; }
trap cleanup EXIT HUP INT TERM
mkdir '${lock}'
sleep 20
`,
	);

	await createCealStableUpdateRunner(install, { PATH: process.env.PATH }, deadlines({ installerMs: 150, terminationGraceMs: 2_000 }))();
	// The trap runs after our promise settles, so give the shell a moment to
	// unwind before reading what it left behind.
	await delay(500);
	assert.equal(existsSync(marker), true, "the installer was killed before its rollback trap could run");
	assert.equal(existsSync(lock), false, "the install lock was leaked; the next update would refuse to start");
});

// A shell that ignores SIGTERM must not turn a bounded wait back into an
// unbounded one. Asserting the envelope is not enough — it arrives either way,
// because the post-kill report settles on its own clock. What distinguishes a
// real escalation is whether the process is actually gone afterwards.
test("an installer that ignores SIGTERM is killed rather than waited out", { timeout: DEADLINE_TEST_TIMEOUT_MS }, async (context) => {
	const root = scratch(context, "sigterm");
	const pidFile = path.join(root, "installer.pid");
	const install = installedGeneration(root, `trap '' TERM\necho $$ > '${pidFile}'\nsleep 20\n`);

	const started = Date.now();
	const result = await createCealStableUpdateRunner(install, { PATH: process.env.PATH }, deadlines({ installerMs: 150 }))();
	const elapsed = Date.now() - started;

	assert.equal(result.error.kind, "update_failed");
	assert.ok(elapsed < 5_000, `the update took ${elapsed}ms; SIGTERM was ignored and nothing escalated`);
	await delay(300);
	const pid = Number(readFileSync(pidFile, "utf8").trim());
	assert.ok(Number.isInteger(pid) && pid > 0, "the fixture must record the pid it is asserting about");
	assert.equal(processAlive(pid), false, `installer pid ${pid} survived a deadline it ignored SIGTERM for`);
});

// The readback runs an installed binary with no network in it, so it gets its
// own much shorter bound, and it reaches the readback envelope rather than the
// installer one. Note what this does NOT prove: a killed readback returns empty
// output, which fails to parse anyway, so the explicit `timedOut` check in
// `readVersion` is defensive and is not gated by this test.
test("a version readback that hangs is bounded and reported as a failed readback", {
	timeout: DEADLINE_TEST_TIMEOUT_MS,
}, async (context) => {
	const root = scratch(context, "readback");
	const install = installedGeneration(root, "exit 0\n", "sleep 20\n");

	const started = Date.now();
	const result = await createCealStableUpdateRunner(install, { PATH: process.env.PATH }, deadlines({ versionReadbackMs: 150 }))();
	const elapsed = Date.now() - started;

	assert.equal(result.error.kind, "update_readback_failed");
	assert.ok(elapsed < 5_000, `the readback took ${elapsed}ms; its deadline did not bound it`);
});

// Deciding the answer and being able to return it are different things, and the
// first version of this deadline had the first without the second: the installer
// is `/bin/sh`, whatever it spawned inherits the stdio pipes, and our read ends
// keep the event loop alive after the shell is gone. The envelope arrived on
// time and `ceal update` still hung. Every assertion above is blind to that —
// they all measure when the promise settles — so this one measures the only
// thing that shows it: when the process running the update can exit.
test("the update process exits once it has its answer", { timeout: DEADLINE_TEST_TIMEOUT_MS }, async (context) => {
	const root = scratch(context, "exit");
	const install = installedGeneration(root, "sleep 20\n");
	const driver = path.join(root, "driver.mjs");
	writeFileSync(
		driver,
		[
			`import { createCealStableUpdateRunner } from ${JSON.stringify(new URL("../dist/stable-update.js", import.meta.url).href)};`,
			`const run = createCealStableUpdateRunner(${JSON.stringify(install)}, { PATH: process.env.PATH },`,
			"  { installerMs: 150, terminationGraceMs: 100, postKillReportMs: 50 });",
			"await run();",
		].join("\n"),
	);

	const started = Date.now();
	const child = spawn(process.execPath, [driver], { stdio: "ignore" });
	await new Promise((resolve) => child.once("close", resolve));
	const elapsed = Date.now() - started;

	// Without the pipe release this is the fixture's full 20 seconds: the answer
	// is already decided, and the command sits there unable to say so.
	assert.ok(elapsed < 10_000, `the update process took ${elapsed}ms to exit after deciding its answer`);
});

// Short kill clocks as well as short deadlines: the real ones are seconds, and a
// test that waited them out five times over would not stay in the iteration gate.
function deadlines(overrides) {
	return { terminationGraceMs: 100, postKillReportMs: 50, ...overrides };
}

function delay(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function processAlive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		// EPERM means it exists under another user, which for a fixture this
		// process spawned would itself be a surprise worth failing on.
		return error.code === "EPERM";
	}
}

function scratch(context, label) {
	const root = mkdtempSync(path.join(tmpdir(), `ceal-stable-update-${label}-`));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	return root;
}

// One managed generation whose installer and worker binary are whatever the
// caller needs them to be, wired through the same digest inventory the real
// layout requires.
function installedGeneration(root, installerBody, workerBody = null) {
	const install = path.join(root, "prefix");
	const worker = path.join(install, ".ceal-cli", "worker");
	const stagedGeneration = path.join(worker, "releases", ".first");
	mkdirSync(stagedGeneration, { recursive: true });
	const binary = path.join(stagedGeneration, "ceal-linux-amd64");
	if (workerBody === null) writeWorkerBinary(binary, "0.65.0");
	else {
		writeFileSync(binary, `#!/usr/bin/env sh\n${workerBody}`);
		chmodSync(binary, 0o755);
	}
	writeFileSync(path.join(stagedGeneration, "install.sh"), `#!/usr/bin/env sh\n${installerBody}`);
	chmodSync(path.join(stagedGeneration, "install.sh"), 0o755);
	writeInventory(stagedGeneration);
	const generation = finalizeGeneration(stagedGeneration, "0.65.0", "linux-amd64");
	symlinkSync(path.join("releases", path.basename(generation)), path.join(worker, "current"));
	mkdirSync(install, { recursive: true });
	symlinkSync(".ceal-cli/worker/current/ceal-linux-amd64", path.join(install, "ceal"));
	return path.join(install, "ceal");
}

function updateScript(nextGeneration, version = "0.65.1", binaryName = "ceal-linux-amd64") {
	return `#!/usr/bin/env sh
set -eu
[ "$CEAL_VERSION" = stable ]
[ "$CEAL_INSTALL_ROLE" = worker ]
mkdir -p '${nextGeneration}'
cat > '${path.join(nextGeneration, binaryName)}' <<'EOF'
#!/usr/bin/env sh
if [ "\${1:-}" = version ]; then
  printf 'schema_version: ceal.version.v1\\ncommand: ceal\\nversion: ${version}\\n'
  exit 0
fi
exit 2
EOF
chmod 755 '${path.join(nextGeneration, binaryName)}'
cat > '${path.join(nextGeneration, "install.sh")}' <<'EOF'
#!/usr/bin/env sh
exit 0
EOF
chmod 755 '${path.join(nextGeneration, "install.sh")}'
printf '${sha256("#!/usr/bin/env sh\nexit 0\n")}  install.sh\\n' > '${path.join(nextGeneration, "SHA256SUMS")}'
rm -f "$CEAL_INSTALL_DIR/.ceal-cli/worker/current"
ln -s 'releases/${path.basename(nextGeneration)}' "$CEAL_INSTALL_DIR/.ceal-cli/worker/current"
printf 'installer prose must not escape\\n'
`;
}

function downgradeScript() {
	return `#!/usr/bin/env sh
set -eu
[ "$CEAL_MINIMUM_VERSION" = 0.65.1 ]
exit 1
`;
}

function writeWorkerBinary(file, version) {
	writeFileSync(
		file,
		`#!/usr/bin/env sh
if [ "\${1:-}" = version ]; then
  printf 'schema_version: ceal.version.v1\\ncommand: ceal\\nversion: ${version}\\n'
  exit 0
fi
exit 2
`,
	);
	chmodSync(file, 0o755);
}

function writeInventory(generation, installerName = "install.sh") {
	const installer = readFileSync(path.join(generation, installerName));
	writeFileSync(path.join(generation, "SHA256SUMS"), `${sha256(installer)}  ${installerName}\n`);
}

function finalizeGeneration(stagedGeneration, version, platform) {
	const inventory = readFileSync(path.join(stagedGeneration, "SHA256SUMS"));
	const generation = path.join(path.dirname(stagedGeneration), `${version}-${platform}-${sha256(inventory)}`);
	renameSync(stagedGeneration, generation);
	return generation;
}

function nextGenerationPath(worker, version, platform) {
	const installer = "#!/usr/bin/env sh\nexit 0\n";
	const inventory = `${sha256(installer)}  install.sh\n`;
	return path.join(worker, "releases", `${version}-${platform}-${sha256(inventory)}`);
}
