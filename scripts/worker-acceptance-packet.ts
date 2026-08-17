#!/usr/bin/env node
// Installed-client acceptance packet.
//
// The question this answers is not "does the source build" — `npm run check`
// owns that — but "is there a real installed release on a real machine that
// reached a real Gateway". Those are different claims, and a package asset, a
// source checkout, a catalog row, or a provider name is none of them.
//
// So this runs the INSTALLED binary and refuses to run anything else. A
// checkout-resolved `ceal`, a workspace link, or a binary with no release
// manifest beside it is a refusal rather than a weaker row: a substitution that
// silently downgrades the claim is exactly how an announcement ends up
// asserting an installation nobody performed.
//
// Usage:
//   npm run accept:worker --
//   npm run accept:worker -- --capability <id> --target <ref>
//   npm run accept:worker -- --binary /path/to/ceal --json
//   npm run accept:worker -- --sanitized   # external record
//
// Without `--capability`/`--target` the live provider row is left as an
// explicit non-claim. A bounded capability call is a real provider action and
// is therefore opt-in per run, never a default of a verification command.
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { projectAcceptanceReceipt } from "../packages/ceal-worker-cli/dist/acceptance-receipt.js";
import { runBoundedProcess } from "../packages/ceal-worker-cli/dist/bounded-process.js";
import { type InstalledWorkerRelease, resolveInstalledWorkerRelease } from "../packages/ceal-worker-cli/dist/managed-worker-install.js";
import { codedErrorClass } from "./lib/coded-error.ts";
import { verifyProtocolProvenanceAgainstLock } from "./lib/protocol-provenance.ts";
import { assertShippableProtocolVendorPin, ProtocolVendorPinError } from "./verify-protocol-vendor-pin.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST_PREFIX = "ceal-worker-release-manifest-";
const SUMS_NAME = "SHA256SUMS";
const ACCEPTANCE_COMMAND_TIMEOUT_MS = 60_000;
const ACCEPTANCE_TERMINATION_GRACE_MS = 2_000;
const ACCEPTANCE_POST_KILL_REPORT_MS = 500;
const ACCEPTANCE_POST_EXIT_DRAIN_MS = 100;
const ACCEPTANCE_MAX_CAPTURED_OUTPUT_BYTES = 64 * 1024;

type JsonRecord = Record<string, unknown>;
type Environment = NodeJS.ProcessEnv;
type FailureCode = string;

interface ResolveBinaryOptions {
	repoRoot?: string;
	binary?: string;
	env?: Environment;
}

interface CommandBounds {
	timeoutMs?: number;
	terminationGraceMs?: number;
	postKillReportMs?: number;
	postExitDrainMs?: number;
	maxCapturedOutputBytes?: number;
}

interface RunCommandOptions extends CommandBounds {
	env?: Environment;
}

interface BuildPacketOptions {
	repoRoot?: string;
	binary?: string;
	capability?: string;
	target?: string;
	env?: Environment;
	commandBounds?: CommandBounds;
}

interface ArtifactDescriptor {
	sha256: string;
}

interface ReleaseManifest {
	schema_version: "ceal.worker_release_manifest.v1";
	platform: string;
	version: string;
	artifact_state: string;
	artifact: ArtifactDescriptor;
	protocol?: JsonRecord;
}

interface ProtocolProvenance {
	package: string;
	version: string;
	sha256: string;
	producer: JsonRecord;
	lock_agreement: JsonRecord;
}

interface InstalledReleaseFacts {
	directory: string;
	manifestName: string;
	manifest: ReleaseManifest;
	artifactSha256: string;
}

interface CommandResult {
	args: readonly string[];
	status: number;
	stdout: string;
	stderr: string;
	elapsed_ms: number;
}

