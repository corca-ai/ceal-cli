import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INSTALLER = path.join(ROOT, "install.sh");

test("installer requires an explicit signed tag before creating either role", () => {
	withFixture(({ root, release, tools, install, cosignLog }) => {
		const result = runInstaller({ root, release, tools, install, cosignLog, version: "" });
		assert.equal(result.status, 1);
		assert.match(result.stderr, /CEAL_VERSION is required until a compatible signed release is approved/u);
		assert.equal(existsSync(cosignLog), false);
		assert.equal(existsSync(install), false);
	});
});

test("default worker installation creates only ceal and worker-owned state", () => {
	withFixture(({ root, release, tools, install, cosignLog }) => {
		const result = runInstaller({ root, release, tools, install, cosignLog });
		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, /Installed ceal v0[.]64[.]0 .* as worker/u);
		assert.match(readFileSync(path.join(install, "ceal"), "utf8"), /command=ceal/u);
		assert.equal(existsSync(path.join(install, "cealctl")), false);
		assert.equal(readlinkSync(path.join(install, "ceal")), ".ceal-cli/worker/current/ceal-linux-arm64");
		assert.equal(lstatSync(path.join(install, ".ceal-cli", "worker", "current")).isSymbolicLink(), true);
		assert.equal(existsSync(path.join(install, ".ceal-cli", "operator")), false);
		assert.match(readFileSync(path.join(install, ".ceal-cli", "worker", "current", "THIRD_PARTY_NOTICES.txt"), "utf8"), /yaml 2[.]9[.]0 \(ISC\)/u);
		assert.equal(readdirSync(path.join(install, ".ceal-cli", "worker", "releases")).length, 1);
		assert.equal(lstatSync(path.join(install, ".ceal-cli", "worker", "install.lock")).isFile(), true);
		const log = readFileSync(cosignLog, "utf8");
		assert.equal(log.match(/verify-blob/gu)?.length, 4);
		assert.match(log, /corca-ai\/ceal-cli/u);
		assert.match(log, /refs\/tags\/v0[.]64[.]0/u);
		assert.match(log, /--certificate-identity\s+https:\/\/github[.]com\/corca-ai\/ceal-cli\/[.]github\/workflows\/cealctl-release[.]yml@refs\/tags\/v0[.]64[.]0/u);
	});
});

test("explicit operator installation creates only cealctl and operator-owned state", () => {
	withFixture(({ root, release, tools, install, cosignLog }) => {
		const result = runInstaller({ root, release, tools, install, cosignLog, role: "operator" });
		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, /Installed cealctl v0[.]64[.]0 .* as operator/u);
		assert.equal(existsSync(path.join(install, "ceal")), false);
		assert.match(readFileSync(path.join(install, "cealctl"), "utf8"), /command=cealctl/u);
		assert.equal(readlinkSync(path.join(install, "cealctl")), ".ceal-cli/operator/current/cealctl-linux-arm64");
		assert.equal(lstatSync(path.join(install, ".ceal-cli", "operator", "current")).isSymbolicLink(), true);
		assert.equal(existsSync(path.join(install, ".ceal-cli", "worker")), false);
	});
});

test("worker installation safely migrates only its legacy dual-installer command link", () => {
	withFixture(({ root, release, tools, install, cosignLog }) => {
		mkdirSync(path.join(install, ".ceal-cli", "releases", "legacy"), { recursive: true });
		symlinkSync("releases/legacy", path.join(install, ".ceal-cli", "current"));
		symlinkSync(".ceal-cli/current/ceal-linux-arm64", path.join(install, "ceal"));
		symlinkSync(".ceal-cli/current/cealctl-linux-arm64", path.join(install, "cealctl"));
		const result = runInstaller({ root, release, tools, install, cosignLog });
		assert.equal(result.status, 0, result.stderr);
		assert.equal(readlinkSync(path.join(install, "ceal")), ".ceal-cli/worker/current/ceal-linux-arm64");
		assert.equal(readlinkSync(path.join(install, "cealctl")), ".ceal-cli/current/cealctl-linux-arm64");
		assert.equal(existsSync(path.join(install, ".ceal-cli", "operator")), false);
	});
});

