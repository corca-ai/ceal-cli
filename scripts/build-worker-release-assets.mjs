#!/usr/bin/env node

// Composes the installer-facing worker release asset set for one platform from
// the locked Gateway handoff archive lane, and merges per-platform sets into
// the one signed release inventory that install-ceal.sh consumes.

import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	readCarrierContract,
	readControlSessionContract,
	verifyEmbeddedGatewayLeasedConsumerHandoffSource,
} from "./generate-leased-consumer-handoff-runtime.mjs";
import { codedErrorClass } from "./lib/coded-error.mjs";
import { inspectOutputDirectory, publishOutputDirectory } from "./lib/output-directory.mjs";
import { verifyProtocolProvenanceAgainstLock } from "./lib/protocol-provenance.mjs";
import { assertShippableProtocolVendorPin, ProtocolVendorPinError } from "./verify-protocol-vendor-pin.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MARKER = ".ceal-worker-release-assets";
const INSTALLER_NAME = "install-ceal.sh";
const GUIDE_ASSET = "ceal-guide.tar";
const NOTICE_NAME = "THIRD_PARTY_NOTICES.txt";
const PRIVATE_CARRIER_CONTRACT_PATH = "packages/ceal-worker-cli/leased-consumer-carrier-contract.json";
const PRIVATE_CONTROL_SESSION_CONTRACT_PATH = "packages/ceal-worker-cli/leased-consumer-control-session-contract.json";
const SHARED_ASSETS = Object.freeze([GUIDE_ASSET, NOTICE_NAME, INSTALLER_NAME]);
const PLATFORM_PATTERN = /^(?:linux|darwin)-(?:arm64|amd64)$/u;
// A published release may predate the current build matrix. Keep this bounded
// historical vocabulary solely for rollback verification; it is not permission
// for a future release to produce every one of these platforms.
const HISTORICAL_RELEASE_PLATFORMS = Object.freeze(["linux-arm64", "linux-amd64", "darwin-arm64", "darwin-amd64"]);

export const WorkerReleaseAssetsError = codedErrorClass("WorkerReleaseAssetsError");

/**
 * Strictly names the signed primary assets in an already-published worker
 * inventory. Rollback verifies SHA256SUMS itself before calling this parser;
 * the parser then prevents that trusted inventory from widening the rollback
 * writer's URL/path vocabulary beyond complete historical worker pairs.
 */
export function parsePublishedWorkerReleaseInventory(bytes) {
	const lines = String(bytes).split("\n").filter(Boolean);
	if (lines.length === 0) fail("published_inventory_malformed", "Published worker SHA256SUMS is empty.");
	const entries = lines.map((line) => /^([a-f0-9]{64}) {2}(\S+)$/u.exec(line));
	if (entries.some((entry) => entry === null)) fail("published_inventory_malformed", "Published worker SHA256SUMS is malformed.");
	const names = entries.map((entry) => entry[2]);
	if (new Set(names).size !== names.length) fail("published_inventory_malformed", "Published worker SHA256SUMS contains duplicate entries.");
	const named = new Set(names);
	for (const shared of SHARED_ASSETS)
		if (!named.has(shared)) fail("published_inventory_malformed", `Published worker SHA256SUMS is missing ${shared}.`);
	let platformCount = 0;
	for (const platform of HISTORICAL_RELEASE_PLATFORMS) {
		const binary = `ceal-${platform}`;
		const manifest = `ceal-worker-release-manifest-${platform}.json`;
		const binaryPresent = named.has(binary);
		const manifestPresent = named.has(manifest);
		if (binaryPresent !== manifestPresent)
			fail("published_inventory_malformed", `Published worker SHA256SUMS has an incomplete platform pair for ${platform}.`);
		if (binaryPresent) platformCount += 1;
	}
	if (platformCount === 0) fail("published_inventory_malformed", "Published worker SHA256SUMS names no platform.");
	if (names.length !== SHARED_ASSETS.length + platformCount * 2)
		fail("published_inventory_malformed", "Published worker SHA256SUMS contains an unexpected asset.");
	return [...named].sort();
}