interface ReceiptObservation {
	[key: string]: unknown;
	readback_status?: string;
	gateway_audit_readback?: string;
	provider_state_readback?: string;
	outcome?: string;
	authorization?: string;
	audit_refs: string[];
	gateway_elapsed_ms: number | null;
	exit_code: number;
	elapsed_ms: number;
}

interface BoundedCapabilityCall {
	capability: string;
	target: string;
	status?: string;
	exit_code: number;
	elapsed_ms: number;
	evidence?: string;
	request_ref: string | null;
	receipt: ReceiptObservation | null;
}

interface InstalledClient {
	binary_path: string;
	platform: string;
	release_version: string;
	artifact_sha256: string;
	artifact_state: string;
	manifest: string;
	digest_agreement: string;
	reported_version?: string;
	client_protocol_version?: string;
}

interface GuideObservation {
	status?: string;
	exit_code: number;
	resolved_host_paths: string[];
	registered_host_count: number;
}

interface GatewaySessionObservation {
	reached: boolean;
	exit_code: number;
	elapsed_ms: number;
	instance_ref?: string;
	profile_ref?: string;
	negotiated_protocol_version?: string;
	host_decision?: string;
	catalog_source?: string;
	live_gateway_checked: boolean;
	capability_count: number;
}

interface AcceptancePacket {
	schema_version: "ceal.worker_acceptance_packet.v1";
	installed_client: InstalledClient;
	gateway_protocol_input: ProtocolProvenance;
	guide: GuideObservation;
	gateway_session: GatewaySessionObservation;
	bounded_capability_call: BoundedCapabilityCall | null;
	non_claims: string[];
}

interface ParsedOptions {
	json: boolean;
	sanitized: boolean;
	binary?: string;
	capability?: string;
	target?: string;
}

interface SanitizableAcceptancePacket<GatewayProtocolInput extends object> {
	installed_client: InstalledClient;
	gateway_protocol_input: GatewayProtocolInput;
	guide: GuideObservation;
	gateway_session: GatewaySessionObservation;
	bounded_capability_call: SanitizableBoundedCapabilityCall | null;
	non_claims: string[];
}

interface SanitizableBoundedCapabilityCall {
	capability: string;
	target: string;
	status?: string;
	exit_code: number;
	elapsed_ms: number;
	evidence?: string;
	request_ref: string | null;
	receipt: JsonRecord | null;
}

interface SanitizedAcceptanceRecord<GatewayProtocolInput extends object> {
	schema_version: "ceal.worker_acceptance_result.v2";
	command: "ceal";
	ok: true;
	status: "emitted";
	emitted_by: "source_checkout";
	installed_client: {
		platform: string;
		release_version: string;
		artifact_sha256: string;
		artifact_state: string;
		manifest: string;
		digest_agreement: string;
		reported_version?: string;
		client_protocol_version?: string;
	};
	gateway_protocol_input: GatewayProtocolInput;
	guide: { status?: string; exit_code: number; registered_host_count: number };
	gateway_session: {
		reached: boolean;
		exit_code: number;
		elapsed_ms: number;
		instance_ref?: string;
		profile_ref?: string;
		negotiated_protocol_version?: string;
		host_decision?: string;
		catalog_source?: string;
		live_gateway_checked: boolean;
		capability_count: number;
	};
	bounded_capability_call: {
		capability: string;
		target: string;
		status?: string;
		exit_code: number;
		elapsed_ms: number;
		evidence?: string;
		request_ref: string | null;
		receipt: Record<string, unknown> | null;
	} | null;
	non_claims: string[];
}

export const WorkerAcceptanceError = codedErrorClass("WorkerAcceptanceError");

function isRecord(value: unknown): value is JsonRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
	return typeof value === "string";
}

function isReleaseManifest(value: unknown): value is ReleaseManifest {
	if (!isRecord(value) || value.schema_version !== "ceal.worker_release_manifest.v1") return false;
	if (!isString(value.platform) || !isString(value.version) || !isString(value.artifact_state)) return false;
	if (!isRecord(value.artifact) || !isString(value.artifact.sha256)) return false;
	return value.protocol === undefined || isRecord(value.protocol);
}

