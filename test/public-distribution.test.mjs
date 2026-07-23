import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
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
		assert.match(result.stderr, /CEAL_VERSION is required; set stable for the latest signed release/u);
		assert.equal(existsSync(cosignLog), false);
		assert.equal(existsSync(install), false);
	});
});

test("default worker installation creates only ceal and worker-owned state", () => {
	withFixture(({ root, release, tools, install, cosignLog }) => {
		const result = runInstaller({ root, release, tools, install, cosignLog });
		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, /Installed ceal v0[.]65[.]0 .* as worker/u);
		assert.match(result.stdout, /Signed guide staged at .*[/]guide[/]SKILL[.]md; register it through the selected agent runtime/u);
		assert.match(readFileSync(path.join(install, "ceal"), "utf8"), /command=ceal/u);
		assert.equal(existsSync(path.join(install, "cealctl")), false);
		assert.equal(readlinkSync(path.join(install, "ceal")), ".ceal-cli/worker/current/ceal-linux-arm64");
		assert.equal(lstatSync(path.join(install, ".ceal-cli", "worker", "current")).isSymbolicLink(), true);
		assert.equal(existsSync(path.join(install, ".ceal-cli", "operator")), false);
		assert.match(readFileSync(path.join(install, ".ceal-cli", "worker", "current", "THIRD_PARTY_NOTICES.txt"), "utf8"), /yaml 2[.]9[.]0 \(ISC\)/u);
		assert.match(readFileSync(path.join(install, ".ceal-cli", "worker", "current", "guide", "SKILL.md"), "utf8"), /ceal-guide/u);
		assert.equal(readFileSync(path.join(install, ".ceal-cli", "worker", "current", "install.sh"), "utf8"), "signed installer asset\n");
		assert.equal(readdirSync(path.join(install, ".ceal-cli", "worker", "releases")).length, 1);
		assert.equal(lstatSync(path.join(install, ".ceal-cli", "worker", "install.lock")).isFile(), true);
		const log = readFileSync(cosignLog, "utf8");
		assert.equal(log.match(/verify-blob/gu)?.length, 6);
		assert.match(log, /corca-ai\/ceal-cli/u);
		assert.match(log, /refs\/tags\/v0[.]65[.]0/u);
		assert.match(log, /--certificate-identity\s+https:\/\/github[.]com\/corca-ai\/ceal-cli\/[.]github\/workflows\/cealctl-release[.]yml@refs\/tags\/v0[.]65[.]0/u);
	});
});

test("stable mode resolves only a canonical latest release tag before the signed install path", () => {
	withFixture(({ root, release, tools, install, cosignLog }) => {
		const result = runInstaller({ root, release, tools, install, cosignLog, version: "stable" });
		assert.equal(result.status, 0, result.stderr);
		assert.match(readFileSync(cosignLog, "utf8"), /refs\/tags\/v0[.]65[.]0/u);
		assert.equal(existsSync(path.join(install, "ceal")), true);
	});
	for (const stableTag of ["v0.65.1-rc.1", "v00.65.1"]) {
		withFixture(({ root, release, tools, install, cosignLog }) => {
			const result = runInstaller({ root, release, tools, install, cosignLog, version: "stable", stableTag });
			assert.notEqual(result.status, 0);
			assert.match(result.stderr, /did not resolve to a canonical stable tag/u);
			assert.equal(existsSync(install), false);
		});
	}
	withFixture(({ root, release, tools, install, cosignLog }) => {
		const result = runInstaller({ root, release, tools, install, cosignLog, version: "stable", minimumVersion: "0.65.1" });
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /older than the installed worker release/u);
		assert.equal(existsSync(install), false);
	});
});

