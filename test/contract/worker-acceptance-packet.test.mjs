import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { CEAL_ACCEPTANCE_RECEIPT_KEYS } from "../../packages/ceal-worker-cli/dist/acceptance-receipt.js";
import {
	CEAL_ACCEPTANCE_BOUNDED_CALL_KEYS,
	CEAL_ACCEPTANCE_GUIDE_KEYS,
	CEAL_ACCEPTANCE_SESSION_KEYS,
	CEAL_ACCEPTANCE_TOP_LEVEL_KEYS,
	readInstalledReleaseFacts,
} from "../../packages/ceal-worker-cli/dist/acceptance-record.js";
import { sha256 } from "../../packages/ceal-worker-cli/dist/sha256.js";
import {
	buildAcceptancePacket,
	inspectInstalledRelease,
	resolveInstalledBinary,
	runInstalledCommand,
	sanitizedAcceptanceRecord,
	verifyProtocolProvenance,
	WorkerAcceptanceError,
} from "../../scripts/worker-acceptance-packet.mjs";
import { createProtocolRepoFixture } from "../converged-protocol-repo-fixture.mjs";
import { scratchDir } from "../scratch-dir.ts";

// Contract tier and offline by design: every refusal below is a decision this
// command makes before it would contact anything, and the whole point of the
// command is that those refusals cannot be skipped. The live rows are proved by
// running it against a real install, which no gate can fabricate.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CONTRACT_REPO = createProtocolRepoFixture({ acceptanceCli: true });
const DIVERGED_REPO = createProtocolRepoFixture({ diverged: true });
test.after(() => {
	CONTRACT_REPO.cleanup();
	DIVERGED_REPO.cleanup();
});

function buildContractAcceptancePacket(options) {
	return buildAcceptancePacket({ ...options, repoRoot: CONTRACT_REPO.root });
}

function buildMessageSearchAcceptancePacket(binary) {
	return buildContractAcceptancePacket({
		binary,
		capability: "message.search",
		target: `target:${"a".repeat(64)}`,
	});
}
const BINARY_BYTES = "#!/bin/sh\nexit 0\n";
const INSTALLER_BYTES = "#!/bin/sh\nexit 0\n";

function stageInstall(
	root,
	{ manifest: overrides = {}, sums, digest, binaryBytes = BINARY_BYTES, generationDigest, commandLink = true } = {},
) {
	const worker = path.join(root, "install", ".ceal-cli", "worker");
	const actual = digest ?? sha256(binaryBytes);
	const installerDigest = sha256(INSTALLER_BYTES);
	const inventory = sums ?? `${actual}  ceal-linux-amd64\n${installerDigest}  install-ceal.sh\n`;
	const generation = `0.66.1-linux-amd64-${generationDigest ?? sha256(inventory)}`;
	const directory = path.join(worker, "releases", generation);
	mkdirSync(directory, { recursive: true });
	const binary = path.join(directory, "ceal-linux-amd64");
	writeFileSync(binary, binaryBytes);
	chmodSync(binary, 0o755);
	const installer = path.join(directory, "install-ceal.sh");
	writeFileSync(installer, INSTALLER_BYTES);
	chmodSync(installer, 0o755);
	mkdirSync(worker, { recursive: true });
	symlinkSync(path.join("releases", generation), path.join(worker, "current"));
	if (commandLink) symlinkSync(path.join(".ceal-cli", "worker", "current", "ceal-linux-amd64"), path.join(root, "install", "ceal"));
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
	writeFileSync(path.join(directory, "SHA256SUMS"), inventory);
	return { directory, binary, manifest };
}

function code(expected) {
	return (error) => error instanceof WorkerAcceptanceError && error.code === expected;
}

