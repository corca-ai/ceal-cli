import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
	chmodSync,
	copyFileSync,
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
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { buildWorkerNativeArtifactFromDevelopmentInputs } from "../scripts/build-worker-native-artifact.mjs";
import { writeClientSessionStoreFixture } from "./client-session-store-fixture.mjs";
import { requireHostTools } from "./host-tools.mjs";
import { platformProofTest } from "./platform-proof.mjs";
import { execReleaseTestProcess, processIsAlive, runSyncReleaseProcess } from "./release-process-bounds.ts";
import { packedProtocolFixture } from "./worker-release-package-fixture.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INSTALLER = path.join(ROOT, "install-ceal.sh");
const TAG = "ceal-v0.65.0";
// The release record owns this immutable historical executable identity. The
// annotated tag is checked against it below, but never used as the `git show`
// input: a moved unsigned tag must fail rather than select code in an OIDC job.
const CEAL_0_76_1_COMMIT = "2edf126e1c7bf65900d40b449dce9ea4481c6ce7";
// See restrictedTools below: the darwin simulation is assembled from a real
// GNU sha256sum, so it can only be staged on a host that has one.
const simulatedDarwinSkip = requireHostTools("sha256sum");
const simulatedDarwinTest = (name, fn) => test(name, { skip: simulatedDarwinSkip }, fn);

test("worker-only installer migrates only ceal from a legacy dual release", () => {
	withFixture(({ install, release, tools, log }) => {
		mkdirSync(path.join(install, ".ceal-cli", "releases", "legacy"), { recursive: true });
		symlinkSync("releases/legacy", path.join(install, ".ceal-cli", "current"));
		symlinkSync(".ceal-cli/current/ceal-linux-arm64", path.join(install, "ceal"));
		symlinkSync(".ceal-cli/current/cealctl-linux-arm64", path.join(install, "cealctl"));
		const result = run({ install, release, tools, log, version: TAG });
		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, /Installed ceal ceal-v0[.]65[.]0/u);
		assert.match(result.stdout, /The install directory is not on PATH in this shell[.] Run:\n {2}export PATH=/u);
		assert.equal(readlinkSync(path.join(install, "ceal")), ".ceal-cli/worker/current/ceal-linux-arm64");
		assert.equal(readlinkSync(path.join(install, "cealctl")), ".ceal-cli/current/cealctl-linux-arm64");
		assert.equal(existsSync(path.join(install, ".ceal-cli", "operator")), false);
		assert.equal(
			readFileSync(path.join(install, ".ceal-cli", "worker", "current", "install-ceal.sh"), "utf8"),
			readFileSync(INSTALLER, "utf8"),
		);
		assert.equal(existsSync(path.join(install, ".ceal-cli", "worker", "current", "guide")), false);
		assert.match(result.stdout, /ceal guide register codex/u);
		assert.match(result.stdout, /ceal guide register claude/u);
		assert.equal(lstatSync(path.join(install, ".ceal-cli", "worker", "current")).isSymbolicLink(), true);
		const cosign = readFileSync(log, "utf8");
		assert.equal(cosign.match(/verify-blob/gu)?.length, 5);
		assert.match(cosign, /ceal-release[.]yml@refs\/tags\/ceal-v0[.]65[.]0/u);
	});
});

