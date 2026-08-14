# Local Usage Dashboard Production Contract

Status: Codex adapter-input seam implemented; canonical browser composition pending

## Capability

The local Workbench can consume one normalized, privacy-safe dataset for a
Codex user's locally observed sessions, tool-call metadata, and runtime-supplied
token evidence while keeping identity/access authority and unsupported monetary
cost explicit.

## Current Slice

`local-usage-dashboard.ts` composes the existing worker-owned
`ceal.agent_activity.v1` projection into the intermediate
`ceal.local_usage_dashboard.codex_input.v1` envelope.
It consumes only structural metadata already allowlisted by `agent-audit.ts`.
The observer state exposes this input beside the predecessor projections. It is
not the canonical browser dataset and must not drive period totals or a heatmap
until the next composer adds window, daily, totals, and metric-specific coverage.

## Fixed Decisions

- Codex is the first production converter; Claude remains a separate runtime
  accounting group and is not silently normalized into Codex semantics.
- Local session identity and Gateway capability access are independent inputs.
- The browser receives the fixed display label `Codex sessions`, never the
  expanded transcript root.
- `complete`, `partial`, `observed_empty`, and `unreadable` remain distinct.
- Inventory state is named separately from per-session event and token evidence;
  a complete inventory never implies complete tool-call or token coverage.
- Returned session details and eligible inventory counts remain separate.
- Cost is `unsupported` until an accepted versioned pricing snapshot exists;
  missing cost is never zero.
- Runtime transcript content, prompts, tool arguments, credentials, raw provider
  payloads, and absolute paths remain outside the dataset.

## Acceptance

- `unit`: a Codex cumulative-token fixture retains session/tool/token evidence,
  local identity, Gateway access counts, and unsupported cost.
- `unit`: partial inventory, unreadable source, and observed-empty source remain
  distinguishable.
- `integration`: observer state exposes the production adapter input without leaking
  session credentials or private Gateway identity fields.
- `npm run check:unit` remains the repository iteration gate.

## Next Slice

Compose the canonical browser dataset from the normalized production adapter
input, then render it in the Workbench and migrate the
Usage/Sessions composition without deriving totals from the bounded session
detail subset. Then add a fail-closed local pricing-snapshot decoder; the
renderer continues to show cost unsupported when no accepted snapshot exists.
