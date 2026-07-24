import { lstatSync, readdirSync } from "node:fs";
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
// `unknown`, never a fabricated inventory; an unimplemented adapter would
// report `unsupported`, never silence. Both adapters now stop at the same
// session-inventory depth, and neither's coverage claim generalizes to the
// other.

const CLAUDE_ROOT = ".claude";
const CODEX_ROOT = ".codex";
// A transcript newer than this marks the collector `active`; anything older
// but present is `stale`. Inventory freshness, not a liveness probe.
const ACTIVE_WINDOW_MS = 24 * 60 * 60 * 1000;
// Bound the directory walk so a pathological root cannot stall the observer.
const MAX_ENTRIES_EXAMINED = 2000;
const RENDERED_SESSIONS = 10;
// Exactly the UUID grammar Claude Code uses for transcript filenames, so a
// human-meaningful filename can never surface as a rendered session_ref.
const SESSION_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]jsonl$/iu;
// Codex rollouts live under sessions/YYYY/MM/DD; only the machine-generated
// rollout grammar is accepted, and only its UUID surfaces as a session_ref.
const CODEX_ROLLOUT_FILE = /^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})[.]jsonl$/iu;
const CODEX_DATE_SEGMENT = [/^\d{4}$/u, /^\d{2}$/u, /^\d{2}$/u];
const HEALTH_BASIS = "health derived from newest transcript mtime (active within 24h); not a liveness probe";

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
	/** Present as "partial" when the walk was truncated or a subtree was unreadable. */
	inventory?: "partial";
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
		observeCodexAdapter(home, now),
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
	const sessionsDirectory = home && path.isAbsolute(home) ? path.join(home, CLAUDE_ROOT, "projects") : null;
	return observeTranscriptAdapter("claude", `~/${CLAUDE_ROOT}`, sessionsDirectory, collectClaudeSessions, now);
}

function observeCodexAdapter(home: string | undefined, now: number): CealAgentAuditAdapterState {
	const sessionsDirectory = home && path.isAbsolute(home) ? path.join(home, CODEX_ROOT, "sessions") : null;
	return observeTranscriptAdapter("codex", `~/${CODEX_ROOT}`, sessionsDirectory, collectCodexSessions, now);
}

function observeTranscriptAdapter(
	runtime: CealAgentAuditAdapterState["runtime"],
	root: string,
	sessionsDirectory: string | null,
	collect: (directory: string) => { sessions: CealAgentAuditSession[]; partial: boolean },
	now: number,
): CealAgentAuditAdapterState {
	const base: CealAgentAuditAdapterState = {
		runtime,
		root,
		health: "unknown",
		coverage: "transcript-observed",
		depth: "session_inventory",
		note: HEALTH_BASIS,
	};
	if (!sessionsDirectory) return base;
	// Only a confirmed absence is `inactive`; a permission or lookup failure
	// stays `unknown` so a read failure can never fabricate an empty inventory.
	try {
		lstatSync(sessionsDirectory);
	} catch (error) {
		const code = error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : null;
		return code === "ENOENT" ? { ...base, health: "inactive", sessionCount: 0, sessions: [] } : base;
	}
	let collected: { sessions: CealAgentAuditSession[]; partial: boolean };
	try {
		collected = collect(sessionsDirectory);
	} catch {
		return base;
	}
	const { sessions, partial } = collected;
	const partialFields = partial
		? { inventory: "partial" as const, note: `${HEALTH_BASIS}; inventory truncated or partly unreadable` }
		: {};
	// A partial walk that found nothing proves nothing about inactivity.
	if (sessions.length === 0) {
		return partial ? { ...base, ...partialFields } : { ...base, health: "inactive", sessionCount: 0, sessions: [] };
	}
	sessions.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
	return {
		...base,
		...partialFields,
		health: now - sessions[0].lastActivityAt < ACTIVE_WINDOW_MS ? "active" : "stale",
		sessionCount: sessions.length,
		sessions: sessions.slice(0, RENDERED_SESSIONS),
	};
}