test("the exact 0.76.1 installer crosses to the embedded-directory release without reinstall", () => {
	withFixture(({ root, install, release, tools, log }) => {
		const crossingTag = "ceal-v0.76.2";
		for (const platform of ["linux-arm64", "linux-amd64"]) {
			writeWorkerBinary(path.join(release, `ceal-${platform}`), "0.76.2");
			writeManifest(release, platform, "0.76.2");
		}
		rewriteChecksumsAndSidecars(release);
		const oldInstaller = path.join(root, "install-ceal-0.76.1.sh");
		assert.equal(
			execReleaseTestProcess("git", ["rev-parse", "ceal-v0.76.1^{}"], { encoding: "utf8", cwd: ROOT }).trim(),
			CEAL_0_76_1_COMMIT,
			"the compatibility tag moved away from the released commit",
		);
		writeFileSync(
			oldInstaller,
			execReleaseTestProcess("git", ["show", `${CEAL_0_76_1_COMMIT}:install-ceal.sh`], { encoding: "utf8", cwd: ROOT }),
			{ mode: 0o755 },
		);
		const registration = path.join(root, "codex", "skills", "ceal-guide");
		mkdirSync(path.dirname(registration), { recursive: true });
		symlinkSync(path.join(install, ".ceal-cli", "worker", "current", "guide"), registration, "dir");

		const result = run({
			install,
			release,
			tools,
			log,
			version: crossingTag,
			minimumVersion: "0.76.1",
			installer: oldInstaller,
		});
		assert.equal(result.status, 0, result.stderr);
		assert.equal(readFileSync(path.join(install, "ceal"), "utf8").includes("ceal.version.v1"), true);
		const bridge = readFileSync(path.join(registration, "SKILL.md"), "utf8");
		assert.match(bridge, /ceal guide register codex/u);
		assert.match(bridge, /ceal guide register claude/u);
		assert.doesNotMatch(bridge, /references\//u);
		const stagedInstaller = path.join(install, ".ceal-cli", "worker", "current", "install-ceal.sh");
		const repeated = run({
			install,
			release,
			tools,
			log,
			version: crossingTag,
			minimumVersion: "0.76.1",
			installer: stagedInstaller,
		});
		assert.equal(repeated.status, 0, repeated.stderr);
		assert.equal(realpathSync(registration), path.join(realpathSync(path.join(install, ".ceal-cli", "worker", "current")), "guide"));
		const bridgePath = path.join(registration, "SKILL.md");
		const historicalMode = lstatSync(bridgePath).mode & 0o7777;
		const assertUnsafeMode = (expectedMessage) => {
			const result = run({
				install,
				release,
				tools,
				log,
				version: crossingTag,
				minimumVersion: "0.76.1",
				installer: stagedInstaller,
			});
			assert.notEqual(result.status, 0);
			assert.match(result.stderr, expectedMessage);
		};
		for (const unsafeBits of [0o100, 0o10, 0o1, 0o4000, 0o2000, 0o1000]) {
			chmodSync(bridgePath, 0o600 | unsafeBits);
			assertUnsafeMode(/unsafe compatibility guide file mode/u);
		}
		chmodSync(bridgePath, historicalMode);
		const guidePath = path.dirname(bridgePath);
		const historicalDirectoryMode = lstatSync(guidePath).mode & 0o7777;
		for (const unsafeBits of [0o4000, 0o2000, 0o1000]) {
			chmodSync(guidePath, 0o700 | unsafeBits);
			assertUnsafeMode(/unsafe compatibility guide directory mode/u);
		}
		chmodSync(guidePath, historicalDirectoryMode);
	});
});

test("the current installer never lets an unavailable compatibility guide asset gate binary success", () => {
	withFixture(({ install, release, tools, log }) => {
		rmSync(path.join(release, "ceal-guide-SKILL.md"));
		const result = run({ install, release, tools, log, version: TAG });
		assert.equal(result.status, 0, result.stderr);
		assert.equal(existsSync(path.join(install, "ceal")), true);
		assert.equal(existsSync(path.join(install, ".ceal-cli", "worker", "current", "guide")), false);
		assert.match(result.stdout, /ceal guide register codex/u);
		assert.match(result.stdout, /guide registration never changes this install result/u);
	});
});

test("worker installer omits PATH guidance when the exact install directory is already reachable", () => {
	withFixture(({ install, release, tools, log }) => {
		const result = run({ install, release, tools, log, version: TAG, restrictedPath: `${install}:${tools}:${process.env.PATH}` });
		assert.equal(result.status, 0, result.stderr);
		assert.doesNotMatch(result.stdout, /install directory is not on PATH/u);
	});
});

test("worker installer renders a copyable PATH command for a shell-active install directory", () => {
	withFixture(({ install, release, tools, log }) => {
		const shellActiveInstall = path.join(path.dirname(install), "worker's local bin");
		const result = run({ install: shellActiveInstall, release, tools, log, version: TAG });
		assert.equal(result.status, 0, result.stderr);
		const command = result.stdout
			.split("\n")
			.find((line) => line.startsWith("  export PATH="))
			?.trim();
		assert.equal(command, `export PATH='${shellActiveInstall.replaceAll("'", "'\\''")}':"$PATH"`);
		const applied = runSyncReleaseProcess("/bin/sh", ["-c", `${command}; [ "\${PATH%%:*}" = "$EXPECTED_INSTALL_DIR" ]`], {
			encoding: "utf8",
			env: { ...process.env, EXPECTED_INSTALL_DIR: shellActiveInstall },
		});
		assert.equal(applied.status, 0, applied.stderr);
	});
});

test("worker installer rejects install directories that cannot be stable PATH entries before external work", () => {
	for (const [install, message] of [
		["relative/worker-bin", /CEAL_INSTALL_DIR must be an absolute path/u],
		["/tmp/worker:bin", /CEAL_INSTALL_DIR must not contain ':'/u],
	]) {
		const result = runSyncReleaseProcess("/bin/sh", [INSTALLER], {
			encoding: "utf8",
			env: { ...process.env, CEAL_INSTALL_DIR: install, CEAL_VERSION: TAG, PATH: "/usr/bin:/bin" },
		});
		assert.equal(result.status, 1);
		assert.match(result.stderr, message);
		assert.equal(result.stdout, "");
	}
});

test("release sync-process proof kills a TERM-ignoring command tree", (context) => {
	const root = mkdtempSync(path.join(tmpdir(), "ceal-release-process-bound-"));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const pidFile = path.join(root, "pid");
	const result = runSyncReleaseProcess(
		"/bin/sh",
		[
			"-c",
			`trap '' TERM; /bin/sh -c 'while :; do sleep 1; done' & child=$!; printf '%s %s' "$$" "$child" > ${JSON.stringify(pidFile)}; printf 'ready\\n'; wait`,
		],
		{ encoding: "utf8", timeoutStartMarker: "ready\n", timeoutStartDeadlineMs: 5_000 },
		50,
	);
	assert.equal(result.error?.code, "ETIMEDOUT");
	for (const pid of readFileSync(pidFile, "utf8").split(" ").map(Number))
		assert.equal(processIsAlive(pid), false, `timed-out release command pid ${pid} survived its watchdog`);
});

test("release test children cannot inherit CI credential surfaces", () => {
	const result = runSyncReleaseProcess(
		process.execPath,
		[
			"-e",
			"process.stdout.write(JSON.stringify({ oidc: process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN, runtime: process.env.ACTIONS_RUNTIME_TOKEN, github: process.env.GITHUB_TOKEN }))",
		],
		{
			encoding: "utf8",
			env: {
				...process.env,
				ACTIONS_ID_TOKEN_REQUEST_TOKEN: "must-not-leak",
				ACTIONS_ID_TOKEN_REQUEST_URL: "https://tokens.invalid",
				ACTIONS_RUNTIME_TOKEN: "must-not-leak",
				GITHUB_TOKEN: "must-not-leak",
			},
		},
	);
	assert.equal(result.status, 0, result.stderr);
	assert.deepEqual(JSON.parse(result.stdout), {});
});

test("worker stable resolver follows the worker static-origin stable pointer", () => {
	withFixture(({ install, release, tools, log }) => {
		writeStablePointer(release);
		const urlLog = path.join(path.dirname(log), "curl-fetches.log");
		const result = run({ install, release, tools, log, version: "stable", urlLog });
		assert.equal(result.status, 0, result.stderr);
		assert.equal(readlinkSync(path.join(install, "ceal")), ".ceal-cli/worker/current/ceal-linux-arm64");
		assert.match(readFileSync(log, "utf8"), /refs\/tags\/ceal-v0[.]65[.]0/u);
		const fetches = readFileSync(urlLog, "utf8");
		assert.match(fetches, /^https:\/\/release[.]example[.]test\/releases\/worker\/stable\/ceal-worker-stable-release[.]json$/mu);
		assert.match(fetches, /^https:\/\/release[.]example[.]test\/releases\/worker\/ceal-v0[.]65[.]0\/ceal-linux-arm64$/mu);
		assert.doesNotMatch(fetches, /api[.]github[.]com/u);
		assert.doesNotMatch(fetches, /Authorization/u);
	});
});

test("worker stable lane ignores the GitHub token and stays on the static origin", () => {
	withFixture(({ install, release, tools, log }) => {
		writeStablePointer(release);
		const urlLog = path.join(path.dirname(log), "curl-fetches.log");
		const result = run({ install, release, tools, log, version: "stable", token: "fake-token", urlLog });
		assert.equal(result.status, 0, result.stderr);
		const fetches = readFileSync(urlLog, "utf8");
		assert.doesNotMatch(fetches, /api[.]github[.]com/u);
		assert.doesNotMatch(fetches, /Authorization/u);
	});
});

simulatedDarwinTest("worker installer bootstraps missing cosign only from the static release origin", () => {
	withFixture(({ install, release, tools, log }) => {
		rmSync(path.join(tools, "cosign"));
		writeFileSync(path.join(release, "cosign-linux-arm64"), "not the pinned cosign binary\n");
		const urlLog = path.join(path.dirname(log), "curl-fetches.log");
		const result = run({ install, release, tools, log, version: TAG, restrictedPath: restrictedTools(tools), urlLog });
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /Pinned cosign v2[.]6[.]4 checksum mismatch/u);
		const fetches = readFileSync(urlLog, "utf8");
		assert.match(fetches, /^https:\/\/release[.]example[.]test\/releases\/tooling\/cosign\/v2[.]6[.]4\/cosign-linux-arm64$/mu);
		assert.doesNotMatch(fetches, /github[.]com/u);
	});
});

