# Local Usage Dashboard Production Contract

Status: implemented through the separate Codex and Claude runtime partitions

## Capability

The local Workbench consumes normalized, privacy-safe datasets for a user's
locally observed Codex and Claude sessions, tool-call metadata, and
runtime-supplied token evidence while keeping identity/access authority and
unsupported monetary cost explicit.

## Current Slice

The current priority is a presentation-ready CLI Workbench shell before further
producer plumbing. The shell must make the product legible with coherent
synthetic evidence: local Profile context, one runtime at a time, usage axes,
an activity field, evidence-bounded suggestions, all returned sessions through
pagination, and a separate capability-access journey. `npm run demo:dashboard`
is the maintained local demo entry point; its fixture is synthetic and cannot
be consumed as production evidence.

The shell is complete for this slice when a presenter can open one loopback URL
and demonstrate the combined Usage/session, Access, and Evidence journeys, switch runtime,
metric, theme, and color mode, inspect a session, and traverse a history above
one hundred sessions without contradictory totals or unbounded scrolling.

Pricing installation remains the next producer-facing CLI slice after the
presentation shells. `ceal pricing status` is already implemented;
`ceal pricing install --file <path> [--dry-run]` remains specified below but is
not advertised until validation and atomic mutation handling ship together.
The CLI remains a transport and validator, not a pricing authority.

Pricing implementation remains sequenced without advertising dead routes: the
implemented status leaf ships independently; install is declared only when
dry-run and mutation handling are executable together.

Both leaves emit one `ceal.pricing_snapshot.v1` YAML document. Shared safe
fields are `schema_version`, `command`, `ok`, `action`, `effect`, `status`, `reason`,
`authority: operator_supplied_local`, `commercial_accuracy: not_verified`,
`network_contact: none`, and `next_action`. A ready/planned/installed value may
also include `observed_at`, `currency`, `rate_count`, and a non-reversible
revision fingerprint. `command` is always `ceal`; `action` is `status` or
`install`; `effect` is `read_only` for status and `local_write` for install.
Status classification records use `ok: true` and the ordered status/reason pair
below, with a fixed recovery-specific `next_action`. `status` exits zero whenever it successfully classifies
the store, including absent or unhealthy states. Invalid arguments exit 2;
install validation/store refusals exit 3; an install whose rename may have
succeeded but whose fresh readback cannot be proved exits 4 with
`status: outcome_unknown`.

Pricing status uses a separate diagnostic inspector; the observer loader keeps
its existing fail-closed `snapshot | null` contract. Classification is ordered:

1. missing `.ceal` directory → `absent/store_absent`;
2. unsafe parent type, symlink, ownership, or mode → `unsafe/unsafe_store`;
3. missing snapshot → `absent/snapshot_absent`;
4. symlink, non-regular, multiply-linked, wrong-owner, or wrong-mode snapshot →
   `unsafe/unsafe_snapshot`;
5. descriptor open/read instability → `unreadable/snapshot_unreadable`;
6. more than 256 KiB → `invalid/snapshot_too_large`;
7. malformed JSON or rejected schema → `invalid/snapshot_invalid`;
8. future `observed_at` → `invalid/snapshot_future`;
9. otherwise → `ready`.

Every non-ready state carries fixed recovery text. Unsafe parents are repaired
manually to a real owner-owned `0700` directory; unsafe destination paths must
be removed or replaced manually after inspection. A regular file with invalid
content may be replaced by install. An unreadable current file is refused
because revision reuse cannot be checked safely.

The current slice adds Claude as a second canonical runtime partition. Claude
`event_usage_sum` observations remain separate from Codex
`runtime_cumulative_last`; the Workbench never produces a cross-runtime token
total, ranking, or cost. The browser selects one runtime partition at a time and
preserves the selected metric inside that partition. Claude cost remains
unsupported because the local transcript adapter does not expose an accepted
model identity.

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
`ceal.agent_activity.v1` projection into runtime-specific intermediate
`ceal.local_usage_dashboard.codex_input.v1` and
`ceal.local_usage_dashboard.claude_input.v1` envelopes.
It consumes only structural metadata already allowlisted by `agent-audit.ts`.
The observer retains only the Codex intermediate input in its compatibility
field beside the predecessor projections; it does not expose the Claude
intermediate. The browser consumes neither intermediate directly.

