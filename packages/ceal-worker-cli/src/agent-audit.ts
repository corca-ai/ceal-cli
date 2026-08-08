import { closeSync, constants, fstatSync, lstatSync, openSync, readdirSync, readSync, type Stats } from "node:fs";
import path from "node:path";
import { type CealAgentHostOverrides, resolveCealAgentHostRoot } from "./agent-guide.js";

// ceal-audit inside the worker: a read-only local view of supported agent
// runtimes' native transcript roots, rendered by the observer Workbench
// shell. The masterplan fixes the vocabulary consumed here — one normalized
// contract shared by the Codex and Claude adapters, collector health
// (active/stale/inactive/unknown), and evidence coverage
// (ceal-mediated/hook-enhanced/transcript-observed/unsupported). The full
// inventory lists transcript files by identity, recency, and size; the
// newest few sessions additionally get a bounded event summary whose
// redaction is structural: lines are parsed locally, but only fixed
// vocabulary kinds, integer counts (including runtime-supplied token
// totals), and re-serialized timestamps leave the parser — no transcript
// field value is ever echoed. A permission or read
// failure reports `unknown` (inventory) or `unreadable` (events), never a
// fabricated result; an unimplemented adapter would report `unsupported`,
// never silence. Neither adapter's coverage claim generalizes to the other.

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
const CODEX_ROLLOUT_FILE =
	/^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})[.]jsonl$/iu;
const CODEX_DATE_SEGMENT = [/^\d{4}$/u, /^\d{2}$/u, /^\d{2}$/u];
const HEALTH_BASIS = "health derived from newest transcript mtime (active within 24h); not a liveness probe";
// Event depth is deliberately bounded: only the newest sessions are scanned,
// and each transcript is read from the start up to fixed byte/line budgets so
// a huge or adversarial file cannot stall the observer. Hitting a budget is
// always declared as `scan: "truncated"`, never presented as complete.
const EVENT_SCAN_SESSIONS = 3;
const MAX_EVENT_BYTES = 2 * 1024 * 1024;
const MAX_EVENT_LINES = 5000;
// Only a timestamp that already looks like an ISO instant is parsed, and it
// re-surfaces solely as the parsed epoch — raw strings never pass through.
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/u;

type CealAgentAuditEventKind = "user_message" | "assistant_message" | "tool_call" | "tool_result" | "reasoning" | "session_state" | "other";

/**
 * Per-session token figures, present only when the runtime's own transcript
 * supplied usage integers. `source` names how the runtime supplied them and
 * `completeness` whether the bounded scan covered the whole transcript; a
 * field the runtime never supplied is omitted, not zero. Field semantics
 * (e.g. cache accounting inside input tokens) stay runtime-defined.
 * `usageEvents` follows the source: deduplicated API turns for
 * `event_usage_sum`, cumulative readings observed for
 * `runtime_cumulative_last`.
 */
export interface CealAgentAuditTokenUsage {
	source: "event_usage_sum" | "runtime_cumulative_last";
	completeness: "full_transcript" | "scanned_prefix";
	usageEvents: number;
	inputTokens?: number;
	outputTokens?: number;
	cacheReadTokens?: number;
	cacheWriteTokens?: number;
}

interface CealAgentAuditSessionEvents {
	scan: "complete" | "truncated";
	eventCount: number;
	kinds: Partial<Record<CealAgentAuditEventKind, number>>;
	unparsedLines: number;
	firstEventAt?: number;
	lastScannedEventAt?: number;
	tokenUsage?: CealAgentAuditTokenUsage;
}

export interface CealAgentAuditSession {
	sessionRef: string;
	lastActivityAt: number;
	transcriptBytes: number;
	/** Present only for the newest scanned sessions; "unreadable" is a declared gap. */
	events?: CealAgentAuditSessionEvents | "unreadable";
}