test("worker stable update refuses a pointer older than the installed release", () => {
	withFixture(({ install, release, tools, log }) => {
		writeStablePointer(release);
		const result = run({ install, release, tools, log, version: "stable", minimumVersion: "0.66.0" });
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /older than the installed worker release/u);
		assert.equal(existsSync(path.join(install, "ceal")), false);
	});
});

test("worker installer rejects a malformed or mismatched stable pointer", () => {
	for (const [prepare, message] of [
		[(release) => writeStablePointer(release, { tag: "v9.9.9" }), /stable release pointer is not a valid/u],
		[(release) => writeStablePointer(release, { sha256sums_sha256: "not-a-release-set-digest" }), /stable release pointer is not a valid/u],
		[(release) => writeFileSync(path.join(release, "ceal-worker-stable-release.json"), ""), /stable release pointer is not a valid/u],
		[
			(release) => writeStablePointer(release, { sha256sums_sha256: digest("tampered release set") }),
			/does not match the downloaded signed SHA256SUMS/u,
		],
	])
		assertStablePointerRefused(prepare, message);
});

// The pointer is read before any signature exists, so it is the one document an
// origin can choose freely. Each case below fails if its specific guard in
// resolve_stable_release is removed.
test("worker installer rejects every pointer an origin could choose freely", () => {
	const releaseSetOf = (release) => digest(readFileSync(path.join(release, "SHA256SUMS")));
	const cases = [
		// A 64-character non-hex value: proves the character check, not the length check.
		{ why: "digest is the right length but not hex", pointer: (_r) => ({ sha256sums_sha256: "z".repeat(64) }) },
		{ why: "schema_version is not the v1 reader's schema", pointer: () => ({ schema_version: "ceal.worker_stable_release.v2" }) },
		{ why: "schema_version is absent", pointer: () => ({ schema_version: undefined }) },
		{ why: "tag is absent", pointer: () => ({ tag: undefined }) },
		{ why: "tag is not a string", pointer: () => ({ tag: 123 }) },
		{ why: "tag carries a leading zero", pointer: () => ({ tag: "ceal-v01.2.3" }) },
	];
	for (const { why, pointer } of cases) {
		assertStablePointerRefused(
			(release) => {
				const overrides = pointer(release);
				const body = { schema_version: "ceal.worker_stable_release.v1", tag: TAG, sha256sums_sha256: releaseSetOf(release), ...overrides };
				for (const [key, value] of Object.entries(overrides)) if (value === undefined) delete body[key];
				writeFileSync(path.join(release, "ceal-worker-stable-release.json"), `${JSON.stringify(body)}\n`);
			},
			/stable release pointer is not a valid/u,
			why,
		);
	}

	// A duplicate key must be refused outright rather than resolved to whichever
	// copy the reader happened to match, so put the decoy first.
	assertStablePointerRefused((release) => {
		writeFileSync(
			path.join(release, "ceal-worker-stable-release.json"),
			`{"schema_version":"ceal.worker_stable_release.v1","tag":"ceal-v9.9.9","tag":"${TAG}","sha256sums_sha256":"${releaseSetOf(release)}"}\n`,
		);
	}, /stable release pointer is not a valid/u);
});

