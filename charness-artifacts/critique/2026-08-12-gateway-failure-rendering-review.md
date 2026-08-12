# Gateway Failure Rendering Review Critique

Date: 2026-08-12

## Decision Under Review

Keep Gateway-authored safe failure presentation while repairing the two
regressions introduced by the `f88f940` simplification: all-or-nothing optional
field fallback and lost denial disposition.

## Failure Angles

- Protocol permits an absent `next_action`; a safe required message must not be
  discarded with it.
- Dynamic wording must not cause credential-shaped text to reach YAML through a
  direct Worker caller.
- Presentation simplification must not silently change `blocked`/`denied`
  semantics for authentication, Profile, or target-authorization failures.

## Counterweight Pass

- Keep field fallback independent and use the Protocol public-safe predicate;
  retain the existing Ceal credential-prefix guard because that predicate does
  not cover that local secret shape.
- Restore only disposition facts as compact code and recovery-kind sets. Do
  not restore the removed per-code wording or recovery prose tables.
- Keep `retry_after_ms` projection out of this repair: its call-only output
  shape predates this change and needs a separate schema decision.

## Structured Findings

- F1 | bin: act-before-ship | evidence: strong | ref: packages/ceal-worker-cli/src/call-result-output.ts | action: fix | note: independently preserve safe message and optional action
- F2 | bin: act-before-ship | evidence: strong | ref: packages/ceal-worker-cli/src/call-result-output.ts | action: fix | note: preserve known authorization denials as denied or blocked
- F3 | bin: act-before-ship | evidence: strong | ref: packages/ceal-worker-cli/src/call-result-output.ts | action: fix | note: use Protocol safe-text validation before direct rendering
- F4 | bin: bundle-anyway | evidence: moderate | ref: packages/ceal-worker-cli/test/cli.test.mjs | action: fix | note: add the message-absent/action-present symmetric regression
- F5 | bin: over-worry | evidence: strong | ref: packages/ceal-protocol/src | action: document | note: do not change frozen Protocol or reintroduce local prose tables
- F6 | bin: valid-but-defer | evidence: moderate | ref: packages/ceal-worker-cli/src/index.ts | action: defer | note: cross-surface retry timing projection is pre-existing schema work
- F7 | bin: act-before-ship | evidence: strong | ref: packages/ceal-worker-cli/src/call-result-output.ts | action: fix | note: absent Gateway action must not become retry authorization
- F8 | bin: act-before-ship | evidence: strong | ref: packages/ceal-worker-cli/src/call-result-output.ts | action: fix | note: direct renderer must reject credential-shaped codes and proof refs
- F9 | bin: act-before-ship | evidence: strong | ref: packages/ceal-worker-cli/src/call-result-output.ts | action: fix | note: direct retry timing must respect the Protocol maximum
- F10 | bin: bundle-anyway | evidence: moderate | ref: test/contract/one-fact-one-home.test.mjs | action: fix | note: prove opaque valid proof refs survive the direct renderer
- F11 | bin: over-worry | evidence: strong | ref: packages/ceal-protocol/src | action: document | note: do not widen the frozen Protocol public exports for this Worker repair
- F12 | bin: act-before-ship | evidence: strong | ref: packages/ceal-worker-cli/src/call-result-output.ts | action: fix | note: normalize the whole direct recovery shape before deriving denial or pacing
- F13 | bin: act-before-ship | evidence: strong | ref: packages/ceal-worker-cli/src/call-result-output.ts | action: fix | note: recognize policy denial only after its complete Protocol-shaped call envelope validates
- F14 | bin: act-before-ship | evidence: strong | ref: packages/ceal-worker-cli/src/call-result-output.ts | action: fix | note: reject non-plain records and serialization-forged nested policy state before projecting authorization

## Reviewer Tier Evidence

- Requested tier: high-leverage
- Requested spawn fields: n/a
- Host exposure state: host-defaulted
- Application state: host did not expose applied model metadata
- Delivery state: findings-received

## Fresh-Eye Satisfaction

parent-delegated

## Reviewed Input Identity

Packet Consumed: n/a (no adapter sections)

## Boundary Ownership

- Producer: Gateway and frozen Protocol define error fields and their safety.
- Consumer: Worker projects the decoded result into CLI YAML and status.
- Owning surface: Worker renderer and its CLI contract tests.
- Verdict: owned-correctly