export async function composeWorkerReleaseAssets(options = {}, dependencies = {}) {
	const repoRoot = path.resolve(options.repoRoot ?? ROOT);
	const output = inspectOutputDirectory(options.outputDirectory, {
		repoRoot,
		force: options.force === true,
		subject: "Worker release assets output",
		marker: MARKER,
		fail,
	});
	// Canonicalize the stage so the native builder's no-symlink output guard
	// accepts it on hosts whose temp root sits behind a symlink (macOS /var).
	const stage = realpathSync(mkdtempSync(path.join(tmpdir(), "ceal-worker-release-assets-")));
	// The native builder needs build-time dependencies (esbuild/postject);
	// loading it lazily keeps `merge` runnable on a dependency-free host.
	let nativeErrorClass = null;
	try {
		let buildNative = dependencies.buildNative;
		if (!buildNative) {
			const nativeModule = await import("./build-worker-native-artifact.mjs");
			buildNative = nativeModule.buildWorkerNativeArtifact;
			nativeErrorClass = nativeModule.WorkerNativeArtifactError;
		}
		const nativeOut = path.join(stage, "native");
		const native = await buildNative({
			outputDirectory: nativeOut,
			gatewayHandoffArchive: options.gatewayHandoffArchive,
			platform: options.platform,
			repoRoot: options.repoRoot,
		});
		if (native?.ok !== true || !PLATFORM_PATTERN.test(native.platform ?? ""))
			fail("native_build_failed", "Worker release assets require a successful native artifact build.");
		if (options.version !== undefined && options.version !== native.version)
			fail("version_mismatch", "Worker release assets version does not match the built worker artifact.");
		const client = requireClientProvenance(native.client, native.version, "client_provenance_invalid");
		const binaryName = `ceal-${native.platform}`;
		const binary = readStagedFile(path.join(nativeOut, binaryName), "native_output_incomplete");
		if (sha256(binary) !== native.artifact.sha256) fail("native_output_incomplete", "Native worker artifact bytes drifted after its build.");
		const guide = readStagedFile(path.join(nativeOut, GUIDE_ASSET), "native_output_incomplete");
		if (
			native.guide?.name !== GUIDE_ASSET ||
			native.guide.format !== "ustar" ||
			native.guide.sha256 !== sha256(guide) ||
			!Array.isArray(native.guide.files) ||
			!native.guide.files.some((file) => file?.path === "SKILL.md")
		)
			fail("native_output_incomplete", "Native worker guide bundle metadata is incomplete or drifted.");
		const notices = readStagedFile(path.join(nativeOut, NOTICE_NAME), "native_output_incomplete");
		const installer = readStagedFile(path.join(repoRoot, INSTALLER_NAME), "installer_unavailable");
		let privateCarrierContract;
		let privateControlSessionContract;
		let privateCarrierHandoff;
		try {
			privateCarrierContract = readCarrierContract(path.join(repoRoot, PRIVATE_CARRIER_CONTRACT_PATH));
			privateControlSessionContract = readControlSessionContract(path.join(repoRoot, PRIVATE_CONTROL_SESSION_CONTRACT_PATH), { repoRoot });
			privateCarrierHandoff = verifyEmbeddedGatewayLeasedConsumerHandoffSource({ repoRoot });
		} catch {
			fail(
				"private_carrier_contract_invalid",
				"Worker release assets require exact validated private carrier contract and Gateway handoff bytes.",
			);
		}
		if (
			!native.private_leased_consumer_carrier ||
			native.private_leased_consumer_carrier.sha256 !== privateCarrierContract.sha256 ||
			JSON.stringify(native.private_leased_consumer_carrier.contract) !== JSON.stringify(privateCarrierContract.value)
		)
			fail(
				"private_carrier_contract_drift",
				"Worker release assets refuse a native binary whose embedded carrier contract differs from the source contract.",
			);
		if (
			!native.private_leased_consumer_control_session ||
			native.private_leased_consumer_control_session.sha256 !== privateControlSessionContract.sha256 ||
			JSON.stringify(native.private_leased_consumer_control_session.contract) !== JSON.stringify(privateControlSessionContract.value)
		)
			fail(
				"private_control_session_contract_drift",
				"Worker release assets refuse a native binary whose embedded control-session contract differs from the source contract.",
			);
		if (JSON.stringify(native.private_leased_consumer_handoff) !== JSON.stringify(privateCarrierHandoff))
			fail(
				"private_carrier_handoff_drift",
				"Worker release assets refuse a native binary whose embedded Gateway handoff differs from the SHA-locked source handoff.",
			);
		const manifest = {
			schema_version: "ceal.worker_release_manifest.v1",
			artifact_state: "unsigned_build_candidate",
			version: native.version,
			platform: native.platform,
			command: "ceal",
			artifact: { name: binaryName, bytes: binary.length, sha256: native.artifact.sha256 },
			client,
			guide: { ...native.guide, bytes: guide.length, sha256: sha256(guide) },
			installer: { name: INSTALLER_NAME, bytes: installer.length, sha256: sha256(installer) },
			third_party_notices: { name: NOTICE_NAME, bytes: notices.length, sha256: sha256(notices) },
			protocol: native.protocol,
			native_smoke: native.native_smoke,
			private_leased_consumer_carrier: {
				contract_json: privateCarrierContract.bytes.toString("utf8"),
				contract_sha256: privateCarrierContract.sha256,
			},
			private_leased_consumer_control_session: {
				contract_json: privateControlSessionContract.bytes.toString("utf8"),
				contract_sha256: privateControlSessionContract.sha256,
			},
			private_leased_consumer_handoff: privateCarrierHandoff,
			non_claims: [
				"This asset set is unsigned until the worker release workflow signs and publishes it.",
				"This does not prove a Gateway host, policy, connector, provider, audit, or installed-client action.",
			],
		};
		const manifestName = `ceal-worker-release-manifest-${native.platform}.json`;
		const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
		const staging = mkdtempSync(path.join(path.dirname(output.directory), `.${path.basename(output.directory)}.ceal-worker-assets-`));
		try {
			writeFileSync(path.join(staging, MARKER), "ceal worker release assets output\n", { mode: 0o644 });
			writeFileSync(path.join(staging, binaryName), binary, { mode: 0o755 });
			writeFileSync(path.join(staging, GUIDE_ASSET), guide, { mode: 0o644 });
			writeFileSync(path.join(staging, NOTICE_NAME), notices, { mode: 0o644 });
			writeFileSync(path.join(staging, INSTALLER_NAME), installer, { mode: 0o755 });
			writeFileSync(path.join(staging, manifestName), manifestBytes, { mode: 0o644 });
			writeChecksumInventory(staging);
			publishOutputDirectory(staging, output);
		} catch (error) {
			rmSync(staging, { recursive: true, force: true });
			throw error;
		}
		return {
			schema_version: "ceal.worker_release_assets_build.v1",
			ok: true,
			proof_level: "local_state",
			writes_external: false,
			output_dir: output.directory,
			version: native.version,
			platform: native.platform,
			assets: {
				binary: { name: binaryName, sha256: native.artifact.sha256 },
				manifest: { name: manifestName, sha256: sha256(manifestBytes) },
				guide: { name: GUIDE_ASSET, sha256: sha256(guide) },
				installer: { name: INSTALLER_NAME, sha256: sha256(installer) },
				third_party_notices: { name: NOTICE_NAME, sha256: sha256(notices) },
			},
			non_claims: manifest.non_claims,
		};
	} catch (error) {
		if (error instanceof WorkerReleaseAssetsError) throw error;
		if (nativeErrorClass && error instanceof nativeErrorClass) throw new WorkerReleaseAssetsError(error.code, error.message);
		throw new WorkerReleaseAssetsError("worker_release_assets_failed", "Could not compose worker release assets.");
	} finally {
		rmSync(stage, { recursive: true, force: true });
	}
}

