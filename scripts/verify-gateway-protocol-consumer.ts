#!/usr/bin/env node

import { isJsonRecord } from "../packages/ceal-worker-cli/src/json-record.ts";
import { sha256 } from "../packages/ceal-worker-cli/src/sha256.ts";
import { codedErrorClass } from "./lib/coded-error.ts";
import { isGitObject } from "./lib/git-object.ts";
import { type NpmPackMetadata, parseNpmPackMetadata } from "./lib/npm-pack-metadata.ts";
import { createSkillDirectoryBundle } from "./lib/skill-directory-bundle.ts";
import { isStringArray } from "./lib/string-array.ts";
import { toolchainEnv } from "./lib/toolchain-env.ts";
import { execFileSync, spawnSync,type SpawnSyncReturns } from "node:child_process";
import {
	cpSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

type PackageManifest = {
	name?: unknown;
	version?: unknown;
	repository?: { url?: unknown; directory?: unknown };
	publishConfig?: { access?: unknown };
	exports?: object;
	dependencies?: object;
	devDependencies?: object;
	optionalDependencies?: object;
	peerDependencies?: object;
};
type ProtocolProvenance = {
	schema_version: string;
	source: { repository: string; commit: string; tree: string; package_path: string };
	artifact: { package: string; version: string; sha256: string; npm_integrity: string; exports: string[] };
};
type ArtifactInput = { tarball: string; provenancePath: string; provenance: ProtocolProvenance; sha256: string; manifest: PackageManifest };
type ReleasePackage = { path: string; name: string };
type ReleaseInputs = {
	packages: { client: ReleasePackage; worker: ReleasePackage };
	guide: string;
	installer: string;
	protocol: { package: string; input: string; version: string };
};
type PackedArtifact = { path: string; sha256: string };
type ClientStage = { source: string; tarball: PackedArtifact; protocol: InstalledProtocol; version: string };
type WorkerStage = { source: string; tarball: PackedArtifact; protocol: InstalledProtocol };
type InstalledProtocol = { package_root: string; lock: { resolved: string; integrity: string } };
type B1Result = {
	decode_generation: "additive-v1";
	unknown_response_keys: "removed";
	authority_keys: "refused";
	closed_enums: "refused";
	undeclared_authority_refs: "refused";
	undeclared_capability_sequence: "relayed_then_known";
};
type ConsumerResult = {
	protocol_tarball_sha256: string;
	protocol_lock: InstalledProtocol["lock"];
	protocol_resolution: string;
	client_tarball_sha256: string;
	worker_tarball_sha256: string;
	worker_commands_schema: "ceal.commands.v1";
	b1: B1Result;
};
type VerificationResult = {
	schema_version: "ceal.gateway_protocol_packed_consumer_proof.v1";
	ok: true;
	proof_level: "local_integration";
	writes_external: false;
	gateway_protocol: ProtocolProvenance;
	worker_source: {
		repository: string;
		baseline_commit: string;
		baseline_tree: string;
		state: "committed" | "working_tree";
		non_claim: string;
	};
	worker_release_inputs: ReleaseInputs & { guide_sha256: string; installer_sha256: string };
	consumer: ConsumerResult;
	non_claims: string[];
	workspace: string | null;
};
export type GatewayProtocolConsumerOptions = {
	repoRoot?: string | undefined;
	protocolTarball?: string | undefined;
	protocolProvenance?: string | undefined;
	keepWorkspace?: boolean | undefined;
};
type ParsedArguments = { help: true } | { options: GatewayProtocolConsumerOptions };
type SpawnResult = SpawnSyncReturns<string>;

function property(value: object, key: string): unknown {
	return Object.hasOwn(value, key) ? Reflect.get(value, key) : undefined;
}
function isString(value: unknown): value is string {
	return typeof value === "string";
}
function objectProperty(value: unknown, key: string): unknown {
	return isJsonRecord(value) ? property(value, key) : undefined;
}
function packageManifest(value: unknown): PackageManifest {
	return isJsonRecord(value) ? value : {};
}
function objectString(value: unknown, key: string): string | undefined {
	const item = objectProperty(value, key);
	return isString(item) ? item : undefined;
}
function objectObject(value: unknown, key: string): object | undefined {
	const item = objectProperty(value, key);
	return isJsonRecord(item) ? item : undefined;
}

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROTOCOL_NAME = "@corca-ai/ceal-protocol";
const CLIENT_NAME = "@corca-ai/ceal";
const WORKER_NAME = "@corca-ai/ceal-worker-cli";
const GATEWAY_REPOSITORY = "corca-ai/ceal";

export const GatewayProtocolConsumerError = codedErrorClass("GatewayProtocolConsumerError", ["workspace"]);

export function verifyGatewayProtocolConsumer({
	repoRoot = REPO_ROOT,
	protocolTarball,
	protocolProvenance,
	keepWorkspace = false,
}: GatewayProtocolConsumerOptions = {}): VerificationResult {
	const root = path.resolve(repoRoot);
	const input = validateArtifactInput({ protocolTarball, protocolProvenance });
	const releaseInputs = validateReleaseInputs(root, input.provenance.artifact.version);
	// Canonicalize so lock/path comparisons agree on hosts where the temp root
	// sits behind a symlink (macOS /var -> /private/var).
	const workspace = realpathSync(mkdtempSync(path.join(tmpdir(), "ceal-gateway-protocol-consumer-")));
	try {
		const client = buildClient({ root, workspace, input, releaseInputs });
		const worker = buildWorker({ root, workspace, input, client, releaseInputs });
		const installed = installAndExerciseWorker({ workspace, input, client, worker });
		const result: VerificationResult = {
			schema_version: "ceal.gateway_protocol_packed_consumer_proof.v1",
			ok: true,
			proof_level: "local_integration",
			writes_external: false,
			gateway_protocol: input.provenance,
			worker_source: {
				repository: "corca-ai/ceal-cli",
				baseline_commit: git(root, ["rev-parse", "HEAD"]),
				baseline_tree: git(root, ["rev-parse", "HEAD^{tree}"]),
				state: git(root, ["status", "--porcelain=v1"]) === "" ? "committed" : "working_tree",
				non_claim:
					"The baseline identity does not bind working-tree package bytes; the packed artifact digests below bind the exercised outputs.",
			},
			worker_release_inputs: {
				...releaseInputs,
				guide_sha256: guideBundleSha256(path.join(root, releaseInputs.guide)),
				installer_sha256: sha256(readRegularFile(path.join(root, releaseInputs.installer), "invalid_worker_release_inputs")),
			},
			consumer: installed,
			non_claims: [
				"This proves a local packed artifact consumer only; it does not publish, sign, install, update, or roll back a release.",
				"This does not prove a Gateway host, policy, connector, provider, audit, or Narnia Stage 3 action.",
			],
			workspace: keepWorkspace ? workspace : null,
		};
		return result;
	} catch (error) {
		if (error instanceof GatewayProtocolConsumerError) {
			if (keepWorkspace) attachWorkspace(error, workspace);
			throw error;
		}
		throw new GatewayProtocolConsumerError(
			"consumer_verification_failed",
			"Gateway protocol packed-consumer verification failed.",
			keepWorkspace ? workspace : undefined,
		);
	} finally {
		// A full packed consumer contains nested npm installs and compiled package
		// trees. Keeping every successful or expected-negative gate workspace turns
		// a standing release proof into an unbounded disk leak. The existing explicit
		// debug flag is the only path that retains one.
		if (!keepWorkspace) rmSync(workspace, { recursive: true, force: true });
	}
}

function attachWorkspace(error: unknown, workspace: string): void {
	if (
		error instanceof GatewayProtocolConsumerError &&
		"workspace" in error &&
		(typeof error.workspace === "string" || error.workspace === null)
	)
		error.workspace ??= workspace;
}

function guideBundleSha256(directory: string): string {
	try {
		return createSkillDirectoryBundle(directory).sha256;
	} catch {
		throw new GatewayProtocolConsumerError("invalid_worker_release_inputs", "Worker guide directory is not a valid release bundle input.");
	}
}

// This used to call into `verify-worker-release-inputs.mjs`, which read a second
// inventory (`release/worker-inputs.json`) whose contents were pinned to a frozen
// constant in that script and restated again in its test — three hand-kept copies
// of one list, and a fourth in the live `worker-release-inputs.json` that the real
// release lane reads. Read the live inventory directly instead. The package
// identity, `private` flag, and exact-protocol-dependency claims that script also
// made are asserted in `test/contract/repo-gates.test.ts`, and the release lane
// enforces the version agreement in `scripts/worker-release-inputs.ts`.
function validateReleaseInputs(root: string, protocolVersion: string): ReleaseInputs {
	const inventory = readJson(path.join(root, "worker-release-inputs.json"), "invalid_worker_release_inputs");
	const client = {
		path: objectString(objectObject(inventory, "client") ?? {}, "source_path"),
		name: objectString(objectObject(inventory, "client") ?? {}, "package"),
	};
	const worker = {
		path: objectString(objectObject(inventory, "worker") ?? {}, "source_path"),
		name: objectString(objectObject(inventory, "worker") ?? {}, "package"),
	};
	const guide = objectString(objectObject(inventory, "guide") ?? {}, "source_path");
	if (!client.path || !client.name || !worker.path || !worker.name || !guide) {
		throw new GatewayProtocolConsumerError("invalid_worker_release_inputs", "Worker release inventory does not name the owned inputs.");
	}
	const clientPath = client.path;
	const clientName = client.name;
	const workerPath = worker.path;
	const workerName = worker.name;
	if (!isString(clientPath) || !isString(clientName) || !isString(workerPath) || !isString(workerName))
		throw new GatewayProtocolConsumerError("invalid_worker_release_inputs", "Worker release inventory does not name the owned inputs.");
	const clientInput = releasePackage(clientPath, clientName);
	const workerInput = releasePackage(workerPath, workerName);
	let releaseVersion: string | undefined;
	for (const input of [clientInput, workerInput]) {
		const manifest = packageManifest(readJson(path.join(root, input.path, "package.json"), "invalid_worker_release_inputs"));
		if (objectString(manifest, "name") !== input.name) {
			throw new GatewayProtocolConsumerError("invalid_worker_release_inputs", "Worker release input package identity is invalid.");
		}
		const version = objectString(manifest, "version");
		if (!isVersion(version)) {
			throw new GatewayProtocolConsumerError("invalid_worker_release_inputs", "Worker release package version is invalid.");
		}
		if (releaseVersion === undefined) releaseVersion = version;
		else if (releaseVersion !== version)
			throw new GatewayProtocolConsumerError("invalid_worker_release_inputs", "Worker release package versions must agree exactly.");
		// The consumer proof is about resolving *this* protocol version, so a
		// package declaring a different one would make the readback meaningless.
		if (objectString(objectObject(manifest, "dependencies") ?? {}, PROTOCOL_NAME) !== protocolVersion) {
			throw new GatewayProtocolConsumerError(
				"invalid_worker_release_inputs",
				"Worker release package does not declare the supplied Gateway protocol version exactly.",
			);
		}
	}
	return {
		packages: { client: clientInput, worker: workerInput },
		guide,
		installer: "install-ceal.sh",
		protocol: { package: PROTOCOL_NAME, input: "gateway_artifact_only", version: protocolVersion },
	};
}

function releasePackage(pathValue: string | undefined, nameValue: string | undefined): ReleasePackage {
	if (pathValue === undefined || nameValue === undefined)
		throw new GatewayProtocolConsumerError("invalid_worker_release_inputs", "Worker release inventory does not name the owned inputs.");
	return { path: pathValue, name: nameValue };
}

function validateArtifactInput({
	protocolTarball,
	protocolProvenance,
}: Pick<GatewayProtocolConsumerOptions, "protocolTarball" | "protocolProvenance">): ArtifactInput {
	const tarball = requireAbsoluteRegularFile(protocolTarball, "invalid_protocol_tarball");
	const provenancePath = requireAbsoluteRegularFile(protocolProvenance, "invalid_protocol_provenance");
	const provenance = readJson(provenancePath, "invalid_protocol_provenance");
	const bytes = readFileSync(tarball);
	if (!isProtocolProvenance(provenance) || provenance.artifact.sha256 !== sha256(bytes)) {
		throw new GatewayProtocolConsumerError("invalid_protocol_provenance", "Gateway protocol provenance does not bind this artifact.");
	}
	const manifest = readPackedManifest(tarball);
	if (
		objectString(manifest, "name") !== PROTOCOL_NAME ||
		objectString(manifest, "version") !== provenance.artifact.version ||
		objectString(objectObject(manifest, "repository") ?? {}, "url") !== "git+https://github.com/corca-ai/ceal.git" ||
		objectString(objectObject(manifest, "repository") ?? {}, "directory") !== "packages/ceal-protocol" ||
		objectString(objectObject(manifest, "publishConfig") ?? {}, "access") !== "public" ||
		JSON.stringify(Object.keys(objectObject(manifest, "exports") ?? {}).sort()) !== JSON.stringify(provenance.artifact.exports.slice().sort())
	) {
		throw new GatewayProtocolConsumerError("protocol_identity_mismatch", "Gateway protocol tarball metadata differs from its provenance.");
	}
	return { tarball, provenancePath, provenance, sha256: provenance.artifact.sha256, manifest };
}

function isProtocolProvenance(value: unknown): value is ProtocolProvenance {
	const source = objectObject(value, "source");
	const artifact = objectObject(value, "artifact");
	return (
		objectString(value, "schema_version") === "ceal.gateway_protocol_artifact.v1" &&
		objectString(source ?? {}, "repository") === GATEWAY_REPOSITORY &&
		isGitObject(objectString(source ?? {}, "commit")) &&
		isGitObject(objectString(source ?? {}, "tree")) &&
		objectString(source ?? {}, "package_path") === "packages/ceal-protocol" &&
		objectString(artifact ?? {}, "package") === PROTOCOL_NAME &&
		isVersion(objectString(artifact ?? {}, "version")) &&
		isString(objectString(artifact ?? {}, "sha256")) &&
		isSha512Integrity(objectString(artifact ?? {}, "npm_integrity")) &&
		isStringArray(property(artifact ?? {}, "exports"))
	);
}

function buildClient({
	root,
	workspace,
	input,
	releaseInputs,
}: {
	root: string;
	workspace: string;
	input: ArtifactInput;
	releaseInputs: ReleaseInputs;
}): ClientStage {
	const source = copySourcePackage(root, workspace, releaseInputs.packages.client.path);
	const manifest = packageManifest(readJson(path.join(source, "package.json"), "invalid_client_package"));
	const version = objectString(manifest, "version");
	if (!isVersion(version)) throw new GatewayProtocolConsumerError("invalid_client_package", "Client package version is invalid.");
	assertPublishedDependency(manifest, PROTOCOL_NAME, input.provenance.artifact.version, "invalid_client_package");
	setDependencies(source, { [PROTOCOL_NAME]: artifactSpecifier(input.tarball) });
	install(source, "client_install");
	const protocol = assertInstalledProtocol(source, input);
	run(source, "npm", ["run", "build"], "client_build");
	setDependencies(source, { [PROTOCOL_NAME]: input.provenance.artifact.version });
	const tarball = pack(source, path.join(workspace, "tarballs"), CLIENT_NAME, version, "client_pack");
	return { source, tarball, protocol, version };
}

function buildWorker({
	root,
	workspace,
	input,
	client,
	releaseInputs,
}: {
	root: string;
	workspace: string;
	input: ArtifactInput;
	client: ClientStage;
	releaseInputs: ReleaseInputs;
}): WorkerStage {
	const source = copySourcePackage(root, workspace, releaseInputs.packages.worker.path);
	const manifest = packageManifest(readJson(path.join(source, "package.json"), "invalid_worker_package"));
	const version = objectString(manifest, "version");
	if (!isVersion(version)) throw new GatewayProtocolConsumerError("invalid_worker_package", "Worker package version is invalid.");
	// The worker versions with the client, not with the pinned Gateway
	// protocol artifact: the protocol dependency alone must match the
	// supplied artifact exactly.
	assertPublishedDependency(manifest, PROTOCOL_NAME, input.provenance.artifact.version, "invalid_worker_package");
	assertPublishedDependency(manifest, CLIENT_NAME, client.version, "invalid_worker_package");
	setDependencies(source, {
		[PROTOCOL_NAME]: artifactSpecifier(input.tarball),
		[CLIENT_NAME]: artifactSpecifier(client.tarball.path),
	});
	install(source, "worker_install");
	const protocol = assertInstalledProtocol(source, input);
	assertInstalledPackage(source, CLIENT_NAME, "invalid_client_install");
	run(source, "npm", ["run", "build"], "worker_build");
	setDependencies(source, {
		[PROTOCOL_NAME]: input.provenance.artifact.version,
		[CLIENT_NAME]: client.version,
	});
	const tarball = pack(source, path.join(workspace, "tarballs"), WORKER_NAME, version, "worker_pack");
	return { source, tarball, protocol };
}

function installAndExerciseWorker({
	workspace,
	input,
	client,
	worker,
}: {
	workspace: string;
	input: ArtifactInput;
	client: ClientStage;
	worker: WorkerStage;
}): ConsumerResult {
	const consumer = path.join(workspace, "consumer");
	mkdirSync(consumer, { recursive: true, mode: 0o755 });
	writeFileSync(
		path.join(consumer, "package.json"),
		`${JSON.stringify({ name: "ceal-gateway-protocol-consumer", private: true, type: "module" })}\n`,
	);
	install(consumer, "consumer_install", [input.tarball, client.tarball.path, worker.tarball.path]);
	const protocol = assertInstalledProtocol(consumer, input);
	assertInstalledPackage(consumer, CLIENT_NAME, "invalid_client_install");
	assertInstalledPackage(consumer, WORKER_NAME, "invalid_worker_install");
	const bin = path.join(consumer, "node_modules", ".bin", "ceal");
	const commands = run(consumer, process.execPath, [bin, "commands"], "worker_commands");
	if (!/ceal[.]commands[.]v1/u.test(commands.stdout))
		throw new GatewayProtocolConsumerError("worker_smoke_failed", "Installed worker did not emit command discovery.");
	const resolution = run(
		consumer,
		process.execPath,
		["--input-type=module", "--eval", "console.log(import.meta.resolve('@corca-ai/ceal-protocol'))"],
		"protocol_resolution",
	).stdout.trim();
	const resolvedPath = filePathFromResolution(resolution);
	assertContainedRegularPath(consumer, resolvedPath, "escaped_protocol_resolution");
	if (!resolvedPath.includes(`${path.sep}node_modules${path.sep}`))
		throw new GatewayProtocolConsumerError("source_fallback", "Worker resolved protocol outside installed node_modules.");
	const b1Probe = path.join(consumer, "verify-b1-installed.mjs");
	const b1ProbeSource = B1_INSTALLED_CONSUMER_PROBE.replace("__CEAL_CLIENT_VERSION_JSON__", JSON.stringify(client.version));
	if (!B1_INSTALLED_CONSUMER_PROBE.includes("__CEAL_CLIENT_VERSION_JSON__") || b1ProbeSource.includes("__CEAL_CLIENT_VERSION_JSON__"))
		throw new GatewayProtocolConsumerError("worker_smoke_failed", "Installed B1 behavior proof did not receive the packed client version.");
	writeFileSync(b1Probe, b1ProbeSource);
	const b1Output = run(consumer, process.execPath, [b1Probe], "b1_installed_behavior").stdout;
	let b1: B1Result;
	try {
		b1 = decodeB1Result(JSON.parse(b1Output));
	} catch {
		throw new GatewayProtocolConsumerError("worker_smoke_failed", "Installed B1 behavior proof did not return valid JSON.");
	}
	if (b1.undeclared_authority_refs !== "refused")
		throw new GatewayProtocolConsumerError(
			"b1_authority_boundary_failed",
			"Installed Protocol admitted a named authority ref in undeclared capability arguments.",
		);
	if (
		b1.decode_generation !== "additive-v1" ||
		b1.unknown_response_keys !== "removed" ||
		b1.authority_keys !== "refused" ||
		b1.closed_enums !== "refused" ||
		b1.undeclared_capability_sequence !== "relayed_then_known"
	) {
		throw new GatewayProtocolConsumerError("worker_smoke_failed", "Installed B1 behavior proof did not satisfy its contract.");
	}
	return {
		protocol_tarball_sha256: input.sha256,
		protocol_lock: protocol.lock,
		protocol_resolution: resolvedPath,
		client_tarball_sha256: client.tarball.sha256,
		worker_tarball_sha256: worker.tarball.sha256,
		worker_commands_schema: "ceal.commands.v1",
		b1,
	};
}

export function decodeB1Result(value: unknown): B1Result {
	const keys = [
		"decode_generation",
		"unknown_response_keys",
		"authority_keys",
		"closed_enums",
		"undeclared_authority_refs",
		"undeclared_capability_sequence",
	];
	if (
		!isJsonRecord(value) ||
		Object.keys(value).length !== keys.length ||
		!keys.every((key) => Object.hasOwn(value, key)) ||
		objectString(value, "decode_generation") !== "additive-v1" ||
		objectString(value, "unknown_response_keys") !== "removed" ||
		objectString(value, "authority_keys") !== "refused" ||
		objectString(value, "closed_enums") !== "refused" ||
		objectString(value, "undeclared_authority_refs") !== "refused" ||
		objectString(value, "undeclared_capability_sequence") !== "relayed_then_known"
	)
		throw new GatewayProtocolConsumerError("worker_smoke_failed", "Installed B1 behavior proof did not return a closed valid result.");
	return {
		decode_generation: "additive-v1",
		unknown_response_keys: "removed",
		authority_keys: "refused",
		closed_enums: "refused",
		undeclared_authority_refs: "refused",
		undeclared_capability_sequence: "relayed_then_known",
	};
}

const B1_INSTALLED_CONSUMER_PROBE = String.raw`import {
	CealHttpTransportError,
	createCealClient,
	createCealHttpTransport,
} from "@corca-ai/ceal";
import {
	ADDITIVE_NON_AUTHORITY_RESPONSE_FIELDS,
	CEAL_GATEWAY_ADDITIVE_DECODE_GENERATION,
	CEAL_GATEWAY_DECODE_GENERATION_HEADER,
} from "@corca-ai/ceal-protocol";
import {
	openLeasedConsumerControlSession,
	runLeasedConsumerControlTransport,
} from "./node_modules/@corca-ai/ceal-worker-cli/dist/leased-consumer-control-session.js";

const encoder = new TextEncoder();
const request = {
	request_id: "request:packed:b1",
	operation: "handshake",
	profile_ref: "profile:packed",
	body: { client: { name: "packed-proof", version: __CEAL_CLIENT_VERSION_JSON__ } },
};
const handshake = () => ({
	ok: true,
	request_id: request.request_id,
	protocol_version: "1.4.0",
	proof_ref_or_unavailable: "proof:packed",
	value: {
		schema_version: "ceal.gateway_handshake.v1",
		negotiated_protocol_version: "1.4.0",
		supported_gateway_protocol_range: { minimum: "1.4.0", maximum: "1.4.0" },
		profile_ref: request.profile_ref,
		membership_ref: "membership:packed",
		registration_ref: "registration:packed",
		client_ref: "client:packed",
		subject_ref: "subject:packed",
		instance_ref: "instance:packed",
		host_decision: "accepted",
		proof_level: "host_decision",
		non_claims: ["provider_execution_not_reached", "production_audit_not_reached"],
	},
});
const transportFor = (response, capture) => createCealHttpTransport({
	endpoint: "https://gateway.example.test/client",
	accessToken: "packed-proof-token",
	fetchFn: async (_endpoint, init) => {
		if (capture) capture(init.headers);
		return Response.json(response, { status: response.ok ? 200 : 503 });
	},
});
const refusesInvalidResponse = async (response) => {
	try {
		await createCealClient(transportFor(response)).request(request);
		return false;
	} catch (error) {
		return error instanceof CealHttpTransportError && error.code === "invalid_response";
	}
};

let headers;
const benign = handshake();
benign.gateway_hint = "later envelope guidance";
benign.value.presentation_hint = "later handshake guidance";
const decoded = await createCealClient(transportFor(benign, (value) => { headers = value; })).request(request);
if (Object.hasOwn(decoded, "gateway_hint") || Object.hasOwn(decoded.value, "presentation_hint")) throw new Error("unknown_key_retained");
if (headers[CEAL_GATEWAY_DECODE_GENERATION_HEADER] !== CEAL_GATEWAY_ADDITIVE_DECODE_GENERATION) throw new Error("generation_missing");
for (const field of ["recovery", "rate_limit_policy", "profiles", "route_provenance"]) {
	if (headers[ADDITIVE_NON_AUTHORITY_RESPONSE_FIELDS[field].legacyAcceptHeader] !== "accept") throw new Error("legacy_header_missing");
}

const authority = handshake();
authority.grant_revision = 9;
if (!(await refusesInvalidResponse(authority))) throw new Error("authority_key_accepted");
const closedEnum = {
	ok: false,
	request_id: request.request_id,
	protocol_version: "1.4.0",
	error: { code: "unavailable", message: "Gateway is unavailable.", recovery: { kind: "retry_with_new_member" } },
};
if (!(await refusesInvalidResponse(closedEnum))) throw new Error("closed_enum_accepted");

const leaseInput = { event_ref: "event:packed", lease_ref: "lease:packed", lease_fence: 1 };
const unknownFrame = {
	schema_version: "ceal.leased_consumer_capability_control_request.v6",
	operation: "call",
	input: {
		...leaseInput,
		schema_version: "ceal.gateway_leased_consumer_call_request.v1",
		capability_id: "calendar.event.list",
		target_ref: "target:" + "a".repeat(64),
		purpose: "list bounded events",
		arguments: { schema_version: "ceal.calendar_event_list_input.v1", window: "week", event_ref: "event:" + "e".repeat(64) },
	},
};
const knownFrame = { schema_version: "ceal.leased_consumer_capability_control_request.v6", operation: "acquire", input: {} };
const unknownResponse = {
	schema_version: "ceal.leased_consumer_capability_control_response.v6",
	operation: "call",
	result: {
		status: "result",
		provider_outcome: "verified",
		result_delivery: "pending",
		result: {
			schema_version: "ceal.gateway_leased_agent_capability_result.v1",
			capability_id: "calendar.event.list",
			effect: "read",
			result_ref: "result:" + "a".repeat(64),
			handles: [],
			data: { entries: [{ label: "Planning" }], truncated: false },
		},
	},
};
const knownResponse = {
	schema_version: "ceal.leased_consumer_capability_control_response.v6",
	operation: "acquire",
	result: {
		status: "leased",
		lease: { ...leaseInput, delivery_attempt: 1, expires_at: "2026-08-11T09:00:00.000Z" },
	},
};
const openSession = (requestUnixSocket) => openLeasedConsumerControlSession({
	readProtectedSession: async () => encoder.encode(JSON.stringify({
		schema_version: "ceal.leased_consumer_control_session.v1",
		transport: "unix_socket",
		socket_path: "/run/user/1001/ceal/leased-consumer-control-v1.sock",
		service_credential: "private-service-credential",
	})),
	closeProtectedSession: async () => {},
	requestUnixSocket,
});
const session = await openSession(async (input) => {
		const frame = JSON.parse(input.body);
		const response = frame.input?.capability_id === "calendar.event.list" ? unknownResponse : knownResponse;
		return { status: 200, contentType: "application/json", bytes: encoder.encode(JSON.stringify(response)) };
});
async function* frames() {
	yield encoder.encode(JSON.stringify(unknownFrame) + "\n" + JSON.stringify(knownFrame) + "\n");
}
const output = [];
const clean = await runLeasedConsumerControlTransport(
	frames(),
	session,
	(frame) => output.push(JSON.parse(new TextDecoder().decode(frame))),
	undefined,
	async () => {},
);
if (!clean || output.length !== 2 || output[0].result.result.capability_id !== "calendar.event.list" || output[1].operation !== "acquire") {
	throw new Error("undeclared_sequence_failed");
}

let authorityRefsRefused = true;
for (const authorityRef of ["grant_ref", "policy_ref", "scope_ref", "role_ref"]) {
	let udsRequests = 0;
	const unsafeSession = await openSession(async () => {
		udsRequests += 1;
		return { status: 200, contentType: "application/json", bytes: encoder.encode(JSON.stringify(unknownResponse)) };
	});
	const unsafeFrame = structuredClone(unknownFrame);
	unsafeFrame.input.arguments = { [authorityRef]: authorityRef + ":admin" };
	async function* unsafeFrames() {
		yield encoder.encode(JSON.stringify(unsafeFrame) + "\n");
	}
	const unsafeOutput = [];
	const unsafeClean = await runLeasedConsumerControlTransport(
		unsafeFrames(),
		unsafeSession,
		(frame) => unsafeOutput.push(frame),
		undefined,
		async () => {},
	);
	if (unsafeClean || udsRequests !== 0 || unsafeOutput.length !== 0) authorityRefsRefused = false;
}

console.log(JSON.stringify({
	decode_generation: headers[CEAL_GATEWAY_DECODE_GENERATION_HEADER],
	unknown_response_keys: "removed",
	authority_keys: "refused",
	closed_enums: "refused",
	undeclared_authority_refs: authorityRefsRefused ? "refused" : "accepted",
	undeclared_capability_sequence: "relayed_then_known",
}));
`;

function copySourcePackage(root: string, workspace: string, sourcePath: string): string {
	const source = path.join(root, sourcePath);
	const destination = path.join(workspace, "sources", path.basename(sourcePath));
	cpSync(source, destination, {
		recursive: true,
		filter: (entry) => !["node_modules", "dist"].includes(path.basename(entry)),
	});
	if (existsSync(path.join(workspace, "sources", "ceal-protocol")))
		throw new GatewayProtocolConsumerError("source_fallback", "Isolated worker fixture must not contain protocol source.");
	assertNoProtocolFallbackSource(destination);
	return destination;
}

function assertNoProtocolFallbackSource(root: string): void {
	const manifest = readJson(path.join(root, "package.json"), "invalid_package_manifest");
	for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
		const rawDependencies = objectProperty(manifest, field);
		if (rawDependencies === undefined) continue;
		if (!isJsonRecord(rawDependencies)) {
			throw new GatewayProtocolConsumerError("source_fallback", `Worker package ${field} must be an object.`);
		}
		for (const name of Object.keys(rawDependencies)) {
			const value = objectString(rawDependencies, name);
			if (
				typeof value !== "string" ||
				value.startsWith("workspace:") ||
				(name === PROTOCOL_NAME && /(?:^|\/)(?:packages\/ceal-protocol|(?:src|dist)(?:\/|$))/u.test(value))
			) {
				throw new GatewayProtocolConsumerError(
					"source_fallback",
					"Worker package dependencies contain a workspace or Protocol source fallback.",
				);
			}
		}
	}
	for (const relative of ["src", "tsconfig.json", "tsconfig.build.json"]) {
		const target = path.join(root, relative);
		if (!existsSync(target)) continue;
		const files = regularFiles(target).filter((file) => {
			// Generated private contracts carry signed producer input paths as
			// provenance data; those literals are not module-resolution fallbacks.
			// The generated modules are verified separately before bundling.
			return relative !== "src" || path.relative(target, file).split(path.sep)[0] !== "generated";
		});
		for (const file of files) {
			const text = readFileSync(file, "utf8");
			if (/workspace:|packages\/ceal-protocol|@corca-ai\/ceal-protocol\/(?:src|dist)/u.test(text)) {
				throw new GatewayProtocolConsumerError(
					"source_fallback",
					"Worker source contains a protocol workspace, path, or undeclared-subpath fallback.",
				);
			}
		}
	}
}

