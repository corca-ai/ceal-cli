import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import {
	type ArchiveResolution,
	consumeLockedGatewayHandoffArchiveSync,
	type RawInputs,
	type SyncArchiveDependencies,
	WorkerGatewayHandoffArchiveError,
} from "../../scripts/worker-gateway-handoff-archive.ts";
import { resolveWorkerReleaseInputsFromLockedGatewayArchive, WorkerReleaseInputError } from "../../scripts/worker-release-inputs.ts";

const LOCK_FILENAME = "gateway-protocol-handoff-lock.json";
const ORIGIN = "https://ceal.borca.ai/releases/gateway-protocol-handoff";
const WORKFLOW_PATH = ".github/workflows/gateway-protocol-handoff-release.yml";

type MutableLock = {
	schema_version?: string;
	status?: string;
	gateway: Record<string, unknown>;
	protocol: Record<string, unknown>;
	archive: Record<string, unknown>;
	reviewed_signature: Record<string, unknown>;
};
type ArchiveFixture = {
	repoRoot: string;
	archive: string;
	archiveSha256: string;
	commit: string;
	tree: string;
	protocolTree: string;
	manifestSha256: string;
	resolution: ArchiveResolution;
};
type TestDependencies = SyncArchiveDependencies<ArchiveResolution>;

// Every refusal in this file is the same three moves: take the fixture's archive,
// perturb one thing, and expect a coded refusal. Written out per case, the bodies
// below became structurally identical to each other — real duplication, and what
// the duplicate ratchet flagged. The perturbation is the only part that differs
// between cases, so it is the only part left at the call site.
//
// `lock` is passed in rather than re-read, because each case overwrites the lock
// file and the next one still has to start from the reviewed original.
function refusesMutatedLock(
	fixture: ArchiveFixture,
	lock: MutableLock,
	mutate: (value: MutableLock) => void,
	code = "invalid_gateway_handoff_lock",
): void {
	const mutated: MutableLock = JSON.parse(JSON.stringify(lock));
	mutate(mutated);
	writeFileSync(path.join(fixture.repoRoot, LOCK_FILENAME), `${JSON.stringify(mutated)}\n`);
	refuses(fixture, undefined, code);
}

function refuses(fixture: ArchiveFixture, dependencies: TestDependencies | undefined, code: string): void {
	assert.throws(
		() => consumeLockedGatewayHandoffArchiveSync({ repoRoot: fixture.repoRoot, archiveFile: fixture.archive }, dependencies),
		hasArchiveCode(code),
	);
}

test("resolves only a lock-bound exact Gateway archive through a disposable packet", (context: TestContext) => {
	const fixture = archiveFixture(context);
	let packetDirectory = "";
	const result = consumeLockedGatewayHandoffArchiveSync(
		{ repoRoot: fixture.repoRoot, archiveFile: fixture.archive },
		{
			resolveInputs: (inputs: RawInputs) => {
				packetDirectory = path.dirname(inputs.protocolTarball);
				assert.equal(existsSync(packetDirectory), true);
				assert.equal(readFileSync(inputs.protocolTarball, "utf8"), "protocol\n");
				assert.equal(readFileSync(inputs.controlConformance, "utf8"), '{"control":true}\n');
				assert.equal(inputs.expectedHandoffSha256, fixture.manifestSha256);
				assert.equal(inputs.clientTarball, undefined);
				return fixture.resolution;
			},
		},
	);
	assert.equal(existsSync(packetDirectory), false);
	assert.deepEqual(result.lock, {
		filename: LOCK_FILENAME,
		gateway_repository: "corca-ai/ceal",
		gateway_commit: fixture.commit,
		gateway_tag: "gateway-protocol-handoff-v0.65.0",
		actions_run_id: 42,
		origin: ORIGIN,
		archive_filename: "ceal-gateway-protocol-handoff-0.65.0.tar.gz",
		archive_sha256: sha256(readFileSync(fixture.archive)),
	});
});

test("refuses a changed archive or unsafe archive inventory before the input resolver", (context: TestContext) => {
	const fixture = archiveFixture(context);
	writeFileSync(fixture.archive, "changed bytes\n");
	assert.throws(
		() =>
			consumeLockedGatewayHandoffArchiveSync(
				{ repoRoot: fixture.repoRoot, archiveFile: fixture.archive },
				{
					resolveInputs: () => assert.fail("changed archive must not reach input resolver"),
				},
			),
		hasArchiveCode("gateway_handoff_archive_mismatch"),
	);
	const unsafe = archiveFixture(context, { extraFile: "unexpected" });
	assert.throws(
		() =>
			consumeLockedGatewayHandoffArchiveSync(
				{ repoRoot: unsafe.repoRoot, archiveFile: unsafe.archive },
				{
					resolveInputs: () => assert.fail("unsafe inventory must not reach input resolver"),
				},
			),
		hasArchiveCode("gateway_handoff_archive_inventory"),
	);
});