export function mergeWorkerReleaseAssetSets(options = {}) {
	const repoRoot = path.resolve(options.repoRoot ?? ROOT);
	try {
		assertShippableProtocolVendorPin({ repoRoot });
	} catch (error) {
		if (error instanceof ProtocolVendorPinError) throw new WorkerReleaseAssetsError(error.code, error.message);
		throw error;
	}
	const output = inspectOutputDirectory(options.outputDirectory, {
		repoRoot,
		force: options.force === true,
		subject: "Worker release assets output",
		marker: MARKER,
		fail,
	});
	const inputs = Array.isArray(options.inputs) ? options.inputs.map((value) => requireAssetDirectory(value)) : [];
	if (inputs.length === 0) fail("merge_inputs_required", "Merging worker release assets requires at least one composed input set.");
	const platforms = new Map();
	const shared = new Map();
	for (const input of inputs) {
		const inventory = readInventory(input);
		for (const [name, digest] of inventory) {
			const bytes = readStagedFile(path.join(input, name), "merge_input_incomplete");
			if (sha256(bytes) !== digest) fail("merge_input_incomplete", "Composed worker asset does not match its checksum inventory.");
			if (SHARED_ASSETS.includes(name)) {
				if (shared.has(name) && shared.get(name).digest !== digest)
					fail("merge_shared_drift", `Shared worker release asset ${name} differs between platform sets.`);
				shared.set(name, { bytes, digest, mode: name === INSTALLER_NAME ? 0o755 : 0o644 });
				continue;
			}
			const platform = platformOfAsset(name);
			if (platform === null) fail("merge_unexpected_asset", `Composed worker asset ${name} is not a worker release asset.`);
			if (!platforms.has(platform)) platforms.set(platform, new Map());
			if (platforms.get(platform).has(name)) fail("merge_duplicate_asset", `Worker release asset ${name} appears in more than one input set.`);
			platforms.get(platform).set(name, { bytes, digest, mode: name.startsWith("ceal-worker-release-manifest-") ? 0o644 : 0o755 });
		}
	}
	for (const shortName of SHARED_ASSETS)
		if (!shared.has(shortName)) fail("merge_input_incomplete", `Merged worker release set is missing ${shortName}.`);
	for (const [platform, entries] of platforms) {
		if (entries.size !== 2) fail("merge_input_incomplete", `Merged worker release set has an incomplete pair for ${platform}.`);
	}
	if (platforms.size === 0) fail("merge_input_incomplete", "Merged worker release set names no platform.");
	// All three private inputs are re-read from the checkout and compared, not
	// only agreed across platforms. Cross-platform agreement alone accepts a
	// corruption that hit every leg identically, which is the ordinary shape when
	// every leg stages from one stale snapshot. Only the control-session check
	// used to do this; the two beside it checked agreement and stopped.
	let sourceControlSessionContract;
	let sourceCarrierContract;
	let sourceCarrierHandoff;
	try {
		sourceControlSessionContract = readControlSessionContract(path.join(repoRoot, PRIVATE_CONTROL_SESSION_CONTRACT_PATH), { repoRoot });
	} catch {
		fail(
			"merge_private_control_session_contract_invalid",
			"Merged worker release assets require a valid source private control-session contract.",
		);
	}
	try {
		sourceCarrierContract = readCarrierContract(path.join(repoRoot, PRIVATE_CARRIER_CONTRACT_PATH));
	} catch {
		fail("merge_private_carrier_contract_invalid", "Merged worker release assets require a valid source private carrier contract.");
	}
	try {
		sourceCarrierHandoff = verifyEmbeddedGatewayLeasedConsumerHandoffSource({ repoRoot });
	} catch {
		fail("merge_private_carrier_handoff_invalid", "Merged worker release assets require a valid source private Gateway handoff.");
	}
	// Each platform manifest is compared against the checkout, one at a time.
	// There is no cross-platform agreement check beside this any more: once every
	// leg must equal the source, every leg equals every other leg, so a `Set`
	// size check could no longer fail and would read as a guard while proving
	// nothing. Agreement is the consequence; equality with the source is the rule.
	for (const [platform, entries] of platforms) {
		const manifestBytes = entries.get(`ceal-worker-release-manifest-${platform}.json`)?.bytes;
		carrierContractIdentity(manifestBytes, sourceCarrierContract);
		carrierHandoffIdentity(manifestBytes, sourceCarrierHandoff);
		controlSessionContractIdentity(manifestBytes, sourceControlSessionContract);
	}
	const expectedClientVersion = readPackageVersion(repoRoot, "packages/ceal-client");
	const clientIdentities = new Set();
	for (const [platform, entries] of platforms) {
		const manifestBytes = entries.get(`ceal-worker-release-manifest-${platform}.json`)?.bytes;
		clientIdentities.add(clientProvenanceIdentity(manifestBytes, expectedClientVersion));
	}
	if (clientIdentities.size !== 1)
		fail("merge_client_provenance_drift", "Merged worker release assets require byte-identical client package provenance across platforms.");
	// The last point at which a protocol-producer disagreement is still cheap.
	// The pin is asserted while each platform BUILDS, and after that nothing
	// asked again: the signing job verifies digests, the file list, and each
	// manifest's version and platform — bytes and shape, never
	// `protocol.producer`. The only other caller compares it against an
	// INSTALLED release, which is after publishing by definition, and a failed
	// release tag cannot be reused. This job already checked out the exact tag,
	// so the lock it reads is the one these artifacts were built against.
	for (const [platform, entries] of platforms) {
		let manifest;
		try {
			manifest = JSON.parse(entries.get(`ceal-worker-release-manifest-${platform}.json`)?.bytes?.toString("utf8") ?? "");
		} catch {
			fail("merge_manifest_unreadable", `Merged worker release assets require a parseable manifest for ${platform}.`);
		}
		verifyProtocolProvenanceAgainstLock(manifest, {
			repoRoot,
			fail: (code, message) => fail(`merge_${code}`, `${message} (${platform})`),
		});
	}
	const staging = mkdtempSync(path.join(path.dirname(output.directory), `.${path.basename(output.directory)}.ceal-worker-merge-`));
	try {
		writeFileSync(path.join(staging, MARKER), "ceal worker release assets output\n", { mode: 0o644 });
		for (const [name, entry] of shared) writeFileSync(path.join(staging, name), entry.bytes, { mode: entry.mode });
		for (const entries of platforms.values())
			for (const [name, entry] of entries) writeFileSync(path.join(staging, name), entry.bytes, { mode: entry.mode });
		writeChecksumInventory(staging);
		publishOutputDirectory(staging, output);
	} catch (error) {
		rmSync(staging, { recursive: true, force: true });
		throw error;
	}
	return {
		schema_version: "ceal.worker_release_assets_merge.v1",
		ok: true,
		proof_level: "local_state",
		writes_external: false,
		output_dir: output.directory,
		platforms: [...platforms.keys()].sort(),
		entry_count: 3 + 2 * platforms.size,
	};
}