function setDependencies(root: string, values: object): void {
	const file = path.join(root, "package.json");
	const manifest = packageManifest(readJson(file, "invalid_package_manifest"));
	const dependencies = objectObject(manifest, "dependencies") ?? {};
	manifest.dependencies = { ...dependencies, ...values };
	writeFileSync(file, `${JSON.stringify(manifest, null, "\t")}\n`);
}

function install(cwd: string, label: string, artifacts: string[] = []): void {
	run(cwd, "npm", ["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", ...artifacts], label);
}

function pack(cwd: string, destination: string, expectedName: string, expectedVersion: string, label: string): PackedArtifact {
	if (!existsSync(destination)) {
		const parent = path.dirname(destination);
		if (!existsSync(parent)) throw new GatewayProtocolConsumerError("invalid_workspace", "Consumer tarball directory parent is missing.");
		// npm owns the package archive; this directory contains only disposable proof output.
		mkdirSync(destination, { recursive: true, mode: 0o755 });
	}
	const result = run(cwd, "npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", destination], label);
	let metadata: NpmPackMetadata;
	try {
		metadata = parseNpmPackMetadata(JSON.parse(result.stdout));
	} catch {
		throw new GatewayProtocolConsumerError("invalid_pack_metadata", "Consumer package pack metadata is invalid.");
	}
	if (metadata.name !== expectedName || metadata.version !== expectedVersion)
		throw new GatewayProtocolConsumerError("invalid_pack_metadata", "Consumer package pack identity or version is invalid.");
	const artifact = path.join(destination, metadata.filename);
	return { path: artifact, sha256: sha256(readRegularFile(artifact, "invalid_pack_artifact")) };
}

