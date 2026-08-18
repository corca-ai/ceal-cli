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
- The historical `ArchiveLock` type family now uses the existing export from
  `worker-gateway-handoff-archive.ts`; native-artifact and release-input
  consumers no longer redeclare that eight-field contract.
- The historical `readJson` family now has one `scripts/lib/read-json.ts`
  reader factory. It owns file decoding and JSON parsing while each caller keeps
  its domain-specific error class, code, and invalid-input message.
- The historical Gateway Protocol fixture provenance shape now has one
  `test/protocol-artifact-provenance.ts` owner. Its callback boundary keeps the
  synthetic tarball fixture and the built-package snapshot distinct while
  sharing only producer scope, marker, and provenance sidecar writes.
- Buffered and streaming Unix-socket transport paths now share one cleanup owner
  for timer and abort-listener release; response lifecycle and close/finally
  behavior remain in their respective transport functions.
- The generic non-null object guard now has one `scripts/lib/object-record.ts`
  owner. Its accepted set intentionally includes arrays, so it does not replace
  the JSON-record guard that rejects arrays.
- Probe command and subcommand validation now share only their common surface
  fields; command name/lifecycle and subcommand parent/route/default validation
  remain local to their respective definitions.
- Compose and merge release-asset workflows now share one result-envelope
  constructor and one staging/checksum/publish/cleanup owner. Their native asset
  population, input validation, and workflow-specific result payloads remain
  separate.
- The shared output publisher now preserves a marked previous output during a
  forced replacement and restores it when the staging rename fails. Sibling
  temporary-directory construction is also one output-directory owner used by
  rollback backup and by the release-assets, native-artifact, and
  release-package staging composers.
- The Worker duplicate-ratchet entrypoint now routes through a repository-owned
  precision adapter. It coalesces stamped content-fingerprint collisions and
  fails closed on malformed identity/span evidence before applying only bounded,
  tested detector-only rules, including a regression contract for same-file
  result-envelope segmentation. The duplicate baseline was not expanded.

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
- JSON reader contract: test/contract/read-json.test.ts.
- Protocol fixture provenance: test/protocol-artifact-provenance.ts,
  test/contract/worker-release-inputs.test.ts, and
  test/worker-release-package-fixture.ts.
- Generic object and probe contracts: scripts/lib/object-record.ts,
  scripts/probe-surface-contract.ts, and test/contract/script-lib.test.ts.
- Release-asset result/staging contracts: scripts/build-worker-release-assets.ts,
  scripts/build-worker-native-artifact.ts, scripts/build-worker-release-package.ts,
  and test/contract/worker-release-assets.test.ts.
- Output replacement contract: scripts/lib/output-directory.ts and the forced
  publish rollback test in test/contract/worker-release-assets.test.ts.
- Repo-build scratch wiring: test/repo-build.ts and
  test/contract/repo-build.test.ts.
- Transport cleanup behavior: packages/ceal-worker-cli/src/private-worker-transport.ts
  and its leased-consumer transport tests.
- Duplicate adapter: scripts/run_dup_ratchet.py and
  scripts/run-dup-ratchet.test.ts.
- Worker-owned gate: scripts/check-dup-ratchet.ts and
  .agents/quality-adapter.yaml.

## Verification

- Targeted strict TS7 and TS6 compiles for
  scripts/materialize-signed-gateway-protocol-source.ts: passed.
- npm run lint:types:tools: passed after the deliberate baseline reduction for
  two repaired fixture surfaces, exact result
  /tmp/ceal-proof-jobs/worker-lint-types-tools-current/result.20260818-worker-lint-types-tools-current-04.json
  (exit_code: 0; no `baseline_reduction_required` output). Its printed
  diagnostics are the remaining ratcheted repository baseline, not a claim
  that the whole tools tree is diagnostic-free.
- The focused historical owner proof passed 60/60 tests, exact result
  /tmp/ceal-proof-jobs/worker-sha256-focused/result.20260818-worker-sha256-focused-03.json
  (exit_code: 0; it includes the direct SHA-256 owner contract), covering
  release-helper, release-process supervision, release inputs/assets, handoff
  bootstrap/call, package build, and native artifact behavior.