interface CealAgentAuditAdapterState {
	runtime: "claude" | "codex";
	root: string;
	health: "active" | "stale" | "inactive" | "unknown";
	coverage: "transcript-observed" | "unsupported";
	depth?: "session_inventory" | "session_events";
	/** Present as "partial" when the walk was truncated or a subtree was unreadable. */
	inventory?: "partial";
	sessionCount?: number;
	sessions?: CealAgentAuditSession[];
	/**
	 * Declares the event-scan bound so the newest-sessions cap is never silent.
	 * scannedSessions counts successful scans only; an attempted-but-unreadable
	 * session is excluded here and appears as `events: "unreadable"` instead.
	 */
	eventScan?: { scannedSessions: number; sessionLimit: number };
	note?: string;
}

export interface CealAgentAuditState {
	schemaVersion: "ceal.agent_activity.v1";
	adapters: CealAgentAuditAdapterState[];
	nonClaims: string[];
}

export interface CealAgentSessionEventsLookup {
	/** "unreadable" declares a failed walk or root refusal, never an absence. */
	status: "scanned" | "not_found" | "unreadable";
	session?: CealAgentAuditSession;
}

// Exactly the session_ref grammar the inventory itself surfaces; anything else
// is rejected before any filesystem access.
const SESSION_REF = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/**
 * On-demand bounded event scan for one inventoried session, so the Workbench
 * can drill into any listed session, not only the newest auto-scanned ones.
 * The caller-supplied ref is never joined into a path: the same inventory walk
 * runs again and only a walk-produced transcript path is opened, so a crafted
 * ref cannot become a read primitive. Returns null for a grammar violation.
 */
export function inspectAgentSessionEvents(
	home: string | undefined,
	overrides: CealAgentHostOverrides,
	runtime: string,
	sessionRef: string,
): CealAgentSessionEventsLookup | null {
	if ((runtime !== "claude" && runtime !== "codex") || !SESSION_REF.test(sessionRef)) return null;
	const { root } = resolveCealAgentHostRoot(runtime, home, overrides);
	if (!root) return { status: "unreadable" };
	const adapter =
		runtime === "claude"
			? { directory: path.join(root, "projects"), collect: collectClaudeSessions, lines: CLAUDE_LINE_ADAPTER }
			: { directory: path.join(root, "sessions"), collect: collectCodexSessions, lines: CODEX_LINE_ADAPTER };
	try {
		lstatSync(adapter.directory);
	} catch (error) {
		const code = error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : null;
		return code === "ENOENT" ? { status: "not_found" } : { status: "unreadable" };
	}
	let collected: { sessions: CollectedSession[]; partial: boolean };
	try {
		collected = adapter.collect(adapter.directory);
	} catch {
		return { status: "unreadable" };
	}
	const wanted = sessionRef.toLowerCase();
	const matches = collected.sessions.filter((session) => session.sessionRef === wanted);
	if (matches.length === 0) return { status: "not_found" };
	// A duplicated ref across shards resolves to the newest transcript.
	matches.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
	const { transcriptPath, ...session } = matches[0];
	return { status: "scanned", session: { ...session, events: scanSessionEvents(transcriptPath, adapter.lines) } };
}

export const AGENT_AUDIT_NON_CLAIMS: readonly string[] = Object.freeze([
	"Bounded event metadata only: fixed-vocabulary kind counts and re-serialized timestamps; transcript content, prompts, tool arguments, and raw payloads are never surfaced, copied, or forwarded.",
	"Local recency evidence, not a surveillance or completeness claim; a stopped or unreadable collector is an explicit gap, and sessions beyond the newest scanned ones stay inventory-only until an explicit per-session drill-down runs.",
	"Token figures are runtime-supplied transcript accounting surfaced as integers with explicit source and scan completeness; field semantics are runtime-defined, figures are not comparable across runtimes, and this is not a cost or billing claim. No latency figure is shown because neither runtime supplies one.",
]);

