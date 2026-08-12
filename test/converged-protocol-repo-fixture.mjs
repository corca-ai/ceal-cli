import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_GATEWAY_COMMIT = "a".repeat(40);
const FIXTURE_GATEWAY_TREE = "b".repeat(40);

/**
 * Build the smallest real Git checkout whose frozen Protocol copy, pin, and
 * shipment lock agree. Contract tests use it to exercise post-guard behavior
 * without weakening the production guard or borrowing the live checkout's
 * current release-readiness state.
 */
export function createProtocolRepoFixture({ acceptanceCli = false, diverged = false } = {}) {
	const root = mkdtempSync(path.join(tmpdir(), "ceal-converged-protocol-"));
	copy("packages/ceal-protocol", root);
	copy("packages/ceal-client/package.json", root);
	copy("packages/ceal-worker-cli/package.json", root);
	copy("skills/ceal-guide", root);
	copy("scripts/assets/ceal-guide-compatibility-SKILL.md", root);
	copy("worker-release-inputs.json", root);
	copy("install-ceal.sh", root);
	mkdirSync(path.join(root, "docs", "requests"), { recursive: true });
	writeFileSync(path.join(root, "docs", "requests", "README.md"), "# Fixture request\n");

	if (acceptanceCli) {
		copy("scripts", root);
		copy("packages/ceal-worker-cli/dist", root);
	}

	runFixtureGit(root, ["init", "--quiet"]);
	runFixtureGit(root, ["config", "user.name", "Ceal Contract Fixture"]);
	runFixtureGit(root, ["config", "user.email", "fixture@invalid.example"]);
	runFixtureGit(root, ["add", "."]);
	runFixtureGit(root, ["commit", "--quiet", "-m", "fixture: seed protocol tree"]);
	const protocolTree = runFixtureGit(root, ["rev-parse", "HEAD:packages/ceal-protocol"]);

	const lock = JSON.parse(readFileSync(path.join(SOURCE_ROOT, "gateway-protocol-handoff-lock.json"), "utf8"));
	lock.gateway.commit = FIXTURE_GATEWAY_COMMIT;
	lock.gateway.tree = FIXTURE_GATEWAY_TREE;
	lock.gateway.protocol_tree = protocolTree;
	writeJson(path.join(root, "gateway-protocol-handoff-lock.json"), lock);

	const pin = JSON.parse(readFileSync(path.join(SOURCE_ROOT, "protocol-vendor-pin.json"), "utf8"));
	pin.source.commit = diverged ? "c".repeat(40) : FIXTURE_GATEWAY_COMMIT;
	pin.source.tree = protocolTree;
	pin.shipped.status = diverged ? "diverged" : "agreed";
	pin.shipped.gateway_commit = FIXTURE_GATEWAY_COMMIT;
	pin.shipped.protocol_tree = protocolTree;
	if (diverged) {
		pin.shipped.reason = "fixture divergence";
		pin.shipped.disposition_owner = "fixture";
		pin.shipped.disposition_request = "docs/protocol-quarantine.md";
	} else {
		delete pin.shipped.reason;
		delete pin.shipped.disposition_owner;
		delete pin.shipped.disposition_request;
	}
	writeJson(path.join(root, "protocol-vendor-pin.json"), pin);

	runFixtureGit(root, ["add", "."]);
	runFixtureGit(root, ["commit", "--quiet", "-m", "fixture: bind converged protocol identity"]);
	return {
		root,
		gateway: { repository: lock.gateway.repository, commit: lock.gateway.commit, tree: lock.gateway.tree, protocol_tree: protocolTree },
		cleanup: () => rmSync(root, { recursive: true, force: true }),
	};
}

function copy(relative, destinationRoot) {
	const source = path.join(SOURCE_ROOT, relative);
	const destination = path.join(destinationRoot, relative);
	mkdirSync(path.dirname(destination), { recursive: true });
	cpSync(source, destination, { recursive: true });
}

export function runFixtureGit(root, args) {
	return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function writeJson(file, value) {
	writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}
