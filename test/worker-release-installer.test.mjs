import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { buildWorkerNativeArtifactFromDevelopmentInputs } from "../scripts/build-worker-native-artifact.mjs";
import { packedProtocolFixture } from "./worker-release-package-fixture.mjs";
import { requireHostTools } from "./host-tools.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INSTALLER = path.join(ROOT, "install-ceal.sh");
const TAG = "ceal-v0.65.0";
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
		assert.equal(readlinkSync(path.join(install, "ceal")), ".ceal-cli/worker/current/ceal-linux-arm64");
		assert.equal(readlinkSync(path.join(install, "cealctl")), ".ceal-cli/current/cealctl-linux-arm64");
		assert.equal(existsSync(path.join(install, ".ceal-cli", "operator")), false);
		assert.equal(readFileSync(path.join(install, ".ceal-cli", "worker", "current", "install-ceal.sh"), "utf8"), readFileSync(INSTALLER, "utf8"));
		assert.equal(lstatSync(path.join(install, ".ceal-cli", "worker", "current")).isSymbolicLink(), true);
		const cosign = readFileSync(log, "utf8");
		assert.equal(cosign.match(/verify-blob/gu)?.length, 6);
		assert.match(cosign, /ceal-release[.]yml@refs\/tags\/ceal-v0[.]65[.]0/u);
	});
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
	withFixture(({ install, release, tools, log }) => {
		writeStablePointer(release, { tag: "v9.9.9" });
		const result = run({ install, release, tools, log, version: "stable" });
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /stable release pointer is not a valid/u);
		assert.equal(existsSync(path.join(install, "ceal")), false);
	});
	withFixture(({ install, release, tools, log }) => {
		writeStablePointer(release, { sha256sums_sha256: "not-a-release-set-digest" });
		const result = run({ install, release, tools, log, version: "stable" });
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /stable release pointer is not a valid/u);
		assert.equal(existsSync(path.join(install, "ceal")), false);
	});
	withFixture(({ install, release, tools, log }) => {
		writeFileSync(path.join(release, "ceal-worker-stable-release.json"), "");
		const result = run({ install, release, tools, log, version: "stable" });
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /stable release pointer is not a valid/u);
		assert.equal(existsSync(path.join(install, "ceal")), false);
	});
	withFixture(({ install, release, tools, log }) => {
		writeStablePointer(release, { sha256sums_sha256: digest("tampered release set") });
		const result = run({ install, release, tools, log, version: "stable" });
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /does not match the downloaded signed SHA256SUMS/u);
		assert.equal(existsSync(path.join(install, "ceal")), false);
	});
});