- The earlier ArchiveLock-slice historical ratchet-shaped scan passed with 132 families after
  the ArchiveLock owner extraction, exact result
  /tmp/ceal-proof-jobs/worker-historical-scan-recount/result.20260818-worker-historical-scan-recount-07.json
  (tool version 0.20.0). This was the previous slice's measured count, not
  historical closure.
- The current readJson owner proof passed 69/69 tests, exact result
  /tmp/ceal-proof-jobs/worker-read-json-focused/result.20260818-worker-read-json-focused-03.json
  (exit_code: 0), including the dedicated reader contract, release inputs,
  handoff archive/bootstrap/call, package, and native-artifact paths.
- The current Worker TypeScript tools ratchet passed with exit_code 0 and no
  `baseline_reduction_required` output at
  /tmp/ceal-proof-jobs/worker-lint-types-read-json/result.20260818-worker-lint-types-read-json-05.json;
  the log still contains `error TS` diagnostics as a positive control, so this
  is not a claim that the remaining type baseline is empty.
- The current historical ratchet-shaped scan passed with 132 families at
  /tmp/ceal-proof-jobs/worker-historical-scan-recount/result.20260818-worker-historical-scan-recount-11.json
  (tool version 0.20.0). The count is not monotonic when a test contract changes
  detector family boundaries; it is a measured inventory, not historical closure.
- The exact former Protocol provenance fixture fingerprint
  `d95ac33768d18b97` has zero current matches, while the same scan returns the
  positive-control `isRecord` family `8c5ae173bd9d0063` at three locations; the
  control payload is recorded at
  /tmp/ceal-proof-jobs/worker-provenance-family-control/result.20260818-worker-provenance-family-control-01.json.
- The current Protocol provenance focused proof passed 51/52 tests with one
  skipped test and no failures at
  /tmp/ceal-proof-jobs/worker-provenance-focused/result.20260818-worker-provenance-focused-02.json.
- The current Unix-socket transport focused proof passed 27/27 tests at
  /tmp/ceal-proof-jobs/worker-transport-focused/result.20260818-worker-transport-focused-01.json.
- Focused retained-path source tests: 109/109 passed, including release
  helpers, package/carrier/cache/spool behavior, handoff contracts, and
  native/package build contracts. The exact proof result is
  /tmp/ceal-proof-jobs/worker-materializer-focused-109/result.20260818-worker-materializer-focused-109-02.json
  (exit_code: 0); the command is the 13-argument node
  test/run-source-tests.ts invocation recorded in the goal Claim Ledger.
- node --test scripts/run-dup-ratchet.test.ts: passed with positive and
  negative controls for whole-file, shallow, import-header, helper-detector,
  zero-overlap, repeated-JSON-guard, small-test-setup, and same-file transport
  boundary rules, including both removable-metric and non-overlap controls.
- npm run check:duplication: passed through the Worker proof route with
  fixable_ceiling=0 <= floor_F=0, exact result
  /tmp/ceal-proof-jobs/worker-dup-three-composer-final/result.20260818-worker-dup-three-composer-final-12.json
  (exit_code: 0). The adapter contract also passes its positive, negative,
  and packaged-scan malformed-input controls.
- The object-record, probe-surface, repo-build, release-assets, and forced
  output-rollback focused proof passed 68/68 tests at
  /tmp/ceal-proof-jobs/worker-three-composer-staging-focused/result.20260818-worker-three-composer-staging-focused-10.json
  (exit_code=0). The first two attempts exposed missing scratch-module mappings;
  the repo-build harness now maps both the new object owner and its pre-existing
  JSON-record supervisor owner to stable absolute imports.
- The Worker tools and tests TypeScript ratchets passed with exit_code 0 at
  /tmp/ceal-proof-jobs/worker-lint-types-three-composer-tools/result.20260818-worker-lint-types-three-composer-tools-08.json
  and
  /tmp/ceal-proof-jobs/worker-lint-types-three-composer-tests/result.20260818-worker-lint-types-three-composer-tests-09.json.
  Both logs retain `error TS` diagnostics as positive controls and contain no
  `baseline_reduction_required` failure; this is not a claim of zero residual
  type debt.