function assertInstalledProtocol(root: string, input: ArtifactInput): InstalledProtocol {
	const packageRoot = assertInstalledPackage(root, PROTOCOL_NAME, "invalid_protocol_install");
	const manifest = readJson(path.join(packageRoot, "package.json"), "invalid_protocol_install");
	if (
		objectString(manifest, "name") !== PROTOCOL_NAME ||
		objectString(manifest, "version") !== input.provenance.artifact.version ||
		objectString(objectObject(manifest, "repository") ?? {}, "url") !== "git+https://github.com/corca-ai/ceal.git"
	) {
		throw new GatewayProtocolConsumerError("protocol_identity_mismatch", "Installed protocol does not match the Gateway artifact identity.");
	}
	const lock = readJson(path.join(root, "package-lock.json"), "invalid_protocol_lock");
	const entry = objectObject(objectProperty(lock, "packages"), `node_modules/${PROTOCOL_NAME}`);
	// npm records `resolved` against the canonicalized package root, so both
	// sides are realpath-compared; a mismatch still fails closed.
	if (
		objectProperty(entry, "link") === true ||
		!isString(objectProperty(entry, "integrity")) ||
		canonicalLockTarball(root, objectProperty(entry, "resolved")) !== realpathSync(input.tarball)
	) {
		throw new GatewayProtocolConsumerError(
			"protocol_lock_mismatch",
			"Installed protocol lock entry does not point to the supplied Gateway tarball.",
		);
	}
	const resolved = objectString(entry ?? {}, "resolved");
	const integrity = objectString(entry ?? {}, "integrity");
	if (resolved === undefined || integrity === undefined)
		throw new GatewayProtocolConsumerError("protocol_lock_mismatch", "Installed protocol lock entry is incomplete.");
	return { package_root: packageRoot, lock: { resolved, integrity } };
}