function isProtocolProvenance(value: unknown): value is ProtocolProvenance {
	return (
		isRecord(value) &&
		isString(value.package) &&
		isString(value.version) &&
		isString(value.sha256) &&
		isRecord(value.producer) &&
		isRecord(value.lock_agreement)
	);
}

function fail(code: FailureCode, message: string): never {
	throw new WorkerAcceptanceError(code, message);
}

/** Resolve the installed binary, refusing every source-shaped substitution. */
export function resolveInstalledBinary({ repoRoot = REPO_ROOT, binary, env = process.env }: ResolveBinaryOptions = {}): string {
	const candidate = binary ?? which("ceal", env);
	if (!candidate) fail("binary_not_found", "No 'ceal' on PATH; pass --binary <path> to name the installed release.");
	if (!existsSync(candidate)) fail("binary_not_found", `No such file: ${candidate}`);
	// realpath first: the install root is reached through a symlink by design,
	// and the checks below are about where the bytes actually live.
	const resolved = realpathSync(candidate);
	const stat = lstatSync(resolved);
	if (!stat.isFile()) fail("binary_not_a_file", `${resolved} is not a regular file.`);
	// A checkout-resolved binary would make every row below describe the source
	// tree this command is run from, which is the one thing it must not claim.
	if (isInside(repoRoot, resolved)) {
		fail(
			"source_checkout_substitution",
			`${resolved} is inside the source checkout ${repoRoot}; this command accepts only an installed release.`,
		);
	}
	for (const marker of ["node_modules", "dist", "packages"]) {
		if (resolved.split(path.sep).includes(marker)) {
			fail(
				"workspace_substitution",
				`${resolved} sits under a '${marker}' directory; a workspace or link substitution is not an installed release.`,
			);
		}
	}
	return resolved;
}