function platformOfAsset(name) {
	const binary = /^ceal-((?:linux|darwin)-(?:arm64|amd64))$/u.exec(name);
	if (binary) return binary[1];
	const manifest = /^ceal-worker-release-manifest-((?:linux|darwin)-(?:arm64|amd64))[.]json$/u.exec(name);
	return manifest ? manifest[1] : null;
}

function clientProvenanceIdentity(bytes, expectedVersion) {
	try {
		const manifest = JSON.parse(bytes?.toString("utf8") ?? "");
		return JSON.stringify(requireClientProvenance(manifest?.client, expectedVersion, "merge_client_provenance_invalid"));
	} catch (error) {
		if (error instanceof WorkerReleaseAssetsError) throw error;
		fail("merge_client_provenance_invalid", "Merged worker release assets require valid client package provenance.");
	}
}

function requireClientProvenance(value, expectedVersion, code) {
	if (
		value?.package !== "@corca-ai/ceal" ||
		value.version !== expectedVersion ||
		value.filename !== `corca-ai-ceal-${expectedVersion}.tgz` ||
		!Number.isSafeInteger(value.bytes) ||
		value.bytes <= 0 ||
		typeof value.sha256 !== "string" ||
		!/^[a-f0-9]{64}$/u.test(value.sha256)
	)
		fail(code, "Worker release assets require exact packed client package provenance.");
	return {
		package: value.package,
		version: value.version,
		filename: value.filename,
		bytes: value.bytes,
		sha256: value.sha256,
	};
}

