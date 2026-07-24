import { existsSync, lstatSync, readdirSync } from "node:fs";
import path from "node:path";

// First ceal-audit delivery inside the worker: a read-only local inventory of
// supported agent runtimes' native transcript roots, rendered by the observer
// Workbench shell. The masterplan fixes the vocabulary consumed here — one
// normalized contract shared by the Codex and Claude adapters, collector
// health (active/stale/inactive/unknown), and evidence coverage
// (ceal-mediated/hook-enhanced/transcript-observed/unsupported) — and this
// slice deliberately stops at session inventory: transcript files are listed
// by identity, recency, and size, but their content is never opened, so no
// redaction path exists to fail. A permission or read failure reports
// `unknown`, never a fabricated inventory; an unimplemented adapter reports
// `unsupported`, never silence. Neither adapter's coverage claim generalizes
// to the other.

const CLAUDE_ROOT = ".claude";
const CODEX_ROOT = ".codex";
// A transcript newer than this marks the collector `active`; anything older
// but present is `stale`. Inventory freshness, not a liveness probe.
const ACTIVE_WINDOW_MS = 24 * 60 * 60 * 1000;
// Bound the directory walk so a pathological root cannot stall the observer.
const MAX_ENTRIES_EXAMINED = 2000;
const RENDERED_SESSIONS = 10;
const SESSION_FILE = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}[.]jsonl$/u;

export interface CealAgentAuditSession {
	sessionRef: string;
	lastActivityAt: number;
	transcriptBytes: number;
}

export interface CealAgentAuditAdapterState {
	runtime: "claude" | "codex";
	root: string;
	health: "active" | "stale" | "inactive" | "unknown";
	coverage: "transcript-observed" | "unsupported";
	depth?: "session_inventory";
	sessionCount?: number;
	sessions?: CealAgentAuditSession[];
	note?: string;
}

export interface CealAgentAuditState {
	schemaVersion: "ceal.agent_activity.v1";
	adapters: CealAgentAuditAdapterState[];
	nonClaims: string[];
}

export function inspectAgentAudit(home: string | undefined, now: number): CealAgentAuditState {
	const adapters: CealAgentAuditAdapterState[] = [
		observeClaudeAdapter(home, now),
		{
			runtime: "codex",
			root: `~/${CODEX_ROOT}`,
			health: "unknown",
			coverage: "unsupported",
			note: "The Codex adapter is not implemented yet; absent data is a coverage gap, not proof of inactivity.",
		},
	];
	return {
		schemaVersion: "ceal.agent_activity.v1",
		adapters,
		nonClaims: [
			"Session inventory only: transcript content is never read, copied, or forwarded.",
			"Local recency evidence, not a surveillance or completeness claim; a stopped or unreadable collector is an explicit gap.",
		],
	};
}

function observeClaudeAdapter(home: string | undefined, now: number): CealAgentAuditAdapterState {
	const base: CealAgentAuditAdapterState = {
		runtime: "claude",
		root: `~/${CLAUDE_ROOT}`,
		health: "unknown",
		coverage: "transcript-observed",
		depth: "session_inventory",
	};
	if (!home || !path.isAbsolute(home)) return base;
	const projects = path.join(home, CLAUDE_ROOT, "projects");
	if (!existsSync(projects)) return { ...base, health: "inactive", sessionCount: 0, sessions: [] };
	let sessions: CealAgentAuditSession[];
	try {
		sessions = collectClaudeSessions(projects);
	} catch {
		return base;
	}
	if (sessions.length === 0) return { ...base, health: "inactive", sessionCount: 0, sessions: [] };
	sessions.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
	return {
		...base,
		health: now - sessions[0].lastActivityAt < ACTIVE_WINDOW_MS ? "active" : "stale",
		sessionCount: sessions.length,
		sessions: sessions.slice(0, RENDERED_SESSIONS),
	};
}

// Claude Code stores one JSONL transcript per session under
// ~/.claude/projects/<project-directory>/<session-uuid>.jsonl. Only the file
// identity and stat metadata are consumed.
function collectClaudeSessions(projects: string): CealAgentAuditSession[] {
	const sessions: CealAgentAuditSession[] = [];
	let examined = 0;
	const root = lstatSync(projects);
	if (root.isSymbolicLink() || !root.isDirectory()) throw new Error("unsafe_root");
	for (const project of readdirSync(projects)) {
		if (examined >= MAX_ENTRIES_EXAMINED) break;
		examined += 1;
		const projectDirectory = path.join(projects, project);
		let projectStat;
		try { projectStat = lstatSync(projectDirectory); } catch { continue; }
		if (projectStat.isSymbolicLink() || !projectStat.isDirectory()) continue;
		let files: string[];
		try { files = readdirSync(projectDirectory); } catch { continue; }
		for (const file of files) {
			if (examined >= MAX_ENTRIES_EXAMINED) break;
			examined += 1;
			if (!SESSION_FILE.test(file)) continue;
			const transcript = path.join(projectDirectory, file);
			let stat;
			try { stat = lstatSync(transcript); } catch { continue; }
			if (stat.isSymbolicLink() || !stat.isFile()) continue;
			sessions.push({
				sessionRef: file.slice(0, -".jsonl".length),
				lastActivityAt: stat.mtimeMs,
				transcriptBytes: stat.size,
			});
		}
	}
	return sessions;
}
