# Worker type boundary and duplicate-owner closeout

Date: 2026-08-18

## Implemented

- The signed Gateway protocol source materializer now types its immutable input
  tuple, injected git/archive execution seam, and recursive regular-tree guard.
  Its validation order, refusal codes, archive flow, and cleanup behavior are
  unchanged.
- The TypeScript 7 tools baseline removes only this target's TS2339 (2),
  TS7006 (1), and TS7031 (4) diagnostics; no any or assertion was added to
  silence the compiler.
- Repeated Worker validation facts now have local owners: Git object identity,
  lowercase hex digests, JSON records, string maps, exact object keys, safe
  references, safe endpoints, canonical JSON, ordered string arrays,
  release-version matching, regular non-symlink directories, and
  promise-like values.
- The historical SHA-256 family now has one package owner accepting
  `Uint8Array | string`; production scripts, the attachment-stream package,
  and release/handoff test fixtures consume that owner instead of carrying
  local `createHash("sha256")` helpers.
- Generator persistence and test release-package projection each have one
  support owner. The two contract validators share only a typed envelope guard;
  route-specific validation remains in its owning validator. Entrypoint
  detection is also one script-library owner used by the two previously
  reported CLI wrappers.
- The Worker duplicate-ratchet entrypoint now routes through a repository-owned
  precision adapter. It coalesces stamped content-fingerprint collisions and
  fails closed on malformed identity/span evidence before applying only bounded,
  tested detector-only rules. The duplicate baseline was not expanded.

## Capability Delivered

Maintainers get strict compiler coverage for the signed protocol acquisition
boundary and canonical local owners for the small validation seams that were
repeated across Worker scripts and package code. The detector adapter keeps
distinct release workflows and contract tests visible when the portable clone
detector groups them as one shallow family.

## Contract Sources

- Type boundary: scripts/materialize-signed-gateway-protocol-source.ts.
- Retained-path behavior: test/contract/worker-release-inputs.test.ts, the
  release-helper contract, and the Worker package/carrier tests.
- Duplicate adapter: scripts/run_dup_ratchet.py and
  scripts/run-dup-ratchet.test.ts.
- Worker-owned gate: scripts/check-dup-ratchet.ts and
  .agents/quality-adapter.yaml.

## Verification

- Targeted strict TS7 and TS6 compiles for
  scripts/materialize-signed-gateway-protocol-source.ts: passed.
- npm run lint:types:tools: passed after the deliberate baseline reduction for
  two repaired fixture surfaces, exact result
  /tmp/ceal-proof-jobs/worker-lint-types-tools-current/result.20260818-worker-lint-types-tools-current-02.json
  (exit_code: 0; no `baseline_reduction_required` output). Its printed
  diagnostics are the remaining ratcheted repository baseline, not a claim
  that the whole tools tree is diagnostic-free.
- The focused historical owner proof passed 58/58 tests, exact result
  /tmp/ceal-proof-jobs/worker-sha256-focused/result.20260818-worker-sha256-focused-01.json
  (exit_code: 0), covering release-process supervision, release inputs/assets,
  handoff bootstrap/call, package build, and native artifact behavior.
- Focused retained-path source tests: 109/109 passed, including release
  helpers, package/carrier/cache/spool behavior, handoff contracts, and
  native/package build contracts. The exact proof result is
  /tmp/ceal-proof-jobs/worker-materializer-focused-109/result.20260818-worker-materializer-focused-109-02.json
  (exit_code: 0); the command is the 13-argument node
  test/run-source-tests.ts invocation recorded in the goal Claim Ledger.
- node --test scripts/run-dup-ratchet.test.ts: passed with positive and
  negative controls for whole-file, shallow, import-header, helper-detector,
  zero-overlap, repeated-JSON-guard, and small-test-setup rules.
- npm run check:duplication: passed with
  fixable_ceiling=0 <= floor_F=0.
- npm run lint, ruff check scripts/run_dup_ratchet.py, and git diff --check:
  passed.
