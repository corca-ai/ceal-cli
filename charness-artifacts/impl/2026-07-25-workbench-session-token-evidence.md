# Workbench per-session token evidence from runtime-supplied usage

Status: current implementation contract, 2026-07-25.
Upstream frame: the Narnia handoff item "Workbench evidence deepening —
per-session latency/token figures only when a runtime supplies them, with
source and completeness explicit (masterplan OTel-adjacent contract)", after
the landed navigation, drill-down, and evidence-linked suggestion slices. The
navigation contract explicitly deferred token/latency columns to this slice.

## Capability Contract

A worker user inspecting a session in the Workbench (newest-session auto scan
or per-session drill-down) sees the token spend that session drove — but only
when the runtime's own transcript supplied usage figures. Every figure names
its source (how the runtime supplied it) and its completeness (whether the
bounded scan covered the whole transcript), and a session whose runtime
supplied nothing shows no figures at all rather than zeros.

## Fixed Decisions

- Evidence source is the existing bounded transcript scan only: no new file
  reads, no new endpoints, no protocol change (`@corca-ai/ceal-protocol`
  stays frozen at 0.65.0), no Gateway contact.
- Runtime-supplied means read-as-supplied: Claude Code assistant records'
  `message.usage` integer fields, and Codex `event_msg`/`token_count`
  cumulative `info.total_token_usage` integer fields. Nothing is estimated,
  derived from timestamps, or priced.
- Latency stays out of this slice: neither runtime supplies a per-session or
  per-turn duration field in its transcript, and deriving one from timestamps
  would violate the runtime-supplied rule. The non-claims say so explicitly.
- Claude figures are summed once per API turn: records sharing a `requestId`
  (fallback `message.id`) repeat the same usage object, so the sum
  deduplicates by that key. Dedupe keys stay in-function and are never
  surfaced (structural redaction unchanged: integers and fixed vocabulary
  only leave the parser).
- Codex figures are the last-observed cumulative `total_token_usage` within
  the scanned prefix, not a sum of per-event readings.
- The projection is one additive optional `tokenUsage` object on the existing
  session events summary, with fixed vocabulary:
  `source: "event_usage_sum" | "runtime_cumulative_last"`,
  `completeness: "full_transcript" | "scanned_prefix"` (prefix iff the scan
  truncated), integer `usageEvents`, and per-field-optional integer totals
  `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens` — a
  field a runtime never supplied is omitted, not zero, and the whole object
  is omitted when no scanned event carried usage.
- Cache-field mapping: Claude `cache_read_input_tokens` → `cacheReadTokens`,
  `cache_creation_input_tokens` → `cacheWriteTokens`; Codex
  `cached_input_tokens` → `cacheReadTokens`, `cache_write_input_tokens` →
  `cacheWriteTokens`. Field semantics stay runtime-defined (e.g. whether
  `input_tokens` includes cache reads differs); the non-claims state that
  figures are not comparable across runtimes and are not a cost claim.
- Observer/drill-down JSON projects it as snake_case `token_usage`; the page
  needs no change (the generic row renderer already renders nested objects).

## Probe Questions

- Do real local transcripts confirm the duplicate-usage-per-request shape?
  (Answered before coding: yes — 28 usage records collapse to 8 unique
  `requestId` keys with identical usage values; Codex `token_count` events
  all carried `info`.)

## Deferred Decisions

- Any latency figure (blocked on a runtime actually supplying one);
  per-turn token breakdowns; adapter-level or cross-session aggregation;
  reasoning/total token fields; cost estimation; transcript-open links.

## Acceptance Checks

- Unit (agent-audit): Claude fixture with duplicated-usage records sums once
  per request key; Codex fixture takes the last cumulative reading; a
  fixture with no usage-bearing events yields no `tokenUsage` key; a
  truncated scan reports `completeness: "scanned_prefix"`; non-integer or
  negative usage values are ignored, never rendered.
- Unit (observer): drill-down and state projections carry snake_case
  `token_usage` with the same omitted-not-zero behavior.
- `npm run check` clean; README Workbench paragraph and non-claims synced.
