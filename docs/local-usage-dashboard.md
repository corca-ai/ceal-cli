# Local Usage Dashboard Production Contract

Status: local pricing snapshot loading and exact estimated-cost derivation implemented

## Capability

The local Workbench can consume one normalized, privacy-safe dataset for a
Codex user's locally observed sessions, tool-call metadata, and runtime-supplied
token evidence while keeping identity/access authority and unsupported monetary
cost explicit.

## Current Slice

The current slice adds one optional owner-only local input at
`~/.ceal/pricing-snapshot.json`. The observer reads it only when both the
directory and file satisfy the existing `0700`/`0600`, non-symlink local-store
contract. Absent, unsafe, unreadable, oversized, malformed, or future-dated snapshots
remain unavailable and never become zero cost.

For a valid snapshot, cost is derived only for sessions with complete token
evidence, one safe model identity, and an exact matching rate. Codex cached
input is a subset of input, so uncached input is priced as `input - cache_read`;
a cache count above input fails closed. Arithmetic uses integer-scaled decimal
strings over the four token categories and rounds the
final per-session amount half-up to six fractional currency digits. Daily and
period totals sum those rounded session amounts exactly; coverage names the
priced-session numerator and returned-session denominator. A partial estimate is
always labeled as the covered subset and is never billed cost.

`local-usage-dashboard.ts` first composes the existing worker-owned
`ceal.agent_activity.v1` projection into the intermediate
`ceal.local_usage_dashboard.codex_input.v1` envelope.
It consumes only structural metadata already allowlisted by `agent-audit.ts`.
The observer state exposes this input beside the predecessor projections, but
the browser never consumes it directly.

`composeCanonicalLocalUsageDashboard` now owns that second boundary. It emits a
fail-closed production discriminator, half-open local-calendar window and IANA
timezone, daily covered-subset values, reconciling totals, per-metric coverage,
comparability groups, identity/access projections, and evidence-bounded pricing.
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
- Usage suggestions are deterministic `ceal.local_usage_rules` v1 projections
  over the canonical dataset. They identify covered-token concentration,
  token/tool evidence gaps, and unavailable cost with bounded metric/session
  evidence; they are not model judgment, productivity scoring, or actions.
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
  one canonical UTC ISO instant, the currently supported `USD` currency,
  unique model keys, and bounded decimal-string per-million token-category
  rates. Unknown keys, paths, unnamespaced refs, duplicate models, and
  non-decimal rates fail closed. Adding another currency requires an explicit
  contract and display test before estimates are enabled for it.
- Snapshot and revision references remain producer-private and are not projected
  into the browser dataset. The cost comparability group contains only a
  collision-resistant truncated SHA-256 revision fingerprint. The trusted
  provisioner must change `revision` whenever any rate changes; violating that
  invariant would make unlike snapshots appear comparable.
- The first loader rejects future-dated snapshots but applies no guessed expiry:
  the trusted local provisioner owns replacement and revision semantics. A
  freshness policy remains part of the provisioning contract, not an implicit
  client-side pricing rule.
- Cost remains `unsupported` without a usable owned snapshot or when no covered
  session can be priced. With at least one priced session it is an `estimated`
  local projection, partitioned by currency and pricing revision semantics;
  missing cost is never zero and the estimate is never billed cost.
- Runtime transcript content, prompts, tool arguments, credentials, raw provider
  payloads, and absolute paths remain outside the dataset.
- Deterministic suggestions are regenerated from canonical evidence at decode
  time. Token concentration is emitted only with complete token coverage over
  at least four returned sessions and a single-session share of at least 50%;
  it describes concentration only and never infers repeated or similar work.
- The first two suggestions are shown directly. Additional suggestions remain
  available in a compact disclosure so the usage field stays primary.

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
- `unit`: the owner-only snapshot loader rejects absent, unsafe, oversized, and
  malformed files; exact decimal fixtures cover all token categories, rounding,
  partial model/rate coverage, and daily/period reconciliation.
- `browser`: a valid snapshot renders estimated currency with explicit covered-
  subset evidence, while no snapshot retains the unsupported state.

## Next Slice

Define how a trusted maintainer or future Ceal-owned sync flow provisions and
updates the snapshot without turning the public CLI into a pricing authority.
Then add the Claude converter as a separate comparability group. The resource
catalog and access-request workflow remain deferred until an Admin-owned
contract exists.
