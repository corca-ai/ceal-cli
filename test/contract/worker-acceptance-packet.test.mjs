import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
	inspectInstalledRelease,
	resolveInstalledBinary,
	sanitizedAcceptanceRecord,
	verifyProtocolProvenance,
	WorkerAcceptanceError,
} from "../../scripts/worker-acceptance-packet.mjs";

// Contract tier and offline by design: every refusal below is a decision this
// command makes before it would contact anything, and the whole point of the
// command is that those refusals cannot be skipped. The live rows are proved by
// running it against a real install, which no gate can fabricate.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BINARY_BYTES = "#!/bin/sh\nexit 0\n";

function scratch(context) {
	const root = mkdtempSync(path.join(tmpdir(), "ceal-acceptance-"));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	return root;
}

function stageInstall(root, { manifest: overrides = {}, sums, digest } = {}) {
	const directory = path.join(root, "install", "releases", "0.66.1-linux-amd64-deadbeef");
	mkdirSync(directory, { recursive: true });
	const binary = path.join(directory, "ceal-linux-amd64");
	writeFileSync(binary, BINARY_BYTES);
	chmodSync(binary, 0o755);
	const actual = digest ?? sha256(BINARY_BYTES);
	const manifest = {
		schema_version: "ceal.worker_release_manifest.v1",
		artifact_state: "unsigned_build_candidate",
		version: "0.66.1",
		platform: "linux-amd64",
		artifact: { name: "ceal-linux-amd64", sha256: actual },
		protocol: {
			package: "@corca-ai/ceal-protocol",
			version: "0.65.0",
			sha256: "a".repeat(64),
			producer: { repository: "corca-ai/ceal", commit: "c".repeat(40), tree: "t".repeat(40) },
		},
		...overrides,
	};
	writeFileSync(path.join(directory, "ceal-worker-release-manifest-linux-amd64.json"), JSON.stringify(manifest, null, 2));
	writeFileSync(path.join(directory, "SHA256SUMS"), sums ?? `${actual}  ceal-linux-amd64\n`);
	return { directory, binary, manifest };
}

function sha256(text) {
	return createHash("sha256").update(text).digest("hex");
}

function code(expected) {
	return (error) => error instanceof WorkerAcceptanceError && error.code === expected;
}

// The command's central claim is that it describes an installed release. A
// binary resolved out of the checkout would make every row describe the source
// tree the command was run from — the one thing it must never claim.
test("a source-checkout or workspace binary is refused, not accepted as a weaker row", (context) => {
	const root = scratch(context);
	const inRepo = path.join(ROOT, "scripts", "worker-acceptance-packet.mjs");
	assert.throws(() => resolveInstalledBinary({ binary: inRepo }), code("source_checkout_substitution"));
	for (const marker of ["node_modules", "dist", "packages"]) {
		const directory = path.join(root, marker, "bin");
		mkdirSync(directory, { recursive: true });
		const binary = path.join(directory, "ceal");
		writeFileSync(binary, BINARY_BYTES);
		assert.throws(() => resolveInstalledBinary({ binary }), code("workspace_substitution"), marker);
	}
	assert.throws(() => resolveInstalledBinary({ binary: path.join(root, "absent") }), code("binary_not_found"));
});

// Three independent statements must agree; any one alone is a self-report.
test("the installed bytes must agree with both the manifest and SHA256SUMS", (context) => {
	const root = scratch(context);
	const good = stageInstall(root);
	const inspected = inspectInstalledRelease(good.binary);
	assert.equal(inspected.manifest.version, "0.66.1");
	assert.equal(inspected.artifactSha256, sha256(BINARY_BYTES));

	const drifted = stageInstall(path.join(root, "drift"), { manifest: { artifact: { name: "ceal-linux-amd64", sha256: "b".repeat(64) } } });
	assert.throws(() => inspectInstalledRelease(drifted.binary), code("artifact_digest_mismatch"));

	const wrongSums = stageInstall(path.join(root, "sums"), { sums: `${"e".repeat(64)}  ceal-linux-amd64\n` });
	assert.throws(() => inspectInstalledRelease(wrongSums.binary), code("checksums_mismatch"));

	const bare = path.join(root, "bare");
	mkdirSync(bare, { recursive: true });
	const lonely = path.join(bare, "ceal");
	writeFileSync(lonely, BINARY_BYTES);
	assert.throws(() => inspectInstalledRelease(lonely), code("release_manifest_missing"));
});

// `@corca-ai/ceal-protocol@0.65.0` has been observed with three different byte
// sets, so a version string names no particular artifact. The producer commit
// and tree are what make the input immutable.
test("a protocol input named by version alone, or by a source path, is refused", (context) => {
	const root = scratch(context);
	const { manifest } = stageInstall(root);
	assert.equal(verifyProtocolProvenance(manifest, { repoRoot: root }).producer.commit, "c".repeat(40));

	for (const missing of ["commit", "tree", "repository"]) {
		const producer = { ...manifest.protocol.producer };
		delete producer[missing];
		const weakened = { ...manifest, protocol: { ...manifest.protocol, producer } };
		assert.throws(() => verifyProtocolProvenance(weakened, { repoRoot: root }), code("protocol_provenance_incomplete"), missing);
	}
	assert.throws(() => verifyProtocolProvenance({ ...manifest, protocol: undefined }, { repoRoot: root }), code("protocol_input_missing"));

	for (const specifier of ["workspace:*", "link:../ceal-protocol", "file:../../packages/ceal-protocol", "portal:/tmp/x"]) {
		const substituted = { ...manifest, protocol: { ...manifest.protocol, version: specifier } };
		assert.throws(() => verifyProtocolProvenance(substituted, { repoRoot: root }), code("protocol_substitution"), specifier);
	}
});