// Already installed generations re-run their own copy of this script against
// whatever the origin serves later, so a pointer that gained a field, changed
// key order, or is pretty-printed must still resolve.
test("worker installer resolves a reordered, extended, or pretty-printed pointer", () => {
	for (const render of [
		(body) => JSON.stringify({ sha256sums_sha256: body.sha256sums_sha256, schema_version: body.schema_version, tag: body.tag }),
		(body) => JSON.stringify({ ...body, published_at: "2026-07-25T00:00:00Z", signature: { keyless: true } }),
		(body) => JSON.stringify(body, null, 2),
	]) {
		withFixture(({ install, release, tools, log }) => {
			const body = {
				schema_version: "ceal.worker_stable_release.v1",
				tag: TAG,
				sha256sums_sha256: digest(readFileSync(path.join(release, "SHA256SUMS"))),
			};
			writeFileSync(path.join(release, "ceal-worker-stable-release.json"), `${render(body)}\n`);
			runSuccessfully({ install, release, tools, log, version: "stable" });
			assert.equal(readlinkSync(path.join(install, "ceal")), ".ceal-cli/worker/current/ceal-linux-arm64");
		});
	}
});

test("worker installer rejects a syntactically valid decoy manifest and a rejected signer", () => {
	withFixture(({ install, release, tools, log }) => {
		const manifest = path.join(release, "ceal-worker-release-manifest-linux-arm64.json");
		writeFileSync(manifest, JSON.stringify({ note: "ceal.worker_release_manifest.v1 0.65.0 linux-arm64 ceal ceal-guide.tar" }) + "\n");
		rewriteChecksumsAndSidecars(release);
		const malformed = run({ install, release, tools, log, version: TAG });
		assert.notEqual(malformed.status, 0);
		assert.match(malformed.stderr, /signed worker platform manifest/u);
		assert.equal(existsSync(path.join(install, "ceal")), false);
	});
	withFixture(({ install, release, tools, log }) => {
		const rejected = run({ install, release, tools, log, version: TAG, cosignFail: true });
		assert.notEqual(rejected.status, 0);
		assert.equal(existsSync(path.join(install, "ceal")), false);
		assert.equal(existsSync(path.join(install, ".ceal-cli", "worker", "current")), false);
	});
});