export function inspectAgentAudit(home: string | undefined, overrides: CealAgentHostOverrides, now: number): CealAgentAuditState {
	const adapters: CealAgentAuditAdapterState[] = [
		observeHostAdapter("claude", "projects", collectClaudeSessions, CLAUDE_LINE_ADAPTER, home, overrides, now),
		observeHostAdapter("codex", "sessions", collectCodexSessions, CODEX_LINE_ADAPTER, home, overrides, now),
	];
	return {
		schemaVersion: "ceal.agent_activity.v1",
		adapters,
		nonClaims: [...AGENT_AUDIT_NON_CLAIMS],
	};
}

// The rendered root is the one actually scanned, so an operator who moved a
// host with `CLAUDE_CONFIG_DIR`/`CODEX_HOME` reads back that directory rather
// than a default the audit never opened.
function observeHostAdapter(
	runtime: "claude" | "codex",
	sessionsSegment: string,
	collect: (directory: string) => { sessions: CollectedSession[]; partial: boolean },
	lines: TranscriptLineAdapter,
	home: string | undefined,
	overrides: CealAgentHostOverrides,
	now: number,
): CealAgentAuditAdapterState {
	const { root, displayRoot } = resolveCealAgentHostRoot(runtime, home, overrides);
	const sessionsDirectory = root ? path.join(root, sessionsSegment) : null;
	return observeTranscriptAdapter(runtime, displayRoot, sessionsDirectory, collect, lines, now);
}

/** Inventory row plus the private transcript path consumed by the event scan. */
interface CollectedSession extends CealAgentAuditSession {
	transcriptPath: string;
}

function observeTranscriptAdapter(
	runtime: CealAgentAuditAdapterState["runtime"],
	root: string,
	sessionsDirectory: string | null,
	collect: (directory: string) => { sessions: CollectedSession[]; partial: boolean },
	lines: TranscriptLineAdapter,
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
	let collected: { sessions: CollectedSession[]; partial: boolean };
	try {
		collected = collect(sessionsDirectory);
	} catch {
		return base;
	}
	const { sessions, partial } = collected;
	const partialFields = partial ? { inventory: "partial" as const, note: `${HEALTH_BASIS}; inventory truncated or partly unreadable` } : {};
	// A partial walk that found nothing proves nothing about inactivity.
	if (sessions.length === 0) {
		return partial ? { ...base, ...partialFields } : { ...base, health: "inactive", sessionCount: 0, sessions: [] };
	}
	sessions.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
	const rendered = sessions
		.slice(0, RENDERED_SESSIONS)
		.map(({ transcriptPath, ...session }, index) =>
			index < EVENT_SCAN_SESSIONS ? { ...session, events: scanSessionEvents(transcriptPath, lines) } : session,
		);
	const scannedSessions = rendered.filter((session) => typeof session.events === "object").length;
	return {
		...base,
		...partialFields,
		// Depth reports what was achieved, not what was attempted: with every
		// scan unreadable the adapter honestly stays at inventory depth.
		depth: scannedSessions > 0 ? "session_events" : "session_inventory",
		health: now - sessions[0].lastActivityAt < ACTIVE_WINDOW_MS ? "active" : "stale",
		sessionCount: sessions.length,
		sessions: rendered,
		eventScan: { scannedSessions, sessionLimit: EVENT_SCAN_SESSIONS },
	};
}

// How one runtime's transcript lines become normalized metadata: `classify`
// maps a line to a fixed-vocabulary kind; `readUsage` extracts runtime-
// supplied token integers (with an optional in-function dedupe key for
// runtimes that repeat one API turn's usage across records); `usageSource`
// declares whether readings sum per event or the last cumulative one wins.
interface TranscriptLineAdapter {
	classify: (line: Record<string, unknown>) => CealAgentAuditEventKind;
	readUsage: (line: Record<string, unknown>) => { reading: TokenUsageReading; dedupeKey?: string } | null;
	usageSource: CealAgentAuditTokenUsage["source"];
}

