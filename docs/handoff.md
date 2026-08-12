# Ceal CLI Roadmap Handoff

## Workflow Trigger

Continue only the `ceal-cli` lanes in the sibling
[`ceal` roadmap](../../ceal/docs/roadmap.md#current-execution-ledger). Do not
redo the Worker shutdown, conditional PATH, read-only discovery, or invariant
guide-method repairs. Push, tag, release, publication, Gateway selection, and
apply remain separately approved boundaries.

## Current State

- Signed `ceal-v0.76.1` is installed on Linux ARM64. The binary digest is
  `5c893c8ab10575eab9da378c85d2ba300d2eb469bd6ed57d5207aae9569cfe04`;
  release run `31346152389` and the public checksum/signature readback are
  recorded in the [release record](../charness-artifacts/release/2026-08-10-ceal-v0-76-1.md).
- That signed worker authoritatively embeds
  `@corca-ai/ceal-protocol@0.72.13`. The release record owns the exact tarball
  and Gateway producer tuple and the commands that re-check the installed
  manifest/build-input chain. The `1.3.0` printed by `ceal version` is the wire
  negotiation version, not the npm Protocol package version.
- Source after `0.76.1` contains the #707 D2 conditional PATH guidance and the
  bounded D3 invariant guide method. The guide is a progressive directory
  carrier and names no fixed capability sequence; final B3 dogfood waits for
  B2's Gateway-served next-step and caller-identity fields.
- `ceal capabilities`, target selection, receipt readback, and acceptance use
  observation mode and never rotate a stored session. Authentication failure
  points to the explicit `ceal session refresh` remote-write route. This is
  already enforced by the renewal-mode and CLI tests; the stale sibling-goal
  claim must not cause a duplicate repair here.
- The current source also contains the client deadline/status/media-type and
  adoption-request boundary repairs, generic HTTP timeout classification,
  narrowed command session capabilities, explicit guide-register provenance,
  bounded subprocess and Unix-socket settlement, monotonic local-store waits,
  managed-install integrity, dependency-closure package hooks, bounded native
  and installer process probes, reduced guide-contract spawning, and the
  directory skill carrier. Ship-facing asset merge now re-asserts the Protocol
  quarantine before reading composed inputs. These are local source/test
  results, not installed worker claims.
- Signed `0.76.1` understands only the legacy single-file guide updater. The
  operator accepted direct rollout of the directory carrier: an upgrade from
  `0.76.1` requires one stable-bootstrap reinstall; archive-capable successors
  can resume ordinary updates.
- The frozen Protocol copy and client/worker dependencies retain reviewed local
  `0.72.17` as a quarantined B1 development baseline. The Gateway has since
  moved the subtree and scheduled one final signed cut after C1; no intermediate
  `0.72.18` consumer review is requested. The signed lock, release workflow, and
  installed worker remain on `0.72.13`, so ship-facing builders and acceptance
  stay correctly refused.
- `npm run check:unit` is the aggregate development iteration gate. Contract
  behavior runs through a real converged scratch repository, while separate
  reachability tests prove the production ship guards refuse divergence before
  reading release inputs or an installed binary. `npm run check:protocol-dev`
  remains the narrower Protocol/client proof. The full gate, release builders,
  packing, and acceptance stay blocked on the live diverged pin.
- Final-gate quality work made audit deadlines deterministic in tests without
  changing the production bound, removed discarded V8 coverage from receipt
  process-gate children, separated their exact exclusion oracle from production
  best-effort lock timing, and watchdog-bounded both production contention
  outcomes. Only the actual first-write race remains concurrent.
  The packed Protocol consumer now derives its guide digest from the same
  canonical directory bundle as both release builders; its focused release test
  passes. The live package/native release positives still refuse the signed-pin
  divergence as required.

## Next Action

1. Wait for the post-C1 final signed Gateway Protocol handoff. Do not request or
   re-pin an intermediate packet merely to restamp the quarantine.
2. Review that exact artifact against the B1 response-depth, authority-key,
   closed-enum, notification-binding, request-envelope, and consecutive-frame
   proofs; converge frozen tree, dependency, lock, pin, generated contracts,
   and workflow input in one commit.
3. Run the ordinary release gates and bootstrap-install proof for the directory
   guide carrier. Ask before choosing a version, pushing, tagging, publishing,
   or installing the new release.
4. After B2 serves ordered guidance and caller identity, finish B3 with
   installed-guide dogfood. Do not invent those future fields in this repo.

## Non-Claims

- No final signed Protocol handoff has been received or reviewed.
- No current source change is signed, released, installed, selected by a
  Gateway, or proved against a live provider.
- D2 and bounded D3 are locally complete but remain unreleased.
- Response-latency and concurrent notification/channel-loss proofs remain
  downstream of coherent signed selection and apply.

## References

- [pre-handoff Worker contract](../charness-artifacts/spec/2026-08-11-pre-handoff-worker-closeout.md)
- [B1 consumer closeout](../charness-artifacts/impl/2026-08-11-b1-additive-response-generation.md)
- [superseded B1 handoff request](requests/2026-08-11-to-gateway-final-b1-protocol-handoff.md)
- [Gateway schedule and Protocol delta](../../ceal/docs/requests/2026-08-11-from-gateway-b1-schedule-and-0-72-18-delta.md)
- [release and enrollment procedure](release-and-enrollment.md)