test("packed native worker artifact preserves both post-allocation failure receipts and performs an option-free stable update", { skip: process.platform !== "linux" || process.arch !== "x64" }, async () => {
	const artifact = mkdtempSync(path.join(tmpdir(), "ceal-cli-packed-update-"));
	try {
		const built = spawnSync(process.execPath, ["scripts/build-platform-binaries.mjs", "--version", "0.65.0", "--platform", "linux-amd64", "--out", artifact, "--json"], {
			cwd: ROOT,
			encoding: "utf8",
		});
		assert.equal(built.status, 0, built.stderr);
		await withFixture(async ({ root, release, tools, install, cosignLog }) => {
			copyFileSync(path.join(artifact, "ceal-linux-amd64"), path.join(release, "ceal-linux-amd64"));
			copyFileSync(INSTALLER, path.join(release, "install.sh"));
			writeTool(path.join(tools, "uname"), "case \"$1\" in -s) echo Linux ;; -m) echo x86_64 ;; *) exit 2 ;; esac");
			writeChecksums(release);
			const installed = runInstaller({ root, release, tools, install, cosignLog });
			assert.equal(installed.status, 0, installed.stderr);
			writeWorkerSession(install);
			const unavailable = spawnSync(path.join(install, "ceal"), ["call", "message.search", "--target", "target:team-inbox", "query=launch"], {
				encoding: "utf8",
				env: { ...process.env, HOME: install, PATH: `${tools}:${process.env.PATH}` },
			});
			assert.equal(unavailable.status, 3, `${unavailable.stderr}\n${unavailable.stdout}`);
			assert.equal(unavailable.stderr, "");
			const unavailablePayload = parse(unavailable.stdout);
			assert.equal(unavailablePayload.schema_version, "ceal.result.v2");
			assert.equal(unavailablePayload.status, "error");
			assert.equal(unavailablePayload.capability, "message.search");
			assert.equal(unavailablePayload.target, "target:team-inbox");
			assert.equal(unavailablePayload.receipt.evidence, "outcome_unknown");
			assert.match(unavailablePayload.receipt.request_ref, /^ceal:[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}:call$/u);
			assert.deepEqual(unavailablePayload.receipt.audit_refs, []);
			assert.equal(unavailablePayload.error.kind, "request_failed");
			assert.match(unavailablePayload.error.next_action, new RegExp(`Do not repeat a write yet[.] Run 'ceal receipt show ${unavailablePayload.receipt.request_ref}'`, "u"));
			assert.doesNotMatch(unavailable.stdout, /ceal_(?:personal|refresh)_/u);

			const gatewayFailure = await startParsedGatewayFailureServer();
			try {
				writeWorkerSession(install, gatewayFailure.endpoint);
				const rejected = spawnSync(path.join(install, "ceal"), ["call", "message.search", "--target", "target:team-inbox", "query=launch"], {
					encoding: "utf8",
					env: { ...process.env, HOME: install, PATH: `${tools}:${process.env.PATH}` },
				});
				assert.equal(rejected.status, 3, `${rejected.stderr}\n${rejected.stdout}`);
				assert.equal(rejected.stderr, "");
				const rejectedPayload = parse(rejected.stdout);
				assert.equal(rejectedPayload.schema_version, "ceal.result.v2");
				assert.equal(rejectedPayload.status, "error");
				assert.equal(rejectedPayload.capability, "message.search");
				assert.equal(rejectedPayload.target, "target:team-inbox");
				assert.equal(rejectedPayload.receipt.evidence, "not_read_back");
				assert.match(rejectedPayload.receipt.request_ref, /^ceal:[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}:call$/u);
				assert.deepEqual(rejectedPayload.receipt.audit_refs, []);
				assert.equal(rejectedPayload.error.kind, "gateway_request_failed");
				assert.doesNotMatch(rejected.stdout, /ceal_(?:personal|refresh)_/u);
			} finally {
				await gatewayFailure.close();
			}
			const started = Date.now();
			const updated = spawnSync(path.join(install, "ceal"), ["update"], {
				encoding: "utf8",
				env: {
					...process.env,
					COSIGN_LOG: cosignLog,
					FAKE_RELEASE_DIR: release,
					STABLE_TAG: "v0.65.0",
					PATH: `${tools}:${process.env.PATH}`,
				},
			});
			assert.equal(updated.status, 0, `${updated.stderr}\n${updated.stdout}`);
			assert.equal(updated.stderr, "");
			const payload = parse(updated.stdout);
			assert.equal(payload.schema_version, "ceal.update.v1");
			assert.equal(payload.status, "unchanged");
			assert.equal(payload.stable_only, true);
			assert.equal(payload.previous_version, "0.65.0");
			assert.equal(payload.installed_version, "0.65.0");
			assert.equal(payload.platform, "linux-amd64");
			assert.equal(payload.artifact_sha256, digest(readFileSync(path.join(install, "ceal"))));
			assert.equal(typeof payload.elapsed_ms, "number");
			assert.ok(Date.now() - started >= payload.elapsed_ms);
		});
	} finally {
		rmSync(artifact, { recursive: true, force: true });
	}
});

