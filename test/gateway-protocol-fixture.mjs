import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export const REPO_ROOT = path.resolve(new URL("..", import.meta.url).pathname);

export function makeGatewayProtocolFixture() {
	const root = realpathSync(mkdtempSync(path.join(tmpdir(), "ceal-gateway-protocol-consumer-test-")));
	const source = path.join(root, "protocol");
	const output = path.join(root, "artifacts");
	mkdirSync(output, { recursive: true, mode: 0o755 });
	const built = spawnSync("npm", ["--prefix", path.join(REPO_ROOT, "packages", "ceal-protocol"), "run", "build"], { encoding: "utf8" });
	assert.equal(built.status, 0, built.stderr);
	cpSync(path.join(REPO_ROOT, "packages", "ceal-protocol"), source, {
		recursive: true,
		filter: (entry) => path.basename(entry) !== "node_modules",
	});
	const manifestPath = path.join(source, "package.json");
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	manifest.repository = { type: "git", url: "git+https://github.com/corca-ai/ceal.git", directory: "packages/ceal-protocol" };
	manifest.homepage = "https://github.com/corca-ai/ceal#readme";
	manifest.bugs = "https://github.com/corca-ai/ceal/issues";
	writeFileSync(manifestPath, `${JSON.stringify(manifest, null, "\t")}\n`);
	const packed = spawnSync("npm", ["pack", source, "--ignore-scripts", "--json", "--pack-destination", output], { encoding: "utf8" });
	assert.equal(packed.status, 0, packed.stderr);
	const metadata = JSON.parse(packed.stdout)[0];
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
