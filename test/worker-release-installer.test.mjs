import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INSTALLER = path.join(ROOT, "install-ceal.sh");
const TAG = "ceal-v0.65.0";

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

test("worker stable resolver ignores bare, draft, and prerelease tags", () => {
	withFixture(({ install, release, tools, log }) => {
		const releases = JSON.stringify([
			{ name: "legacy, global latest", prerelease: false, tag_name: "v9.9.9", unknown: { safe: true }, draft: false },
			{ prerelease: true, name: "candidate, one", tag_name: "ceal-v0.66.0-rc.1", draft: false },
			{ tag_name: "ceal-v0.66.0", draft: true, prerelease: false, name: "draft, two" },
			{ unknown: ["field"], prerelease: false, name: "worker, stable", draft: false, tag_name: TAG },
		]);
		const result = run({ install, release, tools, log, version: "stable", releases });
		assert.equal(result.status, 0, result.stderr);
		assert.match(readFileSync(log, "utf8"), /refs\/tags\/ceal-v0[.]65[.]0/u);
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
		assert.match(result.stderr, /seven worker release entries/u);
		assert.equal(readFileSync(path.join(install, "ceal"), "utf8"), "keep\n");
		assert.equal(existsSync(log), true);
	});
});

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
			"url=''", "out=''", "while [ $# -gt 0 ]; do case \"$1\" in -o) shift; out=\"$1\" ;; http*) url=\"$1\" ;; esac; shift; done",
			"case \"$url\" in *api.github.com*/releases*) printf '%s' \"${FAKE_RELEASES:-[]}\" > \"$out\"; exit 0 ;; esac",
			"[ -n \"$out\" ] || exit 2", "cp \"$FAKE_RELEASE_DIR/${url##*/}\" \"$out\"",
		].join("\n"));
		return callback({ install, release, tools, log });
	} finally { rmSync(root, { recursive: true, force: true }); }
}

function run({ install, release, tools, log, version, releases = "[]", cosignFail = false }) {
	return spawnSync("/bin/sh", [INSTALLER], { encoding: "utf8", env: { ...process.env, CEAL_INSTALL_DIR: install, CEAL_VERSION: version, COSIGN_LOG: log, COSIGN_FAIL: cosignFail ? "1" : "", FAKE_RELEASE_DIR: release, FAKE_RELEASES: releases, PATH: `${tools}:${process.env.PATH}` } });
}

function writeWorkerBinary(file) {
	writeFileSync(file, "#!/usr/bin/env sh\nif [ \"${1:-}\" = version ]; then printf 'schema_version: ceal.version.v1\\ncommand: ceal\\nversion: 0.65.0\\nprotocol_version: 1.3.0\\nsupported_gateway_protocol_range:\\n  minimum: 1.3.0\\n  maximum: 1.3.0\\ncredential_context: gateway_issued_client_session\\n'; exit 0; fi\nif [ \"${1:-}\" = --help ]; then exit 0; fi\nexit 2\n");
	chmodSync(file, 0o755);
}

function writeManifest(release, platform) {
	const guide = readFileSync(path.join(release, "ceal-guide-SKILL.md"));
	writeFileSync(path.join(release, `ceal-worker-release-manifest-${platform}.json`), `${JSON.stringify({ schema_version: "ceal.worker_release_manifest.v1", version: "0.65.0", platform, command: "ceal", guide: { name: "ceal-guide-SKILL.md", sha256: digest(guide) } }, null, 2)}\n`);
}

function writeChecksums(release) {
	const entries = ["THIRD_PARTY_NOTICES.txt", "ceal-guide-SKILL.md", "ceal-linux-amd64", "ceal-linux-arm64", "ceal-worker-release-manifest-linux-amd64.json", "ceal-worker-release-manifest-linux-arm64.json", "install-ceal.sh"];
	writeFileSync(path.join(release, "SHA256SUMS"), entries.map((name) => `${digest(readFileSync(path.join(release, name)))}  ${name}`).join("\n") + "\n");
	return entries;
}

function appendChecksum(release, name) { writeFileSync(path.join(release, "SHA256SUMS"), `${digest(readFileSync(path.join(release, name)))}  ${name}\n`, { flag: "a" }); }
function rewriteChecksumsAndSidecars(release) { for (const name of writeChecksums(release)) { writeFileSync(path.join(release, `${name}.sig`), "signature\n"); writeFileSync(path.join(release, `${name}.pem`), "certificate\n"); } }
function writeTool(file, body) { writeFileSync(file, `#!/usr/bin/env sh\nset -eu\n${body}\n`); chmodSync(file, 0o755); }
function digest(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
