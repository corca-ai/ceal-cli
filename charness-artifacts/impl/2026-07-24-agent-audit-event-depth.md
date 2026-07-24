# Agent-audit event depth for the Claude and Codex adapters

Status: current implementation contract, 2026-07-24.
Upstream frame: the ceal masterplan's Agent-Runtime Audit Boundary (one
normalized contract shared by the Codex and Claude adapters; allowlisted,
locally redacted event metadata only; a redaction/schema/permission failure
reports a gap, never a fabricated payload) and the Narnia handoff item
"Claude/Codex event depth" following the completed session-inventory slice.

## Capability Contract

A worker user running `ceal observe` sees, per supported agent runtime, not
only which sessions exist but a bounded normalized event summary of the newest
sessions: how many events were scanned, of which normalized kinds, over what
scanned time span — while transcript text, prompts, tool arguments, file
contents, and any other free-form field value never enter the projection.

## Fixed Decisions

- One shared normalized event-kind vocabulary for both adapters:
  `user_message`, `assistant_message`, `tool_call`, `tool_result`,
  `reasoning`, `session_state`, `other`. Unparsed lines are counted
  separately as `unparsed_lines`, never guessed into a kind.
- Event scan covers only the newest `EVENT_SCAN_SESSIONS = 3` rendered
  sessions per adapter; the remaining rendered sessions stay inventory-only
  and the adapter declares the bound (`event_scan: { scanned_sessions,
  session_limit }`) so the cap is never silent.
- Per-session read bound: at most `MAX_EVENT_BYTES = 2 MiB` and
  `MAX_EVENT_LINES = 5000` lines from the start of the transcript. Hitting
  either bound yields `scan: "truncated"`; a complete read yields
  `scan: "complete"`.
- Open/parse failure of a listed transcript yields `events: "unreadable"`
  for that session — never invented counts, and never an adapter-level
  failure. Transcripts are re-opened with `O_NOFOLLOW` and re-checked as
  regular files so the inventory-time symlink refusal cannot be raced.
- Redaction is structural: the only values that leave the parser are fixed
  vocabulary strings, non-negative integers, and timestamps re-serialized
  from a parsed epoch (never raw string passthrough). No transcript field
  value is echoed.
- Line classification (one event per parsed line):
  - Claude: `assistant` with any `tool_use` content item → `tool_call`; other
    `assistant` → `assistant_message` (thinking-only → `reasoning`); `user`
    with any `tool_result` content item → `tool_result`; other `user` →
    `user_message`; known runtime-state types (`system`, `mode`, `ai-title`,
    `last-prompt`, `attachment`, `permission-mode`, `file-history-*`,
    `queue-operation`, `summary`) → `session_state`; unknown → `other`.
  - Codex: `response_item` with payload `message` role `user` →
    `user_message`, role `assistant` → `assistant_message`, other roles →
    `session_state`; payload `agent_message` → `assistant_message`; payload
    `reasoning` → `reasoning`; payload `*_call`-class
    (`function_call`, `custom_tool_call`, `local_shell_call`,
    `web_search_call`) → `tool_call`; payload `*_call_output` →
    `tool_result`; `event_msg`/`session_meta`/`turn_context`/`world_state`/
    `compacted` and other known envelope types → `session_state` (event_msg
    duplicates response_item messages, so counting it as state avoids double
    counting); unknown → `other`.
- Adapter `depth` reports the achieved depth: `session_events` when at least
  one session produced an events object, otherwise `session_inventory`.
- Schema stays `ceal.agent_activity.v1`: the change is additive optional
  fields on an owner-local observer projection with no external consumer.
- Non-claims are updated honestly: transcript lines are now parsed locally,
  so the former "content is never read" claim becomes "only fixed-vocabulary
  metadata is surfaced/retained; text never enters the projection".

## Probe Questions

- Do real ~/.claude and ~/.codex homes on this host produce sensible kind
  histograms within the byte/line bounds (smoke, metadata-only)?

## Deferred Decisions

- Spooling/forwarding audit events to the Gateway; hook-enhanced coverage;
  per-session drill-down command surface; Workbench expansion beyond the
  observer page; scanning beyond the newest three sessions.

## Acceptance Checks

- Unit tests: kind mapping per adapter from fixture transcripts; no raw
  transcript text in the serialized state; truncation by line bound;
  unreadable transcript → `events: "unreadable"`; scan limited to the newest
  three sessions; depth vocabulary; timestamps re-serialized.
- Observer test: events render in `agent_activity` sessions.
- `npm run check` clean; real-home smoke via `buildObserverState`/
  `inspectAgentAudit` reporting only counts and bounds.