function assertInstalledPackage(root: string, packageName: string, code: string): string {
	const packageRoot = path.join(root, "node_modules", ...packageName.split("/"));
	assertContainedRegularPath(root, packageRoot, code);
	return packageRoot;
}

function assertContainedRegularPath(root: string, target: string, code: string): void {
	const stat = existsSync(target) ? lstatSync(target) : null;
	if (!stat || stat.isSymbolicLink()) throw new GatewayProtocolConsumerError(code, "Installed package must be a non-symlink path.");
	const realRoot = realpathSync(root);
	const realTarget = realpathSync(target);
	if (!realTarget.startsWith(`${realRoot}${path.sep}`))
		throw new GatewayProtocolConsumerError(code, "Installed package escaped its isolated consumer.");
}

function assertPublishedDependency(manifest: PackageManifest, name: string, version: string, code: string): void {
	if (objectString(objectObject(manifest, "dependencies") ?? {}, name) !== version)
		throw new GatewayProtocolConsumerError(code, `Worker source dependency on ${name} must be the exact published version ${version}.`);
}

function artifactSpecifier(file: string): string {
	return `file:${file}`;
}

function resolveLockTarball(root: string, resolved: unknown): string | null {
	if (typeof resolved !== "string" || !resolved.startsWith("file:")) return null;
	return path.resolve(root, resolved.slice("file:".length));
}