type TokenUsageReading = Pick<CealAgentAuditTokenUsage, "inputTokens" | "outputTokens" | "cacheReadTokens" | "cacheWriteTokens">;

const USAGE_FIELD_KEYS = ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens"] as const;

// Bounded, structurally redacting event scan of one transcript. The file is
// re-opened with O_NOFOLLOW and re-checked as a regular file so the
// inventory-time symlink refusal cannot be raced. Only classified kind
// counts, integer totals, and parsed epoch timestamps leave this function.
function scanSessionEvents(transcriptPath: string, adapter: TranscriptLineAdapter): CealAgentAuditSessionEvents | "unreadable" {
	let descriptor: number;
	try {
		descriptor = openSync(transcriptPath, constants.O_RDONLY | constants.O_NOFOLLOW);
	} catch {
		return "unreadable";
	}
	try {
		const stat = fstatSync(descriptor);
		if (!stat.isFile()) return "unreadable";
		const buffer = Buffer.alloc(Math.min(stat.size, MAX_EVENT_BYTES));
		const bytesRead = readSync(descriptor, buffer, 0, buffer.length, 0);
		const truncatedBytes = stat.size > MAX_EVENT_BYTES;
		const lines = buffer.subarray(0, bytesRead).toString("utf8").split("\n");
		// A byte-truncated read ends in a partial line; scanning it would
		// misreport a real event as unparsed.
		if (truncatedBytes) lines.pop();
		return summarizeEventLines(
			lines.filter((line) => line.trim() !== ""),
			truncatedBytes,
			adapter,
		);
	} catch {
		return "unreadable";
	} finally {
		closeSync(descriptor);
	}
}

function summarizeEventLines(lines: string[], truncatedBytes: boolean, adapter: TranscriptLineAdapter): CealAgentAuditSessionEvents {
	const kinds: Partial<Record<CealAgentAuditEventKind, number>> = {};
	let eventCount = 0;
	let unparsedLines = 0;
	let firstEventAt: number | undefined;
	let lastScannedEventAt: number | undefined;
	// Dedupe keys are transcript-supplied identifiers consumed in-function only;
	// they never leave the parser.
	const seenUsageKeys = new Set<string>();
	let usageEvents = 0;
	let usageTotals: TokenUsageReading | undefined;
	for (const line of lines.slice(0, MAX_EVENT_LINES)) {
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch {
			unparsedLines += 1;
			continue;
		}
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			unparsedLines += 1;
			continue;
		}
		const record = parsed as Record<string, unknown>;
		const kind = adapter.classify(record);
		kinds[kind] = (kinds[kind] ?? 0) + 1;
		eventCount += 1;
		const usage = adapter.readUsage(record);
		if (usage && (usage.dedupeKey === undefined || !seenUsageKeys.has(usage.dedupeKey))) {
			if (usage.dedupeKey !== undefined) seenUsageKeys.add(usage.dedupeKey);
			usageEvents += 1;
			usageTotals = adapter.usageSource === "runtime_cumulative_last" ? usage.reading : addUsageReadings(usageTotals, usage.reading);
		}
		const timestamp = typeof record.timestamp === "string" && ISO_INSTANT.test(record.timestamp) ? Date.parse(record.timestamp) : Number.NaN;
		if (Number.isFinite(timestamp)) {
			firstEventAt = firstEventAt === undefined ? timestamp : Math.min(firstEventAt, timestamp);
			lastScannedEventAt = lastScannedEventAt === undefined ? timestamp : Math.max(lastScannedEventAt, timestamp);
		}
	}
	const scan = truncatedBytes || lines.length > MAX_EVENT_LINES ? "truncated" : "complete";
	return {
		scan,
		eventCount,
		kinds,
		unparsedLines,
		...(firstEventAt === undefined ? {} : { firstEventAt }),
		...(lastScannedEventAt === undefined ? {} : { lastScannedEventAt }),
		// Omitted, not zero: a session whose runtime supplied no usage shows no
		// token figures at all.
		...(usageTotals === undefined
			? {}
			: {
					tokenUsage: {
						source: adapter.usageSource,
						completeness: scan === "complete" ? ("full_transcript" as const) : ("scanned_prefix" as const),
						usageEvents,
						...usageTotals,
					},
				}),
	};
}

