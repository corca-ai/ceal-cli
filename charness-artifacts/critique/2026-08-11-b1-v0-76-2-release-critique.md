# B1 v0.76.2 Release Critique

Date: 2026-08-11

## Decision Under Review

Consume the Gateway additive-decoder/delegated-relay handoff, implement B1 in
the generic client and worker, and publish `ceal-v0.76.2` through the worker
release lane.

## Release Scope

Patch release `ceal-v0.76.2`: ship B1 compatibility plus the already queued
PATH, guide, client-boundary, and session-writer repairs without changing CLI
invocation. The current unsigned Protocol `0.72.14` packet is development input,
not the final release identity.

## Failure Angles

- Operational/checklist: the final signed handoff is absent, the generic
  publisher selects the wrong bare `v0.76.2` lane, and the local packet cannot
  by itself provide the frozen source/test tree.
- Consumer/interface: authority-shaped unknown keys and undeclared capability
  arguments cross weaker boundaries than the packet claims; rolling Gateway
  compatibility also requires legacy negotiation to remain alongside the new
  generation header.
- Proof integrity: one decoder call cannot prove the worker session survives
  version skew, and the packed consumer currently proves package resolution and
  `ceal commands`, not B1 behavior.

## Surface-Lock Inventory

- final Gateway tag/archive/signature/checksum and producer identities;
- frozen Protocol source/test/conformance, vendor pin, handoff lock, exact
  dependencies, private contract, generated digests, and workflow literals;
- generic generation and transitional legacy headers, with lifecycle omission;
- every additive decoder site and the undeclared-capability frame loop;
- existing public SDK header exports;
- three worker manifests, clean-regenerated lockfile, guide, installer, signed
  assets, changelog, release record, and handoff.

## Counterweight Pass

### Act Before Ship

- Gateway must replace `0.72.14`: the authority matcher accepts and strips
  `grant_revision`, `policy_version`, `scope_revision`, and
  `credential_version` despite the declared refusal boundary.
- Gateway must replace `0.72.14`: undeclared capability arguments accept
  locator, permission, grant, and policy keys that the generic result boundary
  refuses.
- A final signed handoff must converge the frozen tree, lock, pin, dependencies,
  generated contract, and workflow inputs before any release path runs.
- The transition release must send the generation declaration alongside legacy
  eligible headers and retain the public legacy constants.
- Worker consecutive-frame and packed-consumer B1 behavior must be executed,
  not inferred from Protocol unit tests or package resolution.

### Bundle Anyway

- Prove benign-key removal across every converted response site and retain the
  authority/request/notification/closed-enum negative controls.
- Bind local source/test re-vendoring to the exact commit/tree named by the
  packet; the tarball remains the packed-artifact proof input.
- Add a tracked divergence request only if a corrected unsigned packet is
  consumed before the signed one.
- Draft result-oriented release notes for the accumulated release scope.

### Over-Worry

- Do not build a second tag guard because the generic plugin helper can produce
  `v0.76.2`; simply never use that helper for the worker lane.
- Do not duplicate the complete release checklist in the B1 spec; the standing
  procedure remains its one home.
- Do not require the handoff tarball itself to carry source/tests when the
  signed identity and exact owner tree bind those inputs separately.

### Valid but Defer

- Removing legacy public header constants or legacy negotiation support waits
  for a supported-Gateway floor and the appropriate semver boundary.
- Live Gateway apply, provider/Slack behavior, latency proof, and macOS installed
  acceptance remain separate authorization/proof surfaces.
- B2/B3 guidance changes and a general safe-JSON refactor remain owner-lane work.

## Operator Action Required

1. Ask the Gateway owner to repair both reproduced Protocol boundary defects
   and issue a replacement packet.
2. Implement and prove B1 only against that corrected packet.
3. Before release, bootstrap the final signed handoff, converge all release
   inputs, regenerate the version lockfile from a manifest-only tree, push main,
   read exact-commit CI, run the worker workflow dry-run and burn preflight, then
   use only the annotated `ceal-v0.76.2` tag.
4. Verify public checksums/signatures and stable identity, run `ceal update`,
   read back version/commands/guide status, and reconcile both handoffs.

## Upgrade Path

Existing managed installations run `ceal update`, then `ceal version`,
`ceal commands`, and `ceal guide status`. The release requires no new flag or
session reenrollment. New Gateway capabilities remain a non-claim until the
Gateway selects/applies the compatible serving identity.

## Structured Findings

- F1 | bin: act-before-ship | evidence: strong | ref: ../ceal/packages/ceal-protocol/src/gateway-validation-primitives.ts:264 | action: defer | note: Gateway authority-key matcher is weaker than its release claim
- F2 | bin: act-before-ship | evidence: strong | ref: ../ceal/packages/ceal-protocol/src/leased-consumer-control.ts:714 | action: defer | note: undeclared arguments admit locator and authority-shaped keys
- F3 | bin: act-before-ship | evidence: strong | ref: gateway-protocol-handoff-lock.json:7 | action: defer | note: no corrected signed final handoff exists
- F4 | bin: act-before-ship | evidence: strong | ref: packages/ceal-client/src/http-transport.ts:98 | action: fix | note: generation must retain transitional legacy sends and public exports
- F5 | bin: act-before-ship | evidence: strong | ref: packages/ceal-worker-cli/src/leased-consumer-control-session.ts:484 | action: fix | note: prove safe unknown capability followed by a known frame in one session
- F6 | bin: act-before-ship | evidence: strong | ref: scripts/verify-gateway-protocol-consumer.mjs:176 | action: fix | note: packed proof must execute B1 behavior
- F7 | bin: bundle-anyway | evidence: moderate | ref: ../ceal/packages/ceal-protocol/src/index.ts | action: defer | note: cover every converted additive response site
- F8 | bin: over-worry | evidence: strong | ref: docs/operator-acceptance.md:132 | action: document | note: generic bare-v publisher is excluded rather than extended
- F9 | bin: valid-but-defer | evidence: moderate | ref: docs/release-and-enrollment.md | action: defer | note: live apply provider latency and macOS installed proof remain separate

## Reviewer Tier Evidence

- Requested tier: n/a (host-default bounded reviewers)
- Requested spawn fields: fork_turns=all
- Host exposure state: host-defaulted
- Application state: n/a
- Delivery state: findings-received

## Fresh-Eye Satisfaction

parent-delegated — two contrasting release angles and one separate
counterweight returned findings; all three worktree fingerprint verifications
were `clean`.

## Reviewed Input Identity

Packet consumed: n/a (no critique adapter sections).

## Boundary Ownership

- Producer: Gateway Protocol owner produces the decoder, relay, packet, and
  signed immutable identity.
- Consumer: ceal-client and the signed worker release consume that identity.
- Owning surface: Gateway Protocol for the two boundary fixes; ceal-cli for
  header emission, worker continuity proof, packing proof, and publication.
- Verdict: moved-to-owner

## Next Move

Do not vendor or release the known-bad `0.72.14` packet. Deliver the tracked
Gateway request, then resume with the corrected replacement packet.
