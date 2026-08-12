# Ceal CLI Roadmap Handoff

## Workflow Trigger

Continue only the worker lane in the sibling
[release execution plan](../../ceal/docs/next-release-execution-plan.md#corca-aiceal-cli--worker-lane).
The older roadmap ledger is stale against the 2026-08-12 reframe. Do not redo
the Worker shutdown, conditional PATH, read-only discovery, or invariant guide-method
repairs. Push, tag, release, publication, Gateway selection, and apply remain
separately approved boundaries.

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
  carrier and names no fixed capability sequence. Installed-guide dogfood is
  still unproved, but the current cross-repo plan does not schedule it as a
  separate worker slice.
- `ceal capabilities`, target selection, receipt readback, and acceptance use
  observation mode and never rotate a stored session. Authentication failure
  points to the explicit `ceal session refresh` remote-write route. This is
  already enforced by the renewal-mode and CLI tests; the stale sibling-goal
  claim must not cause a duplicate repair here.
- The Worker-side half of `ceal-cli#13` is locally repaired. Target-selection
  results now identify whether a request included a match, continued a cursor,
  or requested an unfiltered page without copying a selector into that local
  projection; a completed zero-count match response says it does not prove an
  empty authorized catalog and points at a bounded unfiltered query. Help and
  the checkout/next embedded guide no longer presents URLs, call inputs, or
  opaque resource refs as universal target selectors. The installed `0.76.1`
  guide still carries the reported wording until a successor is released and
  registered. Capability-specific selector semantics and query provenance
  remain Gateway/Protocol work and are not invented in this repository.
- The current source also contains the client deadline/status/media-type and
  adoption-request boundary repairs, generic HTTP timeout classification,
  narrowed command session capabilities, explicit guide-register provenance,
  bounded subprocess and Unix-socket settlement, monotonic local-store waits,
  managed-install integrity, dependency-closure package hooks, bounded native
  and installer process probes, reduced guide-contract spawning, and the
  directory skill carrier. Ship-facing asset merge now re-asserts the Protocol
  quarantine before reading composed inputs. These are local source/test
  results, not installed worker claims.
- The next binary embeds the complete deterministic guide directory. Binary
  update is separate from explicit per-host `ceal guide register codex|claude`:
  guide materialization failure cannot reverse update success. A permanent
  self-contained compatibility asset keeps the immutable `0.76.1` installer
  able to cross directly without reinstall; that old binary cannot emit the new
  guide advisory, so read it from the updated command afterwards.
- The frozen Protocol copy and client/worker dependencies retain reviewed local
  `0.72.17` as a quarantined B1 development baseline. The current cross-repo
  execution plan starts with the Gateway's `0.72.19` bump, allows S1-S5 packet
  changes before one signed cut, and asks this repo for one consumer review at
  that cut. The signed lock, release workflow, and installed worker remain on
  `0.72.13`, so ship-facing builders and acceptance stay correctly refused.
- The release workflows now keep checkout/source proof outside privileged jobs
  and require the existing `ceal-cli-release` approval identity before worker
  publish or rollback activation. Distinct `CEAL_ENV_*` credential names prevent
  fallback to legacy repository-level values. GitHub configuration is still a
  release blocker until that Environment has protection rules and owns those
  values; a tag alone is not approval.
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

1. Wait for the one signed Gateway Protocol handoff cut after S0 and whichever
   of S1-S5 land before that cut. Do not request or re-pin an intermediate packet
   merely to restamp the quarantine.
2. Review that exact artifact against the B1 response-depth, authority-key,
   closed-enum, notification-binding, request-envelope, and consecutive-frame
   proofs, plus the `ceal-cli#13` capability-specific target-selector and empty
   match provenance contract; converge frozen tree, dependency, lock, pin,
   generated contracts, and workflow input in one commit.
3. Run the ordinary release gates and tag-resolved `0.76.1` installer crossing plus explicit
   guide-register proof. Ask before choosing a version, pushing, tagging,
   publishing, or installing the new release. Before any tag, close the external
   `ceal-cli-release` Environment protection/secret move named in operator acceptance.
4. Finish the worker-side D2 release named by the cross-repo plan. Installed-guide
   dogfood remains a proof opportunity after serving, not a separately scheduled
   worker slice. Do not invent future fields in this repo.

## Non-Claims

- No final signed Protocol handoff has been received or reviewed.
- No current source change is signed, released, installed, selected by a
  Gateway, or proved against a live provider.
- No Gateway capability-specific selector declaration or wire-level distinction
  between a selector miss and an empty authorized catalog has been received.
- D2 and bounded D3 are locally complete but remain unreleased.
- Response-latency and concurrent notification/channel-loss proofs remain
  downstream of coherent signed selection and apply.

## References

- [update and embedded-guide independence closeout](../charness-artifacts/impl/2026-08-12-update-guide-independence.md)
- [target-selection ambiguity closeout](../charness-artifacts/impl/2026-08-12-target-selection-ambiguity.md)
- [pre-handoff Worker contract](../charness-artifacts/spec/2026-08-11-pre-handoff-worker-closeout.md)
- [B1 consumer closeout](../charness-artifacts/impl/2026-08-11-b1-additive-response-generation.md)
- [superseded B1 handoff request](requests/2026-08-11-to-gateway-final-b1-protocol-handoff.md)
- [Gateway schedule and Protocol delta](../../ceal/docs/requests/2026-08-11-from-gateway-b1-schedule-and-0-72-18-delta.md)
- [current cross-repo release execution plan](../../ceal/docs/next-release-execution-plan.md)
- [release and enrollment procedure](release-and-enrollment.md)