`composeCanonicalLocalUsageDashboard` now owns that second boundary. It emits a
fail-closed production discriminator, half-open local-calendar window and IANA
timezone, daily covered-subset values, reconciling totals, per-metric coverage,
comparability groups, identity/access projections, and evidence-bounded pricing.
The observer exposes the results as `local_usage_dashboards`, with the Codex
partition retained at `local_usage_dashboard` for compatibility. Consumers
reject fixture provenance or a missing production discriminator.

The Workbench now renders that canonical dataset through Usage, Access, and
Evidence tabs, with an in-page Korean/English selector. Usage combines its
activity field and bounded session detail in one page. It switches among
Sessions, Agent tool calls, Tokens, and Estimated cost without changing
evidence semantics; both runtime partitions render the same selected-period
calendar scaffold, while missing daily evidence remains unavailable rather
than zero. Each calendar cell filters the session detail below without changing
tabs or browser history; the UI states when daily aggregates and returned detail
have different coverage. Session detail uses task-first rows, defaults to highest observed token use,
offers recent/tool-call alternatives, and keeps twenty-row pagination so a
history over one hundred rows does not turn into one unbounded scroll. Synthetic
demo task names are visibly labeled as synthetic; production observations never
infer work content from timing or counts. Runtime switching clears the date
filter and explains that Codex and Claude retain separate sources, accounting
semantics, shapes, and scales. Access uses a capability-specific list rather
than session cards and explains effect and target requirements while keeping the
unowned request workflow disabled. Evidence is the human-readable provenance,
coverage, retention, and known-loss explanation for the other views; raw DTO
field dumps are not part of that presentation surface.

The runtime selector also has an All view when Profile, instance, timezone, and
selected-period bounds align. It combines runtime-scoped session records on the
shared calendar and in one recent-first detail list, but does not sum or rank
token and cost observations across unlike runtime contracts. When only one
runtime supplies numeric session evidence for a date, the combined cell remains
visible as an explicitly outlined lower bound rather than disappearing or
treating missing evidence as zero. Token, cost, and evidence-bound suggestion controls require an
explicit Codex or Claude selection. A suggestion that cites one session moves
focus to the exact runtime-and-session row, marks it as suggestion evidence, and
shows the localized rule rationale; the detail dialog opens only after the user
activates the highlighted row.

## Fixed Decisions

- Codex and Claude have separate production converters and comparability
  groups. Neither runtime is silently normalized into the other's semantics.
- Local session identity and Gateway capability access are independent inputs.
- Access projects only the allowlisted capability ID, display label, effect,
  target requirement, and evidence requirement returned by Gateway discovery.
  It is not a resource inventory or a copy of provider/policy payloads.
- Usage suggestions are deterministic `ceal.local_usage_rules` v2 projections
  over the canonical dataset. They identify covered-token concentration,
  token/tool evidence gaps, and unavailable cost with bounded metric/session
  evidence; they are not model judgment, productivity scoring, or actions.
- The v2 analyzer runs through an internal
  `ceal.local_usage_analysis_input.v1` projection containing only runtime,
  allowlisted source/session refs, per-metric coverage, structural tool-call and
  token counts, and pricing state. It emits coded findings with numeric basis;
  `ceal-cli` recomputes those findings exactly and owns all visible copy and
  next actions. Neither the analysis input nor raw findings reach the browser.
- The browser receives only the fixed display labels `Codex sessions` and
  `Claude sessions`, never expanded transcript roots.
- `complete`, `partial`, `observed_empty`, and `unreadable` remain distinct.
- Inventory state is named separately from per-session event and token evidence;
  a complete inventory never implies complete tool-call or token coverage.
- Returned session details and eligible inventory counts remain separate.
- The displayed token total is the runtime-reported input plus output
  observation. Cache fields remain separate because their accounting relation
  to input is runtime-defined; the UI does not silently add them.
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
- Tool-call concentration uses the same complete-coverage, four-session, and
  50% threshold over structural tool-event counts. It links the highest covered
  session for inspection and never infers repetition, waste, or productivity.
- The first two suggestions are shown directly. Additional suggestions remain
  available in a compact disclosure so the usage field stays primary.
