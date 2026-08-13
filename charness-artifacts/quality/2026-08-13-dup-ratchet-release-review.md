# Quality Review
Date: 2026-08-13
Title: Worker Release Duplicate-Ratchet Review

## Scope

Target boundary: the 18 duplicate families reported by the maintainer-local
pre-push ratchet after the signed v6 Worker release cut.

Ambient repo findings: check:unit was green before this review. This review
does not rerun the broad gate, publish, tag, push, or alter a production serving
surface.

## Surface Contract Review

- semantic coverage: partial — signed contract generation and Protocol source
  acquisition mutations were observed; final published artifacts were not.
- surface: Worker signed-contract generator and release-input test harness.
- owner: authenticated Gateway sidecars own routes; the Worker generator owns
  their exact generated projection; release-input tests own acquisition refusal.
- projections: checked-in generated TypeScript and isolated source materialization.
- state scope: one generator invocation or one temporary source acquisition.
- transitions: exact input, malformed contract, drifted generated source,
  commit mismatch, tree mismatch, and unchanged generation.
- proof boundary: focused contract tests and the canonical duplicate ratchet.
- unexamined axes: full pre-push, packed/native release artifacts, published
  package, installed client, and live Gateway/provider behavior.

## Current Gates

- node scripts/check-dup-ratchet.mjs: 18 new families before triage, 13
  after generator cleanup, 10 after the source-acquisition test cleanup, then
  green after reviewed intentional classifications.
- focused generator/release mutation tests: green.
- npm run check:unit: green in the parent pre-push receipt; not rerun here.
- npm run check, audit, CLI probes, and broad skill inventories: not run in
  this narrow slice.

## Runtime Signals

- runtime source: timing capture is missing for this narrow review; direct
  targeted command elapsed times are recorded below only.
- runtime hot spots: not assessed because structured timing capture is missing;
  both direct focused runs completed within the fast-command boundary.
- coverage gate: not run; the parent receipt says check:unit was green before
  the duplicate hook refusal.
- evaluator depth: deterministic local gates only; no model/provider evaluator
  applies to this source-ownership cleanup.

## Healthy

- Carrier/control generated-source verification now shares one exact
  JSON/ARGV/SHA binding owner while preserving boundary-specific error codes.
- Materialized and verified control contracts share one validated handoff
  projection constructor.
- Commit/tree mismatch tests share setup but retain distinct call-sequence
  assertions proving no write occurs before both identities verify.
- No duplicate family was silently absorbed into the baseline.

## Weak

- The detector can report overlapping spans in one function and whole-file
  orchestration pairs as fixable candidates; each still requires human review.
- Independently runnable scripts retain tiny record/SHA helpers because sharing
  them would add build-order or runtime-package coupling.

## Missing

- No automatic semantic classifier can decide whether two release builders
  cross the same trust boundary. The reviewed overlay remains the explicit
  maintainer-owned judgment surface.

## Deferred

- Further splitting of the long control-session contract validator is deferred:
  the reported spans overlap inside one implementation, and no second fact
  owner exists to remove.

## Advisory

- structural review result (command: node scripts/check-dup-ratchet.mjs): reduce for common contract read/generated-source
  verification and acquisition mutation setup; intentional_keep for distinct
  trust boundaries, symmetric wire directions, self-overlapping detector spans,
  executable boilerplate, and standard three-line primitives.
- concept lens (artifact: gateway-protocol-handoff-lock.json): route and archive identities remain sidecar/lock-owned; no local
  route table or unsigned authority was introduced.
- behavior lens (command: focused contract tests): exact drift and pre-write refusal assertions remain visible.
- security/operability lens (artifact: dup-review.json): no checkout-dist fallback, baseline overwrite, or
  cross-runtime helper dependency was introduced.

## Delegated Review

- Delegated Review: executed — a bounded parent-delegated fresh-eye reviewed
  fail-closed generated constant parsing, handoff validation, mutation honesty,
  and all intentional classifications; verdict: no Act Before Commit.
- Slow-gate lenses: fixture-economics, parallel-critical-path, and
  duplicated-proof were checked; the reviewer confirmed no standing proof was
  removed, and these fast focused suites needed no separate delegation.

## Commands Run

- quality adapter resolve/bootstrap/planner and required primer reads.
- node scripts/check-dup-ratchet.mjs at activation and after each structural
  decision.
- node --test test/contract/worker-release-assets.test.mjs.
- node test/run-source-tests.mjs test/contract/leased-consumer-control-conformance-projection.test.mjs.
- node --test test/contract/worker-release-inputs.test.mjs.
- focused Biome and git diff --check.

## Recommended Next Quality Moves

- active run the final bundle gate — capability_needed=release-ready local
  evidence; next_center=parent pre-push workflow;
  transformation=re-run the complete hook after this commit;
  proof_boundary=pre-push receipt including the duplicate ratchet;
  enforcement_posture=existing-gate-reuse.
- passive because current extraction would add more coupling than it removes,
  revisit generic script primitives only if a repo-owned dependency-free
  script library becomes the existing convention;
  would add more coupling than it removes; proof_boundary=dependency graph and
  duplicate ratchet; enforcement_posture=no-gate.

## History

- [Earlier durable review](history/2026-07-26-quality-review.md)
- [Prior quality review](2026-08-12-issue14-postcommit-review.md)
