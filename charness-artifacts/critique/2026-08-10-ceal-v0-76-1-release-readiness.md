# ceal-v0.76.1 release readiness
Date: 2026-08-10

## Execution

Two parent-delegated reviewers examined the clean `79e876c` source repair
before version mutation. The operational/release-safety lens and the
release-narrative counterweight agreed on a patch release after version,
changelog, candidate proof, canonical tag, public artifact, and installed
readback gates. Parent-side reviewer fingerprints returned `verdict: clean` for
both windows.

## Target

Release critique shaped by `references/release-critique.md`.

## Decision Under Review

Publish the Worker-owned notification shutdown repair as the immutable patch
tag `ceal-v0.76.1`, preserving Protocol `0.72.13` and the signed Gateway handoff
input, then hand the signed identity to the Gateway selection/apply lane.

## Capability at Stake

An already-running Agent turn can be cancelled through the private v5
notification session without a normal owner-initiated FD5 close turning the
Worker process into a false failure.

## Release Scope

- Version and tag: `0.76.1`, `ceal-v0.76.1`.
- Consumer change: exact owned-shutdown classification for the private Worker
  notification stream.
- Preserved failures: FD5-first EOF, malformed notification, unrelated error,
  and same-message/wrong-code error.
- Out of scope: public CLI or Protocol change, npm publication, Gateway/Agent
  source change, selection/apply, live provider/Slack/latency, concurrent
  channel-loss idempotency, and C11a completion.

## Surface-Lock Inventory

- Root/client/worker version manifests, exact Worker client pin, and lockfile.
- Worker binary, per-platform manifests, signed inventory, installer, guide,
  notices, and stable pointer.
- `CHANGELOG.md`, release record, handoff, repair spec, closeout, and code
  critique.
- Frozen Protocol `0.72.13`, Gateway handoff lock, private contract, and
  generated source remain inputs rather than changed surfaces.

## Failure Angles

- Operational: a `0.76.1` tag against `0.76.0` manifests would burn at asset
  composition; the three manifests, exact Worker client pin, and lockfile must
  move together in a separate version slice.
- Release safety: branch CI proves source, not the versioned release matrix,
  signing, public inventory, stable pointer, or installed binary.
- Humane interface: the changelog must describe the narrow Worker lifecycle
  repair without implying public API, Gateway apply, or live behavior.
- Upgrade/rollback: stable-pointer rollback and an already-installed host
  downgrade are distinct operations and must not be described as equivalent.

## Counterweight Pass

- Version synchronization, changelog truth, exact candidate gates, canonical
  tag spelling, public verification, and installed readback are Act Before Ship.
- Reusing the existing Protocol/handoff and local cross-repo proof is correct;
  no new wire version or runtime redesign belongs in this patch.
- Bumping the client manifest does not claim a client API change: the release
  procedure version-binds packed client provenance and requires all three
  manifests to agree.
- Concurrent notification plus channel loss is valid but deferred; the normal
  owner-shutdown repair must not absorb that independent race.

## Operator Action Required

1. Synchronize root/client/worker `0.76.1`, the Worker client dependency, and a
   freshly generated lockfile while keeping Protocol `0.72.13`.
2. Run the full local gate, duplicate/shell/hook/diff gates, push exact main,
   and require exact-head branch CI green.
3. Run the release workflow dry run and the Gateway-owned pre-tag burn
   preflight before creating the canonical `ceal-v0.76.1` tag.
4. Watch the tag workflow, verify signed public assets and stable pointer, then
   update the installed Worker and read back version, commands, and guide.

## Upgrade Path

After public signature and stable-pointer verification, run `ceal update` from
the installed command and read back `ceal version`, `ceal commands`, and
`ceal guide status`. Stable-pointer rollback to `ceal-v0.76.0` affects future
stable resolution; it does not automatically downgrade a host already on
0.76.1. Any host downgrade uses the explicit signed 0.76.0 installer path.

## Deliberately Not Doing

- No public route, operand, Protocol version, Gateway/Agent source, or release
  workflow change.
- No npm package publication or bare `v0.76.1` tag.
- No live Gateway/provider/Slack or concurrent channel-loss claim.

## Structured Findings

- F1 | bin: act-before-ship | evidence: strong | ref: package.json:3 | action: fix | note: synchronize the three release manifests, Worker client pin, and lockfile at 0.76.1
- F2 | bin: act-before-ship | evidence: strong | ref: CHANGELOG.md:3 | action: fix | note: record only the exact owned-shutdown repair and its preserved failure arms
- F3 | bin: act-before-ship | evidence: strong | ref: docs/release-and-enrollment.md:55 | action: document | note: bind full local, main CI, dry-run, tag, public, and installed proof to the version commit
- F4 | bin: act-before-ship | evidence: strong | ref: .github/workflows/ceal-release.yml:22 | action: document | note: use only ceal-v0.76.1; the bare tag belongs to an unconfigured npm lane
- F5 | bin: bundle-anyway | evidence: strong | ref: packages/ceal-worker-cli/test/leased-consumer-control-session.test.mjs:398 | action: document | note: carry the real FD5 and wrong-code mutation evidence into the release record
- F6 | bin: over-worry | evidence: strong | ref: packages/ceal-client/package.json:3 | action: document | note: coordinated client version identity does not imply client API behavior changed
- F7 | bin: valid-but-defer | evidence: strong | ref: charness-artifacts/spec/2026-08-10-worker-owned-notification-shutdown.md:66 | action: defer | note: concurrent notification plus channel loss remains independent
- F8 | bin: valid-but-defer | evidence: strong | ref: docs/handoff.md:34 | action: defer | note: Gateway selection/apply, live latency, and C11a completion follow the signed release

## Reviewer Tier Evidence

- Requested tier: high-leverage, resolved to medium by the repo Codex adapter
  rule.
- Requested spawn fields: follow-up reviewers reused existing medium-effort
  bounded agents; the follow-up surface exposes no per-turn override fields.
- Host exposure state: host-defaulted
- Application state: not host-confirmed.
- Delivery state: findings-received.

## Fresh-Eye Satisfaction

parent-delegated

## Reviewed Input Identity

No packet consumed: no critique adapter sections were configured. The reviewed
input was clean ceal-cli commit
`79e876c2a6d56fe88dd8d939fa8cfb5276a93088`, its diff from
`ceal-v0.76.0`, and the pending `ceal-v0.76.1` tuple.

## Boundary Ownership

- Producer: this repository for Worker source, version identities, release
  assets, installed update, and release record.
- Consumer: the Gateway selection/apply lane and installed `ceal` users.
- Owning surface: ceal-cli release workflow and public Worker origin for the
  immutable artifact; Gateway runtime for later selection and live proof.
- Verdict: owned-correctly

## Next Move

Close F1/F2 in the version slice, execute F3/F4 without weakening the gates,
and preserve F7/F8 as non-claims until their owning lanes execute them.