function addUsageReadings(totals: TokenUsageReading | undefined, reading: TokenUsageReading): TokenUsageReading {
	const sum: TokenUsageReading = { ...totals };
	for (const field of USAGE_FIELD_KEYS) {
		const value = reading[field];
		// Saturate so a pathological transcript cannot push a sum past safe
		// integer range into Infinity/null in the serialized state.
		if (value !== undefined) sum[field] = Math.min(Number.MAX_SAFE_INTEGER, (sum[field] ?? 0) + value);
	}
	return sum;
}

// Reads only allowlisted safe non-negative integer fields into the normalized
// reading; anything non-integer, negative, or beyond safe integer range is
// ignored, never rendered. Returns null when the source object supplied no
// usable field, so absence stays omitted-not-zero.
function usageReading(source: Record<string, unknown>, fields: Record<keyof TokenUsageReading, string>): TokenUsageReading | null {
	const reading: TokenUsageReading = {};
	let present = false;
	for (const field of USAGE_FIELD_KEYS) {
		const value = source[fields[field]];
		if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
			reading[field] = value;
			present = true;
		}
	}
	return present ? reading : null;
}

// Claude Code line grammar: conversational lines carry type user/assistant
// with a content-item array; runtime bookkeeping lines carry their own types.
// Classification reads only `type` fields — never text, arguments, or paths.
const CLAUDE_STATE_TYPES = new Set([
	"system",
	"mode",
	"ai-title",
	"last-prompt",
	"attachment",
	"permission-mode",
	"queue-operation",
	"summary",
]);

function classifyClaudeLine(line: Record<string, unknown>): CealAgentAuditEventKind {
	const type = line.type;
	if (type === "assistant" || type === "user") {
		const message = line.message;
		const content = message && typeof message === "object" ? (message as Record<string, unknown>).content : null;
		const items = Array.isArray(content) ? content : [];
		const has = (itemType: string) =>
			items.some((item) => !!item && typeof item === "object" && (item as Record<string, unknown>).type === itemType);
		if (type === "assistant") {
			if (has("tool_use")) return "tool_call";
			if (has("thinking") && !has("text")) return "reasoning";
			return "assistant_message";
		}
		return has("tool_result") ? "tool_result" : "user_message";
	}
	if (typeof type === "string" && (CLAUDE_STATE_TYPES.has(type) || type.startsWith("file-history-"))) return "session_state";
	return "other";
}

// Claude Code repeats one API turn's identical `message.usage` object on every
// record of that turn (one record per content block), so the sum deduplicates
// by `requestId` (fallback: the message id). Only the allowlisted integer
// fields are read; the key itself stays in-function.
const CLAUDE_USAGE_FIELDS: Record<keyof TokenUsageReading, string> = {
	inputTokens: "input_tokens",
	outputTokens: "output_tokens",
	cacheReadTokens: "cache_read_input_tokens",
	cacheWriteTokens: "cache_creation_input_tokens",
};

function readClaudeUsage(line: Record<string, unknown>): { reading: TokenUsageReading; dedupeKey?: string } | null {
	if (line.type !== "assistant") return null;
	const message = line.message;
	if (!message || typeof message !== "object" || Array.isArray(message)) return null;
	const usage = (message as Record<string, unknown>).usage;
	if (!usage || typeof usage !== "object" || Array.isArray(usage)) return null;
	const reading = usageReading(usage as Record<string, unknown>, CLAUDE_USAGE_FIELDS);
	if (!reading) return null;
	const messageId = (message as Record<string, unknown>).id;
	const dedupeKey = typeof line.requestId === "string" ? line.requestId : typeof messageId === "string" ? messageId : undefined;
	return { reading, ...(dedupeKey === undefined ? {} : { dedupeKey }) };
}

