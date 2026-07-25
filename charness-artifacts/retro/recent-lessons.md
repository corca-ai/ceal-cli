# Recent Retro Lessons

## Current Focus

- One work unit: resolving corca-ai/ceal-cli#1 (the signed guide's mandated descent was not completable because `capabilities targets` had no leaf help, and the guide demanded an opaque cursor where `message.search` returns an integer offset), through causal review, implementation, resolution critique, release `ceal-v0.65.5`, and issue closeout. (source: `charness-artifacts/retro/2026-07-25-session-retro.md`)

## Repeat Traps

- **Additive fix shape.** The declaration was added *beside* the existing acceptance literals rather than replacing them, so two sync gates and three copies of a row parser now exist only to keep two sources agreeing. The counterweight correctly deferred the refactor, but the shape is why the residual risk exists at all. (source: `charness-artifacts/retro/2026-07-25-session-retro.md`)
- **Blind subagent polling (22.7 min, measured).** The five bounded reviewers were the right call, but retrieving their output was improvised each time: sleep, guess, sleep again, then read the transcript by hand. The retrieval path — not the review — was the cost. (source: `charness-artifacts/retro/2026-07-25-session-retro.md`)
- **Critique-after-commit rework.** The `--help`-as-operand hazard (a help probe reaching the enrollment runner and prompting for a device-enrollment code) and `cealctl enrollments create`'s wrong `result_schema` were found *after* slice 1 landed, so slice 2 rewrote the dispatch path slice 1 had just written and re-touched the same four files. Both were findable mechanically before writing the table: enumerate every source that already accepts a route (`GUIDE_ACTIONS`, `parseEnrollmentOptions`, `parseReceiptOptions`, `parseAccessOptions`, …) and every declared schema against its emitter. (source: `charness-artifacts/retro/2026-07-25-session-retro.md`)
- **Gate over-running.** Three full `npm run check` runs where the repo rule is targeted gates at commit boundaries and the full gate at final proof. Gate debt: `npm run check` ≈96s is dominated by release-artifact and native-binary tests that cannot observe CLI help behavior; there is no unit-only script, so the cheap loop is not reachable by name. (source: `charness-artifacts/retro/2026-07-25-session-retro.md`)

## Next-Time Checklist

- file `corca-ai/charness` issues for (a) a deterministic bounded-reviewer result read so parents never sleep-poll, and (b) making the `describe_*`/`scaffold_*` stub the planner's `next_action` for closeout carriers the way it already is for retro artifacts. Structural pattern: improvised retrieval and prose-first authoring of contract-gated artifacts. Triggering instances: 10 sleep calls / 22.7 min, and 13 shape-discovery calls this session. Destination: upstream `charness` (plugin source is upstream-owned; not editable from this repo). (source: `charness-artifacts/retro/2026-07-25-session-retro.md`)
- gate ladder as written — targeted package tests at commit boundaries, full `npm run check` once at final/pre-release proof; and when the JTBD only completes at delivery, put the whole chain (push → release → runtime readback → close) in one boundary question. (source: `charness-artifacts/retro/2026-07-25-session-retro.md`)
- scaffold or stub any validator-gated artifact *before* drafting its prose (closeout carriers, critique, spec, release notes) — the existing always-loaded template-first rule, applied to the closeout carrier where it was skipped; and when a slice declares a table for a dispatch surface, first enumerate every source that already accepts those routes and every declared schema against its emitter, so critique-found rework folds into slice 1. (source: `charness-artifacts/retro/2026-07-25-session-retro.md`)
- split `npm test` into `test:unit` (protocol + client + both CLI packages, ~3s) and `test:release` (root release-artifact and native-binary suites, ~90s) so the iteration gate is reachable by name; record the release suite as named gate debt rather than paying it per commit. (source: `charness-artifacts/retro/2026-07-25-session-retro.md`)

## Selection Policy

- Source: `charness-artifacts/retro/lesson-selection-index.json`
- Slots: current_focus=2, repeat_trap=4, next_improvement=4
- Policy: advisory recency half-life 14 days plus recurrence boost with adaptive alpha.

## Sources

- `charness-artifacts/retro/2026-07-25-session-retro.md`
