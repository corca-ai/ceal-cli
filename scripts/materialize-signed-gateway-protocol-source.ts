#!/usr/bin/env node

import { type ExecFileSyncOptions, execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isGitObject } from "./lib/git-object.ts";

const ORIGIN = "https://github.com/corca-ai/ceal.git";
const TAG = /^gateway-protocol-handoff-v\d+[.]\d+[.]\d+$/u;

type SignedGatewayProtocolSourceInput = {
	readonly tag: string;
	readonly commit: string;
	readonly protocolTree: string;
	readonly outputDirectory: string;
};

type ExecFileSyncRunner = (file: string, args: string[], options?: ExecFileSyncOptions) => string | Buffer;

type SignedGatewayProtocolSourceDependencies = {
	readonly git?: ExecFileSyncRunner;
	readonly archive?: ExecFileSyncRunner;
};

export function materializeSignedGatewayProtocolSource(
	{ tag, commit, protocolTree, outputDirectory }: SignedGatewayProtocolSourceInput,
	dependencies: SignedGatewayProtocolSourceDependencies = {},
) {
	if (!TAG.test(tag ?? "") || !isGitObject(commit) || !isGitObject(protocolTree) || !path.isAbsolute(outputDirectory ?? ""))
		throw new Error("invalid_signed_protocol_source_input");
	if (existsSync(outputDirectory)) throw new Error("signed_protocol_source_output_exists");
	const git = dependencies.git ?? execFileSync;
	const archive = dependencies.archive ?? execFileSync;
	const work = mkdtempSync(path.join(tmpdir(), "ceal-signed-protocol-source-"));
	const repository = path.join(work, "repository");
	const extraction = path.join(work, "extraction");
	try {
		mkdirSync(repository, { mode: 0o700 });
		git("git", ["init", "--quiet"], { cwd: repository, stdio: "pipe" });
		git("git", ["fetch", "--quiet", "--depth=1", ORIGIN, `refs/tags/${tag}:refs/tags/${tag}`], { cwd: repository, stdio: "pipe" });
		const observedCommit = String(git("git", ["rev-list", "-n", "1", tag], { cwd: repository, encoding: "utf8", stdio: "pipe" })).trim();
		if (observedCommit !== commit) throw new Error("signed_protocol_source_commit_mismatch");
		const observedTree = String(
			git("git", ["rev-parse", `${commit}:packages/ceal-protocol`], { cwd: repository, encoding: "utf8", stdio: "pipe" }),
		).trim();
		if (observedTree !== protocolTree) throw new Error("signed_protocol_source_tree_mismatch");
		const listing = String(
			git("git", ["ls-tree", "-r", commit, "--", "packages/ceal-protocol"], { cwd: repository, encoding: "utf8", stdio: "pipe" }),
		);
		if (
			!listing ||
			listing
				.split("\n")
				.filter(Boolean)
				.some((line) => !/^100644 blob [a-f0-9]{40}\tpackages\/ceal-protocol\/[A-Za-z0-9._/-]+$/u.test(line))
		)
			throw new Error("signed_protocol_source_inventory_unsafe");
		mkdirSync(extraction, { mode: 0o700 });
		const tarBytes = archive("git", ["archive", "--format=tar", commit, "packages/ceal-protocol"], {
			cwd: repository,
			stdio: ["ignore", "pipe", "pipe"],
		});
		execFileSync("tar", ["-xf", "-", "-C", extraction], { input: tarBytes, stdio: ["pipe", "pipe", "pipe"] });
		const source = path.join(extraction, "packages", "ceal-protocol");
		assertRegularTree(source);
		mkdirSync(path.dirname(outputDirectory), { recursive: true });
		renameSync(source, outputDirectory);
		return {
			repository: "corca-ai/ceal",
			tag,
			commit,
			protocol_tree: protocolTree,
			acquisition: "authenticated_https_exact_tag_git_archive",
		};
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
}

function assertRegularTree(root: string): void {
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		const target = path.join(root, entry.name);
		if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile()) || lstatSync(target).isSymbolicLink())
			throw new Error("signed_protocol_source_inventory_unsafe");
		if (entry.isDirectory()) assertRegularTree(target);
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		if (process.argv.length !== 6) throw new Error("invalid_arguments");
		const [tag, commit, protocolTree, outputDirectory] = process.argv.slice(2);
		if (tag === undefined || commit === undefined || protocolTree === undefined || outputDirectory === undefined)
			throw new Error("invalid_arguments");
		console.log(
			JSON.stringify(
				materializeSignedGatewayProtocolSource({
					tag,
					commit,
					protocolTree,
					outputDirectory,
				}),
			),
		);
	} catch (error) {
		console.error(JSON.stringify({ ok: false, error_code: error instanceof Error ? error.message : "signed_protocol_source_failed" }));
		process.exitCode = 2;
	}
}