const CLAUDE_LINE_ADAPTER: TranscriptLineAdapter = {
	classify: classifyClaudeLine,
	readUsage: readClaudeUsage,
	usageSource: "event_usage_sum",
};

// Codex rollout grammar: response_item lines carry the conversation payload;
// event_msg mirrors of user/agent messages count as session_state so one
// utterance is never counted twice. Classification reads only `type`/`role`.
const CODEX_STATE_TYPES = new Set([
	"session_meta",
	"turn_context",
	"world_state",
	"compacted",
	"event_msg",
	"inter_agent_communication_metadata",
]);

function classifyCodexLine(line: Record<string, unknown>): CealAgentAuditEventKind {
	const type = line.type;
	if (type === "response_item") {
		const payload = line.payload;
		const payloadType = payload && typeof payload === "object" ? (payload as Record<string, unknown>).type : null;
		if (payloadType === "message") {
			const role = (payload as Record<string, unknown>).role;
			if (role === "user") return "user_message";
			if (role === "assistant") return "assistant_message";
			return "session_state";
		}
		if (payloadType === "agent_message") return "assistant_message";
		if (payloadType === "reasoning") return "reasoning";
		if (typeof payloadType === "string" && payloadType.endsWith("_call_output")) return "tool_result";
		if (typeof payloadType === "string" && payloadType.endsWith("_call")) return "tool_call";
		return "other";
	}
	if (typeof type === "string" && CODEX_STATE_TYPES.has(type)) return "session_state";
	return "other";
}

// Codex emits `event_msg`/`token_count` lines whose `info.total_token_usage`
// is the runtime's own session-cumulative accounting, so the last reading in
// the scanned prefix wins instead of summing.
const CODEX_USAGE_FIELDS: Record<keyof TokenUsageReading, string> = {
	inputTokens: "input_tokens",
	outputTokens: "output_tokens",
	cacheReadTokens: "cached_input_tokens",
	cacheWriteTokens: "cache_write_input_tokens",
};

function readCodexUsage(line: Record<string, unknown>): { reading: TokenUsageReading } | null {
	if (line.type !== "event_msg") return null;
	const payload = line.payload;
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
	const envelope = payload as Record<string, unknown>;
	if (envelope.type !== "token_count") return null;
	const info = envelope.info;
	if (!info || typeof info !== "object" || Array.isArray(info)) return null;
	const total = (info as Record<string, unknown>).total_token_usage;
	if (!total || typeof total !== "object" || Array.isArray(total)) return null;
	const reading = usageReading(total as Record<string, unknown>, CODEX_USAGE_FIELDS);
	return reading ? { reading } : null;
}

const CODEX_LINE_ADAPTER: TranscriptLineAdapter = {
	classify: classifyCodexLine,
	readUsage: readCodexUsage,
	usageSource: "runtime_cumulative_last",
};