- A session-inspection suggestion navigates to the referenced session's
  paginated row and opens its existing structural-evidence dialog. An
  evidence-review suggestion navigates to the Evidence view. These are local UI
  transitions, not analyzer-controlled commands or capability execution.
- Pricing installation is an explicit local-write operation. `--dry-run` makes
  no filesystem change; status and help are read-only.
- The input must be a non-symlink regular file within the existing 256 KiB
  bound and must decode as the strict snapshot contract with no future
  `observed_at`. Its source permissions do not become trust evidence.
- The destination remains `~/.ceal/pricing-snapshot.json` under the existing
  owner-only `0700` directory and `0600` file contract. Replacement is written
  and synced through a same-directory temporary file before atomic rename.
- Reinstalling byte-equivalent canonical content is `unchanged`. Reusing one
  revision for different pricing semantics is refused because it would break
  the comparability-group invariant. A different valid revision may replace
  the prior snapshot.
- Canonical serialization uses the schema key order and rates sorted by
  `model_key`; JSON whitespace, source key order, and source rate order are not
  semantic. Full canonical equality is `unchanged`. Revision reuse compares
  currency plus the sorted model/rate table: changed `snapshot_ref` or
  `observed_at` with identical pricing semantics may install, while the same
  revision with changed currency or any rate is refused.
- Install holds one store lock across current-state inspection, revision
  comparison, same-directory `wx`/`0600` temporary creation, bounded write,
  file `fsync`, close, anchored rename, directory `fsync`, and fresh descriptor
  readback. Two installers therefore serialize instead of silently
  last-writer-winning. Only a temporary created by this invocation is removed.
- The source is opened once with `O_NOFOLLOW`, checked with `fstat`, and read
  from that descriptor up to 256 KiB + 1 byte. It is never reopened by path.
- Dry-run performs the same source, destination, and revision checks but creates
  no directory, lock, or temporary file. It reports `ok: true`, `planned` or
  `unchanged`, and `reason: validation_passed` or `already_installed`. This is a
  non-binding point-in-time plan; the real install repeats every check under the
  lock. A completed install reports `ok: true`, `status: installed`, and
  `reason: installed_and_verified`. Refusals report `ok: false`,
  `status: refused`, and a bounded reason/next action. Any failure after rename
  that prevents directory durability or fresh readback proof reports
  `ok: false`, `status: outcome_unknown`, and `reason:
  installed_readback_unproven`.
- Command output may show state, observed time, currency, rate count, and a
  non-reversible revision fingerprint. It never emits the input path, raw
  snapshot/revision refs, model keys, rates, or snapshot bytes.
- Automatic fetching, signature verification, freshness expiry, background
  updates, rollback history, and snapshot removal remain deferred until an
  owning producer contract exists.
- `pricing` is a declared top-level command; each slice declares its
  corresponding `status` or `install` leaf only when executable, so command discovery, parent/leaf help, effect metadata,
  recovery, and dispatch totality come from the existing command tables.
  `--file` is required exactly once and flag-order independent; `--dry-run` is
  unique and valueless. Help anywhere is side-effect free, and a flag-looking
  file value is rejected before any read or write.

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
- `unit`: pricing status distinguishes absent, ready, unsafe, unreadable, and
  invalid without exposing snapshot contents.
- `unit`: every status reason obeys precedence and maps to exit zero, `ok: true`,
  fixed effect/action, and bounded recovery.
- `unit`: install help and dry-run perform no write; invalid, oversized,
  symlinked, future, and revision-reuse inputs preserve the installed file.
- `integration`: a valid new revision installs with `0700`/`0600` permissions,
  atomic readback, concise YAML output, and no network contact.
- `unit`: canonical ordering ignores JSON/rate order; a metadata-only update may
  reuse a revision, changed pricing semantics may not; concurrent installers
  serialize, and a post-rename proof failure returns `outcome_unknown`.

## Next Slice

Implement and prove the explicit local pricing status/install lifecycle without
turning the public CLI into a pricing authority. Then run both runtime
partitions against bounded local histories and review whether
the selector, coverage language, and runtime-specific suggestions remain useful
without recording user content. The resource catalog and access-request
workflow remain deferred until an Admin-owned contract exists.