function readPackageVersion(repoRoot, relativeDirectory) {
	try {
		const manifest = JSON.parse(readFileSync(path.join(repoRoot, relativeDirectory, "package.json"), "utf8"));
		if (typeof manifest.version !== "string") throw new Error("invalid_version");
		return manifest.version;
	} catch {
		fail("merge_client_provenance_invalid", "Merged worker release assets require the owned client package manifest.");
	}
}

function readInventory(directory) {
	const bytes = readStagedFile(path.join(directory, "SHA256SUMS"), "merge_input_incomplete").toString("utf8");
	const lines = bytes.split("\n").filter(Boolean);
	const entries = lines.map((line) => /^([a-f0-9]{64}) {2}(\S+)$/u.exec(line));
	if (lines.length === 0 || entries.some((entry) => entry === null))
		fail("merge_input_incomplete", "Composed worker asset inventory is malformed.");
	return entries.map((entry) => [entry[2], entry[1]]);
}

function carrierContractIdentity(bytes, sourceCarrierContract) {
	try {
		const manifest = JSON.parse(bytes?.toString("utf8") ?? "");
		const carrier = manifest?.private_leased_consumer_carrier;
		if (
			manifest?.schema_version !== "ceal.worker_release_manifest.v1" ||
			!carrier ||
			typeof carrier.contract_sha256 !== "string" ||
			!/^[a-f0-9]{64}$/u.test(carrier.contract_sha256) ||
			typeof carrier.contract_json !== "string" ||
			!carrier.contract_json.startsWith("{")
		)
			throw new Error("invalid_manifest");
		if (carrier.contract_sha256 !== sourceCarrierContract.sha256 || carrier.contract_json !== sourceCarrierContract.bytes.toString("utf8"))
			fail(
				"merge_private_carrier_contract_drift",
				"Merged worker release assets refuse a carrier contract that differs from the source contract.",
			);
		return `${carrier.contract_sha256}:${carrier.contract_json}`;
	} catch (error) {
		if (error instanceof WorkerReleaseAssetsError) throw error;
		fail(
			"merge_private_carrier_contract_invalid",
			"Merged worker release assets require each platform manifest to declare a valid private carrier contract.",
		);
	}
}

