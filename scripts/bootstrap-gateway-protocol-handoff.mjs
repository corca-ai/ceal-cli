#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { codedErrorClass } from "./lib/coded-error.ts";
import { assertGatewayHandoffArchiveInventory, extractGatewayHandoffArchive } from "./worker-gateway-handoff-archive.mjs";
import { validateGatewayHandoffPacketFiles } from "./worker-release-inputs.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ORIGIN = "https://ceal.borca.ai/releases/gateway-protocol-handoff";
const REPOSITORY = "corca-ai/ceal";
const WORKFLOW_PATH = ".github/workflows/gateway-protocol-handoff-release.yml";
const OIDC_ISSUER = "https://token.actions.githubusercontent.com";
const TAG_PATTERN = /^gateway-protocol-handoff-v(\d+\.\d+\.\d+)$/u;
const GIT_OBJECT_ID = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;

export const GatewayProtocolHandoffBootstrapError = codedErrorClass("GatewayProtocolHandoffBootstrapError");

/**
 * Authenticates one public Gateway handoff before any repository mutation and
 * emits the exact lock value the consumer may review and apply. Successful
 * downloads remain in a private OS-temporary directory for the subsequent
 * locked consumption step; this function never writes below `repoRoot`.
 */
export function bootstrapGatewayProtocolHandoff(options = {}, dependencies = {}) {
	const repoRoot = path.resolve(options.repoRoot ?? ROOT);
	const tag = requireTag(options.tag);
	const version = TAG_PATTERN.exec(tag)[1];
	const archiveName = `ceal-gateway-protocol-handoff-${version}.tar.gz`;
	const protocolName = `corca-ai-ceal-protocol-${version}.tgz`;
	const assetNames = [archiveName, `${archiveName}.sig`, `${archiveName}.pem`, "SHA256SUMS"];
	const downloadDirectory = mkdtempSync(path.join(tmpdir(), "ceal-gateway-handoff-verified-"));
	const extraction = path.join(downloadDirectory, "packet");
	try {
		assertOutsideRepository(repoRoot, downloadDirectory);
		for (const name of assetNames) {
			const destination = path.join(downloadDirectory, name);
			(dependencies.download ?? downloadAsset)(`${ORIGIN}/${tag}/${name}`, destination);
			requireRegularFile(destination, "handoff_asset_unavailable");
		}
		const archive = path.join(downloadDirectory, archiveName);
		const archiveSha256 = sha256(readFileSync(archive));
		assertChecksumFile(path.join(downloadDirectory, "SHA256SUMS"), archiveName, archiveSha256);
		const remoteCommit = (dependencies.resolveRemoteTag ?? resolveRemoteTag)(tag);
		if (!GIT_OBJECT_ID.test(remoteCommit)) fail("gateway_tag_unverified", "Gateway handoff tag did not resolve to one immutable commit.");
		const certificateIdentity = `https://github.com/${REPOSITORY}/${WORKFLOW_PATH}@refs/tags/${tag}`;
		const signature = (dependencies.verifySignature ?? verifySignature)({
			archive,
			certificate: path.join(downloadDirectory, `${archiveName}.pem`),
			signature: path.join(downloadDirectory, `${archiveName}.sig`),
			certificateIdentity,
			tag,
			commit: remoteCommit,
			directory: downloadDirectory,
		});
		if (!Number.isSafeInteger(signature.actionsRunId) || signature.actionsRunId <= 0) {
			fail("gateway_signature_invalid", "Gateway handoff certificate has no valid Actions run identity.");
		}
		assertGatewayHandoffArchiveInventory(archive, protocolName);
		mkdirSync(extraction, { mode: 0o700 });
		(dependencies.extract ?? extractGatewayHandoffArchive)(archive, extraction);
		const manifest = path.join(extraction, "gateway-protocol-handoff.json");
		const handoffManifestSha256 = sha256(readFileSync(manifest));
		const packet = validateGatewayHandoffPacketFiles({
			protocolTarball: path.join(extraction, protocolName),
			protocolProvenance: path.join(extraction, "gateway-protocol-provenance.json"),
			controlConformance: path.join(extraction, "gateway-leased-consumer-control-conformance.json"),
			handoffManifest: manifest,
			expectedHandoffSha256: handoffManifestSha256,
		});
		const controlRoutesSha256 = controlRoutesDigest(path.join(extraction, "gateway-leased-consumer-control-conformance.json"));
		if (packet.producer.commit !== remoteCommit || packet.protocol.version !== version || packet.protocol.filename !== protocolName) {
			fail("gateway_handoff_identity_mismatch", "Signed Gateway handoff bytes disagree with the remote tag or requested Protocol version.");
		}
		const candidateLock = {
			schema_version: "ceal.worker_gateway_protocol_handoff_lock.v2",
			status: "locked",
			gateway: {
				repository: REPOSITORY,
				workflow_path: WORKFLOW_PATH,
				commit: packet.producer.commit,
				tree: packet.producer.tree,
				protocol_tree: packet.producer.protocol_tree,
				tag,
				actions_run_id: signature.actionsRunId,
				origin: ORIGIN,
			},
			protocol: {
				package: "@corca-ai/ceal-protocol",
				version: packet.protocol.version,
				filename: packet.protocol.filename,
				sha256: packet.protocol.sha256,
			},
			archive: {
				filename: archiveName,
				sha256: archiveSha256,
				handoff_manifest_sha256: handoffManifestSha256,
				control_routes_sha256: controlRoutesSha256,
			},
			reviewed_signature: {
				certificate_identity: certificateIdentity,
				oidc_issuer: OIDC_ISSUER,
				workflow_sha: remoteCommit,
				run_invocation_uri: signature.runInvocationUri,
			},
			non_claims: [
				"This lock candidate was derived from one public signed handoff and remote tag readback; it does not promise that either surface remains available later.",
				"The worker release lane binds the downloaded archive by archive.sha256 after this review; it does not re-run the public Sigstore verification while building.",
				"Gateway tree identities come from the signed handoff manifest. The consumer separately proves the frozen Protocol tree after it is vendored.",
			],
		};
		return {
			schema_version: "ceal.worker_gateway_protocol_handoff_bootstrap.v1",
			ok: true,
			proof_level: "public_signed_artifact",
			writes_repository: false,
			retained_download_directory: downloadDirectory,
			archive_file: archive,
			candidate_lock: candidateLock,
			non_claims: [
				"The retained download directory is temporary input, not a repository pin, worker release, installation, or live Gateway readback.",
			],
		};
	} catch (error) {
		rmSync(downloadDirectory, { recursive: true, force: true });
		throw error;
	}
}