// The lock is the repository's own record of which Gateway artifact was
// accepted. An installed release built against a different one is a real
// disagreement, not a detail to report in a field nobody reads.
test("a protocol producer disagreeing with the handoff lock is refused", (context) => {
	const root = scratch(context);
	const { manifest } = stageInstall(root);
	writeFileSync(
		path.join(root, "gateway-protocol-handoff-lock.json"),
		JSON.stringify({ gateway: { commit: "c".repeat(40), tree: "t".repeat(40) } }),
	);
	const agreed = verifyProtocolProvenance(manifest, { repoRoot: root });
	assert.equal(agreed.lock_agreement.commit_matches, true);
	assert.equal(agreed.lock_agreement.tree_matches, true);

	writeFileSync(
		path.join(root, "gateway-protocol-handoff-lock.json"),
		JSON.stringify({ gateway: { commit: "d".repeat(40), tree: "t".repeat(40) } }),
	);
	assert.throws(() => verifyProtocolProvenance(manifest, { repoRoot: root }), code("protocol_provenance_disagreement"));
});

// A packet shaped like a real one, with the three host-local fields populated.
// Built by hand rather than by running the command: the projection is what is
// under test, and requiring an installed release to test it would mean the
// leak-prevention had no gate at all on a machine without one.
function packetFixture() {
	return {
		schema_version: "ceal.worker_acceptance_packet.v1",
		installed_client: {
			binary_path: "/home/someone/.local/bin/ceal",
			platform: "linux-amd64",
			release_version: "0.66.1",
			artifact_sha256: "a".repeat(64),
			artifact_state: "signed",
			manifest: "ceal-worker-release-manifest-linux-amd64.json",
			digest_agreement: "binary_bytes_manifest_and_sha256sums_agree",
			reported_version: "0.66.1",
			client_protocol_version: "1.3.0",
		},
		gateway_protocol_input: { package: "@corca-ai/ceal-protocol", producer: { repository: "corca-ai/ceal" } },
		guide: { status: "registered", exit_code: 0, registered_hosts: ["/home/someone/.claude/skills", "/home/someone/.codex/skills"] },
		gateway_session: {
			reached: true,
			exit_code: 0,
			elapsed_ms: 120,
			instance_ref: "instance:corca",
			profile_ref: "profile:narnia",
			negotiated_protocol_version: "1.3.0",
			host_decision: "accepted",
			catalog_source: "live_discovery",
			live_gateway_checked: true,
			capability_count: 9,
		},
		bounded_capability_call: null,
		non_claims: ["fixture non-claim"],
	};
}

// The defect this projection exists to fix: the packet carries the operator's
// absolute binary path and their local agent registration paths, and the record
// the Gateway lane reads must describe an installation without locating one.
test("the sanitized record omits every host-local path and keeps the Gateway's own refs", () => {
	const packet = packetFixture();
	const record = sanitizedAcceptanceRecord(packet);
	const serialized = JSON.stringify(record);

	// Assert on the rendered bytes, not the key list, so a nested reintroduction
	// is caught too.
	assert.doesNotMatch(serialized, /\/home\/someone/u, "the record leaked a host filesystem path");
	assert.equal(Object.hasOwn(record.installed_client, "binary_path"), false);
	assert.equal(Object.hasOwn(record.guide, "registered_hosts"), false);
	// The count is the evidence; the paths were the leak.
	assert.equal(record.guide.registered_host_count, 2);

	// Gateway-issued identifiers are returned to the Gateway that issued them.
	assert.equal(record.gateway_session.instance_ref, "instance:corca");
	assert.equal(record.gateway_session.profile_ref, "profile:narnia");

	// The evidence the record exists to carry survives intact.
	assert.equal(record.installed_client.artifact_sha256, packet.installed_client.artifact_sha256);
	assert.equal(record.installed_client.digest_agreement, packet.installed_client.digest_agreement);
	assert.deepEqual(record.gateway_protocol_input, packet.gateway_protocol_input);
	assert.equal(record.schema_version, "ceal.worker_acceptance_result.v1");
	// The packet's own non-claims travel, plus one naming the omission.
	assert.equal(record.non_claims[0], "fixture non-claim");
	assert.match(record.non_claims.at(-1), /sanitized projection/u);
});

// An allow-list is only an allow-list if a new packet field does not ride along.
test("a field added to the packet does not travel into the record by default", () => {
	const packet = packetFixture();
	packet.installed_client.operator_home = "/home/someone";
	packet.gateway_session.raw_access_token = "ceal_personal_secret";
	packet.invented_top_level = { path: "/home/someone/secret" };
	const serialized = JSON.stringify(sanitizedAcceptanceRecord(packet));
	assert.doesNotMatch(serialized, /operator_home|raw_access_token|invented_top_level|secret/u);
});