test("explicit operator installation creates only cealctl and operator-owned state", () => {
	withFixture(({ root, release, tools, install, cosignLog }) => {
		const result = runInstaller({ root, release, tools, install, cosignLog, role: "operator" });
		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, /Installed cealctl v0[.]65[.]0 .* as operator/u);
		assert.match(result.stdout, /Signed guide staged at .*[/]guide[/]SKILL[.]md; register it through the selected agent runtime/u);
		assert.equal(existsSync(path.join(install, "ceal")), false);
		assert.match(readFileSync(path.join(install, "cealctl"), "utf8"), /command=cealctl/u);
		assert.equal(readlinkSync(path.join(install, "cealctl")), ".ceal-cli/operator/current/cealctl-linux-arm64");
		assert.equal(lstatSync(path.join(install, ".ceal-cli", "operator", "current")).isSymbolicLink(), true);
		assert.equal(existsSync(path.join(install, ".ceal-cli", "worker")), false);
		assert.match(readFileSync(path.join(install, ".ceal-cli", "operator", "current", "guide", "SKILL.md"), "utf8"), /cealctl-guide/u);
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

test("guide checksum failure preserves the selected command before staging a generation", () => {
	withFixture(({ root, release, tools, install, cosignLog }) => {
		mkdirSync(install, { recursive: true });
		writeFileSync(path.join(install, "ceal"), "old-ceal\n");
		const sums = readFileSync(path.join(release, "SHA256SUMS"), "utf8");
		writeFileSync(path.join(release, "SHA256SUMS"), sums.replace(/^[a-f0-9]{64}( {2}ceal-guide-SKILL[.]md)$/mu, `${"0".repeat(64)}$1`));
		const result = runInstaller({ root, release, tools, install, cosignLog });
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /Checksum mismatch for ceal-guide-SKILL[.]md/u);
		assert.equal(readFileSync(path.join(install, "ceal"), "utf8"), "old-ceal\n");
	});
});

test("installer rejects a selected guide that does not match its signed platform manifest", () => {
	for (const [field, value] of [
		["name", "cealctl-guide-SKILL.md"],
		["binary", "cealctl"],
		["sha256", "0".repeat(64)],
	]) {
		withFixture(({ root, release, tools, install, cosignLog }) => {
			mkdirSync(install, { recursive: true });
			writeFileSync(path.join(install, "ceal"), "old-ceal\n");
			const manifestPath = path.join(release, "ceal-cli-platform-release-manifest-linux-arm64.json");
			const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
			manifest.guides["ceal-guide"][field] = value;
			writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
			writeChecksums(release);
			const result = runInstaller({ root, release, tools, install, cosignLog });
			assert.notEqual(result.status, 0, field);
			assert.match(result.stderr, /Selected guide does not match the signed platform manifest/u);
			assert.equal(readFileSync(path.join(install, "ceal"), "utf8"), "old-ceal\n");
		});
	}
});

test("installer rejects an unsafe existing staged guide without moving current", () => {
	withFixture(({ root, release, tools, install, cosignLog }) => {
		const first = runInstaller({ root, release, tools, install, cosignLog });
		assert.equal(first.status, 0, first.stderr);
		const current = path.join(install, ".ceal-cli", "worker", "current");
		const before = readlinkSync(current);
		const guidePath = path.join(install, ".ceal-cli", "worker", "current", "guide", "SKILL.md");
		rmSync(guidePath);
		symlinkSync(path.join(install, "ceal"), guidePath);
		const result = runInstaller({ root, release, tools, install, cosignLog });
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /Existing release generation is unsafe/u);
		assert.equal(readlinkSync(current), before);
	});
});

test("installer rejects signed checksum files with malformed extra lines", () => {
	withFixture(({ root, release, tools, install, cosignLog }) => {
		const sums = readFileSync(path.join(release, "SHA256SUMS"), "utf8");
		writeFileSync(path.join(release, "SHA256SUMS"), `${sums}not-a-checksum-line\n`);
		const result = runInstaller({ root, release, tools, install, cosignLog });
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /exactly ten physical lines|malformed or unexpected entry/u);
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
	assert.match(workflow, /ceal-guide-SKILL[.]md cealctl-guide-SKILL[.]md/u);
	assert.match(workflow, /permissions:\n\s+contents: read/u);
	assert.match(workflow, /environment: ceal-cli-release[\s\S]+contents: write[\s\S]+id-token: write/u);
	assert.match(workflow, /gh release download/u);
	assert.match(workflow, /gh release view[^\n]+> "\$existing_inventory"/u);
	assert.doesNotMatch(workflow, /ceal-runtime|corca-ai\/ceal(?:\s|['"])/u);
	assert.equal((workflow.match(/cosign sign-blob/gu) ?? []).length, 1);
	for (const action of workflow.matchAll(/uses:\s+([^\s]+)/gu)) assert.match(action[1], /@[a-f0-9]{40}$/u);
});

function runInstaller({ root, release, tools, install, cosignLog, version = "v0.65.0", role = "worker", stableTag = "v0.65.0", minimumVersion }) {
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
			STABLE_TAG: stableTag,
			...(minimumVersion ? { CEAL_MINIMUM_VERSION: minimumVersion } : {}),
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
	const cleanup = () => rmSync(root, { recursive: true, force: true });
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
		writeFileSync(path.join(release, "ceal-guide-SKILL.md"), "name: ceal-guide\n");
		writeFileSync(path.join(release, "cealctl-guide-SKILL.md"), "name: cealctl-guide\n");
		writePlatformManifest(release, "linux-arm64");
		writePlatformManifest(release, "linux-amd64");
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
			"case \"$url\" in",
			"  */releases/latest) printf 'HTTP/2 302\\nlocation: https://github.com/corca-ai/ceal-cli/releases/tag/%s\\n' \"$STABLE_TAG\"; exit 0 ;;",
			"esac",
			"[ -n \"$out\" ] || exit 2",
			"cp \"$FAKE_RELEASE_DIR/${url##*/}\" \"$out\"",
		].join("\n"));
		const result = callback({ root, release, tools, install, cosignLog });
		if (result && typeof result.then === "function") return result.finally(cleanup);
		cleanup();
		return result;
	} catch (error) {
		cleanup();
		throw error;
	}
}

function writePlatformManifest(release, platform) {
	const guide = (name, binary) => ({
		name,
		binary,
		sha256: digest(readFileSync(path.join(release, name))),
	});
	writeFileSync(path.join(release, `ceal-cli-platform-release-manifest-${platform}.json`), `${JSON.stringify({
		release_version: "0.65.0",
		platform,
		guides: {
			"ceal-guide": guide("ceal-guide-SKILL.md", "ceal"),
			"cealctl-guide": guide("cealctl-guide-SKILL.md", "cealctl"),
		},
	}, null, 2)}\n`);
}

function writeChecksums(release) {
	const checksummed = [
		"THIRD_PARTY_NOTICES.txt",
		"ceal-cli-platform-release-manifest-linux-amd64.json",
		"ceal-cli-platform-release-manifest-linux-arm64.json",
		"ceal-guide-SKILL.md",
		"cealctl-guide-SKILL.md",
		"ceal-linux-amd64",
		"ceal-linux-arm64",
		"cealctl-linux-amd64",
		"cealctl-linux-arm64",
		"install.sh",
	];
	writeFileSync(path.join(release, "SHA256SUMS"), checksummed.map((name) => `${digest(readFileSync(path.join(release, name)))}  ${name}`).join("\n") + "\n");
	return checksummed;
}

function writeWorkerSession(home, gatewayEndpoint = "http://127.0.0.1:0") {
	const stateDirectory = path.join(home, ".ceal");
	mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });
	chmodSync(stateDirectory, 0o700);
	writeFileSync(path.join(stateDirectory, "client-session.json"), `${JSON.stringify({
		schema_version: "ceal.client_session_store.v1",
		// Port zero cannot have a listening TCP service, so this proves the
		// transport-failure branch without depending on a locally free port.
		gateway_endpoint: gatewayEndpoint,
		profile_ref: "profile:narnia",
		membership_ref: "membership:narnia",
		registration_ref: "registration:narnia",
		client_ref: "client:narnia",
		subject_ref: "subject:worker",
		instance_ref: "instance:corca",
		access_token: `ceal_personal_${"P".repeat(43)}`,
		expires_at: "2099-07-14T00:00:00.000Z",
		refresh_token: `ceal_refresh_${"R".repeat(43)}`,
		refresh_token_idle_expires_at: "2099-08-14T00:00:00.000Z",
		refresh_token_absolute_expires_at: "2099-10-14T00:00:00.000Z",
	})}\n`, { mode: 0o600 });
}

