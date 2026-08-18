import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { sha256 } from "../../packages/ceal-worker-cli/src/sha256.ts";
import {
	bootstrapGatewayProtocolHandoff,
	GatewayProtocolHandoffBootstrapError,
	resolveRemoteTag,
} from "../../scripts/bootstrap-gateway-protocol-handoff.ts";
import { packedProtocolFixture, ROOT } from "../worker-release-package-fixture.ts";

test("public bootstrap derives one lock candidate from exact signed packet identities without writing the repository", (context: TestContext) => {
	const fixture = publicFixture(context);
	const downloads: string[] = [];
	const result = bootstrapGatewayProtocolHandoff(
		{ repoRoot: ROOT, tag: fixture.tag },
		{
			download: (url: string, destination: string) => {
				downloads.push(url);
				assert.equal(path.relative(ROOT, destination).startsWith(".."), true);
				copyFileSync(path.join(fixture.assets, path.basename(url)), destination);
			},
			resolveRemoteTag: () => fixture.producer.commit,
			verifySignature: () => ({ actionsRunId: 42, runInvocationUri: "https://github.com/corca-ai/ceal/actions/runs/42/attempts/1" }),
		},
	);
	context.after(() => rmSync(result.retained_download_directory, { recursive: true, force: true }));
	assert.equal(result.proof_level, "public_signed_artifact");
	assert.equal(result.writes_repository, false);
	assert.equal(result.candidate_lock.schema_version, "ceal.worker_gateway_protocol_handoff_lock.v2");
	assert.equal(result.candidate_lock.gateway.commit, fixture.producer.commit);
	assert.equal(result.candidate_lock.gateway.protocol_tree, fixture.producer.protocol_tree);
	assert.equal(result.candidate_lock.protocol.version, fixture.version);
	assert.equal(result.candidate_lock.archive.sha256, fixture.archiveSha256);
	assert.match(result.candidate_lock.archive.control_routes_sha256, /^[a-f0-9]{64}$/u);
	assert.equal(result.candidate_lock.reviewed_signature.workflow_sha, fixture.producer.commit);
	assert.equal(result.candidate_lock.reviewed_signature.actions_run_id, undefined);
	assert.equal(result.candidate_lock.reviewed_signature.run_invocation_uri.endsWith("/runs/42/attempts/1"), true);
	assert.deepEqual(
		downloads,
		fixture.assetNames.map((name) => `${fixture.origin}/${fixture.tag}/${name}`),
	);
});

test("public bootstrap refuses checksum or remote-tag drift before producing a candidate", (context: TestContext) => {
	const fixture = publicFixture(context);
	const dependencies = {
		download: (url: string, destination: string) => copyFileSync(path.join(fixture.assets, path.basename(url)), destination),
		resolveRemoteTag: () => fixture.producer.commit,
		verifySignature: () => ({ actionsRunId: 42, runInvocationUri: "https://github.com/corca-ai/ceal/actions/runs/42/attempts/1" }),
	};
	writeFileSync(path.join(fixture.assets, "SHA256SUMS"), `${"0".repeat(64)}  ${fixture.archiveName}\n`);
	assert.throws(
		() => bootstrapGatewayProtocolHandoff({ repoRoot: ROOT, tag: fixture.tag }, dependencies),
		(error) => error instanceof GatewayProtocolHandoffBootstrapError && error.code === "gateway_checksum_mismatch",
	);
	writeFileSync(path.join(fixture.assets, "SHA256SUMS"), `${fixture.archiveSha256}  ${fixture.archiveName}\n`);
	assert.throws(
		() => bootstrapGatewayProtocolHandoff({ repoRoot: ROOT, tag: fixture.tag }, { ...dependencies, resolveRemoteTag: () => "f".repeat(40) }),
		(error) => error instanceof GatewayProtocolHandoffBootstrapError && error.code === "gateway_handoff_identity_mismatch",
	);
});

test("the real verifier binds the certificate to workflow, repository, tag, commit, trigger, and issuer", () => {
	const source = readFileSync(new URL("../../scripts/bootstrap-gateway-protocol-handoff.ts", import.meta.url), "utf8");
	for (const flag of [
		"--certificate-identity",
		"--certificate-oidc-issuer",
		"--certificate-github-workflow-name",
		"--certificate-github-workflow-repository",
		"--certificate-github-workflow-ref",
		"--certificate-github-workflow-sha",
		"--certificate-github-workflow-trigger",
	]) {
		assert.equal(source.includes(`"${flag}"`), true, `missing cosign binding ${flag}`);
	}
	assert.match(source, /git",\s*\["ls-remote", "--tags", "https:\/\/github\.com\/corca-ai\/ceal\.git"/u);
});

test("remote tag resolution is bounded and peels annotated tags to their commit", () => {
	const tag = "gateway-protocol-handoff-v0.72.13";
	const tagObject = "a".repeat(40);
	const commit = "b".repeat(40);
	let observed: { command: string; argv: readonly string[]; options: { timeout: number } } | undefined;
	const resolved = resolveRemoteTag(tag, (command, argv, options) => {
		observed = { command, argv, options };
		return `${tagObject}\trefs/tags/${tag}\n${commit}\trefs/tags/${tag}^{}\n`;
	});
	assert.equal(resolved, commit);
	if (!observed) throw new Error("remote tag runner was not called");
	assert.equal(observed.command, "git");
	assert.equal(observed.options.timeout, 30_000);
	assert.deepEqual(observed.argv.slice(-2), [`refs/tags/${tag}`, `refs/tags/${tag}^{}`]);
});

function publicFixture(context: TestContext) {
	const packet = packedProtocolFixture(context);
	const manifest = JSON.parse(readFileSync(packet.handoffManifest, "utf8"));
	const version = manifest.protocol.version;
	const tag = `gateway-protocol-handoff-v${version}`;
	const archiveName = `ceal-gateway-protocol-handoff-${version}.tar.gz`;
	const assets = path.join(packet.root, "public");
	mkdirSync(assets);
	const archive = path.join(assets, archiveName);
	execFileSync("tar", [
		"-czf",
		archive,
		"-C",
		packet.root,
		".ceal-protocol-handoff-owner",
		path.basename(packet.protocolTarball),
		path.basename(packet.controlConformance),
		path.basename(packet.handoffManifest),
		path.basename(packet.protocolProvenance),
	]);
	const archiveSha256 = sha256(readFileSync(archive));
	writeFileSync(path.join(assets, `${archiveName}.sig`), "fixture-signature\n");
	writeFileSync(path.join(assets, `${archiveName}.pem`), "fixture-certificate\n");
	writeFileSync(path.join(assets, "SHA256SUMS"), `${archiveSha256}  ${archiveName}\n`);
	return {
		assets,
		archiveName,
		archiveSha256,
		assetNames: [archiveName, `${archiveName}.sig`, `${archiveName}.pem`, "SHA256SUMS"],
		origin: "https://ceal.borca.ai/releases/gateway-protocol-handoff",
		producer: manifest.producer,
		tag,
		version,
	};
}