// Each override breaks exactly one binding the manifest check exists to hold.
// Without these, that whole check can be deleted and the suite still passes.
test("worker installer rejects a manifest that does not bind this release, platform, command, and guide", () => {
	const cases = [
		{ why: "guide digest is not the signed guide", overrides: { guide: { name: "ceal-guide-SKILL.md", bytes: 7, sha256: "f".repeat(64) } } },
		{ why: "guide is renamed", overrides: { guide: { name: "evil-SKILL.md", bytes: 7, sha256: "f".repeat(64) } } },
		{ why: "guide block is absent", overrides: { guide: undefined } },
		{ why: "command is another binary", overrides: { command: "cealctl" } },
		{ why: "version is a different release", overrides: { version: "0.65.9" } },
		{ why: "platform is another platform", overrides: { platform: "linux-amd64" } },
		{ why: "schema_version is not the manifest schema", overrides: { schema_version: "evil.v1" } },
	];
	for (const { why, overrides } of cases) {
		withFixture(({ install, release, tools, log }) => {
			writeManifest(release, "linux-arm64", "0.65.0", overrides);
			rewriteChecksumsAndSidecars(release);
			const result = run({ install, release, tools, log, version: TAG });
			assert.notEqual(result.status, 0, why);
			assert.match(result.stderr, /signed worker platform manifest/u, why);
			assert.equal(existsSync(path.join(install, "ceal")), false, why);
		});
	}

	// The only thing the occurrence counts add over the equality checks: a
	// duplicate key whose second copy is correct would otherwise be accepted,
	// because the later line overwrites the earlier one.
	withFixture(({ install, release, tools, log }) => {
		const manifestPath = path.join(release, `ceal-worker-release-manifest-linux-arm64.json`);
		writeManifest(release, "linux-arm64");
		writeFileSync(
			manifestPath,
			readFileSync(manifestPath, "utf8").replace('  "version": "0.65.0",', '  "version": "9.9.9",\n  "version": "0.65.0",'),
		);
		rewriteChecksumsAndSidecars(release);
		const result = run({ install, release, tools, log, version: TAG });
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /signed worker platform manifest/u);
		assert.equal(existsSync(path.join(install, "ceal")), false);
	});
});

test("worker installer refuses a damaged or widened existing generation", () => {
	for (const mutate of [
		(generation) => chmodSync(path.join(generation, "ceal-linux-arm64"), 0o644),
		(generation) => writeFileSync(path.join(generation, "unexpected"), "not signed\n"),
		(generation) => chmodSync(path.join(generation, "ceal-worker-release-manifest-linux-arm64.json"), 0o755),
	]) {
		withFixture(({ install, release, tools, log }) => {
			runSuccessfully({ install, release, tools, log, version: TAG });
			const current = realpathSync(path.join(install, ".ceal-cli", "worker", "current"));
			mutate(current);
			const repeated = run({ install, release, tools, log, version: TAG });
			assert.notEqual(repeated.status, 0);
			assert.match(repeated.stderr, /Existing worker release generation/u);
			assert.equal(realpathSync(path.join(install, ".ceal-cli", "worker", "current")), current);
		});
	}
});

test("worker installer rejects non-worker checksum inventory before changing ceal", () => {
	withFixture(({ install, release, tools, log }) => {
		mkdirSync(install, { recursive: true });
		writeFileSync(path.join(install, "ceal"), "keep\n");
		writeFileSync(path.join(release, "cealctl-linux-arm64"), "forbidden\n");
		appendChecksum(release, "cealctl-linux-arm64");
		const result = run({ install, release, tools, log, version: TAG });
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /malformed or unexpected worker entry/u);
		assert.equal(readFileSync(path.join(install, "ceal"), "utf8"), "keep\n");
		assert.equal(existsSync(log), true);
	});
});

test("worker installer rejects an incomplete platform pair before changing ceal", () => {
	withFixture(({ install, release, tools, log }) => {
		mkdirSync(install, { recursive: true });
		writeFileSync(path.join(install, "ceal"), "keep\n");
		writeWorkerBinary(path.join(release, "ceal-darwin-arm64"));
		appendChecksum(release, "ceal-darwin-arm64");
		const result = run({ install, release, tools, log, version: TAG });
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /incomplete worker platform pair for darwin-arm64/u);
		assert.equal(readFileSync(path.join(install, "ceal"), "utf8"), "keep\n");
	});
});

test("worker installer rejects a signed release that skips this platform", () => {
	withFixture(({ install, release, tools, log }) => {
		writeDarwinAssets(release);
		writeChecksums(release, ["darwin-arm64", "darwin-amd64"]);
		rewriteSidecars(release);
		const result = run({ install, release, tools, log, version: TAG });
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /does not include this platform: linux-arm64/u);
		assert.equal(existsSync(path.join(install, "ceal")), false);
	});
});

test("worker installer downloads explicit tags only from the static release origin", () => {
	withFixture(({ install, release, tools, log }) => {
		const urlLog = path.join(path.dirname(log), "curl-fetches.log");
		const result = run({ install, release, tools, log, version: TAG, token: "fake-token", urlLog });
		assert.equal(result.status, 0, result.stderr);
		assert.equal(readlinkSync(path.join(install, "ceal")), ".ceal-cli/worker/current/ceal-linux-arm64");
		const fetches = readFileSync(urlLog, "utf8");
		assert.match(fetches, /^https:\/\/release[.]example[.]test\/releases\/worker\/ceal-v0[.]65[.]0\/SHA256SUMS$/mu);
		assert.doesNotMatch(fetches, /github[.]com|Authorization/u);
	});
});