// The command's central claim is that it describes an installed release. A
// binary resolved out of the checkout would make every row describe the source
// tree the command was run from — the one thing it must never claim.
test("a source-checkout or workspace binary is refused, not accepted as a weaker row", (context) => {
	const root = scratchDir(context, "ceal-acceptance-");
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
	const root = scratchDir(context, "ceal-acceptance-");
	const good = stageInstall(root);
	const inspected = inspectInstalledRelease(good.binary);
	assert.equal(inspected.manifest.version, "0.66.1");
	assert.equal(inspected.artifactSha256, sha256(BINARY_BYTES));
	const installedReading = readInstalledReleaseFacts(good.binary);
	assert.equal(installedReading.ok, true);
	assert.equal(installedReading.facts.release_version, "0.66.1");

	const drifted = stageInstall(path.join(root, "drift"), { manifest: { artifact: { name: "ceal-linux-amd64", sha256: "b".repeat(64) } } });
	assert.throws(() => inspectInstalledRelease(drifted.binary), code("artifact_digest_mismatch"));

	const wrongSums = stageInstall(path.join(root, "sums"), {
		sums: `${"e".repeat(64)}  ceal-linux-amd64\n${sha256(INSTALLER_BYTES)}  install-ceal.sh\n`,
	});
	assert.throws(() => inspectInstalledRelease(wrongSums.binary), code("checksums_mismatch"));

	const missingManifest = stageInstall(path.join(root, "bare"));
	unlinkSync(path.join(missingManifest.directory, "ceal-worker-release-manifest-linux-amd64.json"));
	assert.throws(() => inspectInstalledRelease(missingManifest.binary), code("release_manifest_missing"));
});

test("self-consistent release sidecars outside the managed current generation are refused", (context) => {
	const root = scratchDir(context, "ceal-acceptance-");
	const staged = stageInstall(root);
	const scratch = path.join(root, "freeform");
	mkdirSync(scratch, { recursive: true });
	const binary = path.join(scratch, "ceal-linux-amd64");
	writeFileSync(binary, BINARY_BYTES);
	chmodSync(binary, 0o755);
	writeFileSync(path.join(scratch, "ceal-worker-release-manifest-linux-amd64.json"), JSON.stringify(staged.manifest));
	writeFileSync(path.join(scratch, "SHA256SUMS"), `${sha256(BINARY_BYTES)}  ceal-linux-amd64\n`);
	assert.throws(() => inspectInstalledRelease(binary), code("managed_install_required"));
	assert.deepEqual(readInstalledReleaseFacts(binary), {
		ok: false,
		code: "managed_install_required",
		message: "The running binary is not the current generation of a verified managed worker installation.",
	});
});

test("managed-shaped scratch must match the installer generation identity and public command link", (context) => {
	const root = scratchDir(context, "ceal-acceptance-");
	const wrongGeneration = stageInstall(path.join(root, "wrong-generation"), { generationDigest: "0".repeat(64) });
	assert.throws(() => inspectInstalledRelease(wrongGeneration.binary), code("managed_install_required"));
	assert.equal(readInstalledReleaseFacts(wrongGeneration.binary).ok, false);

	const missingLink = stageInstall(path.join(root, "missing-link"), { commandLink: false });
	assert.throws(() => inspectInstalledRelease(missingLink.binary), code("managed_install_required"));
	assert.equal(readInstalledReleaseFacts(missingLink.binary).ok, false);
});

