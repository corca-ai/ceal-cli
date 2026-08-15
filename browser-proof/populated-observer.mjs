import { createCealObserverServer } from "../packages/ceal-worker-cli/dist/observer.js";

const NOW = Date.parse("2026-08-13T12:00:00.000Z");
const DAY = 86_400_000;
const statuses = ["completed", "completed", "blocked", "error"];
const evidence = ["readback_verified", "readback_verified", "not_read_back", "outcome_unknown"];
const capabilities = ["message.search", "file.read", "calendar.list", "message.send"];
const accessCapabilities = Array.from({ length: 9 }, (_, index) => ({
	capability_id: `${capabilities[index % capabilities.length]}.${index + 1}`,
	label: `Review capability ${index + 1}`,
	effect: index < 6 ? "read" : "write",
	target_requirement: "required",
	evidence_requirement: "gateway_audit",
}));
const demoMode = process.env.CEAL_REVIEW_DEMO === "1";
const codexSessionCount = demoMode || process.env.CEAL_REVIEW_MANY_SESSIONS === "1" ? 105 : 3;
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
		lastActivityAt: NOW - (demoMode && runtime === "codex" ? Math.floor(index * 0.58) + offset : index + offset) * DAY,
		transcriptBytes: 2_048 + index * 512,
		events:
			!demoMode && count > 3 && index >= 3
				? undefined
				: !demoMode && index === count - 1
					? "unreadable"
					: {
							scan: !demoMode && index === count - 2 ? "truncated" : "complete",
							eventCount: 8 + index,
							kinds: { user_message: 3, assistant_message: 3, tool_call: 2 },
							unparsedLines: !demoMode && index === count - 2 ? 1 : 0,
							...(runtime === "codex" && (demoMode || index === 0)
								? { modelIdentity: { source: "turn_context", modelKey: "gpt-review-codex" } }
								: {}),
							firstEventAt: NOW - (demoMode && runtime === "codex" ? Math.floor(index * 0.58) + offset : index + offset) * DAY - 60_000,
							lastScannedEventAt: NOW - (demoMode && runtime === "codex" ? Math.floor(index * 0.58) + offset : index + offset) * DAY,
							tokenUsage:
								demoMode || index % 2 === 0
									? {
											source: runtime === "claude" ? "event_usage_sum" : "runtime_cumulative_last",
											completeness: !demoMode && index === count - 2 ? "scanned_prefix" : "full_transcript",
											usageEvents: 2,
											inputTokens: 1_200 + index * 100,
											outputTokens: 320 + index * 40,
										}
									: undefined,
						},
	}));

const server = createCealObserverServer({
	loadSession: async () => ({
		gatewayEndpoint: "https://gateway.review.invalid/client",
		profileRef: "profile:review-personal",
		membershipRef: "membership:review-personal",
		registrationRef: "registration:review-personal",
		clientRef: "client:review-personal",
		subjectRef: "subject:review-personal",
		instanceRef: "instance:review",
		accessToken: "fixture-access-token-not-rendered",
		expiresAt: "2099-08-14T00:00:00.000Z",
		refreshToken: "fixture-refresh-token-not-rendered",
		refreshTokenIdleExpiresAt: "2099-09-14T00:00:00.000Z",
		refreshTokenAbsoluteExpiresAt: "2099-10-14T00:00:00.000Z",
	}),
	loadPricingSnapshot: () => ({
		schema_version: "ceal.local_pricing_snapshot.v1",
		snapshot_ref: "pricing:review:2026-08-13",
		revision: "pricing-rev-review-1",
		observed_at: "2026-08-13T00:00:00.000Z",
		currency: "USD",
		rates: [
			{
				model_key: "gpt-review-codex",
				input_per_million: "1.25",
				output_per_million: "10",
				cache_read_per_million: "0",
				cache_write_per_million: "0",
			},
		],
	}),
	loadCealOverview: async () => ({
		status: "connected",
		source: "ceal_gateway",
		authority: "gateway",
		profile_ref: "profile:review-personal",
		instance_ref: "instance:review",
		protocol_version: "1.3.0",
		capability_count: 9,
		read_capability_count: 6,
		write_capability_count: 3,
		capabilities: accessCapabilities,
	}),
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
							sessionCount: codexSessionCount,
							sessions: sessions("codex", codexSessionCount, 10),
							eventScan: {
								scannedSessions: demoMode ? codexSessionCount : Math.min(3, codexSessionCount),
								sessionLimit: demoMode ? codexSessionCount : 3,
							},
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
	process.stdout.write("mode: synthetic demo data; no personal transcript source is read\n");
	process.stdout.write(`url: http://127.0.0.1:${address.port}/\n`);
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
