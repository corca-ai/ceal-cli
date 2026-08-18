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
- Delivery state: findings-received; follow-up review complete
- Round-1 delivery: verdict `blocker`; the reviewer also
  confirmed the frozen input was not drifted and rechecked the Worker/Agent
  source claims listed in the goal. Its stale-current-identity finding is
  addressed by the historical substantive-proof wording above; a second
  review verified that distinction against a new frozen input.
- Round-2 delivery: verdict `clean`; no findings. The reviewer confirmed the
  fixture/production boundary, native D2 enforcement and recorded mutation
  evidence, zero-only baseline removal with positive controls, the sole
  Protocol quarantine red, and the absence of external-boundary or unsupported
  completion claims.
- Round-2 frozen inputs: goal
  `/tmp/ceal-final-claims-freeze-round4.toMn7Z/goal.md`
  (`1c42b5a3469d172dcac3eebc72735effa65a8a7402c801873640380138ce6007`),
  retro
  `/tmp/ceal-final-claims-freeze-round4.toMn7Z/retro.md`
  (`536f18ca45e548b9fb774b434e9e017522bd6cfe24c954dd3a73edac62dd9944`),
  host log
  `/tmp/ceal-final-claims-freeze-round4.toMn7Z/host-log.md`
  (`64d126da0fbd61c684d85b86fbc6d602c3319e713718fab20c71670d7a4b4ede`),
  claims review
  `/tmp/ceal-final-claims-freeze-round4.toMn7Z/claims-review.md`
  (`12b168d982600592aabb0038c69f368c62c9941c6a422012eda20049e8b29805`),
  and adapter
  `/tmp/ceal-final-claims-freeze-round4.toMn7Z/adapter.yaml`
  (`ac62a0da184a3d587a44175bc6e1762d8b748b14e44f04eee74e23adede128cc`).
- Round-2 reviewed roots: Gateway `67afbec6a42451490e9a22f0c9896c15c870eda6`
  / `01f2389ac5e4ff9474595c4a8f1f4941eeb45e97`; current Worker
  `a2192bae5b5b0d87df0627e57fae1a630b2266e8` /
  `60069ced4bda5d2b5dd94df49026fcec66d6d8e4`; Agent
  `0fff321111c8fd3953b54e7bd32da309b08bcc1c` /
  `27f5fc5b558712d1ba2b6911816b151c4c77b6cd`; historical Worker
  substantive-proof boundary `ae4a955e7b371cee4ed778254688646861623377` /
  `44ca6df30cfa445b686fa1b258fdd11db4e32008`.
- External application state: n/a — repository-only review; no push, CI watch,
  release, apply/restart, live readback, or issue operation.
- Application state: n/a — repository-only read-only review.

## Fresh-Eye Satisfaction

parent-delegated

Round 1 is complete as a blocker-finding review. Round 2 is complete against
the new frozen goal and Worker/Agent identities with verdict `clean` and no
findings. The primary may now mark the goal complete; the lifecycle-only
recording commit must not be mistaken for a new source or configuration proof.

## Reviewed Input Identity

The round-1 snapshot SHA values are recorded above. The round-2 snapshot and
reviewed-root SHA values are recorded above before the lifecycle status flips.

## Boundary Ownership

- Producer: Worker goal/closeout artifacts and Agent source/quality artifacts.
- Consumer: the local compiler/linter/test gates and the goal closeout reader.
- Owning surface: the Worker goal artifact with sibling-owned implementation
  evidence.
- Verdict: owned-correctly

Worker owns this goal artifact and its closeout evidence. Agent owns its source,
quality, and baseline artifacts. Gateway supplies the fixed port context only.
No release, runtime, or live-provider surface is owned by this closeout.
