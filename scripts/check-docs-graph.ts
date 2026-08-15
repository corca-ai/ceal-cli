import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const AWIKI_INSTALL_COMMAND =
	"cargo install --git https://github.com/corca-ai/awiki --rev f65f8c43dbf0300609bdfdf823c09cba370222c6 --locked awiki";

export interface AwikiResult {
	status: number | null;
	stdout: string;
	stderr: string;
	error?: unknown;
}

export interface DocsGraphCheckOptions {
	cwd?: string;
	runAwiki?: (cwd: string) => AwikiResult;
	write?: (message: string) => void;
}

function runAwiki(cwd: string): AwikiResult {
	const result = spawnSync("awiki", ["lint", "-root", "docs"], {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "", error: result.error };
}

interface GraphSummary {
	kind: "connected" | "failed";
	documents: number;
	orphans: number;
	islands: number;
	linkOnlyLines: number;
}

function parseSummary(output: string): GraphSummary | undefined {
	const summaryLine = output.split(/\r?\n/u).find((line) => /^\/\/ (?:ok connected_graph|lint_failed)\b/u.test(line));
	if (!summaryLine) return undefined;
	const connectedGraph = /^\/\/ ok connected_graph\b/u.test(summaryLine);
	const values = new Map<string, string>();
	for (const match of summaryLine.matchAll(/\b([a-z_]+)=([0-9]+(?:\.[0-9]+)?)\b/gu)) {
		if (values.has(match[1])) return undefined;
		values.set(match[1], match[2]);
	}
	const count = (name: string): number | undefined => {
		const value = values.get(name);
		if (value === undefined || !/^(?:0|[1-9][0-9]*)$/u.test(value)) return undefined;
		const parsed = Number(value);
		return Number.isSafeInteger(parsed) ? parsed : undefined;
	};
	const documents = count("documents");
	const orphanRateText = values.get("orphan_rate");
	const orphanRate = orphanRateText === undefined ? undefined : Number(orphanRateText);
	const explicitOrphans = count("orphans") ?? count("orphan_count");
	const orphans = explicitOrphans ?? (orphanRate === undefined ? undefined : orphanRate > 0 ? 1 : 0);
	const islands = count("islands") ?? count("island_count") ?? (connectedGraph ? 0 : undefined);
	const linkOnlyLines = count("link_only_lines") ?? (connectedGraph ? 0 : undefined);
	if (
		documents === undefined ||
		orphans === undefined ||
		islands === undefined ||
		linkOnlyLines === undefined ||
		![documents, orphans, islands, linkOnlyLines].every(Number.isFinite)
	)
		return undefined;
	if (explicitOrphans !== undefined && orphanRate !== undefined && (explicitOrphans === 0) !== (orphanRate === 0)) return undefined;
	return { kind: connectedGraph ? "connected" : "failed", documents, orphans, islands, linkOnlyLines };
}

export function checkDocsGraph(options: DocsGraphCheckOptions = {}): number {
	const cwd = options.cwd ?? process.cwd();
	const write = options.write ?? ((message: string) => process.stderr.write(`${message}\n`));
	const result = (options.runAwiki ?? runAwiki)(cwd);
	if (result.error !== undefined) {
		const code = result.error instanceof Error && "code" in result.error ? result.error.code : undefined;
		if (code === "ENOENT") {
			write(`awiki is not installed; install the pinned prerequisite with: ${AWIKI_INSTALL_COMMAND}`);
			return 3;
		}
		write(`unable to run awiki: ${result.error instanceof Error ? result.error.message : String(result.error)}`);
		return 3;
	}
	if (result.status !== 0 && result.status !== 1) {
		write(`awiki ended without a supported exit status: ${String(result.status)}`);
		return 3;
	}
	const summary = parseSummary(`${result.stdout}\n${result.stderr}`);
	if (!summary) {
		write("awiki produced no parseable docs graph summary; refusing to pass the gate");
		return 3;
	}
	write(`docs graph: documents=${summary.documents} orphans=${summary.orphans} islands=${summary.islands}`);
	if (summary.documents === 0 || summary.orphans > 0 || summary.islands > 0) return 1;
	if (result.status === 0 && summary.kind === "connected" && summary.linkOnlyLines === 0) return 0;
	if (result.status === 1 && summary.kind === "failed" && summary.linkOnlyLines > 0) {
		write(`docs graph connectivity is clean; awiki reported ${summary.linkOnlyLines} link-only style finding(s) separately`);
		return 0;
	}
	write("awiki status and summary disagree; refusing to pass the gate");
	return 3;
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) process.exitCode = checkDocsGraph();