function carrierHandoffIdentity(bytes, sourceCarrierHandoff) {
	try {
		const handoff = JSON.parse(bytes?.toString("utf8") ?? "")?.private_leased_consumer_handoff;
		if (
			!handoff ||
			typeof handoff.path !== "string" ||
			typeof handoff.sha256 !== "string" ||
			!/^[a-f0-9]{64}$/u.test(handoff.sha256) ||
			typeof handoff.source_repository !== "string" ||
			!Array.isArray(handoff.vector_ids) ||
			handoff.vector_ids.some((value) => typeof value !== "string")
		)
			throw new Error("invalid_manifest");
		// The manifest field IS the verifier's return value, the same way compose
		// writes it, so the comparison is over the whole record rather than a digest
		// inside it.
		if (JSON.stringify(handoff) !== JSON.stringify(sourceCarrierHandoff))
			fail(
				"merge_private_carrier_handoff_drift",
				"Merged worker release assets refuse a Gateway handoff that differs from the source handoff.",
			);
		return JSON.stringify(handoff);
	} catch (error) {
		if (error instanceof WorkerReleaseAssetsError) throw error;
		fail(
			"merge_private_carrier_handoff_invalid",
			"Merged worker release assets require each platform manifest to declare a valid private Gateway handoff.",
		);
	}
}

function controlSessionContractIdentity(bytes, sourceControlSessionContract) {
	try {
		const manifest = JSON.parse(bytes?.toString("utf8") ?? "");
		const controlSession = manifest?.private_leased_consumer_control_session;
		if (
			manifest?.schema_version !== "ceal.worker_release_manifest.v1" ||
			!controlSession ||
			typeof controlSession.contract_sha256 !== "string" ||
			!/^[a-f0-9]{64}$/u.test(controlSession.contract_sha256) ||
			typeof controlSession.contract_json !== "string" ||
			!controlSession.contract_json.startsWith("{")
		)
			throw new Error("invalid_manifest");
		if (
			controlSession.contract_sha256 !== sourceControlSessionContract.sha256 ||
			controlSession.contract_json !== sourceControlSessionContract.bytes.toString("utf8")
		)
			fail(
				"merge_private_control_session_contract_drift",
				"Merged worker release assets refuse a control-session contract that differs from the source contract.",
			);
		return `${controlSession.contract_sha256}:${controlSession.contract_json}`;
	} catch (error) {
		if (error instanceof WorkerReleaseAssetsError) throw error;
		fail(
			"merge_private_control_session_contract_invalid",
			"Merged worker release assets require each platform manifest to declare a valid private control-session contract.",
		);
	}
}

