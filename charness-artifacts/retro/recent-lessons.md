# Recent Retro Lessons

## Current Focus

- This retro covers the Worker/client diagnostic-propagation slice after the O3 refresh observation: a bounded response shape now travels from the shared session exchange to the Worker refresh error, and a stale capability fixture was repaired when retained-path proof exposed it. (source: `charness-artifacts/retro/2026-08-21-session-retro.md`)
- This retro covers the local Worker/Agent quality goal from activation through the closeout proof pass. (source: `charness-artifacts/retro/2026-08-19-session-retro.md`)

## Repeat Traps

- The first combined Worker test run surfaced a retained capability fixture family returning `ceal.gateway_discovery.v2` while the decoder required v3. Treating those three reds as unrelated baseline debt would have taught the next session to rerun around a broken fixture. Updating the owned helper to v3 plus `phase: target_page` fixed the producer/consumer shape and all four selector tests passed. (source: `charness-artifacts/retro/2026-08-21-session-retro.md`)
- The first focused raw-body assertion used the scalar text `false`, which also appeared in another serialized error field and produced a false red. Replacing it with a unique JSON string scalar repaired the test oracle itself before rerunning; the lesson is that negative retention sentinels must be unique, not merely valid. (source: `charness-artifacts/retro/2026-08-21-session-retro.md`)
- The first lint run exposed two import-sort violations and one max-line violation introduced by the patch. They were repaired at the source span before any retry; no lint bypass was used. (source: `charness-artifacts/retro/2026-08-21-session-retro.md`)
- The first root proof-runner invocation used `/home/ubuntu/ceal-cli/scripts/run-proof-job.ts`, which does not exist. The runner is owned by the Gateway repo at `/home/ubuntu/ceal/scripts/run-proof-job.ts`; the positive-control file search repaired the command before retrying. This was an ownership-resolution failure, not evidence that `check:unit` failed. (source: `charness-artifacts/retro/2026-08-21-session-retro.md`)

## Next-Time Checklist

- configure the sibling retro adapter's auto-trigger keys only if the repo wants automatic surface-triggered retros; until then, treat `state: not-established` as a manual-retro decision, never as `triggered: false`. (source: `charness-artifacts/retro/2026-08-21-session-retro.md`)
- resolve command ownership with a positive-control file search before any long proof retry; freeze reviewed source paths before delegating fresh-eye review; keep slow gates in the root proof runner; record an exact owner/debt disposition when a frozen contract lane fails. (source: `charness-artifacts/retro/2026-08-21-session-retro.md`)
- update the active goal and sibling handoff after the sibling commit so the diagnostic slice, stale-fixture repair, live-readback non-claim, and no-new-PR boundary are all durable. (source: `charness-artifacts/retro/2026-08-21-session-retro.md`)
- applied: freeze goal bytes, sibling HEADs, and evidence paths before every delegated review; require a clean result or an explicit drift disposition before editing again (source: `charness-artifacts/retro/2026-08-19-session-retro.md`)

## Selection Policy

- Source: `charness-artifacts/retro/lesson-selection-index.json`
- Slots: current_focus=2, repeat_trap=4, next_improvement=4
- Policy: advisory recency half-life 45 days plus recurrence boost with adaptive alpha.

## Sources

- `charness-artifacts/retro/2026-08-19-session-retro.md`
- `charness-artifacts/retro/2026-08-21-session-retro.md`