// The client tarball used to be the fifth member and the reason the lock had to
// declare a package pair. It is packed from this repository's own source now, so
// a packet that still carries one is not a Gateway protocol handoff — and a
// consumer that tolerated the extra member would be accepting a client artifact
// nobody in this repository reviewed.
test("a packet carrying a client tarball is refused as an inventory violation", (context: TestContext) => {
	const fixture = archiveFixture(context, { extraFile: "corca-ai-ceal-0.71.0.tgz" });
	assert.throws(
		() =>
			consumeLockedGatewayHandoffArchiveSync(
				{ repoRoot: fixture.repoRoot, archiveFile: fixture.archive },
				{ resolveInputs: () => assert.fail("a client tarball must not reach the input resolver") },
			),
		hasArchiveCode("gateway_handoff_archive_inventory"),
	);
});

test("verifies and extracts the private copied archive when the supplied path changes after copy", (context: TestContext) => {
	const fixture = archiveFixture(context);
	const result = consumeLockedGatewayHandoffArchiveSync(
		{ repoRoot: fixture.repoRoot, archiveFile: fixture.archive },
		{
			copyArchive: (source: string, destination: string) => {
				copyFileSync(source, destination);
				writeFileSync(source, "attacker replaced the supplied path after copy\n");
			},
			resolveInputs: (inputs: RawInputs) => {
				assert.equal(readFileSync(inputs.protocolTarball, "utf8"), "protocol\n");
				return fixture.resolution;
			},
		},
	);
	assert.equal(result.lock.archive_sha256, fixture.archiveSha256);
});

// The tag names the Protocol release, and the lock declares the Protocol binding
// rather than deriving it. Deriving the tarball name from the tag is what made a
// genuine Protocol/Client pair archive unconsumable under the previous handoff
// shape; the packet has one package now, but the lock is still what gets read.
test("the lock declares the Protocol binding and it must agree with the tag", (context: TestContext) => {
	const fixture = archiveFixture(context);
	const lock: MutableLock = JSON.parse(readFileSync(path.join(fixture.repoRoot, LOCK_FILENAME), "utf8"));
	for (const mutate of [
		(value: MutableLock) => removeProperty(value, "protocol"),
		// The filename must agree with the declared version, so a lock cannot name
		// one version and point at another tarball.
		(value: MutableLock) => {
			value.protocol.filename = "corca-ai-ceal-protocol-0.66.0.tgz";
		},
		// A Protocol version disagreeing with the tag is a lock error, not a silent
		// preference for one of the two.
		(value: MutableLock) => {
			value.protocol.version = "0.66.0";
			value.protocol.filename = "corca-ai-ceal-protocol-0.66.0.tgz";
		},
	]) {
		refusesMutatedLock(fixture, lock, mutate);
	}
});

// The archive is signed now, and a lock a maintainer reviews has to be able to
// say which identity it was verified against. Nothing re-runs cosign here, so the
// only property that can be enforced is that the recorded identity is the one the
// lock's own tag and workflow imply — a lock naming some other workflow's
// certificate is describing a different archive than the one it binds.
test("the lock must record the Sigstore identity its own tag implies", (context: TestContext) => {
	const fixture = archiveFixture(context);
	const lock: MutableLock = JSON.parse(readFileSync(path.join(fixture.repoRoot, LOCK_FILENAME), "utf8"));
	lock.schema_version = "ceal.worker_gateway_protocol_handoff_lock.v2";
	lock.reviewed_signature.workflow_sha = lock.gateway.commit;
	for (const mutate of [
		(value: MutableLock) => removeProperty(value, "reviewed_signature"),
		(value: MutableLock) => {
			value.reviewed_signature.certificate_identity = "https://github.com/corca-ai/ceal/.github/workflows/other.yml@refs/tags/x";
		},
		(value: MutableLock) => {
			value.reviewed_signature.oidc_issuer = "https://example.invalid";
		},
		(value: MutableLock) => {
			value.reviewed_signature.run_invocation_uri = "https://github.com/corca-ai/ceal/actions/runs/1/attempts/1";
		},
		(value: MutableLock) => {
			delete value.reviewed_signature.workflow_sha;
		},
		(value: MutableLock) => {
			value.reviewed_signature.workflow_sha = "f".repeat(40);
		},
	]) {
		refusesMutatedLock(fixture, lock, mutate);
	}
});