function writeChecksumInventory(directory) {
	const names = readdirSync(directory)
		.filter((name) => name !== MARKER && name !== "SHA256SUMS")
		.sort();
	const lines = names.map((name) => `${sha256(readFileSync(path.join(directory, name)))}  ${name}`);
	writeFileSync(path.join(directory, "SHA256SUMS"), `${lines.join("\n")}\n`, { mode: 0o644 });
}

function requireAssetDirectory(value) {
	if (typeof value !== "string" || !path.isAbsolute(value))
		fail("merge_inputs_required", "Merged worker asset inputs must be absolute directories.");
	const directory = path.resolve(value);
	if (!existsSync(directory) || !lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink())
		fail("merge_inputs_required", "Merged worker asset input is not a regular directory.");
	if (!existsSync(path.join(directory, MARKER)))
		fail("merge_inputs_required", "Merged worker asset input is not a marked composed asset set.");
	return directory;
}

function readStagedFile(file, code) {
	if (!existsSync(file) || !lstatSync(file).isFile() || lstatSync(file).isSymbolicLink())
		fail(code, `Worker release asset input ${path.basename(file)} is unavailable.`);
	return readFileSync(file);
}

function sha256(bytes) {
	return createHash("sha256").update(bytes).digest("hex");
}
function fail(code, message) {
	throw new WorkerReleaseAssetsError(code, message);
}

function parseArgs(argv) {
	const [mode, ...rest] = argv;
	const options = { force: false, inputs: [] };
	let json = false;
	for (let index = 0; index < rest.length; index += 1) {
		const arg = rest[index];
		if (arg === "--help" || arg === "-h") return { help: true, json, mode, options };
		if (arg === "--json") {
			json = true;
			continue;
		}
		if (arg === "--force") {
			options.force = true;
			continue;
		}
		// Consuming the operand and refusing a missing one is the same act for
		// every valued flag; only where the value lands differs.
		const takeValue = () => {
			const value = rest[++index];
			if (typeof value !== "string") fail("invalid_argument", "Worker release assets option requires a value.");
			return value;
		};
		if (arg === "--input") {
			options.inputs.push(takeValue());
			continue;
		}
		if (["--out", "--platform", "--version", "--gateway-handoff-archive"].includes(arg)) {
			const name = arg === "--out" ? "outputDirectory" : arg === "--gateway-handoff-archive" ? "gatewayHandoffArchive" : arg.slice(2);
			options[name] = takeValue();
			continue;
		}
		fail("invalid_argument", "Unexpected worker release assets argument.");
	}
	return { help: false, json, mode, options };
}

export async function runCli(argv, io = console) {
	const json = argv.includes("--json");
	try {
		const parsed = parseArgs(argv);
		if (parsed.help || (parsed.mode !== "compose" && parsed.mode !== "merge")) {
			io.log(
				"usage: node scripts/build-worker-release-assets.mjs compose --out <absolute-dir> --gateway-handoff-archive <absolute-tar.gz> [--version <semver>] [--platform <current-platform>] [--force] [--json]\n       node scripts/build-worker-release-assets.mjs merge --out <absolute-dir> --input <composed-dir> [--input <composed-dir> ...] [--force] [--json]",
			);
			return parsed.help ? 0 : 2;
		}
		const result = parsed.mode === "compose" ? await composeWorkerReleaseAssets(parsed.options) : mergeWorkerReleaseAssetSets(parsed.options);
		io.log(json ? JSON.stringify(result, null, 2) : `Prepared worker release assets in ${result.output_dir}.`);
		return 0;
	} catch (error) {
		const known = error instanceof WorkerReleaseAssetsError;
		const payload = {
			schema_version: "ceal.worker_release_assets_error.v1",
			ok: false,
			error_code: known ? error.code : "worker_release_assets_failed",
			message: known ? error.message : "Could not prepare worker release assets.",
		};
		if (json) io.log(JSON.stringify(payload));
		else io.error(payload.message);
		return 2;
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
	process.exitCode = await runCli(process.argv.slice(2));
