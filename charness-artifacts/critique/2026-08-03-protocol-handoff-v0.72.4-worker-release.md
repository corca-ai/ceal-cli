# Release Critique: Protocol Handoff v0.72.4 Worker Release

## Execution

Two bounded fresh-eye reviews covered release coherence and identity/security.
The requested separate counterweight reviewer could not start because the host
reported an agent-thread limit; no same-agent substitute was used.

## Fresh-Eye Satisfaction

parent-delegated

## Packet Consumed

n/a (no adapter sections)

## Target

Release critique.

## Change

Publish worker `0.72.7`, consuming the signed
`gateway-protocol-handoff-v0.72.4` archive and replacing the carrier's static
UDS path with the Gateway-issued, Protocol-validated session path.

## Capability at Stake

The next Agent cutover can use a worker artifact that is portable across the
Gateway owner's actual safe Unix-socket location without giving Agent IPC a
credential, endpoint, or path-selection capability.

## Findings

- Both reviewers found no Act Before Ship mismatch. The archive digest,
  manifest digest, Protocol tgz digest, producer commit/tree/subtree, lock,
  vendor pin, and frozen source agree. Local `npm run check` and a real
  linux-arm64 lock-bound asset composition passed.
- Bundle Anyway: record the coherent consumption ordering and update the
  release handoff and changelog; both are included before publication.
- Bundle Anyway: CI reuses the reviewed SHA-256 lock rather than re-running
  Cosign. That is the stated trust model, not a source fallback. A manual
  reproducibility comparison can remain optional because the real composer
  consumes the signed Protocol tgz.
- Over-Worry: the post-verification source-tree archive used solely to refresh
  the frozen type/test copy does not cross the worker release-input boundary.
  The release composer receives only the lock-bound signed archive.
- Valid but Defer: Gateway apply, Agent service composition, ingress fencing,
  and live provider proof remain a distinct cutover slice after publication.

## Counterweight Triage

- Act Before Ship: empty.
- Bundle Anyway: documentation of the consumption tuple and release record.
- Over-Worry: do not add a per-CI Cosign or dist-reproducibility pass that
  duplicates the reviewed immutable digest boundary and defeats the cost goal.
- Valid but Defer: optional manual reproducibility proof and all live cutover
  work.

## Deliberately Not Doing

Do not claim that this worker release applies Gateway code, launches
`ceal-agent`, receives Slack ingress, or executes a provider call.

## Next Move

Commit the documentation closeout, push the already verified source once, tag
`ceal-v0.72.7`, watch the single release workflow, then consume its signed
artifact for the Agent canary/cutover slice.