// The archive consumer is the last place that can notice the packet resolving to
// a different Gateway identity than the reviewed lock names. It checks the whole
// identity, not just the commit: two Gateway commits can share a tree, and the
// protocol subtree is the field the vendored copy is pinned against.
test("a packet resolving to another producer identity or another Protocol digest is refused", (context: TestContext) => {
	const drifts = [{ commit: "c".repeat(40) }, { tree: "c".repeat(40) }, { protocol_tree: "c".repeat(40) }];
	for (const drift of drifts) {
		const fixture = archiveFixture(context);
		const protocol = fixture.resolution.protocol;
		if (!protocol) throw new Error("fixture protocol resolution is required");
		refuses(
			fixture,
			{
				resolveInputs: () => ({
					...fixture.resolution,
					protocol: { ...protocol, producer: { ...protocol.producer, ...drift } },
				}),
			},
			"gateway_handoff_lock_mismatch",
		);
	}
	const fixture = archiveFixture(context);
	refuses(
		fixture,
		{ resolveInputs: () => ({ ...fixture.resolution, protocol: { ...fixture.resolution.protocol, sha256: "d".repeat(64) } }) },
		"gateway_handoff_lock_mismatch",
	);
});

test("worker input facade preserves the reviewed lock trust anchor and maps archive failures", () => {
	const lock = {
		filename: LOCK_FILENAME,
		gateway_repository: "corca-ai/ceal",
		gateway_commit: "a".repeat(40),
		gateway_tag: "gateway-protocol-handoff-v0.65.0",
		actions_run_id: 42,
		origin: ORIGIN,
		archive_filename: "ceal-gateway-protocol-handoff-0.65.0.tar.gz",
		archive_sha256: "b".repeat(64),
	};
	const result = resolveWorkerReleaseInputsFromLockedGatewayArchive(
		{ repoRoot: "/tmp/ceal-cli-test", gatewayHandoffArchive: "/tmp/ceal-gateway-protocol-handoff-0.65.0.tar.gz" },
		{
			consumeArchive: (_options, handlers) =>
				handlers.consume({
					lock,
					rawInputs: {
						repoRoot: "/tmp",
						protocolTarball: "/tmp/protocol.tgz",
						protocolProvenance: "/tmp/provenance.json",
						controlConformance: "/tmp/control.json",
						handoffManifest: "/tmp/handoff.json",
						expectedHandoffSha256: "a".repeat(64),
					},
					resolution: {
						schema_version: "ceal.worker_release_input_resolution.v1",
						ok: true,
						proof_level: "local_state",
						writes_external: false,
						worker: { package: "@corca-ai/ceal-worker-cli", source_path: "packages/ceal-worker-cli", command: "ceal" },
						client: { package: "@corca-ai/ceal", source_path: "packages/ceal-client" },
						guide: {
							compatibility_asset: "ceal-guide-SKILL.md",
							compatibility_source_path: "scripts/assets/ceal-guide-compatibility-SKILL.md",
							embedded_asset: "ceal-guide.tar",
							source_path: "skills/ceal-guide",
							format: "tar",
						},
						protocol: {
							package: "@corca-ai/ceal-protocol",
							version: "0.65.0",
							filename: "corca-ai-ceal-protocol-0.65.0.tgz",
							sha256: "b".repeat(64),
							npm_integrity: "sha512-placeholder",
							exports: [".", "./conformance"],
							producer: {
								repository: "corca-ai/ceal",
								commit: lock.gateway_commit,
								tree: "b".repeat(40),
								protocol_tree: "e".repeat(40),
							},
						},
						control_conformance: { filename: "control.json", sha256: "c".repeat(64), bytes: 1 },
						handoff: { filename: "handoff.json", sha256: "d".repeat(64) },
						trust_anchor: {
							kind: "caller_supplied_manifest_sha256",
							value: "a".repeat(64),
						},
						forbidden_release_inputs: ["packages/ceal-protocol"],
						non_claims: [
							"This caller-supplied digest binds exact local input bytes; it does not authenticate who supplied that digest or packet.",
						],
					},
				}),
		},
	);
	assert.equal(result.trust_anchor.kind, "reviewed_gateway_handoff_lock");
	assert.equal(result.trust_anchor.gateway_commit, lock.gateway_commit);
	assert.equal(result.trust_anchor.origin, ORIGIN);
	assert.equal(
		result.non_claims.some((entry) => entry.startsWith("This caller-supplied digest")),
		false,
	);
	assert.throws(
		() =>
			resolveWorkerReleaseInputsFromLockedGatewayArchive(
				{ repoRoot: "/tmp", gatewayHandoffArchive: "/tmp/archive.tar.gz" },
				{
					consumeArchive: () => {
						throw new WorkerGatewayHandoffArchiveError("gateway_handoff_lock_missing", "missing");
					},
				},
			),
		hasInputCode("gateway_handoff_lock_missing"),
	);
});

