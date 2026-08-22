import { sha256 } from "../packages/ceal-worker-cli/src/sha256.ts";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// `URL.pathname` is percent-encoded, so a checkout under a path containing a
// space (or any escaped character) yields "%20" here and every derived path fails
// as a confusing ENOENT. `fileURLToPath` is the decoding conversion.
export const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

export function makeGatewayProtocolFixture() {
	const root = realpathSync(mkdtempSync(path.join(tmpdir(), "ceal-gateway-protocol-consumer-test-")));
	const output = path.join(root, "artifacts");
	mkdirSync(output, { recursive: true, mode: 0o755 });
	// The consumer proof is about an archive this repository RECEIVES, so the fixture
	// uses the received archive rather than building and packing a local source tree
	// that resembles one. That tree is gone, and with it the workspace build lock and
	// the `npm pack` this used to need: the Protocol arrives already packed and
	// already signed, and `vendor/ceal-protocol` is where it lands.
	const lock = JSON.parse(readFileSync(path.join(REPO_ROOT, "gateway-protocol-handoff-lock.json"), "utf8"));
	const tarball = path.join(output, lock.protocol.filename);
	copyFileSync(path.join(REPO_ROOT, "vendor", "ceal-protocol", lock.protocol.filename), tarball);
	const bytes = readFileSync(tarball);
	// Read back out of the archive, so every field below describes the bytes on disk
	// rather than a manifest the fixture could have edited first.
	const manifest = JSON.parse(execFileSync("tar", ["-xOzf", tarball, "package/package.json"]).toString("utf8"));
	const digest = sha256(bytes);
	assert.equal(digest, lock.protocol.sha256, "the vendored archive must be the one the handoff lock binds");
	const proof = {
		schema_version: "ceal.gateway_protocol_artifact.v1",
		proof_level: "local_state",
		writes_external: false,
		source: { repository: "corca-ai/ceal", commit: "a".repeat(40), tree: "b".repeat(40), package_path: "packages/ceal-protocol" },
		artifact: {
			package: "@corca-ai/ceal-protocol",
			version: manifest.version,
			filename: lock.protocol.filename,
			sha256: digest,
			npm_integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
			npm_shasum: createHash("sha1").update(bytes).digest("hex"),
			exports: Object.keys(manifest.exports).sort(),
		},
	};
	const provenance = path.join(output, "gateway-protocol-provenance.json");
	writeFileSync(provenance, `${JSON.stringify(proof)}\n`);
	return { root, tarball, provenance, proof };
}
