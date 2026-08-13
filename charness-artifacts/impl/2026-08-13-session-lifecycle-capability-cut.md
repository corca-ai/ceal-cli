# Session Lifecycle Capability Cut Closeout

## Implemented

- Replaced the public flat session reader/writer/lock hooks with one optional,
  all-or-none `CealSessionCapability` containing `load`, `commitEnrolled`,
  `ensureCurrent`, and `logout`.
- Added one production factory over the canonical locked store. The shipped
  binary and deterministic in-memory fixtures both use that factory instead of
  assembling semantic callbacks independently.
- Deleted the projected command context and its prototype/lazy/partial-hook
  compatibility tests.
- Moved status, discovery, call, observer, enrollment/adoption, refresh, and
  logout consumers to the same capability.
- Deleted unlocked enrollment, refresh, and logout fallbacks while retaining
  the locked compare/dispose/write interval, refresh identity plus token CAS,
  and revoke-before-remove ordering.

## Migration Disposition

No data migration exists in this slice. The persisted session V1/V2 parser,
serializer, and exact payload shapes remain current and unchanged. The deleted
surface was source-compatibility scaffolding for hypothetical embeddings, not a
reader for observed historical records.

## Verification

- Focused Worker tests: 185 passed across `cli.test.mjs`,
  `device-adoption.test.mjs`, and `observer.test.mjs`.
- A focused mutation that bypassed `withStateLock` failed the all-or-none
  capability lock assertion (`0 !== 1`, process exit 1); restoring the shipped
  lock path made the same proof green.
- A real child process with `HOME` removed proves session status is
  unconfigured and logout reports `session_runtime_unavailable`; it does not
  substitute a temporary home.
- `npm run check:unit` passed from the staged target tree: lint, unused-export,
  production-reachability, store-lock, duplicate-literal, clean build, unit,
  coverage, and 251 contract tests. Durable result:
  `/tmp/ceal-proof-jobs/ceal-cli-session-lifecycle-check-unit/result.20260813c.json`.
- `npm run check` reached the release-script tier and then failed only on the
  pre-existing `proof_shipment_protocol_divergence` guard (four release
  positives/fixtures); the resulting unvisited release branches also tripped
  script coverage thresholds. Durable result:
  `/tmp/ceal-proof-jobs/ceal-cli-session-lifecycle-check/result.20260813a.json`.
  This is the expected signed-input refusal recorded by the implementation
  contract and handoff, not a session-lifecycle regression.
- Generated declarations expose only `session?: CealSessionCapability`. The
  paired source/dist scan finds the known-positive capability factory and no
  removed raw hook or projected-context identifier.
- `git diff --check` passed.

## Lint Gate

Passed through `npm run check:unit`: Biome, Knip, production reachability,
store-lock census, and duplicate-literal analysis.

## Critique

Two bounded parent-delegated reviewers consumed the current code packet and
reported no Act Before Ship blocker. Their consolidated result is recorded in
`charness-artifacts/critique/2026-08-13-session-lifecycle-capability-code-critique.md`.

Fresh-Eye Satisfaction: parent-delegated.

## Boundary Ownership

`moved-to-owner` — the public binary creates the sole semantic lifecycle
capability over its canonical store; commands consume that capability directly.
No compatibility adapter or second ownership seam remains.

## Residual Risks and Non-Claims

- The signed Protocol pin remains intentionally diverged, so release builders,
  package acceptance, publish, and installed-worker proof remain blocked or
  out of scope until the final signed handoff is consumed.
- No push, tag, publish, install, Gateway selection, live provider action, or
  instance apply occurred.
- Ordinary read-only loads remain unlocked; no reproduced invariant failure
  justified widening this mutation-focused cut.

## Completion Categories

- Completed locally: API cut, ownership convergence, locked mutations, reader
  migration, generated declarations, deterministic tests, and fresh-eye review.
- Deferred to external owner/state: signed Protocol handoff and Worker release.
- Unresolved inside this source slice: none.