simulatedDarwinTest("worker installer installs on a darwin host through the portable tool lane", () => {
	withFixture(({ install, release, tools, log }) => {
		writeDarwinAssets(release);
		writeChecksums(release, ["linux-arm64", "linux-amd64", "darwin-arm64", "darwin-amd64"]);
		rewriteSidecars(release);
		writeTool(path.join(tools, "uname"), 'case "$1" in -s) echo Darwin ;; -m) echo arm64 ;; *) exit 2 ;; esac');
		const restricted = restrictedTools(tools);
		const result = run({ install, release, tools, log, version: TAG, restrictedPath: restricted });
		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, /Installed ceal ceal-v0[.]65[.]0 \(darwin-arm64\)/u);
		assert.equal(readlinkSync(path.join(install, "ceal")), ".ceal-cli/worker/current/ceal-darwin-arm64");
		assert.equal(existsSync(path.join(install, ".ceal-cli", "worker", "install.lock.d")), false);
		const cosign = readFileSync(log, "utf8");
		assert.match(cosign, /ceal-darwin-arm64/u);
		assert.match(cosign, /ceal-release[.]yml@refs\/tags\/ceal-v0[.]65[.]0/u);
	});
});

// The worker lane owns the real-binary install/update proof after version
// independence: the legacy dual installer can no longer represent current
// worker source, so this test installs a real packed native artifact through
// install-ceal.sh, smokes an installed post-allocation receipt, and performs
// a real option-free `ceal update` against the stable pointer.
platformProofTest(
	"the real-binary install and option-free stable update proof",
	"real native worker installs through the worker lane and performs an option-free stable update",
	async (context) => {
		const fixture = packedProtocolFixture(context);
		const native = path.join(fixture.root, "worker-native-install");
		const built = await buildWorkerNativeArtifactFromDevelopmentInputs({ outputDirectory: native, ...fixture });
		assert.equal(built.ok, true);
		assert.equal(built.platform, "linux-amd64");
		const realTag = `ceal-v${built.version}`;
		withFixture(({ install, release, tools, log }) => {
			copyFileSync(path.join(native, "ceal-linux-amd64"), path.join(release, "ceal-linux-amd64"));
			writeTool(path.join(tools, "uname"), 'case "$1" in -s) echo Linux ;; -m) echo x86_64 ;; *) exit 2 ;; esac');
			for (const platform of ["linux-arm64", "linux-amd64"]) writeManifest(release, platform, built.version);
			writeChecksums(release);
			writeStablePointer(release, { tag: realTag });
			rewriteSidecars(release);
			const result = run({ install, release, tools, log, version: realTag });
			assert.equal(result.status, 0, result.stderr);
			assert.equal(readlinkSync(path.join(install, "ceal")), ".ceal-cli/worker/current/ceal-linux-amd64");
			const installed = path.join(install, "ceal");
			const version = parse(runSyncReleaseProcess(installed, ["version"], { encoding: "utf8" }).stdout);
			assert.equal(version.version, built.version);
			assert.equal(version.protocol_version, "1.3.0");

			writeClientSessionStoreFixture(install, {
				gatewayEndpoint: "http://127.0.0.1:1/gateway/client",
				label: "installer-fixture",
			});
			const unavailable = runSyncReleaseProcess(installed, ["call", "message.search", "--target", "target:team-inbox", "query=launch"], {
				encoding: "utf8",
				env: { ...process.env, HOME: install },
			});
			assert.equal(unavailable.status, 3, `${unavailable.stderr}\n${unavailable.stdout}`);
			const unavailablePayload = parse(unavailable.stdout);
			assert.equal(unavailablePayload.schema_version, "ceal.result.v2");
			assert.equal(unavailablePayload.receipt.evidence, "outcome_unknown");
			assert.doesNotMatch(unavailable.stdout, /ceal_(?:personal|refresh)_/u);

			const updated = runSyncReleaseProcess(installed, ["update"], {
				encoding: "utf8",
				env: {
					...process.env,
					CEAL_RELEASE_ORIGIN: "https://release.example.test/releases",
					COSIGN_LOG: log,
					FAKE_RELEASE_DIR: release,
					PATH: `${tools}:${process.env.PATH}`,
				},
			});
			assert.equal(updated.status, 0, `${updated.stderr}\n${updated.stdout}`);
			const payload = parse(updated.stdout);
			assert.equal(payload.schema_version, "ceal.update.v1");
			assert.equal(payload.status, "unchanged");
			assert.equal(payload.stable_only, true);
			assert.equal(payload.previous_version, built.version);
			assert.equal(payload.installed_version, built.version);
			assert.equal(payload.platform, "linux-amd64");
			assert.equal(typeof payload.elapsed_ms, "number");
		});
	},
);

