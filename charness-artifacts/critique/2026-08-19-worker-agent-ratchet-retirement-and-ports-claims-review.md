# Worker and Agent ratchet retirement and ports claims review

Date: 2026-08-19

## Decision Under Review

Close the local Worker/Agent ratchet-retirement goal after its compiler/linter
and fixture slices, with no external-boundary claim.

## Failure Angles

- A final claim may outrun the source, especially at the temporary-fixture versus
  production-tsconfig boundary.
- The Agent baseline cleanup may remove positive diagnostics or blur TS7/TS6
  lanes.
- Native D2 lint ownership or mutation/restore evidence may be a copied claim
  rather than a receiving-local guard.
- A dirty checkout or stale identity may be presented as final closeout.
- Local proof may be described as release, CI, installed-worker, or live proof.

## Counterweight Pass

The review must downgrade any claim that is not re-readable at the frozen root
and must preserve the existing Protocol quarantine red rather than re-pin it.
The fixture claim is intentionally limited to unchanged production configs and
source-diagnostics scope; it must not imply that existing production
`skipLibCheck` settings perform dependency declaration-file checking.

## Structured Findings

<!-- allowed enums: bin: act-before-ship | bundle-anyway | over-worry | valid-but-defer; evidence: strong | moderate | weak | contested; action: fix | file-issue | document | defer -->

- F1 | bin: act-before-ship | evidence: strong | ref: frozen goal Slice 2 and Worker/Agent production tsconfig owners | action: fix | note: round 1 found that “preserving production declaration checking” was too strong because both existing production configs already have `skipLibCheck: true`; the goal and quality artifacts were narrowed to unchanged production configs/source diagnostics, and the pre-existing policy was recorded as a separate compiler-migration finding.
- F2 | bin: act-before-ship | evidence: strong | ref: frozen goal Final Verification and Worker checkout state | action: fix | note: round 1 found closeout artifacts dirty and identities provisional; the source/evidence roots are now explicitly rebound to Worker `ae4a955` and Agent `0fff321`, while the lifecycle-only Worker artifact commit is kept separate from that historical proof identity.

## Reviewer Tier Evidence

- Requested tier: one bounded, unnamed, parent-delegated read-only claims reviewer
  per the repository delegation contract.
- Requested spawn fields: unnamed spawn; frozen goal, retro, host-evidence,
  adapter, and three explicit roots; no edits, staging, commits, child agents,
  or external boundaries; stop and return partial findings on read failure.
- Host exposure state: metadata-hidden
- Frozen round-1 inputs: goal, retro, host evidence, adapter, and Gateway/
  Worker/Agent HEAD/tree identities were fingerprinted under
  `/tmp/ceal-final-claims-freeze.k0wPdb/`.
- Delivery state: findings-received; follow-up review pending
- Round-1 delivery: verdict `blocker`; the reviewer also
  confirmed the frozen input was not drifted and rechecked the Worker/Agent
  source claims listed in the goal. Its stale-current-identity finding is
  addressed by the historical substantive-proof wording above; a second
  review must verify that distinction against a new frozen input.
- External application state: n/a — repository-only review; no push, CI watch,
  release, apply/restart, live readback, or issue operation.
- Application state: n/a — repository-only read-only review.

## Fresh-Eye Satisfaction

parent-delegated

Round 1 is complete as a blocker-finding review. A second review is required
after this wording repair and closeout commit, against a new frozen goal and
the new Worker/Agent identities; the goal may not be marked complete before it
returns a clean verdict or an explicitly recorded blocker.

## Reviewed Input Identity

The round-1 snapshot SHA values are recorded in the session transcript and the
active goal. The follow-up round will record its exact snapshot SHA values here
before the lifecycle status flips. No clean follow-up verdict is claimed yet.

## Boundary Ownership

- Producer: Worker goal/closeout artifacts and Agent source/quality artifacts.
- Consumer: the local compiler/linter/test gates and the goal closeout reader.
- Owning surface: the Worker goal artifact with sibling-owned implementation
  evidence.
- Verdict: owned-correctly

Worker owns this goal artifact and its closeout evidence. Agent owns its source,
quality, and baseline artifacts. Gateway supplies the fixed port context only.
No release, runtime, or live-provider surface is owned by this closeout.