function isInside(parent: string, child: string): boolean {
	const relative = path.relative(realpathSync(parent), child);
	return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function which(command: string, env: Environment): string | undefined {
	for (const entry of (env.PATH ?? "").split(path.delimiter)) {
		if (!entry) continue;
		const candidate = path.join(entry, command);
		if (existsSync(candidate)) return candidate;
	}
	return undefined;
}

/**
 * Cross-check the installed bytes against the release manifest beside them.
 *
 * Three independent statements must agree: the bytes on disk, the manifest's
 * declared artifact digest, and the `SHA256SUMS` line. Any one of them alone is
 * a self-report.
 */
export function inspectInstalledRelease(binaryPath: string): InstalledReleaseFacts {
	let installed: InstalledWorkerRelease | undefined;
	try {
		installed = resolveInstalledWorkerRelease(binaryPath);
	} catch {
		fail("managed_install_required", `${binaryPath} is not the current generation of a verified managed worker installation.`);
	}
	const binary = installed.commandPath;
	const directory = installed.generationDirectory;
	const manifestName = readdirSync(directory).find((name) => name.startsWith(MANIFEST_PREFIX) && name.endsWith(".json"));
	if (!manifestName)
		fail("release_manifest_missing", `No ${MANIFEST_PREFIX}*.json beside ${binaryPath}; this is not an installed release layout.`);
	const parsedManifest: unknown = JSON.parse(readFileSync(path.join(directory, manifestName), "utf8"));
	if (!isReleaseManifest(parsedManifest)) {
		fail("release_manifest_schema", "Unexpected release manifest schema or shape.");
	}
	const manifest = parsedManifest;
	const observed = sha256File(binary);
	if (observed !== manifest.artifact?.sha256) {
		fail("artifact_digest_mismatch", `Installed bytes ${observed} do not match the manifest's ${manifest.artifact?.sha256}.`);
	}
	const sums = readChecksums(path.join(directory, SUMS_NAME));
	const declared = sums.get(path.basename(binary));
	if (!declared) fail("checksums_entry_missing", `${SUMS_NAME} has no line for ${path.basename(binary)}.`);
	if (declared !== observed)
		fail("checksums_mismatch", `${SUMS_NAME} declares ${declared} for the installed binary but its bytes are ${observed}.`);
	return { directory, manifestName, manifest, artifactSha256: observed };
}

function readChecksums(file: string): Map<string, string> {
	if (!existsSync(file)) fail("checksums_missing", `No ${SUMS_NAME} beside the installed binary.`);
	const entries = new Map<string, string>();
	for (const line of readFileSync(file, "utf8").split("\n")) {
		if (!line.trim()) continue;
		const match = /^([0-9a-f]{64}) {2}(\S+)$/u.exec(line);
		if (!match) fail("checksums_malformed", `Unparseable ${SUMS_NAME} line: ${line}`);
		const [, digest, name] = match;
		if (!digest || !name) fail("checksums_malformed", `Unparseable ${SUMS_NAME} line: ${line}`);
		entries.set(name, digest);
	}
	return entries;
}

function sha256File(file: string): string {
	return createHash("sha256").update(readFileSync(file)).digest("hex");
}

/**
 * This lane's binding of the shared provenance rule. The rule itself is in
 * `lib/protocol-provenance.mjs` because the asset merge asks the same question
 * before signing; only the error envelope differs.
 */
export function verifyProtocolProvenance(manifest: unknown, { repoRoot = REPO_ROOT }: { repoRoot?: string } = {}): ProtocolProvenance {
	if (!isReleaseManifest(manifest)) fail("release_manifest_schema", "Unexpected release manifest schema or shape.");
	const provenance: unknown = verifyProtocolProvenanceAgainstLock(manifest, { repoRoot, fail });
	if (!isProtocolProvenance(provenance)) fail("protocol_provenance_incomplete", "Protocol provenance output is incomplete.");
	return provenance;
}

function acceptanceCommandEnv(base: Environment): Environment {
	const clean: Environment = { ...base };
	for (const name of [
		"ACTIONS_ID_TOKEN_REQUEST_TOKEN",
		"ACTIONS_ID_TOKEN_REQUEST_URL",
		"ACTIONS_RUNTIME_TOKEN",
		"GITHUB_TOKEN",
		"NODE_AUTH_TOKEN",
		"NPM_TOKEN",
		"CLOUDFLARE_API_TOKEN",
		"CEAL_GITHUB_TOKEN",
	])
		delete clean[name];
	return clean;
}

export async function runInstalledCommand(
	binaryPath: string,
	args: readonly string[],
	{
		env = process.env,
		timeoutMs = ACCEPTANCE_COMMAND_TIMEOUT_MS,
		terminationGraceMs = ACCEPTANCE_TERMINATION_GRACE_MS,
		postKillReportMs = ACCEPTANCE_POST_KILL_REPORT_MS,
		postExitDrainMs = ACCEPTANCE_POST_EXIT_DRAIN_MS,
		maxCapturedOutputBytes = ACCEPTANCE_MAX_CAPTURED_OUTPUT_BYTES,
	}: RunCommandOptions = {},
): Promise<CommandResult> {
	const started = Date.now();
	const result = await runBoundedProcess(binaryPath, args, {
		cwd: path.dirname(binaryPath),
		env: acceptanceCommandEnv(env),
		timeoutMs,
		terminationGraceMs,
		postKillReportMs,
		postExitDrainMs,
		maxCapturedOutputBytes,
	});
	if (result.timedOut) {
		const action = args[0] === "call" ? " The provider outcome may be unknown; do not repeat the call until its receipt is read back." : "";
		fail("installed_binary_timeout", `'${binaryPath} ${args.join(" ")}' exceeded its deadline and was stopped.${action}`);
	}
	if (result.truncated) fail("installed_binary_output_too_large", `'${binaryPath} ${args.join(" ")}' exceeded the captured-output bound.`);
	if (result.spawnError || result.signal !== null || result.code === null) {
		const action = args[0] === "call" ? " The provider outcome may be unknown; do not repeat the call until its receipt is read back." : "";
		fail("installed_binary_failed", `'${binaryPath} ${args.join(" ")}' did not exit normally.${action}`);
	}
	if (result.code === null) fail("installed_binary_failed", `'${binaryPath} ${args.join(" ")}' did not return an exit code.`);
	return { args, status: result.code, stdout: result.stdout, stderr: result.stderr, elapsed_ms: Date.now() - started };
}

// Deliberately not a YAML parser: the packet records a handful of scalar
// fields, and a real parser here would invite reading structure the CLI never
// promised to keep stable.
function scalar(stdout: string, key: string): string | undefined {
	const match = new RegExp(`^\\s*${key}:[ ]+(.+)$`, "mu").exec(stdout);
	return match ? match[1].trim() : undefined;
}

export async function buildAcceptancePacket({
	repoRoot = REPO_ROOT,
	binary,
	capability,
	target,
	env = process.env,
	commandBounds = {},
}: BuildPacketOptions = {}): Promise<AcceptancePacket> {
	// Acceptance-candidate emission is one of the paths the Gateway owner made
	// ship-blocking on a proof/ship divergence, and it must refuse on its own
	// rather than on the strength of some test command having passed earlier. It
	// runs before the binary is even resolved: a packet that described a real
	// install would be the most convincing possible evidence for bytes the lock
	// does not bind, so the refusal has to come before anything is measured.
	try {
		assertShippableProtocolVendorPin({ repoRoot });
	} catch (error) {
		const message = error instanceof Error ? error.message : "Protocol vendor pin verification failed.";
		fail(error instanceof ProtocolVendorPinError ? error.code : "protocol_vendor_pin_verification_failed", message);
	}
	const binaryPath = resolveInstalledBinary({ repoRoot, binary, env });
	const release = inspectInstalledRelease(binaryPath);
	const protocol = verifyProtocolProvenance(release.manifest, { repoRoot });

	const installedCommandOptions: RunCommandOptions = { ...commandBounds, env };
	const version = await runInstalledCommand(binaryPath, ["version"], installedCommandOptions);
	if (version.status !== 0) fail("installed_binary_unusable", `'${binaryPath} version' exited ${version.status}.`);
	const guide = await runInstalledCommand(binaryPath, ["guide", "status"], installedCommandOptions);
	const discovery = await runInstalledCommand(binaryPath, ["capabilities", "--fresh"], installedCommandOptions);

	const packet: AcceptancePacket = {
		schema_version: "ceal.worker_acceptance_packet.v1",
		installed_client: {
			binary_path: binaryPath,
			platform: release.manifest.platform,
			release_version: release.manifest.version,
			artifact_sha256: release.artifactSha256,
			artifact_state: release.manifest.artifact_state,
			manifest: release.manifestName,
			digest_agreement: "binary_bytes_manifest_and_sha256sums_agree",
			reported_version: scalar(version.stdout, "version"),
			client_protocol_version: scalar(version.stdout, "protocol_version"),
		},
		gateway_protocol_input: protocol,
		guide: {
			status: scalar(guide.stdout, "status"),
			exit_code: guide.status,
			// A `registration_path` is present for every host whose root merely
			// resolved, so counting paths reported registration this host never
			// performed. `registered` is the state that says it did.
			resolved_host_paths: [...guide.stdout.matchAll(/^\s*registration_path: (.+)$/gmu)].map((match) => match[1]),
			registered_host_count: (guide.stdout.match(/^\s*registered: true$/gmu) ?? []).length,
		},
		gateway_session: {
			reached: discovery.status === 0,
			exit_code: discovery.status,
			elapsed_ms: discovery.elapsed_ms,
			instance_ref: scalar(discovery.stdout, "instance_ref"),
			profile_ref: scalar(discovery.stdout, "profile_ref"),
			negotiated_protocol_version: scalar(discovery.stdout, "negotiated_protocol_version"),
			host_decision: scalar(discovery.stdout, "host_decision"),
			catalog_source: scalar(discovery.stdout, "catalog_source"),
			live_gateway_checked: scalar(discovery.stdout, "live_gateway_checked") === "true",
			capability_count: [...discovery.stdout.matchAll(/^\s*- capability_id: /gmu)].length,
		},
		bounded_capability_call: null,
		non_claims: [],
	};

	if (capability && target) {
		const call = await runInstalledCommand(binaryPath, ["call", capability, "--target", target], installedCommandOptions);
		const requestRef = scalar(call.stdout, "request_ref");
		let receipt: ReceiptObservation | null = null;
		if (requestRef) {
			const shown = await runInstalledCommand(binaryPath, ["receipt", "show", requestRef], installedCommandOptions);
			// These are the rendered observations available on the checkout side.
			// The shared receipt projector below supplies the declared total key set.
			receipt = {
				readback_status: scalar(shown.stdout, "status"),
				gateway_audit_readback: scalar(shown.stdout, "gateway_audit_readback"),
				provider_state_readback: scalar(shown.stdout, "provider_state_readback"),
				outcome: scalar(shown.stdout, "outcome"),
				authorization: scalar(shown.stdout, "authorization"),
				audit_refs: [...shown.stdout.matchAll(/^\s*- ref: (.+)$/gmu)].map((match) => match[1]),
				gateway_elapsed_ms: Number.isFinite(Number(scalar(shown.stdout, "gateway_elapsed_ms")))
					? Number(scalar(shown.stdout, "gateway_elapsed_ms"))
					: null,
				exit_code: shown.status,
				elapsed_ms: shown.elapsed_ms,
			};
		}
		// In the order CEAL_ACCEPTANCE_BOUNDED_CALL_KEYS declares.
		packet.bounded_capability_call = {
			capability,
			target,
			status: scalar(call.stdout, "status"),
			exit_code: call.status,
			elapsed_ms: call.elapsed_ms,
			evidence: scalar(call.stdout, "evidence"),
			request_ref: requestRef ?? null,
			receipt,
		};
	}

	packet.non_claims = nonClaims(packet);
	return packet;
}

// The non-claims are derived from what the run actually reached, so a row that
// was skipped says so in the packet itself rather than in a covering note that
// travels separately and goes stale.
function nonClaims(packet: AcceptancePacket): string[] {
	const claims = [
		`Only ${packet.installed_client.platform} is evidenced by this packet; every other platform is unproved by it.`,
		"No tag, signature, upload, publication, or Gateway configuration change was performed.",
	];
	if (!packet.bounded_capability_call) {
		claims.push("provider_execution_not_reached: no bounded capability call was requested, so no provider action or receipt is claimed.");
	}
	if (!packet.gateway_session.reached) {
		claims.push("gateway_session_not_reached: the installed client did not complete a live discovery on this run.");
	}
	if (packet.installed_client.artifact_state !== "signed") {
		// This reads as "the artifact is unsigned" unless the timing is spelled
		// out, and this record travels to another lane as announcement evidence.
		// The manifest is written when the asset set is composed, before the
		// release job signs anything, and a manifest cannot honestly declare a
		// signature over bytes that include itself. So the field describes the
		// composed candidate and says nothing either way about the installed
		// artifact, which the installer does verify before accepting it.
		claims.push(
			`artifact_state is '${packet.installed_client.artifact_state}' because the release manifest is written at asset-composition time, before signing; ` +
				"it does not mean the installed artifact is unsigned. Cosign verification is the installer's step, and this command does not re-prove it.",
		);
	}
	claims.push(
		"This packet describes one machine. It is not a fresh-device installation proof unless this install was performed fresh for it.",
	);
	return claims;
}

/**
 * The external form of the packet, for a record another lane reads.
 *
 * The packet itself is a local diagnostic and carries things that have no
 * business leaving this machine: the operator's absolute filesystem path, and
 * the local agent registration paths. This is an allow-list rather than a
 * delete-list for the same reason the announcement policy renderer is — a field
 * added to the packet later must not travel by default just because nobody
 * remembered to strip it.
 *
 * What is deliberately KEPT: `instance_ref` and `profile_ref`. Both are
 * Gateway-issued identifiers being returned to the Gateway that issued them, so
 * withholding them protects nobody and costs the record its binding to a
 * session. The host paths are dropped and only `registered_host_count` survives:
 * the number is the evidence ("guide registration reached N hosts"), the paths
 * are the leak.
 */

export function sanitizedAcceptanceRecord<GatewayProtocolInput extends object>(
	packet: SanitizableAcceptancePacket<GatewayProtocolInput>,
): SanitizedAcceptanceRecord<GatewayProtocolInput> {
	const client = packet.installed_client;
	const session = packet.gateway_session;
	const call = packet.bounded_capability_call;
	return {
		schema_version: "ceal.worker_acceptance_result.v2",
		// The shipped guide tells an agent to branch on `ok`, "which every command
		// answers". The installed emitter learned that and this one did not, so the
		// artifact a maintainer produces from a checkout read as `ok: undefined` to
		// any reader following the instruction. Same invariant, the other half.
		command: "ceal",
		ok: true,
		status: "emitted",
		emitted_by: "source_checkout",
		installed_client: {
			platform: client.platform,
			release_version: client.release_version,
			artifact_sha256: client.artifact_sha256,
			artifact_state: client.artifact_state,
			manifest: client.manifest,
			digest_agreement: client.digest_agreement,
			reported_version: client.reported_version,
			client_protocol_version: client.client_protocol_version,
		},
		gateway_protocol_input: packet.gateway_protocol_input,
		guide: {
			status: packet.guide.status,
			exit_code: packet.guide.exit_code,
			registered_host_count: packet.guide.registered_host_count,
		},
		gateway_session: {
			reached: session.reached,
			exit_code: session.exit_code,
			elapsed_ms: session.elapsed_ms,
			instance_ref: session.instance_ref,
			profile_ref: session.profile_ref,
			negotiated_protocol_version: session.negotiated_protocol_version,
			host_decision: session.host_decision,
			catalog_source: session.catalog_source,
			live_gateway_checked: session.live_gateway_checked,
			capability_count: session.capability_count,
		},
		bounded_capability_call: call
			? {
					capability: call.capability,
					target: call.target,
					status: call.status,
					exit_code: call.exit_code,
					elapsed_ms: call.elapsed_ms,
					evidence: call.evidence,
					request_ref: call.request_ref,
					// Projected by declared key, not copied: the installed emitter builds
					// this row the same way, and passing the object through is how an
					// identity ref rode into a published record in the first place.
					receipt: call.receipt
						? projectAcceptanceReceipt({
								readback_status: call.receipt.readback_status,
								gateway_audit_readback: call.receipt.gateway_audit_readback,
								provider_state_readback: call.receipt.provider_state_readback,
								outcome: call.receipt.outcome,
								authorization: call.receipt.authorization,
								audit_refs: call.receipt.audit_refs,
								gateway_elapsed_ms: call.receipt.gateway_elapsed_ms,
								exit_code: call.receipt.exit_code,
								elapsed_ms: call.receipt.elapsed_ms,
							})
						: null,
				}
			: null,
		non_claims: [
			...packet.non_claims,
			"This record is a sanitized projection: the emitting host's binary path and local agent registration paths are omitted by allow-list, so it describes an installation without locating one.",
		],
	};
}

function parseArgs(argv: readonly string[]): ParsedOptions {
	const options: ParsedOptions = { json: false, sanitized: false };
	const valued: Record<string, "binary" | "capability" | "target"> = {
		"--binary": "binary",
		"--capability": "capability",
		"--target": "target",
	};
	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index];
		if (token === "--json") {
			options.json = true;
		} else if (token === "--sanitized") {
			// The external record is JSON by construction: it exists to be written to a
			// file another lane reads by digest, not to be eyeballed.
			options.sanitized = true;
			options.json = true;
		} else if (valued[token]) {
			index += 1;
			if (index >= argv.length) fail("missing_argument_value", `${token} needs a value.`);
			const value = argv[index];
			if (value === undefined) fail("missing_argument_value", `${token} needs a value.`);
			options[valued[token]] = value;
		} else {
			fail("unknown_argument", `Unknown argument: ${token}`);
		}
	}
	if (Boolean(options.capability) !== Boolean(options.target)) {
		fail("incomplete_call_request", "--capability and --target must be given together; a call needs both.");
	}
	return options;
}

