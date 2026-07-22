import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createCealStableUpdateRunner } from "../dist/stable-update.js";

test("stable updater only launches a current managed worker generation and reads back its replacement", async (context) => {
	const root = mkdtempSync(path.join(tmpdir(), "ceal-stable-update-"));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const install = path.join(root, "prefix");
	const worker = path.join(install, ".ceal-cli", "worker");
	const releases = path.join(worker, "releases");
	const first = path.join(releases, "0.65.0-linux-amd64-test");
	const second = path.join(releases, "0.65.1-linux-amd64-test");
	mkdirSync(first, { recursive: true });
	writeWorkerBinary(path.join(first, "ceal-linux-amd64"), "0.65.0");
	writeFileSync(path.join(first, "install.sh"), updateScript(second));
	chmodSync(path.join(first, "install.sh"), 0o755);
	writeInventory(first);
	symlinkSync("releases/0.65.0-linux-amd64-test", path.join(worker, "current"));
	mkdirSync(install, { recursive: true });
	symlinkSync(".ceal-cli/worker/current/ceal-linux-amd64", path.join(install, "ceal"));

	const result = await createCealStableUpdateRunner(path.join(install, "ceal"), { PATH: process.env.PATH })();
	assert.equal(result.status, "updated");
	assert.equal(result.previous_version, "0.65.0");
	assert.equal(result.installed_version, "0.65.1");
	assert.equal(result.platform, "linux-amd64");
	assert.equal(result.artifact_sha256, digest(readFileSync(path.join(second, "ceal-linux-amd64"))));
	assert.equal(typeof result.elapsed_ms, "number");
	assert.equal(readlinkSync(path.join(install, "ceal")), ".ceal-cli/worker/current/ceal-linux-amd64");
});

test("stable updater fails closed for an unmanaged or tampered staged installer", async (context) => {
	const root = mkdtempSync(path.join(tmpdir(), "ceal-stable-update-unsafe-"));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const binary = path.join(root, "ceal-linux-amd64");
	writeWorkerBinary(binary, "0.65.0");
	const unmanaged = await createCealStableUpdateRunner(binary, { PATH: process.env.PATH })();
	assert.equal(unmanaged.status, "unavailable");
	assert.equal(unmanaged.error.kind, "update_unavailable");
});

test("stable updater rejects a verified installer result that would downgrade the worker", async (context) => {
	const root = mkdtempSync(path.join(tmpdir(), "ceal-stable-update-downgrade-"));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const install = path.join(root, "prefix");
	const worker = path.join(install, ".ceal-cli", "worker");
	const releases = path.join(worker, "releases");
	const first = path.join(releases, "0.65.1-linux-amd64-test");
	const second = path.join(releases, "0.65.0-linux-amd64-test");
	mkdirSync(first, { recursive: true });
	writeWorkerBinary(path.join(first, "ceal-linux-amd64"), "0.65.1");
	writeFileSync(path.join(first, "install.sh"), downgradeScript());
	chmodSync(path.join(first, "install.sh"), 0o755);
	writeInventory(first);
	symlinkSync("releases/0.65.1-linux-amd64-test", path.join(worker, "current"));
	mkdirSync(install, { recursive: true });
	symlinkSync(".ceal-cli/worker/current/ceal-linux-amd64", path.join(install, "ceal"));
	const result = await createCealStableUpdateRunner(path.join(install, "ceal"), { PATH: process.env.PATH })();
	assert.equal(result.status, "unavailable");
	assert.equal(result.error.kind, "update_failed");
});

function updateScript(nextGeneration, version = "0.65.1") {
	return `#!/usr/bin/env sh
set -eu
[ "$CEAL_VERSION" = stable ]
[ "$CEAL_INSTALL_ROLE" = worker ]
mkdir -p '${nextGeneration}'
cat > '${path.join(nextGeneration, "ceal-linux-amd64")}' <<'EOF'
#!/usr/bin/env sh
if [ "\${1:-}" = version ]; then
  printf 'schema_version: ceal.version.v1\\ncommand: ceal\\nversion: ${version}\\n'
  exit 0
fi
exit 2
EOF
chmod 755 '${path.join(nextGeneration, "ceal-linux-amd64")}'
ln -s 'releases/${path.basename(nextGeneration)}' "$CEAL_INSTALL_DIR/.ceal-cli/worker/current.next"
mv -Tf "$CEAL_INSTALL_DIR/.ceal-cli/worker/current.next" "$CEAL_INSTALL_DIR/.ceal-cli/worker/current"
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
	writeFileSync(file, `#!/usr/bin/env sh
if [ "\${1:-}" = version ]; then
  printf 'schema_version: ceal.version.v1\\ncommand: ceal\\nversion: ${version}\\n'
  exit 0
fi
exit 2
`);
	chmodSync(file, 0o755);
}

function writeInventory(generation) {
	const installer = readFileSync(path.join(generation, "install.sh"));
	writeFileSync(path.join(generation, "SHA256SUMS"), `${digest(installer)}  install.sh\n`);
}

function digest(bytes) {
	return createHash("sha256").update(bytes).digest("hex");
}
