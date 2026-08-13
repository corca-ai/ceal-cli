import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { npmPackArgs, parseNpmPackMetadata } from "../scripts/lib/npm-pack-metadata.mjs";
import { toolchainEnv } from "../scripts/lib/toolchain-env.mjs";
import { withBuiltPackages } from "./repo-build.mjs";

// `URL.pathname` is percent-encoded, so a checkout under a path containing a
// space (or any escaped character) yields "%20" here and every derived path fails
// as a confusing ENOENT. `fileURLToPath` is the decoding conversion.
export const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

export function makeGatewayProtocolFixture() {
	const root = realpathSync(mkdtempSync(path.join(tmpdir(), "ceal-gateway-protocol-consumer-test-")));
	const source = path.join(root, "protocol");
	const output = path.join(root, "artifacts");
	mkdirSync(output, { recursive: true, mode: 0o755 });
	// The copy reads the shared workspace `dist`, so it happens inside one hold of
	// the lock that also owns building it — see `test/repo-build.mjs`. Everything
	// after this point works on the private copy under `root` and needs no lock.
	withBuiltPackages(["packages/ceal-protocol"], () => {
		cpSync(path.join(REPO_ROOT, "packages", "ceal-protocol"), source, {
			recursive: true,
			filter: (entry) => path.basename(entry) !== "node_modules",
		});
	});
	const manifestPath = path.join(source, "package.json");
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	manifest.repository = { type: "git", url: "git+https://github.com/corca-ai/ceal.git", directory: "packages/ceal-protocol" };
	manifest.homepage = "https://github.com/corca-ai/ceal#readme";
	manifest.bugs = "https://github.com/corca-ai/ceal/issues";
	writeFileSync(manifestPath, `${JSON.stringify(manifest, null, "\t")}\n`);
	const packed = spawnSync("npm", npmPackArgs(source, "--ignore-scripts", "--pack-destination", output), {
		encoding: "utf8",
		env: toolchainEnv(),
	});
	assert.equal(packed.status, 0, packed.stderr);
	const metadata = parseNpmPackMetadata(packed.stdout, "@corca-ai/ceal-protocol");
	const tarball = path.join(output, metadata.filename);
	const proof = {
		schema_version: "ceal.gateway_protocol_artifact.v1",
		proof_level: "local_state",
		writes_external: false,
		source: { repository: "corca-ai/ceal", commit: "a".repeat(40), tree: "b".repeat(40), package_path: "packages/ceal-protocol" },
		artifact: {
			package: "@corca-ai/ceal-protocol",
			version: manifest.version,
			filename: metadata.filename,
			sha256: sha256(readFileSync(tarball)),
			npm_integrity: metadata.integrity,
			npm_shasum: metadata.shasum,
			exports: Object.keys(manifest.exports).sort(),
		},
	};
	const provenance = path.join(output, "gateway-protocol-provenance.json");
	writeFileSync(provenance, `${JSON.stringify(proof)}\n`);
	return { root, tarball, provenance, proof };
}

function sha256(bytes) {
	return createHash("sha256").update(bytes).digest("hex");
}