- The duplicate adapter contract passed 1/1 after the result-owner extraction,
  and its exact result-envelope positive/negative controls remain in
  scripts/run-dup-ratchet.test.ts.
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
- The packaged scanner's public `scan_families` seam normalizes malformed
  entries before returning. The Worker adapter now calls the skill-owned raw
  collector when available, preserves its family list, and fails closed before
  filtering; the adapter contract models a raw collector returning
  `[None, valid_family]` and proves that it is refused. Charness/plugin source
  was not edited.
- Historical family 02290b95d0fcd055 was resolved by importing the existing
  `ArchiveLock` type owner; no new type or runtime dependency was introduced.
- Historical family d95ac33768d18b97 was resolved by sharing only the Protocol
  fixture provenance/marker/sidecar owner; the synthetic and built-package pack
  callbacks remain separate. The current scan has zero matches for that exact
  fingerprint, with `8c5ae173bd9d0063` retained as a positive control.
- Historical family 8c5ae173bd9d0063 was resolved by the neutral
  `isObjectRecord` owner. Its array-including semantics are directly tested, and
  the existing `isJsonRecord` owner remains separate because it excludes arrays.
- Historical family 7b59dc768ff177fd was resolved by
  `hasProbeDefinitionFields`; command-specific and subcommand-specific fields
  remain in their owning guards.
- Historical family a63fc52b0fc88b75 was resolved by
  `stageAndPublishWorkerReleaseAssets`; the compose and merge callbacks still
  own distinct asset population and validation.
- The re-segmented 126a9b71a039844c result-envelope family was not accepted as a
  detector exemption. Its common local-state envelope is now owned by
  `createWorkerReleaseAssetsResult`; the adapter's exact same-file rule and
  positive/negative fixtures remain only as a fail-closed regression guard for
  future detector re-segmentation.
- The forced output replacement failure was fixed at the shared
  `publishOutputDirectory` owner: a marked previous tree moves to a sibling
  backup, staging is renamed into place, and the previous tree is restored when
  that rename fails. The 68-test proof includes a missing-staging control.
- The transient d40055414bbcc395 family exposed by the first rollback version
  was resolved by `createSiblingTemporaryDirectory`; the final duplicate gate
  reports no new fixable family and the final historical scan finds zero matches.
- The later native/package staging-owner finding was resolved by changing both
  `materializeOutput` callers to use `createSiblingTemporaryDirectory`; all three
  release composers now share the same staging-path owner. The final focused
  proof, type ratchets, duplicate gate, and historical recount were rerun after
  this repair.
- The source-backed result-envelope detector rule was strengthened after a
  fresh-eye review: it now requires the source declaration and envelope markers
  plus the actual `output_dir` line named by each `shared_subdag`. The first
  overly narrow version exposed family `25dbc057a594dfa0` as a gate failure;
  the corrected source witness classifies that current raw overlap as
  detector-only, with a metadata/source negative control retained in the adapter
  contract. The failed attempt is evidence of precision repair, not a bypass.
- The repeated timer/listener cleanup in the buffered and streaming transport
  paths is now owned by `clearUnixSocketCleanup` at
  `packages/ceal-worker-cli/src/private-worker-transport.ts:244-251`.
- Family 75c41de299d5412b was a detector-only same-file span crossing the
  streaming transport into `boundedResponseStream`; it is filtered only by the
  exact overlap/shape/metric contract at `scripts/run_dup_ratchet.py:144-166`.
  The adapter test keeps both a removable-metric mismatch and a non-overlap
  geometry control visible.
- The `_same_file_two_locations` adapter helper owns the repeated location
  normalization used by the same-file rules; this prevents the adapter itself
  from creating a new duplicate family.
- Whole-file and large shallow families are filtered only when the adapter
  proves the exact detector shape, valid distinct locations, complete/large
  spans, distinct non-partial boundaries, and a low-overlap margin.
  High-overlap, wrong-shape, partial-span, and duplicate-location controls
  remain visible.