async function startParsedGatewayFailureServer() {
	const child = spawn(process.execPath, ["--input-type=module", "--eval", [
		'import { createServer } from "node:http";',
		"const server = createServer(async (request, response) => {",
		"  const chunks = []; for await (const chunk of request) chunks.push(chunk);",
		"  const body = JSON.parse(Buffer.concat(chunks).toString(\"utf8\"));",
		"  response.writeHead(200, { \"content-type\": \"application/json\" });",
		"  response.end(JSON.stringify({ ok: false, request_id: body.request_id, protocol_version: \"1.3.0\", error: { code: \"uncategorized_gateway_failure\", message: \"server-controlled\", next_action: \"server-controlled\" } }));",
		"});",
		"server.listen(0, \"127.0.0.1\", () => { const address = server.address(); console.log(JSON.stringify({ endpoint: `http://127.0.0.1:${address.port}/gateway/client` })); });",
		"process.once(\"SIGTERM\", () => server.close(() => process.exit(0)));",
	].join("\n")], { stdio: ["ignore", "pipe", "pipe"] });
	try {
		const ready = await readChildJsonLine(child);
		if (!ready || typeof ready.endpoint !== "string") throw new Error("parsed Gateway failure fixture did not report an endpoint");
		return {
			endpoint: ready.endpoint,
			close: () => stopChild(child),
		};
	} catch (error) {
		await stopChild(child);
		throw error;
	}
}