test("worker installer rejects a syntactically valid decoy manifest and a rejected signer", () => {
	withFixture(({ install, release, tools, log }) => {
		const manifest = path.join(release, "ceal-worker-release-manifest-linux-arm64.json");
		writeFileSync(manifest, JSON.stringify({ note: "ceal.worker_release_manifest.v1 0.65.0 linux-arm64 ceal ceal-guide-SKILL.md" }) + "\n");
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
		writeTool(path.join(tools, "uname"), "case \"$1\" in -s) echo Darwin ;; -m) echo arm64 ;; *) exit 2 ;; esac");
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
test("real native worker installs through the worker lane and performs an option-free stable update", { skip: process.platform !== "linux" || process.arch !== "x64" }, async (context) => {
	const fixture = packedProtocolFixture(context);
	const native = path.join(fixture.root, "worker-native-install");
	const built = await buildWorkerNativeArtifactFromDevelopmentInputs({ outputDirectory: native, ...fixture });
	assert.equal(built.ok, true);
	assert.equal(built.platform, "linux-amd64");
	const realTag = `ceal-v${built.version}`;
	withFixture(({ install, release, tools, log }) => {
		copyFileSync(path.join(native, "ceal-linux-amd64"), path.join(release, "ceal-linux-amd64"));
		writeTool(path.join(tools, "uname"), "case \"$1\" in -s) echo Linux ;; -m) echo x86_64 ;; *) exit 2 ;; esac");
		for (const platform of ["linux-arm64", "linux-amd64"]) writeManifest(release, platform, built.version);
		writeChecksums(release);
		writeStablePointer(release, { tag: realTag });
		rewriteSidecars(release);
		const result = run({ install, release, tools, log, version: realTag });
		assert.equal(result.status, 0, result.stderr);
		assert.equal(readlinkSync(path.join(install, "ceal")), ".ceal-cli/worker/current/ceal-linux-amd64");
		const installed = path.join(install, "ceal");
		const version = parse(spawnSync(installed, ["version"], { encoding: "utf8" }).stdout);
		assert.equal(version.version, built.version);
		assert.equal(version.protocol_version, "1.3.0");

		writeWorkerSession(install);
		const unavailable = spawnSync(installed, ["call", "message.search", "--target", "target:team-inbox", "query=launch"], {
			encoding: "utf8",
			env: { ...process.env, HOME: install },
		});
		assert.equal(unavailable.status, 3, `${unavailable.stderr}\n${unavailable.stdout}`);
		const unavailablePayload = parse(unavailable.stdout);
		assert.equal(unavailablePayload.schema_version, "ceal.result.v2");
		assert.equal(unavailablePayload.receipt.evidence, "outcome_unknown");
		assert.doesNotMatch(unavailable.stdout, /ceal_(?:personal|refresh)_/u);

		const updated = spawnSync(installed, ["update"], {
			encoding: "utf8",
			env: { ...process.env, CEAL_RELEASE_ORIGIN: "https://release.example.test/releases", COSIGN_LOG: log, FAKE_RELEASE_DIR: release, PATH: `${tools}:${process.env.PATH}` },
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
});

function writeWorkerSession(home) {
	const directory = path.join(home, ".ceal");
	mkdirSync(directory, { recursive: true, mode: 0o700 });
	writeFileSync(path.join(directory, "client-session.json"), `${JSON.stringify({
		schema_version: "ceal.client_session_store.v1",
		gateway_endpoint: "http://127.0.0.1:1/gateway/client",
		profile_ref: "profile:installer-fixture",
		membership_ref: "membership:installer-fixture",
		registration_ref: "registration:installer-fixture",
		client_ref: "client:installer-fixture",
		subject_ref: "subject:installer-fixture",
		instance_ref: "instance:installer-fixture",
		access_token: `ceal_personal_${"P".repeat(43)}`,
		expires_at: "2099-07-14T00:00:00.000Z",
		refresh_token: `ceal_refresh_${"R".repeat(43)}`,
		refresh_token_idle_expires_at: "2099-08-14T00:00:00.000Z",
		refresh_token_absolute_expires_at: "2099-10-14T00:00:00.000Z",
	}, null, 2)}\n`, { mode: 0o600 });
}

function withFixture(callback) {
	const root = mkdtempSync(path.join(tmpdir(), "ceal-worker-installer-"));
	try {
		const release = path.join(root, "release"); const tools = path.join(root, "tools"); const install = path.join(root, "install"); const log = path.join(root, "cosign.log");
		mkdirSync(release); mkdirSync(tools);
		writeWorkerBinary(path.join(release, "ceal-linux-arm64"));
		writeWorkerBinary(path.join(release, "ceal-linux-amd64"));
		writeFileSync(path.join(release, "ceal-guide-SKILL.md"), "---\nname: ceal-guide\n");
		writeFileSync(path.join(release, "THIRD_PARTY_NOTICES.txt"), "notice\n");
		copyFileSync(INSTALLER, path.join(release, "install-ceal.sh"));
		for (const platform of ["linux-arm64", "linux-amd64"]) writeManifest(release, platform);
		const entries = writeChecksums(release);
		for (const name of [...entries, "SHA256SUMS"]) { writeFileSync(path.join(release, `${name}.sig`), "signature\n"); writeFileSync(path.join(release, `${name}.pem`), "certificate\n"); }
		writeTool(path.join(tools, "uname"), "case \"$1\" in -s) echo Linux ;; -m) echo aarch64 ;; *) exit 2 ;; esac");
		writeTool(path.join(tools, "cosign"), "printf '%s\\n' \"$*\" >> \"$COSIGN_LOG\"\n[ -z \"${COSIGN_FAIL:-}\" ] || exit 1");
		writeTool(path.join(tools, "curl"), [
			"url=''", "out=''",
			"while [ $# -gt 0 ]; do case \"$1\" in -o) shift; out=\"$1\" ;; http*) url=\"$1\" ;; esac; shift; done",
			"printf '%s\\n' \"$url\" >> \"${CURL_URL_LOG:-/dev/null}\"",
			"case \"$url\" in *tooling/cosign/v2.6.4/cosign-linux-arm64) cp \"$FAKE_RELEASE_DIR/cosign-linux-arm64\" \"$out\"; exit 0 ;; *github.com*|*api.github.com*) exit 97 ;; esac",
			"[ -n \"$out\" ] || exit 2", "cp \"$FAKE_RELEASE_DIR/${url##*/}\" \"$out\"",
		].join("\n"));
		return callback({ install, release, tools, log });
	} finally { rmSync(root, { recursive: true, force: true }); }
}

function run({ install, release, tools, log, version, cosignFail = false, restrictedPath = null, token = "", minimumVersion = "", urlLog = "" }) {
	return spawnSync("/bin/sh", [INSTALLER], { encoding: "utf8", env: { ...process.env, CEAL_INSTALL_DIR: install, CEAL_VERSION: version, CEAL_GITHUB_TOKEN: token, CEAL_RELEASE_ORIGIN: "https://release.example.test/releases", CEAL_MINIMUM_VERSION: minimumVersion, COSIGN_LOG: log, COSIGN_FAIL: cosignFail ? "1" : "", CURL_URL_LOG: urlLog, FAKE_RELEASE_DIR: release, PATH: restrictedPath ?? `${tools}:${process.env.PATH}` } });
}

// A darwin host has shasum but neither sha256sum nor flock; the restricted
// PATH proves the portable lane end to end on this Linux host. The simulation
// is built by faking shasum on top of a real sha256sum, so it needs a host that
// has one — which a real darwin runner does not. Skipping there loses nothing:
// the host being simulated is the host running the test.
function restrictedTools(tools) {
	const resolve = (name) => spawnSync("/bin/sh", ["-c", `command -v ${name}`], { encoding: "utf8" }).stdout.trim();
	// Models a stock Mac: awk is present, python3 is deliberately absent, so an
	// installer that reaches for python3 again fails here instead of on a
	// colleague's machine.
	for (const name of ["sh", "mktemp", "grep", "sed", "sort", "uniq", "wc", "tr", "cut", "cmp", "awk", "chmod", "mkdir", "rmdir", "rm", "ln", "mv", "cp", "readlink"]) {
		const found = resolve(name);
		assert.notEqual(found, "", `restricted tool ${name} must exist on the test host`);
		if (!existsSync(path.join(tools, name))) symlinkSync(found, path.join(tools, name));
	}
	const sha256sum = resolve("sha256sum");
	assert.notEqual(sha256sum, "");
	writeTool(path.join(tools, "shasum"), `[ "\${1:-}" = -a ] && [ "\${2:-}" = 256 ] || exit 2\nshift 2\nexec ${sha256sum} "$@"`);
	return tools;
}

function writeWorkerBinary(file) {
	writeFileSync(file, "#!/usr/bin/env sh\nif [ \"${1:-}\" = version ]; then printf 'schema_version: ceal.version.v1\\ncommand: ceal\\nversion: 0.65.0\\nprotocol_version: 1.3.0\\nsupported_gateway_protocol_range:\\n  minimum: 1.3.0\\n  maximum: 1.3.0\\ncredential_context: gateway_issued_client_session\\n'; exit 0; fi\nif [ \"${1:-}\" = --help ]; then exit 0; fi\nexit 2\n");
	chmodSync(file, 0o755);
}

// The stable pointer is operator-published static-origin metadata, not a
// signed release asset; the installer re-checks its digest against the
// downloaded signed SHA256SUMS.
function writeStablePointer(release, overrides = {}) {
	const releaseSet = digest(readFileSync(path.join(release, "SHA256SUMS")));
	writeFileSync(path.join(release, "ceal-worker-stable-release.json"), `${JSON.stringify({ schema_version: "ceal.worker_stable_release.v1", tag: TAG, sha256sums_sha256: releaseSet, ...overrides })}\n`);
}

function writeManifest(release, platform, version = "0.65.0") {
	const guide = readFileSync(path.join(release, "ceal-guide-SKILL.md"));
	writeFileSync(path.join(release, `ceal-worker-release-manifest-${platform}.json`), `${JSON.stringify({ schema_version: "ceal.worker_release_manifest.v1", version, platform, command: "ceal", guide: { name: "ceal-guide-SKILL.md", sha256: digest(guide) } }, null, 2)}\n`);
}

function writeChecksums(release, platforms = ["linux-arm64", "linux-amd64"]) {
	const entries = ["THIRD_PARTY_NOTICES.txt", "ceal-guide-SKILL.md", "install-ceal.sh", ...platforms.flatMap((platform) => [`ceal-${platform}`, `ceal-worker-release-manifest-${platform}.json`])].sort();
	writeFileSync(path.join(release, "SHA256SUMS"), entries.map((name) => `${digest(readFileSync(path.join(release, name)))}  ${name}`).join("\n") + "\n");
	return entries;
}

function writeDarwinAssets(release) {
	for (const platform of ["darwin-arm64", "darwin-amd64"]) {
		writeWorkerBinary(path.join(release, `ceal-${platform}`));
		writeManifest(release, platform);
	}
}

function appendChecksum(release, name) { writeFileSync(path.join(release, "SHA256SUMS"), `${digest(readFileSync(path.join(release, name)))}  ${name}\n`, { flag: "a" }); }
function rewriteSidecars(release) { for (const name of [...readFileSync(path.join(release, "SHA256SUMS"), "utf8").trim().split("\n").map((line) => line.slice(66)), "SHA256SUMS"]) { writeFileSync(path.join(release, `${name}.sig`), "signature\n"); writeFileSync(path.join(release, `${name}.pem`), "certificate\n"); } }
function rewriteChecksumsAndSidecars(release) { for (const name of writeChecksums(release)) { writeFileSync(path.join(release, `${name}.sig`), "signature\n"); writeFileSync(path.join(release, `${name}.pem`), "certificate\n"); } }
function writeTool(file, body) { writeFileSync(file, `#!/usr/bin/env sh\nset -eu\n${body}\n`); chmodSync(file, 0o755); }
function digest(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
