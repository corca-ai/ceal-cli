# ceal-v0.76.0 release readiness
Date: 2026-08-09

## Execution

Two parent-delegated angle reviewers examined the clean `56ab0d1` tree under
the operational/checklist and humane-interface/first-reader lenses. A third
parent-delegated reviewer performed the separate counterweight pass. The
parent-side boundary fingerprint returned `verdict: clean` after every review.

## Target

Release critique shaped by `references/release-critique.md`.

## Decision Under Review

Consume the signed Gateway Protocol handoff
`gateway-protocol-handoff-v0.72.13`, release the accumulated CLI safety and
fine-grained timing work as `ceal-v0.76.0`, and publish only after the coherent
input/version commits, local gates, main CI, and release-lane dry run succeed.

## Capability at Stake

Users must receive an observable and failure-safe CLI from one immutable,
authenticated Gateway input without an ambiguous install, provenance, or
release-note surface.

## Release Scope

- Version and tag: `0.76.0`, `ceal-v0.76.0`.
- Consumer change: opt-in phase timing, safer local session/update behavior,
  and v5 private leased-consumer control compatibility through Protocol
  `0.72.13`.
- Out of scope: macOS installed proof and live Gateway/provider readback.

## Surface-Lock Inventory

- `ceal --timing`, CLI result/recovery behavior, and installed update path.
- Signed handoff lock, frozen Protocol source/pin, private contract/generated
  source, and release workflow handoff literals.
- Root/client/worker manifests, package lock, signed static release inventory,
  and install/update assets.
- `CHANGELOG.md`, README timing guidance, handoff, debt, release procedure, and
  release record.

## Failure Angles

- Operational/checklist: authenticated certificate claims must remain
  mechanically enforced when the candidate lock becomes a release input; the
  handoff and version changes must stay in their documented commit order.
- Humane interface/first reader: the release history must explain what timing
  exposes, what channel it uses, and what the release does not prove.
- Provenance: a signed worker manifest that embeds the client package must bind
  that package's immutable identity rather than recording Protocol alone.

## Counterweight Pass

- The missing workflow-SHA consumer check, client-package provenance, release
  history, and ordered public verification are release blockers backed by the
  current source.
- Stale handoff/debt prose is cheap truth-surface cleanup bundled with the
  coherent handoff input.
- Suppressing transient human update text under `--timing` is deliberate: the
  JSONL-only stderr contract is tested so machine parsing remains valid.
- Cross-invocation timing correlation is a real future design question, but the
  CLI does not append or aggregate logs. It does not block this invocation-local
  diagnostic surface.
- macOS installed and live provider proof remain explicit non-claims rather
  than invented prerequisites.

## Operator Action Required

1. Enforce `reviewed_signature.workflow_sha === gateway.commit` and test drift.
2. Bind the client package identity in the signed worker release manifest and
   all inventory consumers.
3. Apply the authenticated v0.72.13 lock, frozen tree, private contract,
   generated source, workflow literals, and truth-surface docs in one commit.
4. Add the 0.76.0 release history and regenerate the separate manifest/lockfile
   version slice with no `node_modules` in the regeneration tree.
5. Run the full local gate, push main, read `check.yml`, run the workflow dry
   run, then tag and verify public artifacts before installed readback.

## Upgrade Path

After the signed release is publicly verified, run `ceal update`, then read
back `ceal version`, `ceal commands`, and `ceal guide status`. The previous
immutable `ceal-v0.75.0` remains the rollback identity; stable-pointer rollback
still requires the repo-owned verified rollback workflow.

## Deliberately Not Doing

- No macOS installed-success or live Gateway/provider-success claim is made.
- No route, operand, endpoint, identity, or payload is added to timing events.
- No broad timing aggregation/store is introduced in this release.

## Structured Findings

- F1 | bin: act-before-ship | evidence: strong | ref: scripts/worker-gateway-handoff-archive.mjs:155 | action: fix | note: enforce the certificate workflow SHA recorded by the bootstrap
- F2 | bin: act-before-ship | evidence: strong | ref: scripts/build-worker-release-assets.mjs:144 | action: fix | note: bind embedded client package provenance in the signed release manifest
- F3 | bin: act-before-ship | evidence: strong | ref: CHANGELOG.md:3 | action: fix | note: record the 0.76.0 user surface and honest timing scope
- F4 | bin: act-before-ship | evidence: strong | ref: docs/release-and-enrollment.md:14 | action: fix | note: preserve coherent handoff/version commits and CI dry-run-tag-public-readback ordering
- F5 | bin: bundle-anyway | evidence: strong | ref: docs/handoff.md:38 | action: fix | note: replace stale bootstrap and highest-handoff state when the input lands
- F6 | bin: over-worry | evidence: strong | ref: packages/ceal-worker-cli/test/cli.test.mjs:601 | action: document | note: timing mode intentionally keeps stderr JSONL-only instead of mixing transient progress
- F7 | bin: valid-but-defer | evidence: moderate | ref: packages/ceal-worker-cli/src/timing.ts:73 | action: defer | note: cross-invocation correlation belongs to a future aggregation contract
- F8 | bin: valid-but-defer | evidence: strong | ref: docs/operator-acceptance.md | action: document | note: macOS installed and live Gateway/provider proof remain explicit post-release non-claims

## Reviewer Tier Evidence

- Requested tier: high-leverage
- Requested spawn fields: model gpt-5.6-luna; reasoning_effort xhigh
- Host exposure state: requested_fields_sent
- Application state: not host-confirmed; the spawn surface accepted the fields
- Delivery state: findings-received

## Fresh-Eye Satisfaction

parent-delegated

## Reviewed Input Identity

No packet consumed: no critique adapter sections were configured. The reviewed
input was the clean repository tree at
`56ab0d1cd88017c661467f1ae1b13e2a21528c75` plus the pending release tuple named
above.

## Boundary Ownership

- Producer: Gateway handoff workflow for Protocol identity; this repository for
  worker/client artifacts and release records.
- Consumer: the worker release lane and installed `ceal` users.
- Owning surface: signed Gateway handoff for producer facts; repo-owned lock,
  frozen copy, manifest builder, CLI, and release procedure for consumer facts.
- Verdict: owned-correctly

## Next Move

Close F1 through F5, run the full release proof, and preserve F7/F8 as honest
non-claims rather than expanding the tag boundary.