// Claude Code stores one JSONL transcript per session under
// ~/.claude/projects/<project-directory>/<session-uuid>.jsonl. Only the file
// identity and stat metadata are consumed. `partial` reports an exhausted walk
// budget or an unreadable/vanished subtree so a truncated inventory is never
// presented as complete.
function collectClaudeSessions(projects: string): { sessions: CealAgentAuditSession[]; partial: boolean } {
	const sessions: CealAgentAuditSession[] = [];
	let examined = 0;
	let partial = false;
	const root = lstatSync(projects);
	if (root.isSymbolicLink() || !root.isDirectory()) throw new Error("unsafe_root");
	for (const project of readdirSync(projects)) {
		if (examined >= MAX_ENTRIES_EXAMINED) { partial = true; break; }
		examined += 1;
		const projectDirectory = path.join(projects, project);
		let projectStat;
		try { projectStat = lstatSync(projectDirectory); } catch { partial = true; continue; }
		if (projectStat.isSymbolicLink() || !projectStat.isDirectory()) continue;
		let files: string[];
		try { files = readdirSync(projectDirectory); } catch { partial = true; continue; }
		for (const file of files) {
			if (examined >= MAX_ENTRIES_EXAMINED) { partial = true; break; }
			examined += 1;
			if (!SESSION_FILE.test(file)) continue;
			const transcript = path.join(projectDirectory, file);
			let stat;
			try { stat = lstatSync(transcript); } catch { partial = true; continue; }
			if (stat.isSymbolicLink() || !stat.isFile()) continue;
			sessions.push({
				sessionRef: file.slice(0, -".jsonl".length),
				lastActivityAt: stat.mtimeMs,
				transcriptBytes: stat.size,
			});
		}
	}
	return { sessions, partial };
}

// Codex stores one JSONL rollout per session under
// ~/.codex/sessions/YYYY/MM/DD/rollout-<stamp>-<session-uuid>.jsonl. Only file
// identity and stat metadata are consumed, and only the machine-generated
// UUID surfaces as a session_ref. The date shards are walked newest-first so
// an exhausted budget truncates the oldest history, keeping recency-derived
// health honest under `inventory: partial`.
function collectCodexSessions(sessionsRoot: string): { sessions: CealAgentAuditSession[]; partial: boolean } {
	const sessions: CealAgentAuditSession[] = [];
	const walk = { examined: 0, partial: false };
	const root = lstatSync(sessionsRoot);
	if (root.isSymbolicLink() || !root.isDirectory()) throw new Error("unsafe_root");
	for (const dayDirectory of codexDayDirectories(sessionsRoot, walk)) {
		if (walk.examined >= MAX_ENTRIES_EXAMINED) { walk.partial = true; break; }
		let files: string[];
		try { files = readdirSync(dayDirectory); } catch { walk.partial = true; continue; }
		// Descending name order puts newer rollout stamps first, so a budget
		// truncation inside one day still keeps its newest sessions.
		files.sort(descending);
		for (const file of files) {
			if (walk.examined >= MAX_ENTRIES_EXAMINED) { walk.partial = true; break; }
			walk.examined += 1;
			const rollout = CODEX_ROLLOUT_FILE.exec(file);
			if (!rollout) continue;
			let stat;
			try { stat = lstatSync(path.join(dayDirectory, file)); } catch { walk.partial = true; continue; }
			if (stat.isSymbolicLink() || !stat.isFile()) continue;
			sessions.push({
				sessionRef: rollout[1].toLowerCase(),
				lastActivityAt: stat.mtimeMs,
				transcriptBytes: stat.size,
			});
		}
	}
	return { sessions, partial: walk.partial };
}

// Locale-independent descending name order; zero-padded date shards and
// rollout stamps therefore sort newest-first.
function descending(a: string, b: string): number {
	return a < b ? 1 : a > b ? -1 : 0;
}

// Resolves YYYY/MM/DD leaf directories in descending date order, consuming
// the shared walk budget and refusing symlinked shards at every level.
function codexDayDirectories(sessionsRoot: string, walk: { examined: number; partial: boolean }): string[] {
	let levels = [sessionsRoot];
	for (const segment of CODEX_DATE_SEGMENT) {
		const next: string[] = [];
		for (const parent of levels) {
			if (walk.examined >= MAX_ENTRIES_EXAMINED) { walk.partial = true; break; }
			let entries: string[];
			try { entries = readdirSync(parent); } catch { walk.partial = true; continue; }
			entries.sort(descending);
			for (const entry of entries) {
				if (walk.examined >= MAX_ENTRIES_EXAMINED) { walk.partial = true; break; }
				walk.examined += 1;
				if (!segment.test(entry)) continue;
				const child = path.join(parent, entry);
				let stat;
				try { stat = lstatSync(child); } catch { walk.partial = true; continue; }
				if (stat.isSymbolicLink() || !stat.isDirectory()) continue;
				next.push(child);
			}
		}
		levels = next;
	}
	return levels;
}
