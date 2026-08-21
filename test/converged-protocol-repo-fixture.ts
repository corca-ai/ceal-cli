import { generateLeasedConsumerHandoffRuntime } from "../scripts/generate-leased-consumer-handoff-runtime.ts";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_GATEWAY_COMMIT = "a".repeat(40);
const FIXTURE_GATEWAY_TREE = "b".repeat(40);
const FIXTURE_PROTOCOL_TREE = "e".repeat(40);

/**
 * Build the smallest real Git checkout whose vendored Protocol artifact and
 * shipment lock agree. Contract tests use it to exercise post-guard behavior
 * without weakening the production guard or borrowing the live checkout's
 * current release-readiness state.
 *
 * The `diverged` option is gone with the tree it described. While the Protocol was
 * an editable copy, "what we test" and "what we ship" were different objects that
 * could disagree, and a fixture had to be able to construct that disagreement. The
 * repository now consumes the signed archive itself, so proof and shipment are the
 * same bytes and the diverged state has no constructor — not because this fixture
 * declines to build it, but because there is nothing left to build it out of.
 */
export function createProtocolRepoFixture({ acceptanceCli = false, releaseBuild = false } = {}) {
	const root = mkdtempSync(path.join(tmpdir(), "ceal-converged-protocol-"));
	const lock = JSON.parse(readFileSync(path.join(SOURCE_ROOT, "gateway-protocol-handoff-lock.json"), "utf8"));
	// The REAL archive, copied byte-for-byte. A synthesized stand-in would not hash
	// to `lock.protocol.sha256`, and rewriting the lock to match a stand-in would
	// make every fixture-backed release test pass against bytes no release consumes.
	copy(`vendor/ceal-protocol/${lock.protocol.filename}`, root);
	copyOwnedPackage("packages/ceal-client", root, releaseBuild);
	copyOwnedPackage("packages/ceal-worker-cli", root, releaseBuild);
	copy("skills/ceal-guide", root);
	copy("scripts/assets/ceal-guide-compatibility-SKILL.md", root);
	copy("worker-release-inputs.json", root);
	copy("install-ceal.sh", root);
	copy(".gitignore", root);
	if (releaseBuild) {
		copy("THIRD_PARTY_NOTICES.txt", root);
		copy("gateway-leased-consumer-call-handoff-lock.json", root);
		copy("vendor/gateway-leased-consumer-call", root);
	}
	mkdirSync(path.join(root, "docs", "requests"), { recursive: true });
	writeFileSync(path.join(root, "docs", "requests", "README.md"), "# Fixture request\n");

	if (acceptanceCli) {
		copy("scripts", root);
		copy("packages/ceal-worker-cli/src/json-record.ts", root);
		copy("packages/ceal-worker-cli/dist", root);
	}

	// Only the producer identities are fixture values. `lock.protocol` is left
	// untouched so the archive's digest still binds, which is what the gate checks.
	lock.gateway.commit = FIXTURE_GATEWAY_COMMIT;
	lock.gateway.tree = FIXTURE_GATEWAY_TREE;
	lock.gateway.protocol_tree = FIXTURE_PROTOCOL_TREE;
	writeJson(path.join(root, "gateway-protocol-handoff-lock.json"), lock);

	runFixtureGit(root, ["init", "--quiet"]);
	runFixtureGit(root, ["config", "user.name", "Ceal Contract Fixture"]);
	runFixtureGit(root, ["config", "user.email", "fixture@invalid.example"]);
	runFixtureGit(root, ["add", "."]);
	runFixtureGit(root, ["commit", "--quiet", "-m", "fixture: seed vendored protocol artifact"]);
	if (releaseBuild) {
		const controlContractPath = path.join(root, "packages/ceal-worker-cli/leased-consumer-control-session-contract.json");
		const controlContract = JSON.parse(readFileSync(controlContractPath, "utf8"));
		controlContract.gateway_protocol_handoff.gateway_tag = lock.gateway.tag;
		controlContract.gateway_protocol_handoff.gateway_commit = lock.gateway.commit;
		controlContract.gateway_protocol_handoff.protocol_tree = lock.gateway.protocol_tree;
		controlContract.gateway_protocol_handoff.archive_sha256 = lock.archive.sha256;
		writeJson(controlContractPath, controlContract);
		generateLeasedConsumerHandoffRuntime({ repoRoot: root });
		// Only this branch produces anything to commit. The second commit used to be
		// unconditional because the pin was written after the first one; the pin is
		// gone and the lock is now written before it, so an unconditional commit here
		// fails outright on a clean tree rather than doing nothing.
		runFixtureGit(root, ["add", "."]);
		runFixtureGit(root, ["commit", "--quiet", "-m", "fixture: bind regenerated release contracts"]);
	}

	if (releaseBuild) {
		for (const dependency of ["typescript", "yaml", "undici-types", "@types/node", "@typescript/old"])
			copy(`node_modules/${dependency}`, root);
	}
	return {
		root,
		gateway: {
			repository: lock.gateway.repository,
			commit: lock.gateway.commit,
			tree: lock.gateway.tree,
			protocol_tree: FIXTURE_PROTOCOL_TREE,
		},
		cleanup: () => rmSync(root, { recursive: true, force: true }),
	};
}

function copyOwnedPackage(relative: string, destinationRoot: string, releaseBuild: boolean): void {
	copy(`${relative}/package.json`, destinationRoot);
	if (!releaseBuild) return;
	for (const entry of ["LICENSE", "src", "tsconfig.build.json", "tsconfig.json"]) copy(`${relative}/${entry}`, destinationRoot);
	if (relative.endsWith("ceal-worker-cli")) {
		copy(`${relative}/leased-consumer-carrier-contract.json`, destinationRoot);
		copy(`${relative}/leased-consumer-control-session-contract.json`, destinationRoot);
	}
}

function copy(relative: string, destinationRoot: string): void {
	const source = path.join(SOURCE_ROOT, relative);
	const destination = path.join(destinationRoot, relative);
	mkdirSync(path.dirname(destination), { recursive: true });
	cpSync(source, destination, { recursive: true });
}

export function runFixtureGit(root: string, args: readonly string[]): string {
	return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function writeJson(file: string, value: unknown): void {
	writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}