test("installer rejects an unrecognized role without downloading or modifying commands", () => {
	withFixture(({ root, release, tools, install, cosignLog }) => {
		mkdirSync(install, { recursive: true });
		writeFileSync(path.join(install, "ceal"), "existing-worker\n");
		writeFileSync(path.join(install, "cealctl"), "existing-operator\n");
		const result = runInstaller({ root, release, tools, install, cosignLog, role: "both" });
		assert.equal(result.status, 1);
		assert.match(result.stderr, /CEAL_INSTALL_ROLE must be worker \(default\) or operator/u);
		assert.equal(readFileSync(path.join(install, "ceal"), "utf8"), "existing-worker\n");
		assert.equal(readFileSync(path.join(install, "cealctl"), "utf8"), "existing-operator\n");
		assert.equal(existsSync(cosignLog), false);
	});
});

test("installer selects the signed amd64 worker artifact on x86_64", () => {
	withFixture(({ root, release, tools, install, cosignLog }) => {
		writeTool(path.join(tools, "uname"), "case \"$1\" in -s) echo Linux ;; -m) echo x86_64 ;; *) exit 2 ;; esac");
		const result = runInstaller({ root, release, tools, install, cosignLog });
		assert.equal(result.status, 0, result.stderr);
		assert.equal(readlinkSync(path.join(install, "ceal")), ".ceal-cli/worker/current/ceal-linux-amd64");
		assert.match(readFileSync(path.join(install, "ceal"), "utf8"), /architecture-amd64/u);
		assert.equal(existsSync(path.join(install, "cealctl")), false);
	});
});

test("installer rejects malformed or misidentified selected-command version YAML", () => {
	for (const [role, asset, command] of [["worker", "ceal-linux-arm64", "cealctl"], ["operator", "cealctl-linux-arm64", "ceal"]]) {
		withFixture(({ root, release, tools, install, cosignLog }) => {
			writeBinary(path.join(release, asset), command, "generation-1");
			writeChecksums(release);
			const result = runInstaller({ root, release, tools, install, cosignLog, role });
			assert.equal(result.status, 1);
			assert.match(result.stderr, /reported an invalid version YAML document/u);
			assert.equal(existsSync(path.join(install, "ceal")), false);
			assert.equal(existsSync(path.join(install, "cealctl")), false);
		});
	}
});

test("installer preserves an existing directory mode and unrelated files", () => {
	withFixture(({ root, release, tools, install, cosignLog }) => {
		mkdirSync(install, { mode: 0o755 });
		writeFileSync(path.join(install, "unrelated"), "keep\n");
		const beforeMode = statSync(install).mode & 0o777;
		const result = runInstaller({ root, release, tools, install, cosignLog });
		assert.equal(result.status, 0, result.stderr);
		assert.equal(statSync(install).mode & 0o777, beforeMode);
		assert.equal(readFileSync(path.join(install, "unrelated"), "utf8"), "keep\n");
	});
});

test("installer refuses a concurrent worker install without changing either command", () => {
	withFixture(({ root, release, tools, install, cosignLog }) => {
		mkdirSync(path.join(install, ".ceal-cli", "worker", "releases"), { recursive: true });
		const lockPath = path.join(install, ".ceal-cli", "worker", "install.lock");
		writeFileSync(lockPath, "");
		const holder = spawn("flock", ["-F", "-x", lockPath, "sleep", "30"], { stdio: "ignore" });
		waitForLock(holder, lockPath);
		writeFileSync(path.join(install, "ceal"), "old-ceal\n");
		writeFileSync(path.join(install, "cealctl"), "operator-untouched\n");
		try {
			const result = runInstaller({ root, release, tools, install, cosignLog });
			assert.notEqual(result.status, 0);
			assert.match(result.stderr, /Another Ceal CLI installation is active/u);
			assert.equal(readFileSync(path.join(install, "ceal"), "utf8"), "old-ceal\n");
			assert.equal(readFileSync(path.join(install, "cealctl"), "utf8"), "operator-untouched\n");
			assert.equal(existsSync(cosignLog), false);
		} finally {
			holder.kill("SIGKILL");
		}
	});
});