function archiveFixture(context: TestContext, { extraFile = null }: { extraFile?: string | null } = {}): ArchiveFixture {
	const root = realpathSync(mkdtempSync(path.join(tmpdir(), "ceal-worker-gateway-handoff-test-")));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const repoRoot = path.join(root, "repo");
	const handoff = path.join(root, "handoff");
	mkdirSync(repoRoot);
	mkdirSync(handoff);
	const commit = "a".repeat(40);
	const tree = "b".repeat(40);
	const protocolTree = "e".repeat(40);
	const manifest = '{"safe":true}\n';
	const protocolBytes = "protocol\n";
	writeFileSync(path.join(handoff, ".ceal-protocol-handoff-owner"), "ceal.gateway_protocol_handoff.v1\n");
	writeFileSync(path.join(handoff, "corca-ai-ceal-protocol-0.65.0.tgz"), protocolBytes);
	writeFileSync(path.join(handoff, "gateway-protocol-handoff.json"), manifest);
	writeFileSync(path.join(handoff, "gateway-leased-consumer-control-conformance.json"), '{"control":true}\n');
	writeFileSync(path.join(handoff, "gateway-protocol-provenance.json"), '{"provenance":true}\n');
	if (extraFile) writeFileSync(path.join(handoff, extraFile), "unexpected\n");
	const archive = path.join(root, "ceal-gateway-protocol-handoff-0.65.0.tar.gz");
	execFileSync("tar", ["-czf", archive, "-C", handoff, ...readFileNames(handoff)]);
	const tag = "gateway-protocol-handoff-v0.65.0";
	const lock = {
		schema_version: "ceal.worker_gateway_protocol_handoff_lock.v1",
		status: "locked",
		gateway: {
			repository: "corca-ai/ceal",
			workflow_path: WORKFLOW_PATH,
			commit,
			tree,
			protocol_tree: protocolTree,
			tag,
			actions_run_id: 42,
			origin: ORIGIN,
		},
		protocol: {
			package: "@corca-ai/ceal-protocol",
			version: "0.65.0",
			filename: "corca-ai-ceal-protocol-0.65.0.tgz",
			sha256: sha256(Buffer.from(protocolBytes)),
		},
		archive: {
			filename: path.basename(archive),
			sha256: sha256(readFileSync(archive)),
			handoff_manifest_sha256: sha256(Buffer.from(manifest)),
		},
		reviewed_signature: {
			certificate_identity: `https://github.com/corca-ai/ceal/${WORKFLOW_PATH}@refs/tags/${tag}`,
			oidc_issuer: "https://token.actions.githubusercontent.com",
			run_invocation_uri: "https://github.com/corca-ai/ceal/actions/runs/42/attempts/1",
		},
	};
	writeFileSync(path.join(repoRoot, LOCK_FILENAME), `${JSON.stringify(lock)}\n`);
	return {
		repoRoot,
		archive,
		archiveSha256: lock.archive.sha256,
		commit,
		tree,
		protocolTree,
		manifestSha256: lock.archive.handoff_manifest_sha256,
		resolution: {
			protocol: { sha256: lock.protocol.sha256, producer: { commit, tree, protocol_tree: protocolTree } },
		},
	};
}

function readFileNames(directory: string): string[] {
	return readdirSync(directory).sort();
}
function removeProperty(record: Record<string, unknown>, key: string): void {
	Reflect.deleteProperty(record, key);
}

function sha256(value: Uint8Array): string {
	return createHash("sha256").update(value).digest("hex");
}
function hasArchiveCode(code: string): (error: unknown) => boolean {
	return (error: unknown) => error instanceof WorkerGatewayHandoffArchiveError && error.code === code;
}
function hasInputCode(code: string): (error: unknown) => boolean {
	return (error: unknown) => error instanceof WorkerReleaseInputError && error.code === code;
}