function requireTag(value) {
	if (typeof value !== "string" || !TAG_PATTERN.test(value)) fail("invalid_gateway_handoff_tag", "Gateway handoff tag is invalid.");
	return value;
}

function downloadAsset(url, destination) {
	try {
		execFileSync(
			"curl",
			[
				"--fail",
				"--silent",
				"--show-error",
				"--location",
				"--proto",
				"=https",
				"--tlsv1.2",
				"--connect-timeout",
				"10",
				"--max-time",
				"120",
				"--retry",
				"5",
				"--retry-delay",
				"3",
				"--retry-connrefused",
				url,
				"--output",
				destination,
			],
			{ stdio: "pipe" },
		);
	} catch {
		fail("handoff_download_failed", "Gateway handoff public asset could not be downloaded.");
	}
}

/**
 * @testOnly
 */
export function resolveRemoteTag(tag, run = execFileSync) {
	let output;
	try {
		output = run("git", ["ls-remote", "--tags", "https://github.com/corca-ai/ceal.git", `refs/tags/${tag}`, `refs/tags/${tag}^{}`], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
			timeout: 30_000,
		});
	} catch {
		fail("gateway_tag_unverified", "Gateway handoff remote tag could not be read.");
	}
	const lines = output.trim().split("\n").filter(Boolean);
	if (lines.length < 1 || lines.length > 2) fail("gateway_tag_unverified", "Gateway handoff tag did not resolve to one commit.");
	const refs = new Map();
	for (const line of lines) {
		const [objectId, ref, extra] = line.split(/\s+/u);
		if (extra || !GIT_OBJECT_ID.test(objectId) || refs.has(ref)) {
			fail("gateway_tag_unverified", "Gateway handoff tag response is invalid.");
		}
		refs.set(ref, objectId);
	}
	const directRef = `refs/tags/${tag}`;
	const peeledRef = `${directRef}^{}`;
	if (!refs.has(directRef) || [...refs.keys()].some((ref) => ref !== directRef && ref !== peeledRef)) {
		fail("gateway_tag_unverified", "Gateway handoff tag response is invalid.");
	}
	return refs.get(peeledRef) ?? refs.get(directRef);
}