function canonicalLockTarball(root: string, resolved: unknown): string | null {
	const tarball = resolveLockTarball(root, resolved);
	if (tarball === null || !existsSync(tarball)) return null;
	return realpathSync(tarball);
}

function requireAbsoluteRegularFile(value: unknown, code: string): string {
	if (typeof value !== "string" || !path.isAbsolute(value))
		throw new GatewayProtocolConsumerError(code, "Protocol proof input must be an absolute regular file.");
	const resolved = path.resolve(value);
	readRegularFile(resolved, code);
	return resolved;
}

function readRegularFile(file: string, code: string): Buffer {
	const stat = existsSync(file) ? lstatSync(file) : null;
	// `lstatSync` does not follow the link, so a symlink already fails the check
	// below and a second `|| stat.isSymbolicLink()` operand could never evaluate
	// true -- the same reasoning `verify-protocol-vendor-pin.ts` wrote down when it
	// removed its own. Measured rather than argued: dropping the operand kept the
	// suite green, while dropping the surviving one turned
	// `consumer rejects a directory where a protocol tarball belongs` red.
	if (!stat?.isFile())
		throw new GatewayProtocolConsumerError(code, "Protocol proof input must be a regular non-symlink file.");
	return readFileSync(file);
}

function readPackedManifest(tarball: string): PackageManifest {
	try {
		return packageManifest(
			JSON.parse(execFileSync("tar", ["-xOzf", tarball, "package/package.json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })),
		);
	} catch {
		throw new GatewayProtocolConsumerError("invalid_protocol_tarball", "Protocol artifact is not a readable package tarball.");
	}
}

function run(cwd: string, command: string, args: string[], label: string): SpawnResult {
	const result = spawnSync(command, args, {
		cwd,
		encoding: "utf8",
		maxBuffer: 8 * 1024 * 1024,
		// The shared toolchain boundary removes caller-side loaders and coverage;
		// NODE_PATH is additionally cleared because this staged consumer must resolve
		// only its installed dependency graph. Coverage removal was worth about 9s
		// with no measured coverage; docs/gates.md has the controlled numbers.
		env: { ...toolchainEnv(), NODE_PATH: "" },
	});
	if (result.status !== 0) throw new GatewayProtocolConsumerError("command_failed", `Packed consumer ${label} failed.`);
	return result;
}

function git(cwd: string, args: string[]): string {
	try {
		return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
	} catch {
		throw new GatewayProtocolConsumerError("git_identity_failed", "Worker source Git identity is unavailable.");
	}
}

function regularFiles(target: string): string[] {
	const stat = lstatSync(target);
	if (stat.isFile()) return [target];
	// `lstatSync` does not follow the link, so a symlink already fails the check
	// below and a second `|| stat.isSymbolicLink()` operand could never evaluate
	// true -- the same reasoning `verify-protocol-vendor-pin.ts` wrote down when it
	// removed its own. Measured rather than argued: dropping the operand kept the
	// suite green, while dropping the surviving one turned
	// the sibling guard at `readRegularFile` red.
	if (!stat.isDirectory())
		throw new GatewayProtocolConsumerError("unsafe_source", "Worker source must contain only regular files and directories.");
	return readdirSync(target).flatMap((name) => regularFiles(path.join(target, name)));
}

function readJson(file: string, code: string): unknown {
	try {
		return JSON.parse(readFileSync(file, "utf8"));
	} catch {
		throw new GatewayProtocolConsumerError(code, "Consumer proof JSON is invalid.");
	}
}

function filePathFromResolution(value: string): string {
	if (!value.startsWith("file:"))
		throw new GatewayProtocolConsumerError("escaped_protocol_resolution", "Protocol resolution is not a file URL.");
	return fileURLToPath(value);
}

function isVersion(value: unknown): value is string {
	return typeof value === "string" && /^(0|[1-9][0-9]*)[.](0|[1-9][0-9]*)[.](0|[1-9][0-9]*)$/u.test(value);
}
function isSha512Integrity(value: unknown): value is string {
	return typeof value === "string" && /^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(value);
}

function parseArgs(argv: string[]): ParsedArguments {
	const options: Partial<GatewayProtocolConsumerOptions> = {};
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--help" || arg === "-h") return { help: true };
		const flags: Array<[string, keyof GatewayProtocolConsumerOptions]> = [
			["--protocol-tarball", "protocolTarball"],
			["--protocol-provenance", "protocolProvenance"],
			["--keep-workspace", "keepWorkspace"],
		];
		if (
			!flags.some(([flag, field]) => {
				if (arg !== flag || options[field] !== undefined) return false;
				if (field === "keepWorkspace") options.keepWorkspace = true;
				else if (field === "protocolTarball") options.protocolTarball = argv[++index];
				else options.protocolProvenance = argv[++index];
				return true;
			})
		)
			throw new GatewayProtocolConsumerError("invalid_argument", "Invalid packed protocol consumer argument.");
	}
	return { options };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		const parsed = parseArgs(process.argv.slice(2));
		if ("help" in parsed)
			console.log(
				"usage: node scripts/verify-gateway-protocol-consumer.ts --protocol-tarball <absolute-tgz> --protocol-provenance <absolute-json> [--keep-workspace]",
			);
		else console.log(JSON.stringify(verifyGatewayProtocolConsumer(parsed.options), null, 2));
	} catch (error) {
		console.error(
			JSON.stringify({
				schema_version: "ceal.gateway_protocol_packed_consumer_error.v1",
				ok: false,
				error_code: error instanceof GatewayProtocolConsumerError ? error.code : "consumer_verification_failed",
			}),
		);
		process.exitCode = 2;
	}
}