function render(packet: AcceptancePacket): string {
	const lines: string[] = [];
	const client = packet.installed_client;
	lines.push(`installed:  ${client.release_version} ${client.platform}  ${client.artifact_sha256}`);
	lines.push(`            ${client.binary_path}`);
	lines.push(`            digests agree: bytes = manifest = SHA256SUMS`);
	const producer = packet.gateway_protocol_input.producer;
	lines.push(
		`protocol:   ${packet.gateway_protocol_input.package}@${packet.gateway_protocol_input.version} from ${producer.repository}@${producer.commit}`,
	);
	lines.push(
		`            lock agreement: commit=${packet.gateway_protocol_input.lock_agreement.commit_matches} tree=${packet.gateway_protocol_input.lock_agreement.tree_matches}`,
	);
	lines.push(
		`guide:      ${packet.guide.status} (${packet.guide.registered_host_count} registered of ${packet.guide.resolved_host_paths.length} resolved hosts)`,
	);
	const session = packet.gateway_session;
	lines.push(
		`gateway:    ${session.instance_ref} protocol ${session.negotiated_protocol_version} ${session.host_decision} in ${session.elapsed_ms}ms`,
	);
	lines.push(`            ${session.capability_count} capabilities, source ${session.catalog_source}`);
	const call = packet.bounded_capability_call;
	if (call) {
		lines.push(`call:       ${call.capability} -> ${call.status} (${call.evidence}) in ${call.elapsed_ms}ms`);
		lines.push(`            ${call.request_ref}`);
		if (call.receipt) {
			lines.push(
				`receipt:    ${call.receipt.readback_status} audit=${call.receipt.gateway_audit_readback ?? "unreported"} provider=${call.receipt.provider_state_readback ?? "unreported"} ${call.receipt.authorization}/${call.receipt.outcome} ${call.receipt.audit_refs.join(", ")}`,
			);
		}
	} else {
		lines.push("call:       not requested");
	}
	lines.push("non_claims:");
	for (const claim of packet.non_claims) lines.push(`  - ${claim}`);
	return lines.join("\n");
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
	try {
		const options = parseArgs(process.argv.slice(2));
		const packet = await buildAcceptancePacket(options);
		const emitted = options.sanitized ? sanitizedAcceptanceRecord(packet) : packet;
		process.stdout.write(options.json ? `${JSON.stringify(emitted, null, 2)}\n` : `${render(packet)}\n`);
	} catch (error: unknown) {
		const code = error instanceof WorkerAcceptanceError ? error.code : "unexpected_error";
		const message = error instanceof Error ? error.message : "Unknown failure.";
		process.stderr.write(`worker-acceptance: ${code}: ${message}\n`);
		process.exit(1);
	}
}