function withFixture(callback) {
	const root = mkdtempSync(path.join(tmpdir(), "ceal-worker-installer-"));
	try {
		const release = path.join(root, "release");
		const tools = path.join(root, "tools");
		const install = path.join(root, "install");
		const log = path.join(root, "cosign.log");
		mkdirSync(release);
		mkdirSync(tools);
		writeWorkerBinary(path.join(release, "ceal-linux-arm64"));
		writeWorkerBinary(path.join(release, "ceal-linux-amd64"));
		copyFileSync(path.join(ROOT, "scripts", "assets", "ceal-guide-compatibility-SKILL.md"), path.join(release, "ceal-guide-SKILL.md"));
		writeFileSync(path.join(release, "THIRD_PARTY_NOTICES.txt"), "notice\n");
		copyFileSync(INSTALLER, path.join(release, "install-ceal.sh"));
		for (const platform of ["linux-arm64", "linux-amd64"]) writeManifest(release, platform);
		const entries = writeChecksums(release);
		writeSignatureSidecars(release, [...entries, "SHA256SUMS"]);
		writeTool(path.join(tools, "uname"), 'case "$1" in -s) echo Linux ;; -m) echo aarch64 ;; *) exit 2 ;; esac');
		writeTool(path.join(tools, "cosign"), 'printf \'%s\\n\' "$*" >> "$COSIGN_LOG"\n[ -z "${COSIGN_FAIL:-}" ] || exit 1');
		writeTool(
			path.join(tools, "curl"),
			[
				"url=''",
				"out=''",
				'while [ $# -gt 0 ]; do case "$1" in -o) shift; out="$1" ;; http*) url="$1" ;; esac; shift; done',
				'printf \'%s\\n\' "$url" >> "${CURL_URL_LOG:-/dev/null}"',
				'case "$url" in *tooling/cosign/v2.6.4/cosign-linux-arm64) cp "$FAKE_RELEASE_DIR/cosign-linux-arm64" "$out"; exit 0 ;; *github.com*|*api.github.com*) exit 97 ;; esac',
				'[ -n "$out" ] || exit 2',
				'cp "$FAKE_RELEASE_DIR/${url##*/}" "$out"',
			].join("\n"),
		);
		return callback({ root, install, release, tools, log });
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

function run({
	install,
	release,
	tools,
	log,
	version,
	cosignFail = false,
	restrictedPath = null,
	token = "",
	minimumVersion = "",
	urlLog = "",
	installer = INSTALLER,
}) {
	return runSyncReleaseProcess("/bin/sh", [installer], {
		encoding: "utf8",
		env: {
			...process.env,
			CEAL_INSTALL_DIR: install,
			CEAL_VERSION: version,
			CEAL_GITHUB_TOKEN: token,
			CEAL_RELEASE_ORIGIN: "https://release.example.test/releases",
			CEAL_MINIMUM_VERSION: minimumVersion,
			COSIGN_LOG: log,
			COSIGN_FAIL: cosignFail ? "1" : "",
			CURL_URL_LOG: urlLog,
			FAKE_RELEASE_DIR: release,
			PATH: restrictedPath ?? `${tools}:${process.env.PATH}`,
		},
	});
}

function runSuccessfully(options) {
	const result = run(options);
	assert.equal(result.status, 0, result.stderr);
	return result;
}

function assertStablePointerRefused(prepare, message, why) {
	withFixture(({ install, release, tools, log }) => {
		prepare(release);
		const result = run({ install, release, tools, log, version: "stable" });
		assert.notEqual(result.status, 0, why);
		assert.match(result.stderr, message, why);
		assert.equal(existsSync(path.join(install, "ceal")), false, why);
	});
}

// A darwin host has shasum but neither sha256sum nor flock; the restricted
// PATH proves the portable lane end to end on this Linux host. The simulation
// is built by faking shasum on top of a real sha256sum, so it needs a host that
// has one — which a real darwin runner does not. Skipping there loses nothing:
// the host being simulated is the host running the test.
function restrictedTools(tools) {
	const resolve = (name) => runSyncReleaseProcess("/bin/sh", ["-c", `command -v ${name}`], { encoding: "utf8" }).stdout.trim();
	// Models a stock Mac: awk is present, python3 is deliberately absent, so an
	// installer that reaches for python3 again fails here instead of on a
	// colleague's machine.
	for (const name of [
		"sh",
		"mktemp",
		"grep",
		"sed",
		"sort",
		"uniq",
		"wc",
		"tr",
		"cut",
		"cmp",
		"find",
		"awk",
		"chmod",
		"mkdir",
		"rmdir",
		"rm",
		"ln",
		"mv",
		"cp",
		"readlink",
		"tar",
	]) {
		const found = resolve(name);
		assert.notEqual(found, "", `restricted tool ${name} must exist on the test host`);
		if (!existsSync(path.join(tools, name))) symlinkSync(found, path.join(tools, name));
	}
	const sha256sum = resolve("sha256sum");
	assert.notEqual(sha256sum, "");
	writeTool(path.join(tools, "shasum"), `[ "\${1:-}" = -a ] && [ "\${2:-}" = 256 ] || exit 2\nshift 2\nexec ${sha256sum} "$@"`);
	return tools;
}

function writeWorkerBinary(file, version = "0.65.0") {
	writeFileSync(
		file,
		`#!/usr/bin/env sh\nif [ "\${1:-}" = version ]; then printf 'schema_version: ceal.version.v1\\ncommand: ceal\\nversion: ${version}\\nprotocol_version: 1.3.0\\nsupported_gateway_protocol_range:\\n  minimum: 1.3.0\\n  maximum: 1.3.0\\ncredential_context: gateway_issued_client_session\\n'; exit 0; fi\nif [ "\${1:-}" = --help ]; then exit 0; fi\nexit 2\n`,
	);
	chmodSync(file, 0o755);
}

// The stable pointer is operator-published static-origin metadata, not a
// signed release asset; the installer re-checks its digest against the
// downloaded signed SHA256SUMS.
function writeStablePointer(release, overrides = {}) {
	const releaseSet = digest(readFileSync(path.join(release, "SHA256SUMS")));
	writeFileSync(
		path.join(release, "ceal-worker-stable-release.json"),
		`${JSON.stringify({ schema_version: "ceal.worker_stable_release.v1", tag: TAG, sha256sums_sha256: releaseSet, ...overrides })}\n`,
	);
}

// Mirrors the shape build-worker-release-assets.mjs actually emits. The nested
// blocks are the point: artifact and installer carry their own name/sha256, and
// protocol and native_smoke carry their own version/command, so a manifest
// reader that matches those keys at any depth binds the wrong value. A minimal
// fixture cannot catch that.
function writeManifest(release, platform, version = "0.65.0", overrides = {}) {
	const guide = readFileSync(path.join(release, "ceal-guide-SKILL.md"));
	const manifest = {
		schema_version: "ceal.worker_release_manifest.v1",
		artifact_state: "unsigned_build_candidate",
		version,
		platform,
		command: "ceal",
		artifact: { name: `ceal-${platform}`, bytes: 1024, sha256: digest("artifact") },
		guide: { name: "ceal-guide-SKILL.md", bytes: guide.length, sha256: digest(guide) },
		embedded_guide: { name: "ceal-guide.tar", format: "ustar", bytes: 1024, sha256: digest("embedded-guide") },
		installer: { name: "install-ceal.sh", bytes: 2048, sha256: digest("installer") },
		protocol: { package: "@corca-ai/ceal-protocol", version: "0.65.0", sha256: digest("protocol") },
		native_smoke: { command: "ceal", version, help: true, operator_surface_absent: true },
		...overrides,
	};
	writeFileSync(path.join(release, `ceal-worker-release-manifest-${platform}.json`), `${JSON.stringify(manifest, null, 2)}\n`);
}

function writeChecksums(release, platforms = ["linux-arm64", "linux-amd64"]) {
	const entries = [
		"THIRD_PARTY_NOTICES.txt",
		"ceal-guide-SKILL.md",
		"install-ceal.sh",
		...platforms.flatMap((platform) => [`ceal-${platform}`, `ceal-worker-release-manifest-${platform}.json`]),
	].sort();
	writeFileSync(
		path.join(release, "SHA256SUMS"),
		entries.map((name) => `${digest(readFileSync(path.join(release, name)))}  ${name}`).join("\n") + "\n",
	);
	return entries;
}

function writeDarwinAssets(release) {
	for (const platform of ["darwin-arm64", "darwin-amd64"]) {
		writeWorkerBinary(path.join(release, `ceal-${platform}`));
		writeManifest(release, platform);
	}
}

function appendChecksum(release, name) {
	writeFileSync(path.join(release, "SHA256SUMS"), `${digest(readFileSync(path.join(release, name)))}  ${name}\n`, { flag: "a" });
}

function rewriteSidecars(release) {
	writeSignatureSidecars(release, [
		...readFileSync(path.join(release, "SHA256SUMS"), "utf8")
			.trim()
			.split("\n")
			.map((line) => line.slice(66)),
		"SHA256SUMS",
	]);
}
function rewriteChecksumsAndSidecars(release) {
	writeSignatureSidecars(release, writeChecksums(release));
}
function writeSignatureSidecars(release, names) {
	for (const name of names) {
		writeFileSync(path.join(release, `${name}.sig`), "signature\n");
		writeFileSync(path.join(release, `${name}.pem`), "certificate\n");
	}
}
function writeTool(file, body) {
	writeFileSync(file, `#!/usr/bin/env sh\nset -eu\n${body}\n`);
	chmodSync(file, 0o755);
}
function digest(bytes) {
	return createHash("sha256").update(bytes).digest("hex");
}