// Claude Code stores one JSONL transcript per session under
// ~/.claude/projects/<project-directory>/<session-uuid>.jsonl. The inventory
// walk consumes only file identity and stat metadata. `partial` reports an
// exhausted walk budget or an unreadable/vanished subtree so a truncated
// inventory is never presented as complete.
function collectClaudeSessions(projects: string): { sessions: CollectedSession[]; partial: boolean } {
	const sessions: CollectedSession[] = [];
	let examined = 0;
	let partial = false;
	const root = lstatSync(projects);
	if (root.isSymbolicLink() || !root.isDirectory()) throw new Error("unsafe_root");
	for (const project of readdirSync(projects)) {
		if (examined >= MAX_ENTRIES_EXAMINED) {
			partial = true;
			break;
		}
		examined += 1;
		const projectDirectory = path.join(projects, project);
		let projectStat: Stats;
		try {
			projectStat = lstatSync(projectDirectory);
		} catch {
			partial = true;
			continue;
		}
		if (projectStat.isSymbolicLink() || !projectStat.isDirectory()) continue;
		let files: string[];
		try {
			files = readdirSync(projectDirectory);
		} catch {
			partial = true;
			continue;
		}
		for (const file of files) {
			if (examined >= MAX_ENTRIES_EXAMINED) {
				partial = true;
				break;
			}
			examined += 1;
			if (!SESSION_FILE.test(file)) continue;
			const transcript = path.join(projectDirectory, file);
			let stat: Stats;
			try {
				stat = lstatSync(transcript);
			} catch {
				partial = true;
				continue;
			}
			if (stat.isSymbolicLink() || !stat.isFile()) continue;
			sessions.push({
				sessionRef: file.slice(0, -".jsonl".length),
				lastActivityAt: stat.mtimeMs,
				transcriptBytes: stat.size,
				transcriptPath: transcript,
			});
		}
	}
	return { sessions, partial };
}

// Codex stores one JSONL rollout per session under
// ~/.codex/sessions/YYYY/MM/DD/rollout-<stamp>-<session-uuid>.jsonl. The
// inventory walk consumes only file identity and stat metadata, and only the
// machine-generated UUID surfaces as a session_ref. The date shards are
// walked newest-named first so a truncated walk keeps the newest shards;
// health derives from mtime, so its accuracy is guaranteed only for a
// complete walk — any truncation is always declared as `inventory: partial`.
function collectCodexSessions(sessionsRoot: string): { sessions: CollectedSession[]; partial: boolean } {
	const sessions: CollectedSession[] = [];
	const walk = { examined: 0, partial: false };
	const root = lstatSync(sessionsRoot);
	if (root.isSymbolicLink() || !root.isDirectory()) throw new Error("unsafe_root");
	for (const dayDirectory of codexDayDirectories(sessionsRoot, walk)) {
		if (walk.examined >= MAX_ENTRIES_EXAMINED) {
			walk.partial = true;
			break;
		}
		let files: string[];
		try {
			files = readdirSync(dayDirectory);
		} catch {
			walk.partial = true;
			continue;
		}
		// Descending name order puts newer rollout stamps first, so a budget
		// truncation inside one day still keeps its newest sessions.
		files.sort(descending);
		for (const file of files) {
			if (walk.examined >= MAX_ENTRIES_EXAMINED) {
				walk.partial = true;
				break;
			}
			walk.examined += 1;
			const rollout = CODEX_ROLLOUT_FILE.exec(file);
			if (!rollout) continue;
			const rolloutPath = path.join(dayDirectory, file);
			let stat: Stats;
			try {
				stat = lstatSync(rolloutPath);
			} catch {
				walk.partial = true;
				continue;
			}
			if (stat.isSymbolicLink() || !stat.isFile()) continue;
			sessions.push({
				sessionRef: rollout[1].toLowerCase(),
				lastActivityAt: stat.mtimeMs,
				transcriptBytes: stat.size,
				transcriptPath: rolloutPath,
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
			if (walk.examined >= MAX_ENTRIES_EXAMINED) {
				walk.partial = true;
				break;
			}
			let entries: string[];
			try {
				entries = readdirSync(parent);
			} catch {
				walk.partial = true;
				continue;
			}
			entries.sort(descending);
			for (const entry of entries) {
				if (walk.examined >= MAX_ENTRIES_EXAMINED) {
					walk.partial = true;
					break;
				}
				walk.examined += 1;
				if (!segment.test(entry)) continue;
				const child = path.join(parent, entry);
				let stat: Stats;
				try {
					stat = lstatSync(child);
				} catch {
					walk.partial = true;
					continue;
				}
				if (stat.isSymbolicLink() || !stat.isDirectory()) continue;
				next.push(child);
			}
		}
		levels = next;
	}
	return levels;
}
