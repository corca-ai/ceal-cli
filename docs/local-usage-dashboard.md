# Local Usage Dashboard Production Contract

Status: Codex adapter input, canonical production composition, and browser rendering implemented

## Capability

The local Workbench can consume one normalized, privacy-safe dataset for a
Codex user's locally observed sessions, tool-call metadata, and runtime-supplied
token evidence while keeping identity/access authority and unsupported monetary
cost explicit.

## Current Slice

`local-usage-dashboard.ts` first composes the existing worker-owned
`ceal.agent_activity.v1` projection into the intermediate
`ceal.local_usage_dashboard.codex_input.v1` envelope.
It consumes only structural metadata already allowlisted by `agent-audit.ts`.
The observer state exposes this input beside the predecessor projections, but
the browser never consumes it directly.

`composeCanonicalLocalUsageDashboard` now owns that second boundary. It emits a
fail-closed production discriminator, half-open local-calendar window and IANA
timezone, daily covered-subset values, reconciling totals, per-metric coverage,
comparability groups, identity/access projections, and unsupported pricing.
The observer exposes the result as `local_usage_dashboard`; consumers reject
fixture provenance or a missing production discriminator.

The Workbench now renders that canonical dataset through separate Usage,
Sessions, and Access tabs. Usage switches among Sessions, Agent tool calls,
Tokens, and Estimated cost without changing evidence semantics. Sessions uses
twenty-row pagination so a history over one hundred rows does not turn into one
unbounded scroll. Access renders the bounded Gateway-owned capability catalog
and summary while keeping the unowned request workflow disabled.

## Fixed Decisions

- Codex is the first production converter; Claude remains a separate runtime
  accounting group and is not silently normalized into Codex semantics.
- Local session identity and Gateway capability access are independent inputs.
- Access projects only the allowlisted capability ID, display label, effect,
  target requirement, and evidence requirement returned by Gateway discovery.
  It is not a resource inventory or a copy of provider/policy payloads.
- The browser receives the fixed display label `Codex sessions`, never the
  expanded transcript root.
- `complete`, `partial`, `observed_empty`, and `unreadable` remain distinct.
- Inventory state is named separately from per-session event and token evidence;
  a complete inventory never implies complete tool-call or token coverage.
- Returned session details and eligible inventory counts remain separate.
- A Codex session exposes `model_key` only when a complete, fully parsed local
  transcript scan contains exactly one safe `turn_context` model key. Partial,
  ambiguous, invalid, and absent model evidence remains `null`. The producer
  contract treats Codex's dedicated `turn_context.model` field as runtime-owned
  metadata; arbitrary transcript fields never become model identity.
- A local pricing snapshot is accepted only through the strict
  `ceal.local_pricing_snapshot.v1` decoder: namespaced snapshot/revision refs,
  one canonical UTC ISO instant, a three-letter uppercase currency-shaped code,
  unique model keys, and bounded decimal-string per-million token-category
  rates. Unknown keys, paths, unnamespaced refs, duplicate models, and
  non-decimal rates fail closed. A real monetary source must further constrain
  supported currencies and arithmetic before any estimate is enabled.
- Snapshot and revision references remain producer-private and are not projected
  into the browser dataset while monetary derivation is unsupported.
- Cost remains `unsupported` even with a valid snapshot until the runtime
  supplies a privacy-safe model identity for each priced token observation;
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
- `unit`: canonical daily values reconcile with totals, partial tool/token
  evidence prevents a complete claim, future/out-of-window sessions are omitted,
  and fixture provenance is rejected by the production decoder.
- `npm run check:unit` remains the repository iteration gate.
- `browser`: metric switching, unsupported cost, session detail, disabled access
  request, theme/mode invariance, narrow layout, and 105-session pagination.

## Next Slice

Define the owned local pricing-snapshot location and loader, then add decimal
cost derivation only for sessions whose model key exactly matches one snapshot
rate and whose token categories are supported. Until that contract lands,
pricing distinguishes missing model evidence, a missing matching rate, and the
not-yet-implemented derivation; no currency amount is derived. The resource catalog and access-request workflow
remain deferred until an Admin-owned contract exists.