function readChildJsonLine(child) {
	return new Promise((resolve, reject) => {
		let stdout = "";
		const fail = (error) => { cleanup(); reject(error); };
		const onData = (chunk) => {
			stdout += chunk;
			const newline = stdout.indexOf("\n");
			if (newline < 0) return;
			try {
				const value = JSON.parse(stdout.slice(0, newline));
				cleanup();
				resolve(value);
			} catch { fail(new Error("parsed Gateway failure fixture emitted invalid startup data")); }
		};
		const onExit = (code, signal) => fail(new Error(`parsed Gateway failure fixture exited before startup (${code ?? signal ?? "unknown"})`));
		const cleanup = () => {
			child.stdout.off("data", onData);
			child.off("exit", onExit);
		};
		child.stdout.on("data", onData);
		child.once("exit", onExit);
	});
}

function stopChild(child) {
	if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
	return new Promise((resolve) => {
		child.once("exit", resolve);
		child.kill("SIGTERM");
	});
}

function writeBinary(file, command, marker = "generation-1", versionSuffix = "") {
	const schema = command === "ceal" ? "ceal.version.v1" : "cealctl.version.v1";
	const credentialContext = command === "ceal" ? "gateway_issued_client_session" : "cealctl_operator_admin_session";
	writeFileSync(file, `#!/usr/bin/env sh\n# ${marker}\ncommand=${command}\nif [ "\${1:-}" = version ]; then printf 'schema_version: ${schema}\\ncommand: %s\\nversion: 0.65.0\\nprotocol_version: 1.3.0\\nsupported_gateway_protocol_range:\\n  minimum: 1.3.0\\n  maximum: 1.3.0\\ncredential_context: ${credentialContext}\\n${versionSuffix}' "$command"; exit 0; fi\nif [ "\${1:-}" = --help ]; then echo help; exit 0; fi\nexit 2\n`);
	chmodSync(file, 0o755);
}

function writeTool(file, body) {
	writeFileSync(file, `#!/usr/bin/env sh\nset -eu\n${body}\n`);
	chmodSync(file, 0o755);
}

function digest(bytes) {
	return createHash("sha256").update(bytes).digest("hex");
}