test("installer reuses an unlocked persistent role lock and rejects unsafe locks", () => {
	withFixture(({ root, release, tools, install, cosignLog }) => {
		mkdirSync(path.join(install, ".ceal-cli", "worker", "releases"), { recursive: true });
		writeFileSync(path.join(install, ".ceal-cli", "worker", "install.lock"), "");
		const result = runInstaller({ root, release, tools, install, cosignLog });
		assert.equal(result.status, 0, result.stderr);
		assert.equal(lstatSync(path.join(install, ".ceal-cli", "worker", "install.lock")).isFile(), true);
		assert.match(readFileSync(path.join(install, "ceal"), "utf8"), /command=ceal/u);
	});
	withFixture(({ root, release, tools, install, cosignLog }) => {
		mkdirSync(path.join(install, ".ceal-cli", "worker", "install.lock"), { recursive: true });
		const result = runInstaller({ root, release, tools, install, cosignLog });
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /install lock is unsafe/u);
		assert.equal(existsSync(cosignLog), false);
	});
});

test("worker and operator updates use independent state and do not modify the other command", () => {
	withFixture(({ root, release, tools, install, cosignLog }) => {
		const workerFirst = runInstaller({ root, release, tools, install, cosignLog });
		assert.equal(workerFirst.status, 0, workerFirst.stderr);
		const operatorFirst = runInstaller({ root, release, tools, install, cosignLog, role: "operator" });
		assert.equal(operatorFirst.status, 0, operatorFirst.stderr);
		const workerCurrent = path.join(install, ".ceal-cli", "worker", "current");
		const operatorCurrent = path.join(install, ".ceal-cli", "operator", "current");
		const operatorLinkInode = lstatSync(path.join(install, "cealctl")).ino;
		const operatorBytes = readFileSync(path.join(install, "cealctl"));
		const initialOperatorCurrent = readlinkSync(operatorCurrent);
		writeBinary(path.join(release, "ceal-linux-arm64"), "ceal", "worker-generation-2");
		writeChecksums(release);
		const workerSecond = runInstaller({ root, release, tools, install, cosignLog });
		assert.equal(workerSecond.status, 0, workerSecond.stderr);
		assert.notEqual(readlinkSync(workerCurrent), "");
		assert.equal(readlinkSync(operatorCurrent), initialOperatorCurrent);
		assert.equal(lstatSync(path.join(install, "cealctl")).ino, operatorLinkInode);
		assert.deepEqual(readFileSync(path.join(install, "cealctl")), operatorBytes);
		assert.match(readFileSync(path.join(install, "ceal"), "utf8"), /worker-generation-2/u);
		const workerLinkInode = lstatSync(path.join(install, "ceal")).ino;
		const workerBytes = readFileSync(path.join(install, "ceal"));
		const initialWorkerCurrent = readlinkSync(workerCurrent);
		writeBinary(path.join(release, "cealctl-linux-arm64"), "cealctl", "operator-generation-2");
		writeChecksums(release);
		const operatorSecond = runInstaller({ root, release, tools, install, cosignLog, role: "operator" });
		assert.equal(operatorSecond.status, 0, operatorSecond.stderr);
		assert.notEqual(readlinkSync(operatorCurrent), initialOperatorCurrent);
		assert.equal(readlinkSync(workerCurrent), initialWorkerCurrent);
		assert.equal(lstatSync(path.join(install, "ceal")).ino, workerLinkInode);
		assert.deepEqual(readFileSync(path.join(install, "ceal")), workerBytes);
		assert.match(readFileSync(path.join(install, "cealctl"), "utf8"), /operator-generation-2/u);
	});
});

test("checksum failure preserves the selected command and leaves the other role untouched", () => {
	withFixture(({ root, release, tools, install, cosignLog }) => {
		mkdirSync(install, { recursive: true });
		writeFileSync(path.join(install, "ceal"), "old-ceal\n");
		writeFileSync(path.join(install, "cealctl"), "operator-untouched\n");
		const sums = readFileSync(path.join(release, "SHA256SUMS"), "utf8");
		writeFileSync(path.join(release, "SHA256SUMS"), sums.replace(/^[a-f0-9]{64}( {2}ceal-linux-arm64)$/mu, `${"0".repeat(64)}$1`));
		const result = runInstaller({ root, release, tools, install, cosignLog });
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /Checksum mismatch for ceal-linux-arm64/u);
		assert.equal(readFileSync(path.join(install, "ceal"), "utf8"), "old-ceal\n");
		assert.equal(readFileSync(path.join(install, "cealctl"), "utf8"), "operator-untouched\n");
	});
});