- Helper-detector, zero-overlap, repeated JSON-record guard, and small test-setup
  filters each require their exact metadata and evidence. Non-list scan output,
  malformed family entries, invalid content identity, and missing spans remain
  gate failures rather than becoming an empty clean inventory.
- The current historical Worker scan reports 130 families after the object,
  probe, staging, result-envelope, and harness slices at
  /tmp/ceal-proof-jobs/worker-historical-scan-recount/result.20260818-worker-historical-scan-recount-17.json
  (tool version 0.20.0). The exact former families 8c5ae173bd9d0063 and
  126a9b71a039844c have zero matches, while positive-control family
  a3048e1b0c675c4a remains present and the transient d40055414bbcc395 family
  introduced during rollback repair is absent. Raw family 25dbc057a594dfa0
  remains present once and is filtered only by the source-backed result-owner
  detector contract; historical debt is therefore still open.

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
- Historical-owner fresh-eye: three bounded read-only reviewers read frozen
  Worker HEAD 7cb0393. The type/runtime reviewer found no retained-behavior
  blocker but required current proof rebinding; the counterweight marked the
  mixed owner families as a valid-but-defer grouping concern and required
  direct SHA input proof; the duplicate-precision reviewer found a real
  packaged-scan normalization hole. The raw-collector boundary and direct
  SHA-256 contract test were added, then the 60-test, type-ratchet, duplicate
  gate, lint, and 132-family recount proofs were rerun. Reviewer reports were
  signals; the primary re-read the scanner and adapter source before repair.
- ReadJson owner fresh-eye: the bounded type/runtime reviewer re-read all four
  original implementations, their domain-specific error contracts, call sites,
  and nearest tests; it found no retained-behavior blocker and confirmed that a
  caller-injected failure preserves each error class, code, and message. It
  noted that a generic `Error` test was too weak; the dedicated contract now
  throws the actual `WorkerReleaseInputError` and checks its class, code, and
  message. Missing-file coverage remains explicitly deferred because it enters
  the same `readFileSync` catch path and no separate behavior branch was added.
  The bounded duplicate-precision reviewer then re-read the factory and four
  callers, found no blocker or fragile threshold, and confirmed the current
  duplicate gate and former-family control. Both reviews are complete.
- Protocol fixture, transport, and detector fresh-eye: Avicenna re-read the
  frozen current source and found no blocker. It confirmed that the provenance
  helper shares only the marker/sidecar shape, that synthetic and built-package
  pack paths remain separate, and that `clearUnixSocketCleanup` preserves the
  existing timer/listener and stream close/finally lifecycle. It also confirmed
  the adapter's fail-closed identity checks and precise same-file boundary
  conditions. The suggested non-overlap geometry control was added and passed.
- Object-record/result-envelope fresh-eye: Aquinas found no blocker after
  re-reading the object guard, common probe fields, staging cleanup, scratch
  mappings, and adapter controls. Its only risk—that the result envelope might
  be hidden rather than owned—was addressed by extracting
  `createWorkerReleaseAssetsResult`; the current scan confirms the former
  126a9b71a039844c family is absent. The inherited Hilbert report was stale and
  was not used as evidence. Euler then found that native and package staging
  construction still had separate callers; those two callers were repaired to
  use the shared sibling-directory owner. Euclid's final follow-up re-read the
  source-backed result-owner witness, confirmed that the shared subdag correctly
  points outside the composer spans to the extracted helper, and found no
  remaining blocker. Its non-blocking concern is the intentional exact-source
  contract coupling, which is now recorded in the next-slice risk.

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
starting with the next current candidate after positive-control family
`a3048e1b0c675c4a`, while preserving the exact `8c5ae173bd9d0063` and
`126a9b71a039844c` zero-hit controls. Recount the three-repository gates before
moving to Agent work.
Keep the result-envelope detector contract source-backed: if the helper
declaration, envelope markers, or canonical owner line moves, update its adapter
fixture and rerun the raw/gate positive controls in the same slice. Do not widen
it into a blanket same-file exemption.
Do not push, tag, publish, or apply a runtime from this local quality lane.

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