function verifySignature({ archive, certificate, signature, certificateIdentity, tag, commit, directory }) {
	try {
		execFileSync(
			"cosign",
			[
				"verify-blob",
				"--certificate",
				certificate,
				"--signature",
				signature,
				"--certificate-identity",
				certificateIdentity,
				"--certificate-oidc-issuer",
				OIDC_ISSUER,
				"--certificate-github-workflow-name",
				"Gateway protocol handoff release",
				"--certificate-github-workflow-repository",
				REPOSITORY,
				"--certificate-github-workflow-ref",
				`refs/tags/${tag}`,
				"--certificate-github-workflow-sha",
				commit,
				"--certificate-github-workflow-trigger",
				"push",
				archive,
			],
			{ stdio: "pipe", timeout: 180_000 },
		);
	} catch {
		fail("gateway_signature_invalid", "Gateway handoff Sigstore signature or certificate identity is invalid.");
	}
	const certificatePem = decodedCertificate(readFileSync(certificate, "utf8"));
	const decodedPath = path.join(directory, "verified-certificate.pem");
	writeFileSync(decodedPath, certificatePem, { mode: 0o600, flag: "wx" });
	let text;
	try {
		text = execFileSync("openssl", ["x509", "-in", decodedPath, "-noout", "-text"], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
	} catch {
		fail("gateway_signature_invalid", "Gateway handoff certificate could not be inspected.");
	}
	const matches = [...text.matchAll(/https:\/\/github\.com\/corca-ai\/ceal\/actions\/runs\/(\d+)\/attempts\/1/gu)];
	if (matches.length !== 1) fail("gateway_signature_invalid", "Gateway handoff certificate has an ambiguous Actions run identity.");
	const actionsRunId = Number(matches[0][1]);
	return { actionsRunId, runInvocationUri: matches[0][0] };
}

function decodedCertificate(value) {
	if (value.startsWith("-----BEGIN CERTIFICATE-----")) return value;
	const compact = value.replaceAll(/\s/gu, "");
	if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(compact)) fail("gateway_signature_invalid", "Gateway handoff certificate encoding is invalid.");
	const decoded = Buffer.from(compact, "base64").toString("utf8");
	if (!decoded.startsWith("-----BEGIN CERTIFICATE-----") || !decoded.includes("-----END CERTIFICATE-----")) {
		fail("gateway_signature_invalid", "Gateway handoff certificate encoding is invalid.");
	}
	return decoded;
}

function assertChecksumFile(file, archiveName, observed) {
	const contents = readFileSync(file, "utf8");
	const match = /^([a-f0-9]{64}) {2}([^\r\n]+)\n?$/u.exec(contents);
	if (!match || match[2] !== archiveName || match[1] !== observed || !SHA256.test(match[1])) {
		fail("gateway_checksum_mismatch", "Gateway handoff archive does not match the signed release checksum inventory.");
	}
}

function assertOutsideRepository(repoRoot, target) {
	const relative = path.relative(repoRoot, target);
	if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..")) {
		fail("bootstrap_writes_repository", "Gateway handoff bootstrap staging must remain outside the repository.");
	}
}

function requireRegularFile(file, code) {
	if (!existsSync(file)) fail(code, "Gateway handoff bootstrap input is missing.");
	const stat = lstatSync(file);
	if (!stat.isFile() || stat.isSymbolicLink()) fail(code, "Gateway handoff bootstrap input must be a regular file.");
	return file;
}

function sha256(bytes) {
	return createHash("sha256").update(bytes).digest("hex");
}

function controlRoutesDigest(file) {
	let value;
	try {
		value = JSON.parse(readFileSync(file, "utf8"));
	} catch {
		fail("gateway_handoff_identity_mismatch", "Signed Gateway control conformance is invalid.");
	}
	if (!Array.isArray(value.operations) || value.operations.length !== 7) {
		fail("gateway_handoff_identity_mismatch", "Signed Gateway control conformance has no exact route projection.");
	}
	const routes = {};
	for (const entry of value.operations) {
		if (
			!entry ||
			typeof entry !== "object" ||
			typeof entry.operation !== "string" ||
			typeof entry.path !== "string" ||
			Object.hasOwn(routes, entry.operation)
		) {
			fail("gateway_handoff_identity_mismatch", "Signed Gateway control conformance has an invalid route projection.");
		}
		routes[entry.operation] = entry.path;
	}
	return sha256(Buffer.from(JSON.stringify(routes)));
}

function fail(code, message) {
	throw new GatewayProtocolHandoffBootstrapError(code, message);
}

export function runCli(argv, io = console) {
	const tagIndex = argv.indexOf("--tag");
	if (argv.length !== 2 || tagIndex !== 0) {
		io.error(
			JSON.stringify({ ok: false, error_code: "invalid_arguments", message: "Usage: npm run bootstrap:gateway-handoff -- --tag <tag>" }),
		);
		return 2;
	}
	try {
		io.log(JSON.stringify(bootstrapGatewayProtocolHandoff({ repoRoot: ROOT, tag: argv[1] }), null, 2));
		return 0;
	} catch (error) {
		const known = error instanceof GatewayProtocolHandoffBootstrapError;
		io.error(
			JSON.stringify({
				ok: false,
				error_code: known ? error.code : "gateway_handoff_bootstrap_failed",
				message: known ? error.message : "Gateway handoff bootstrap could not complete.",
			}),
		);
		return 2;
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = runCli(process.argv.slice(2));