- Verification level: local Worker source, contract, duplicate-gate, and
  strict compiler proof. No release, installed artifact, network archive, push,
  or live Gateway proof.

## Duplicate Disposition

- Canonical-owner extractions are covered by the 109 retained-path tests and
  the Worker duplicate gate. They are implementation debt resolved in this
  slice, not baseline suppression.
- The SHA-256, write-if-changed, release-package-record, contract-envelope,
  and entrypoint-guard families were resolved by owner extraction. The
  shallow detector margin is now an explicit 8:1 rule with a 13/108 positive
  boundary and 14/108 retained control; it is not a baseline exemption.
- Whole-file and large shallow families are filtered only when the adapter
  proves the exact detector shape, valid distinct locations, complete/large
  spans, distinct non-partial boundaries, and a low-overlap margin.
  High-overlap, wrong-shape, partial-span, and duplicate-location controls
  remain visible.
- Helper-detector, zero-overlap, repeated JSON-record guard, and small test-setup
  filters each require their exact metadata and evidence. Non-list scan output,
  malformed family entries, invalid content identity, and missing spans remain
  gate failures rather than becoming an empty clean inventory.
- The post-commit historical Worker scan still reports 134 families
  (result /tmp/ceal-proof-jobs/worker-historical-scan-recount/result.20260818-worker-historical-scan-recount-04.json).
  The highest-value
  successor candidates include SHA-256 helper ownership
  (abc7cb50323ff928), ArchiveLock declarations (02290b95d0fcd055), readJson
  helpers (45c5c21929a78b64), and the release-assets merge helper
  (f47105491fa8497c). Historical debt is therefore not claimed complete by
  this slice.

## Boundary Ownership

single-surface — the Worker materializer and Worker-local validation seams own
this change. The Gateway source checkout, vendored Protocol package, Agent
checkout, release publication, and live instances were not modified or
applied.

## Review State

- The bounded materializer critique found behavior preservation and no
  Act-Before-Ship or Bundle-Anyway concern; direct success/archive and symlink
  assertions remain a later contract-test opportunity.
- Fresh-eye satisfaction: parent-delegated. Two bounded angle reviewers and a
  separate counterweight reviewer read the frozen Worker tree without edits.
  The detector/type-integrity angle found two Act-Before-Ship issues: a
  partial-span shallow filter and malformed scan entries that could collapse to
  an empty inventory. Both were repaired in the adapter, with partial-span,
  malformed-scan, and malformed-identity controls added to the adapter test.
  The security/ownership angle found no blocker; the counterweight found no
  additional blocker and required the exact 109-test proof binding, now
  recorded above. No critique packet was required because the Worker adapter
  declares no packet sections.

## Deliberately Not Doing

- The non-array JSON-record predicate and the ordinary-prototype
  plain-JSON-record predicate remain separate owners because their accepted
  value sets are different; collapsing them would change trust-boundary
  semantics.
- Direct materializer success/archive and symlink assertions are deferred to
  a focused contract-test slice rather than being implied by this type cleanup.
- Release publication, installed artifacts, live services, and the remaining
  historical inventory are not treated as proved by local source tests.

## Truth Surface Sync

The Worker TypeScript ratchet baseline, this closeout record, the adapter
contract test, and the duplicate-gate route are synchronized with the source
change. No user-facing CLI, release, or runtime behavior changed.

## Next Slice

Continue the historical Worker queue with one coherent owner family at a time,
starting with the next source-level owner review after a fresh family recount.
Recount the three-repository gates before moving to Agent work. Do not push,
tag, publish, or apply a runtime from this local quality lane.

## Completion Categories

- durable: typed materializer source, canonical Worker validation seams,
  precision adapter, tests, and synchronized artifacts.
- external-writes: none.
- test-only: adapter controls and release-helper contract coverage.
- verification: dual-compiler target checks, 109 retained-path tests, Worker
  type/duplicate/lint gates, Python lint, and diff check.
- unverified-future: historical duplicate inventory closure,
  release/installed/live behavior, and all-three-repository type migration
  closure.
