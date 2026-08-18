# Recent Retro Lessons

## Current Focus

- This retro covers the local Worker/Agent quality goal from activation through the closeout proof pass. (source: `charness-artifacts/retro/2026-08-19-session-retro.md`)

## Repeat Traps

- One targeted Agent test was sent through `run-test-lanes.ts` even though the script test is not owned by that runner. The runner returned `source_test_not_owned`; the valid direct Node strip-types route then passed 17/17. This was a route-selection miss, not a test failure. (source: `charness-artifacts/retro/2026-08-19-session-retro.md`)
- The first fresh-eye reviewer was spawned before the goal and checkout inputs were frozen. Subsequent goal edits made its line-based reading ambiguous, so the result was correctly discarded as drift evidence and a second bounded review was needed. This was avoidable verification rework, strong evidence. (source: `charness-artifacts/retro/2026-08-19-session-retro.md`)
- The first generated Lane E baseline patch was a near miss: its initial key comparison was not lane-qualified and its comma handling could have produced invalid JSON. JSON parsing and an exact pre/post positive-key comparison caught both before any baseline commit, so there was no lasting data loss. The waste was reconstruction and repair of the patch shape, not a greened baseline. (source: `charness-artifacts/retro/2026-08-19-session-retro.md`)
- The first Worker full gate also exposed a host-shaped timeout message mismatch in a retained fixture. The exact filtered test passed on immediate retry, so no production workaround was justified; the result remains a recorded non-determinism signal rather than an erased red. (source: `charness-artifacts/retro/2026-08-19-session-retro.md`)

## Next-Time Checklist

- applied: freeze goal bytes, sibling HEADs, and evidence paths before every delegated review; require a clean result or an explicit drift disposition before editing again (source: `charness-artifacts/retro/2026-08-19-session-retro.md`)
- applied: the active goal Claim Ledger now carries explicit sibling-root commands, baseline key-preservation checks, proof-job result paths, and the first-review drift non-claim (source: `charness-artifacts/retro/2026-08-19-session-retro.md`)
- out-of-scope: upstream Charness should expose a closeout scaffold/shape path earlier; no plugin source or external issue was authorized in this local-only run (source: `charness-artifacts/retro/2026-08-19-session-retro.md`)

## Selection Policy

- Source: `charness-artifacts/retro/lesson-selection-index.json`
- Slots: current_focus=2, repeat_trap=4, next_improvement=4
- Policy: advisory recency half-life 45 days plus recurrence boost with adaptive alpha.

## Sources

- `charness-artifacts/retro/2026-08-19-session-retro.md`