// `@corca-ai/ceal-protocol@0.65.0` has been observed with three different byte
// sets, so a version string names no particular artifact. The producer commit
// and tree are what make the input immutable.
test("a protocol input named by version alone, or by a source path, is refused", (context) => {
	const root = scratchDir(context, "ceal-acceptance-");
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
	const root = scratchDir(context, "ceal-acceptance-");
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

// A manifest of some other shape is refused rather than read field by field:
// the fields this command quotes only mean what it says they mean under the
// schema it names.
test("a release manifest of an unknown schema is refused before any field is read", (context) => {
	const root = scratchDir(context, "ceal-acceptance-");
	const { binary } = stageInstall(root, { manifest: { schema_version: "ceal.worker_release_manifest.v2" } });
	assert.throws(() => inspectInstalledRelease(binary), code("release_manifest_schema"));
});

// A stub that answers the five routes the packet actually runs, in the shape it
// actually parses: the command reads a handful of scalars out of the CLI's YAML
// with a regex, deliberately not a parser, so the fixture has to be text rather
// than a structure. `$1 $2` because the packet distinguishes `guide status` from
// `receipt show`, and a stub keyed on `$1` alone would let those two collapse.
function stubBinary({ discoveryStatus = 0 } = {}) {
	return `#!/bin/sh
case "$1 $2" in
  "version ") echo "version: 0.66.1"; echo "protocol_version: 0.65.0" ;;
  "guide status") echo "status: registered"; echo "  registration_path: /home/fixture/.claude/skills/ceal-guide"; echo "  registration_path: /home/fixture/.codex/skills/ceal-guide" ;;
  "capabilities --fresh")
    echo "instance_ref: instance:fixture"
    echo "profile_ref: profile:fixture"
    echo "negotiated_protocol_version: 0.65.0"
    echo "host_decision: allow"
    echo "catalog_source: gateway"
    echo "live_gateway_checked: true"
    echo "  - capability_id: message.search"
    echo "  - capability_id: message.post"
    exit ${discoveryStatus} ;;
  "call message.search")
    echo "status: completed"
    echo "evidence: receipt"
    echo "request_ref: request:fixture" ;;
  "receipt show")
    echo "status: readback_complete"
    echo "gateway_audit_readback: verified"
    echo "provider_state_readback: not_established"
    echo "outcome: succeeded"
    echo "authorization: granted"
    echo "gateway_elapsed_ms: 42"
    echo "  - ref: audit:one"
    echo "  - ref: audit:two" ;;
esac
exit 0
`;
}

// The real lock, read rather than restated: `buildAcceptancePacket` compares the
// manifest's producer against the repo's own lock, so a hand-copied commit here
// would be a fixture agreeing with itself.
function lockedProducer(repoRoot = CONTRACT_REPO.root) {
	const gateway = JSON.parse(readFileSync(path.join(repoRoot, "gateway-protocol-handoff-lock.json"), "utf8")).gateway;
	return { repository: gateway.repository, commit: gateway.commit, tree: gateway.tree };
}

// An install the command will actually describe rather than refuse: a binary
// that answers, and a producer the repo's lock agrees with. `stageInstall` stays
// the low-level fixture because the refusal tests above need to break exactly
// one of those two properties at a time.
function stageWorkingInstall(root, options = {}, repoRoot = CONTRACT_REPO.root) {
	return stageInstall(root, {
		binaryBytes: stubBinary(options),
		manifest: {
			protocol: { package: "@corca-ai/ceal-protocol", version: "0.65.0", sha256: "a".repeat(64), producer: lockedProducer(repoRoot) },
		},
	});
}

// Packet semantics are contract behavior, not a claim that the live checkout
// is release-ready. A real scratch Git checkout supplies a converged pin so the
// production guard runs and the behavior after it remains reachable while the
// live checkout is deliberately quarantined.
test("the packet describes the install it measured, and its non-claims follow what the run reached", async (context) => {
	const root = scratchDir(context, "ceal-acceptance-");
	const { binary, directory } = stageWorkingInstall(root);
	const packet = await buildContractAcceptancePacket({ binary });

	assert.equal(packet.schema_version, "ceal.worker_acceptance_packet.v1");
	assert.equal(packet.installed_client.binary_path, binary);
	assert.equal(packet.installed_client.platform, "linux-amd64");
	assert.equal(packet.installed_client.release_version, "0.66.1");
	// Read out of the binary's own output, not copied from the manifest: these
	// two rows are what makes the packet a measurement rather than a restatement.
	assert.equal(packet.installed_client.reported_version, "0.66.1");
	assert.equal(packet.installed_client.client_protocol_version, "0.65.0");
	assert.equal(packet.installed_client.manifest, path.basename(path.join(directory, "ceal-worker-release-manifest-linux-amd64.json")));

	assert.equal(packet.gateway_protocol_input.lock_agreement.commit_matches, true);
	assert.equal(packet.gateway_protocol_input.lock_agreement.tree_matches, true);

	assert.equal(packet.guide.status, "registered");
	assert.equal(packet.guide.exit_code, 0);
	// A resolved host path is not a registration: `hostStates` gives a `staged`
	// host one too. The count must follow `registered`, which this fixture leaves
	// false on both hosts.
	assert.equal(packet.guide.resolved_host_paths.length, 2);
	assert.equal(packet.guide.registered_host_count, 0);

	assert.equal(packet.gateway_session.reached, true);
	assert.equal(packet.gateway_session.instance_ref, "instance:fixture");
	assert.equal(packet.gateway_session.host_decision, "allow");
	assert.equal(packet.gateway_session.live_gateway_checked, true);
	assert.equal(packet.gateway_session.capability_count, 2);

	// No --capability/--target, so the provider row must be absent AND said so.
	assert.equal(packet.bounded_capability_call, null);
	assert.ok(packet.non_claims.some((claim) => claim.startsWith("provider_execution_not_reached:")));
	assert.ok(!packet.non_claims.some((claim) => claim.startsWith("gateway_session_not_reached:")));
	assert.ok(packet.non_claims.some((claim) => claim.includes("Only linux-amd64 is evidenced")));
	// The artifact_state claim exists to stop a reader concluding the installed
	// binary is unsigned; it must not disappear quietly.
	assert.ok(packet.non_claims.some((claim) => claim.includes("before signing")));
});

test("a bounded call adds the provider row and its receipt readback, and drops that non-claim", async (context) => {
	const root = scratchDir(context, "ceal-acceptance-");
	const { binary } = stageWorkingInstall(root);
	const packet = await buildMessageSearchAcceptancePacket(binary);

	assert.equal(packet.bounded_capability_call.capability, "message.search");
	assert.equal(packet.bounded_capability_call.status, "completed");
	assert.equal(packet.bounded_capability_call.evidence, "receipt");
	assert.equal(packet.bounded_capability_call.request_ref, "request:fixture");
	// The receipt is a SECOND invocation keyed on the request_ref the call
	// returned. Without it the packet would be quoting the call's own report of
	// itself, which is the substitution this row exists to avoid.
	assert.equal(packet.bounded_capability_call.receipt.readback_status, "readback_complete");
	assert.equal(packet.bounded_capability_call.receipt.gateway_audit_readback, "verified");
	assert.equal(packet.bounded_capability_call.receipt.provider_state_readback, "not_established");
	assert.equal(packet.bounded_capability_call.receipt.authorization, "granted");
	assert.equal(packet.bounded_capability_call.receipt.gateway_elapsed_ms, 42);
	assert.deepEqual(packet.bounded_capability_call.receipt.audit_refs, ["audit:one", "audit:two"]);
	assert.ok(!packet.non_claims.some((claim) => claim.startsWith("provider_execution_not_reached:")));
});

// A discovery that exits non-zero is not a failure of the command — it is a row
// the packet must report as unreached and then say so, rather than omitting.
test("an unreached Gateway session is recorded and named in the non-claims", async (context) => {
	const root = scratchDir(context, "ceal-acceptance-");
	const { binary } = stageWorkingInstall(root, { discoveryStatus: 3 });
	const packet = await buildContractAcceptancePacket({ binary });
	assert.equal(packet.gateway_session.reached, false);
	assert.equal(packet.gateway_session.exit_code, 3);
	assert.ok(packet.non_claims.some((claim) => claim.startsWith("gateway_session_not_reached:")));
});

test("a binary that cannot answer 'version' is refused rather than described", async (context) => {
	const root = scratchDir(context, "ceal-acceptance-");
	const { binary } = stageInstall(root, {
		binaryBytes: "#!/bin/sh\nexit 9\n",
		manifest: { protocol: { package: "@corca-ai/ceal-protocol", version: "0.65.0", sha256: "a".repeat(64), producer: lockedProducer() } },
	});
	await assert.rejects(() => buildContractAcceptancePacket({ binary }), code("installed_binary_unusable"));
});

test("acceptance reaches the protocol ship guard before resolving an installed binary", async () => {
	await assert.rejects(
		() => buildAcceptancePacket({ repoRoot: DIVERGED_REPO.root, binary: path.join(DIVERGED_REPO.root, "absent") }),
		code("proof_shipment_protocol_divergence"),
	);
});

test("installed command execution refuses a child that ignores TERM and a child that floods output", async (context) => {
	const root = scratchDir(context, "ceal-acceptance-");
	const hanging = path.join(root, "hanging");
	writeFileSync(hanging, "#!/bin/sh\ntrap '' TERM\nwhile :; do sleep 1; done\n");
	chmodSync(hanging, 0o755);
	await assert.rejects(
		() =>
			runInstalledCommand(hanging, ["version"], {
				timeoutMs: 20,
				terminationGraceMs: 20,
				postKillReportMs: 20,
				postExitDrainMs: 5,
			}),
		code("installed_binary_timeout"),
	);

	const flooding = path.join(root, "flooding");
	writeFileSync(flooding, "#!/bin/sh\nwhile :; do printf '0123456789abcdef'; done\n");
	chmodSync(flooding, 0o755);
	await assert.rejects(
		() => runInstalledCommand(flooding, ["version"], { maxCapturedOutputBytes: 64, postKillReportMs: 20 }),
		code("installed_binary_output_too_large"),
	);

	const signaled = path.join(root, "signaled");
	writeFileSync(signaled, "#!/bin/sh\nkill -KILL $$\n");
	chmodSync(signaled, 0o755);
	await assert.rejects(
		() => runInstalledCommand(signaled, ["call", "message.search"], { postExitDrainMs: 5 }),
		(error) => code("installed_binary_failed")(error) && /provider outcome may be unknown/u.test(error.message),
	);
	await assert.rejects(
		() => runInstalledCommand(path.join(root, "missing"), ["version"], { postExitDrainMs: 5 }),
		code("installed_binary_failed"),
	);
});

test("installed command execution uses the caller environment without CI credential surfaces", async (context) => {
	const root = scratchDir(context, "ceal-acceptance-env-");
	const binary = path.join(root, "environment");
	writeFileSync(
		binary,
		`#!/bin/sh
printf '{"home":"%s","oidc":"%s","github":"%s","cloudflare":"%s"}' "$HOME" "\${ACTIONS_ID_TOKEN_REQUEST_TOKEN-}" "\${GITHUB_TOKEN-}" "\${CLOUDFLARE_API_TOKEN-}"
`,
	);
	chmodSync(binary, 0o755);
	const result = await runInstalledCommand(binary, ["version"], {
		env: {
			...process.env,
			HOME: path.join(root, "selected-home"),
			ACTIONS_ID_TOKEN_REQUEST_TOKEN: "must-not-leak",
			GITHUB_TOKEN: "must-not-leak",
			CLOUDFLARE_API_TOKEN: "must-not-leak",
		},
	});
	assert.deepEqual(JSON.parse(result.stdout), {
		home: path.join(root, "selected-home"),
		oidc: "",
		github: "",
		cloudflare: "",
	});
});

// The CLI entry, run as the process it really is. `parseArgs` and `render` have
// no other caller, and exporting them to reach in-process would prove a surface
// no operator uses. The child inherits NODE_V8_COVERAGE, so this counts.
function runCli(args, options = {}) {
	return runCliAt(path.join(CONTRACT_REPO.root, "scripts", "worker-acceptance-packet.mjs"), args, options);
}

function runCliAt(script, args, options = {}) {
	return spawnSync(process.execPath, [script, ...args], {
		encoding: "utf8",
		...options,
	});
}

test("the CLI renders a human packet, emits JSON on request, and refuses malformed argv", (context) => {
	const root = scratchDir(context, "ceal-acceptance-");
	const { binary } = stageWorkingInstall(root);
	const linkedCli = path.join(root, "worker-acceptance-linked.mjs");
	symlinkSync(path.join(CONTRACT_REPO.root, "scripts", "worker-acceptance-packet.mjs"), linkedCli);

	const rendered = runCli(["--binary", binary]);
	assert.equal(rendered.status, 0, rendered.stderr);
	assert.match(rendered.stdout, /^installed: {2}0[.]66[.]1 linux-amd64 {2}[0-9a-f]{64}$/mu);
	assert.match(rendered.stdout, /^ {12}digests agree: bytes = manifest = SHA256SUMS$/mu);
	assert.match(rendered.stdout, /^guide: {6}registered \(0 registered of 2 resolved hosts\)$/mu);
	assert.match(rendered.stdout, /^gateway: {4}instance:fixture protocol 0[.]65[.]0 allow in \d+ms$/mu);
	assert.match(rendered.stdout, /^call: {7}not requested$/mu);
	assert.match(rendered.stdout, /^non_claims:$/mu);
	const canonicalized = runCliAt(linkedCli, ["--binary", binary]);
	assert.equal(canonicalized.status, 0, canonicalized.stderr);
	assert.match(canonicalized.stdout, /^installed: {2}0[.]66[.]1 linux-amd64 {2}[0-9a-f]{64}$/mu);

	// The call and receipt lines are a separate rendering branch, and the branch
	// that prints "not requested" above cannot reach them.
	const called = runCli(["--binary", binary, "--capability", "message.search", "--target", `target:${"a".repeat(64)}`]);
	assert.equal(called.status, 0, called.stderr);
	assert.match(called.stdout, /^call: {7}message[.]search -> completed \(receipt\) in \d+ms$/mu);
	assert.match(called.stdout, /^ {12}request:fixture$/mu);
	assert.match(
		called.stdout,
		/^receipt: {4}readback_complete audit=verified provider=not_established granted\/succeeded audit:one, audit:two$/mu,
	);

	const json = runCli(["--binary", binary, "--json"]);
	assert.equal(json.status, 0, json.stderr);
	assert.equal(JSON.parse(json.stdout).schema_version, "ceal.worker_acceptance_packet.v1");

	// --sanitized implies --json: the external record exists to be written to a
	// file another lane reads by digest, not to be eyeballed.
	const sanitized = runCli(["--binary", binary, "--sanitized"]);
	assert.equal(sanitized.status, 0, sanitized.stderr);
	const record = JSON.parse(sanitized.stdout);
	assert.equal(record.schema_version, "ceal.worker_acceptance_result.v2");
	assert.doesNotMatch(sanitized.stdout, new RegExp(root.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
	assert.equal(record.bounded_capability_call, null);

	// The record projects the provider row through its own allow-list, which is a
	// different branch from projecting its absence — and the one that would leak
	// a host-local path if the allow-list were widened by accident.
	const sanitizedCall = runCli([
		"--binary",
		binary,
		"--sanitized",
		"--capability",
		"message.search",
		"--target",
		`target:${"a".repeat(64)}`,
	]);
	assert.equal(sanitizedCall.status, 0, sanitizedCall.stderr);
	const calledRecord = JSON.parse(sanitizedCall.stdout);
	assert.equal(calledRecord.bounded_capability_call.request_ref, "request:fixture");
	assert.deepEqual(calledRecord.bounded_capability_call.receipt.audit_refs, ["audit:one", "audit:two"]);
	assert.doesNotMatch(sanitizedCall.stdout, new RegExp(root.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));

	for (const [argv, expected] of [
		[["--nope"], "unknown_argument"],
		[["--binary"], "missing_argument_value"],
		[["--capability", "message.search"], "incomplete_call_request"],
		[["--target", "target:x"], "incomplete_call_request"],
	]) {
		const refused = runCli(argv);
		assert.notEqual(refused.status, 0, `${argv.join(" ")} must be refused`);
		assert.match(refused.stderr + refused.stdout, new RegExp(expected, "u"));
	}
});

// A call whose stdout carries no request_ref must leave the receipt null rather
// than inventing one — the packet would otherwise claim a readback it never ran.
test("a call with no request_ref leaves the receipt unclaimed", async (context) => {
	const root = scratchDir(context, "ceal-acceptance-");
	const { binary } = stageInstall(root, {
		binaryBytes:
			'#!/bin/sh\ncase "$1 $2" in\n  "version ") echo "version: 0.66.1" ;;\n  "call message.search") echo "status: refused" ;;\nesac\nexit 0\n',
		manifest: { protocol: { package: "@corca-ai/ceal-protocol", version: "0.65.0", sha256: "a".repeat(64), producer: lockedProducer() } },
	});
	const packet = await buildMessageSearchAcceptancePacket(binary);
	assert.equal(packet.bounded_capability_call.status, "refused");
	assert.equal(packet.bounded_capability_call.request_ref, null);
	assert.equal(packet.bounded_capability_call.receipt, null);
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
		guide: {
			status: "registered",
			exit_code: 0,
			resolved_host_paths: ["/home/someone/.claude/skills", "/home/someone/.codex/skills"],
			registered_host_count: 2,
		},
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
	assert.equal(Object.hasOwn(record.guide, "resolved_host_paths"), false);
	// The count is the evidence; the paths were the leak.
	assert.equal(record.guide.registered_host_count, 2);

	// Gateway-issued identifiers are returned to the Gateway that issued them.
	assert.equal(record.gateway_session.instance_ref, "instance:corca");
	assert.equal(record.gateway_session.profile_ref, "profile:narnia");

	// The evidence the record exists to carry survives intact.
	assert.equal(record.installed_client.artifact_sha256, packet.installed_client.artifact_sha256);
	assert.equal(record.installed_client.digest_agreement, packet.installed_client.digest_agreement);
	assert.deepEqual(record.gateway_protocol_input, packet.gateway_protocol_input);
	assert.equal(record.schema_version, "ceal.worker_acceptance_result.v2");
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

// Two emitters answer `ceal.worker_acceptance_result`, and they cannot share an
// implementation — one decodes Gateway events, the other reads the installed
// binary's rendered stdout. So the field lists live in acceptance-record.ts and
// this test is what binds the script to them. Without it the two drifted into
// different field sets under one schema version, which is what docs/debt.md
// recorded and what a consumer of the record could not have detected.
test("the checkout emitter answers the record schema with exactly its declared key sets", () => {
	const packet = packetFixture();
	// Fields the emitter was never told to emit are handed in on every nested
	// object. An allow-list that copies its input by reference passes a key-set
	// comparison against the fixture it was given, which is how the first cut of
	// this test asserted nothing about the receipt row: it compared the emitter's
	// output to the very object it had just handed the emitter.
	packet.guide.registered_hosts = ["/home/someone/.claude/skills"];
	packet.gateway_session.raw_access_token = "ceal_personal_secret";
	packet.bounded_capability_call = {
		capability: "message.search",
		target: `target:${"a".repeat(8)}`,
		status: "succeeded",
		exit_code: 0,
		elapsed_ms: 12,
		evidence: "audited_call",
		request_ref: "ceal:fixture:call",
		operator_home: "/home/someone",
		receipt: {
			readback_status: "verified",
			gateway_audit_readback: "verified",
			provider_state_readback: "not_established",
			outcome: "succeeded",
			authorization: "allowed",
			audit_refs: ["gateway-audit:fixture"],
			gateway_elapsed_ms: 7,
			exit_code: 0,
			elapsed_ms: 4,
			membership_ref: "membership:someone",
			subject_ref: "subject:someone",
			events: [{ subject_ref: "subject:someone" }],
		},
	};
	const record = sanitizedAcceptanceRecord(packet);
	const sorted = (value) => [...value].sort();
	assert.deepEqual(Object.keys(record).sort(), sorted(CEAL_ACCEPTANCE_TOP_LEVEL_KEYS));
	assert.deepEqual(Object.keys(record.guide).sort(), sorted(CEAL_ACCEPTANCE_GUIDE_KEYS));
	assert.deepEqual(Object.keys(record.gateway_session).sort(), sorted(CEAL_ACCEPTANCE_SESSION_KEYS));
	assert.deepEqual(Object.keys(record.bounded_capability_call).sort(), sorted(CEAL_ACCEPTANCE_BOUNDED_CALL_KEYS));
	assert.deepEqual(Object.keys(record.bounded_capability_call.receipt).sort(), sorted(CEAL_ACCEPTANCE_RECEIPT_KEYS));
	assert.doesNotMatch(JSON.stringify(record), /membership_ref|subject_ref|operator_home|raw_access_token|registered_hosts|"events"/u);
	// Positive control: the evidence each row exists to carry did survive.
	assert.equal(record.bounded_capability_call.request_ref, "ceal:fixture:call");
	assert.deepEqual(record.bounded_capability_call.receipt.audit_refs, ["gateway-audit:fixture"]);
	// The shipped guide tells a reader to branch on `ok`; both emitters answer it.
	assert.equal(record.ok, true);
	assert.equal(record.command, "ceal");
	assert.equal(record.status, "emitted");
	assert.equal(record.emitted_by, "source_checkout");
});

test("the checkout emitter keeps every declared receipt key when readback reports no fields", () => {
	const packet = packetFixture();
	packet.bounded_capability_call = {
		capability: "message.search",
		target: "target:aaaaaaaa",
		status: "error",
		exit_code: 3,
		elapsed_ms: 12,
		evidence: "outcome_unknown",
		request_ref: "ceal:fixture:call",
		receipt: { exit_code: 3, elapsed_ms: 4 },
	};
	const receipt = sanitizedAcceptanceRecord(packet).bounded_capability_call.receipt;
	assert.deepEqual(Object.keys(receipt).sort(), [...CEAL_ACCEPTANCE_RECEIPT_KEYS].sort());
	for (const key of CEAL_ACCEPTANCE_RECEIPT_KEYS) {
		if (key !== "exit_code" && key !== "elapsed_ms") assert.equal(receipt[key], null, `${key} must remain explicit`);
	}
	assert.deepEqual(JSON.parse(JSON.stringify(receipt)), receipt, "JSON serialization must not drop an undefined key");
});

// The two emitters cannot share an implementation, so this is what makes "one
// schema, one key set" true rather than asserted. It compares two live outputs,
// not either one against a list, so a key added to one alone turns it red.
test("both emitters answer the record schema with the same key sets", async () => {
	const { buildAcceptanceRecord } = await import("../../packages/ceal-worker-cli/dist/acceptance-record.js");
	const installed = buildAcceptanceRecord({
		release: {
			platform: "linux-amd64",
			release_version: "0.75.0",
			artifact_sha256: "a".repeat(64),
			artifact_state: "signed",
			manifest: "ceal-worker-release-manifest-linux-amd64.json",
			digest_agreement: "binary_bytes_manifest_and_sha256sums_agree",
			protocol: {},
		},
		reportedVersion: "0.75.0",
		clientProtocolVersion: "1.3.0",
		guide: { status: "available", registered_host_count: 1 },
		session: {
			instance_ref: "instance:x",
			profile_ref: "profile:x",
			negotiated_protocol_version: "1.3.0",
			host_decision: "accepted",
			catalog_source: "live_discovery",
			capability_count: 1,
			elapsed_ms: 1,
		},
		boundedCall: {
			capability: null,
			target: null,
			status: "verified",
			exit_code: null,
			elapsed_ms: null,
			evidence: null,
			request_ref: "ceal:x:call",
			receipt: {
				readback_status: "verified",
				gateway_audit_readback: "verified",
				provider_state_readback: "not_established",
				outcome: "succeeded",
				authorization: "allowed",
				audit_refs: [],
				gateway_elapsed_ms: null,
			},
		},
	});
	const packet = packetFixture();
	packet.bounded_capability_call = {
		capability: "message.search",
		target: "target:aaaaaaaa",
		status: "succeeded",
		exit_code: 0,
		elapsed_ms: 12,
		evidence: "audited_call",
		request_ref: "ceal:fixture:call",
		receipt: {
			readback_status: "verified",
			gateway_audit_readback: "verified",
			provider_state_readback: "not_established",
			outcome: "succeeded",
			authorization: "allowed",
			audit_refs: [],
			gateway_elapsed_ms: 7,
			exit_code: 0,
			elapsed_ms: 4,
		},
	};
	const checkout = sanitizedAcceptanceRecord(packet);
	assert.equal(installed.schema_version, checkout.schema_version);
	const keys = (value) => Object.keys(value).sort();
	assert.deepEqual(keys(installed), keys(checkout));
	assert.deepEqual(keys(installed.guide), keys(checkout.guide));
	assert.deepEqual(keys(installed.gateway_session), keys(checkout.gateway_session));
	assert.deepEqual(keys(installed.bounded_capability_call), keys(checkout.bounded_capability_call));
	assert.deepEqual(keys(installed.bounded_capability_call.receipt), keys(checkout.bounded_capability_call.receipt));
	// `emitted_by` is the key that must NOT agree in value; it is what tells the
	// two documents apart for a reader holding both.
	assert.notEqual(installed.emitted_by, checkout.emitted_by);
});

// A legacy acceptance record carried `membership_ref` and `subject_ref` because
// the installed emitter shipped the
// decoded Gateway audit event whole. Neither emitter's key list admits them now,
// and this asserts the property rather than re-listing the forbidden names in a
// second place: an identity ref can only arrive inside a key nobody declared.
test("no bounded-call key admits a Gateway identity ref", () => {
	const forbidden = ["membership_ref", "subject_ref", "registration_ref", "client_ref", "grant_snapshot", "events"];
	for (const name of forbidden) {
		assert.equal(CEAL_ACCEPTANCE_BOUNDED_CALL_KEYS.includes(name), false, `${name} is declared on the bounded-call row`);
		assert.equal(CEAL_ACCEPTANCE_RECEIPT_KEYS.includes(name), false, `${name} is declared on the receipt row`);
	}
	// Positive control: the lists are not empty and do declare what they should.
	assert.equal(CEAL_ACCEPTANCE_BOUNDED_CALL_KEYS.includes("request_ref"), true);
	assert.equal(CEAL_ACCEPTANCE_RECEIPT_KEYS.includes("audit_refs"), true);
});
