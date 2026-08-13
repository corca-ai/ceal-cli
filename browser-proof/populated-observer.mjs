import { createCealObserverServer } from "../packages/ceal-worker-cli/dist/observer.js";

const NOW = Date.parse("2026-08-13T12:00:00.000Z");
const DAY = 86_400_000;
const statuses = ["completed", "completed", "blocked", "error"];
const evidence = ["readback_verified", "readback_verified", "not_read_back", "outcome_unknown"];
const capabilities = ["message.search", "file.read", "calendar.list", "message.send"];
const receipts = Array.from({ length: 35 }, (_, index) => ({
	recordedAt: NOW - (29 - (index % 30)) * DAY - Math.floor(index / 30) * 3_600_000,
	requestRef: `review:receipt:${String(index).padStart(2, "0")}`,
	status: statuses[index % statuses.length],
	evidence: evidence[index % evidence.length],
	auditRefs: [`review:audit:${String(index).padStart(2, "0")}`],
	capabilityId: capabilities[index % capabilities.length],
	targetRef: `review:target:${index % 3}`,
}));

const sessions = (runtime, count, offset) =>
	Array.from({ length: count }, (_, index) => ({
		sessionRef: `${runtime === "claude" ? "11111111" : "22222222"}-2222-3333-4444-${String(offset + index).padStart(12, "0")}`,
		lastActivityAt: NOW - (index + offset) * DAY,
		transcriptBytes: 2_048 + index * 512,
		events:
			index === count - 1
				? "unreadable"
				: {
						scan: index === count - 2 ? "truncated" : "complete",
						eventCount: 8 + index,
						kinds: { user_message: 3, assistant_message: 3, tool_call: 2 },
						unparsedLines: index === count - 2 ? 1 : 0,
						firstEventAt: NOW - (index + offset) * DAY - 60_000,
						lastScannedEventAt: NOW - (index + offset) * DAY,
						tokenUsage:
							index % 2 === 0
								? {
										source: runtime === "claude" ? "event_usage_sum" : "runtime_cumulative_last",
										completeness: index === count - 2 ? "scanned_prefix" : "full_transcript",
										usageEvents: 2,
										inputTokens: 1_200 + index * 100,
										outputTokens: 320 + index * 40,
									}
								: undefined,
					},
	}));

const server = createCealObserverServer({
	loadReceiptSpool: async () => ({
		entries: receipts,
		bounds: { maxEntries: 200, retentionMs: 30 * DAY },
		drops: { count: 2, atLeast: false },
		spoolPresent: true,
	}),
	...(process.env.CEAL_REVIEW_AGENT_UNAVAILABLE === "1"
		? {}
		: {
				inspectAgentAudit: () => ({
					schemaVersion: "ceal.agent_activity.v1",
					adapters: [
						{
							runtime: "claude",
							root: "review-fixture/claude",
							health: "active",
							coverage: "transcript-observed",
							inventory: "partial",
							depth: "session_events",
							sessionCount: 4,
							sessions: sessions("claude", 4, 0),
							eventScan: { scannedSessions: 4, sessionLimit: 4 },
						},
						{
							runtime: "codex",
							root: "review-fixture/codex",
							health: "stale",
							coverage: "transcript-observed",
							depth: "session_events",
							sessionCount: 3,
							sessions: sessions("codex", 3, 10),
							eventScan: { scannedSessions: 3, sessionLimit: 3 },
						},
					],
					nonClaims: ["Synthetic fixed-vocabulary review evidence; no prompt or transcript content exists in this fixture."],
				}),
			}),
	inspectAgentGuide: () => ({ status: "mixed", agent: "codex", guide_id: "ceal-guide", update_safe: true, registered: false }),
	now: () => NOW,
});

server.listen(0, "127.0.0.1", () => {
	const address = server.address();
	if (typeof address !== "object" || address === null) throw new Error("fixture observer did not expose a port");
	process.stdout.write(`url: http://127.0.0.1:${address.port}/\n`);
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