test("installer rejects signed checksum files with malformed extra lines", () => {
	withFixture(({ root, release, tools, install, cosignLog }) => {
		const sums = readFileSync(path.join(release, "SHA256SUMS"), "utf8");
		writeFileSync(path.join(release, "SHA256SUMS"), `${sums}not-a-checksum-line\n`);
		const result = runInstaller({ root, release, tools, install, cosignLog });
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /exactly eight physical lines|malformed or unexpected entry/u);
		assert.equal(existsSync(path.join(install, "ceal")), false);
		assert.equal(existsSync(path.join(install, "cealctl")), false);
	});
});

test("workflow builds from public source and never downloads injected draft binaries", () => {
	const workflow = readFileSync(path.join(ROOT, ".github/workflows/cealctl-release.yml"), "utf8");
	const parsed = parse(workflow);
	assert.equal(parsed.jobs.assemble.needs, "build");
	assert.equal(parsed.jobs.assemble.environment, undefined);
	assert.equal(parsed.jobs["sign-and-draft"].needs, "assemble");
	assert.equal(parsed.jobs["sign-and-draft"].environment, "ceal-cli-release");
	assert.match(workflow, /npm ci --ignore-scripts/u);
	assert.match(workflow, /npm run check/u);
	assert.match(workflow, /scripts\/build-platform-binaries[.]mjs/u);
	assert.match(workflow, /ceal-linux-arm64/u);
	assert.match(workflow, /cealctl-linux-arm64/u);
	assert.match(workflow, /ceal-linux-amd64/u);
	assert.match(workflow, /cealctl-linux-amd64/u);
	assert.match(workflow, /ubuntu-24[.]04-arm/u);
	assert.match(workflow, /runner: ubuntu-24[.]04/u);
	assert.match(workflow, /dist-a[\s\S]+dist-b/u);
	assert.match(workflow, /CEAL_CLI_APPROVED_COMMIT/u);
	assert.match(workflow, /CEAL_CLI_APPROVED_SHA256SUMS_SHA256/u);
	assert.match(workflow, /Unprivileged dual-platform release handoff/u);
	assert.match(workflow, /THIRD_PARTY_NOTICES[.]txt SHA256SUMS install[.]sh/u);
	assert.match(workflow, /permissions:\n\s+contents: read/u);
	assert.match(workflow, /environment: ceal-cli-release[\s\S]+contents: write[\s\S]+id-token: write/u);
	assert.match(workflow, /gh release download/u);
	assert.match(workflow, /gh release view[^\n]+> "\$existing_inventory"/u);
	assert.doesNotMatch(workflow, /ceal-runtime|corca-ai\/ceal(?:\s|['"])/u);
	assert.equal((workflow.match(/cosign sign-blob/gu) ?? []).length, 1);
	for (const action of workflow.matchAll(/uses:\s+([^\s]+)/gu)) assert.match(action[1], /@[a-f0-9]{40}$/u);
});

function runInstaller({ root, release, tools, install, cosignLog, version = "v0.64.0", role = "worker" }) {
	return spawnSync(INSTALLER, [], {
		cwd: root,
		encoding: "utf8",
		env: {
			...process.env,
			CEAL_VERSION: version,
			CEAL_INSTALL_ROLE: role,
			CEAL_INSTALL_DIR: install,
			COSIGN_LOG: cosignLog,
			FAKE_RELEASE_DIR: release,
			PATH: `${tools}:${process.env.PATH}`,
		},
	});
}

function waitForLock(holder, lockPath) {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		if (holder.exitCode !== null) throw new Error(`lock holder exited early with ${holder.exitCode}`);
		const probe = spawnSync("flock", ["-n", lockPath, "true"], { stdio: "ignore" });
		if (probe.status !== 0) return;
		Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
	}
	throw new Error("timed out waiting for the fixture install lock");
}

function withFixture(callback) {
	const root = mkdtempSync(path.join(tmpdir(), "ceal-cli-install-test-"));
	try {
		const release = path.join(root, "release");
		const tools = path.join(root, "tools");
		const install = path.join(root, "install");
		const cosignLog = path.join(root, "cosign.log");
		mkdirSync(release);
		mkdirSync(tools);
		writeBinary(path.join(release, "ceal-linux-arm64"), "ceal");
		writeBinary(path.join(release, "cealctl-linux-arm64"), "cealctl");
		writeBinary(path.join(release, "ceal-linux-amd64"), "ceal", "architecture-amd64");
		writeBinary(path.join(release, "cealctl-linux-amd64"), "cealctl", "architecture-amd64");
		writeFileSync(path.join(release, "ceal-cli-platform-release-manifest-linux-arm64.json"), "{\"release_version\":\"0.64.0\",\"platform\":\"linux-arm64\"}\n");
		writeFileSync(path.join(release, "ceal-cli-platform-release-manifest-linux-amd64.json"), "{\"release_version\":\"0.64.0\",\"platform\":\"linux-amd64\"}\n");
		writeFileSync(path.join(release, "THIRD_PARTY_NOTICES.txt"), "yaml 2.9.0 (ISC)\n");
		writeFileSync(path.join(release, "install.sh"), "signed installer asset\n");
		const checksummed = writeChecksums(release);
		for (const name of [...checksummed, "SHA256SUMS"]) {
			writeFileSync(path.join(release, `${name}.sig`), "signature\n");
			writeFileSync(path.join(release, `${name}.pem`), "certificate\n");
		}
		writeTool(path.join(tools, "uname"), "case \"$1\" in -s) echo Linux ;; -m) echo aarch64 ;; *) exit 2 ;; esac");
		writeTool(path.join(tools, "cosign"), "printf '%s\\n' \"$*\" >> \"$COSIGN_LOG\"");
		writeTool(path.join(tools, "curl"), [
			"url=''",
			"out=''",
			"while [ $# -gt 0 ]; do",
			"  case \"$1\" in -o) shift; out=\"$1\" ;; http*) url=\"$1\" ;; esac",
			"  shift",
			"done",
			"[ -n \"$out\" ] || exit 2",
			"cp \"$FAKE_RELEASE_DIR/${url##*/}\" \"$out\"",
		].join("\n"));
		callback({ root, release, tools, install, cosignLog });
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

function writeChecksums(release) {
	const checksummed = [
		"THIRD_PARTY_NOTICES.txt",
		"ceal-cli-platform-release-manifest-linux-amd64.json",
		"ceal-cli-platform-release-manifest-linux-arm64.json",
		"ceal-linux-amd64",
		"ceal-linux-arm64",
		"cealctl-linux-amd64",
		"cealctl-linux-arm64",
		"install.sh",
	];
	writeFileSync(path.join(release, "SHA256SUMS"), checksummed.map((name) => `${digest(readFileSync(path.join(release, name)))}  ${name}`).join("\n") + "\n");
	return checksummed;
}

function writeBinary(file, command, marker = "generation-1", versionSuffix = "") {
	const schema = command === "ceal" ? "ceal.version.v1" : "cealctl.version.v1";
	const credentialContext = command === "ceal" ? "gateway_issued_client_session" : "cealctl_operator_admin_session";
	writeFileSync(file, `#!/usr/bin/env sh\n# ${marker}\ncommand=${command}\nif [ "\${1:-}" = version ]; then printf 'schema_version: ${schema}\\ncommand: %s\\nversion: 0.64.0\\nprotocol_version: 1.2.0\\nsupported_gateway_protocol_range:\\n  minimum: 1.2.0\\n  maximum: 1.2.0\\ncredential_context: ${credentialContext}\\n${versionSuffix}' "$command"; exit 0; fi\nif [ "\${1:-}" = --help ]; then echo help; exit 0; fi\nexit 2\n`);
	chmodSync(file, 0o755);
}

function writeTool(file, body) {
	writeFileSync(file, `#!/usr/bin/env sh\nset -eu\n${body}\n`);
	chmodSync(file, 0o755);
}

function digest(bytes) {
	return createHash("sha256").update(bytes).digest("hex");
}
