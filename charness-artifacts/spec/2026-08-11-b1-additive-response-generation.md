# Implementation Contract: B1 Additive Response Generation

Date: 2026-08-11
Target release: `ceal-v0.76.2` (patch)

## Problem

The generic Gateway HTTP client still negotiates six response fields one by
one and consumes a strict Protocol decoder. A safe non-authority response key
therefore remains a coordinated worker release. The delegated control decoder
also rejects an undeclared capability even when its arguments and result obey
the provider-neutral relay boundary, ending the session on ordinary version
skew.

The unsigned local packet declares Gateway Protocol `0.72.17` at commit
`cd3f5f4b8fe1757ca97c12512f9f5066db989840` corrects the boundary defects
reproduced in `0.72.14` and the named-authority-reference escape reproduced in
`0.72.16`. The sibling checkout contains that commit and exact Protocol tree.
This is corrected B1 development input and includes the
complete converted-response-site matrix, but it is unsigned; the last signed
handoff remains `0.72.13`.

## Capability Contract

A released generic client declares one decode generation. The Gateway may add
a non-authority response key at any eligible depth without requiring another
worker release; the canonical decoder removes keys it did not declare before
returning a value. Unknown authority-shaped keys and closed enum members remain
fatal. A delegated control session relays an undeclared safe capability through
the generic argument/result boundary instead of dying on a fixed capability
table.

## Quarantined Development Input Slice

- Consume the corrected tarball/provenance as a Gateway-issued artifact;
  never edit frozen Protocol source by hand.
- Evaluated packet identity: Protocol tree
  `857545f9b5fc3eb76f84679f76080ca081902103`, tarball SHA-256
  `f56201e86124099b245a2073b78e0c7114fd01200cb09e47ccc1c75e2b380b70`.
- Use the tarball for packed-artifact proof. Re-vendor source/test/conformance
  only from the exact Gateway commit whose Protocol tree equals the packet's
  declared `protocol_tree`, then update dependencies and
  `protocol-vendor-pin.json` together.
- Declare the proof/shipment divergence with an owner and tracked request. Only
  development-scoped evidence may be claimed while the shipped handoff lock
  still names `0.72.13`; `npm run check:protocol-dev` is the aggregate
  development gate and the focused packed verifier is local integration proof.
- Call `0.72.17` corrected B1 development proof only after the installed
  consumer refuses named authority refs and the owner suite exercises the
  complete response-site matrix. Do not call it signed, shipped, released,
  installed-worker, or live proof.
- Delete `temp.md` after the local packet is consumed; the durable request and
  this contract replace the handshake note.

## Client Slice

- Import the Protocol-owned `CEAL_GATEWAY_DECODE_GENERATION_HEADER`; do not
  retype the header name in a second production home.
- The generic Gateway HTTP transport sends the exact value `additive-v1` on
  every semantic operation.
- Enrollment, device adoption, and personal-session transports do not send the
  header because their authority protocols are separate.
- Send the generation alongside the eligible legacy accept headers during this
  transition release so a new worker retains response detail against an older
  Gateway. Derive legacy literals from the Protocol registry where possible and
  keep existing public constants as deprecated compatibility exports.
- Do not touch the separate non-additive announcement-policy negotiation.

## Acceptance Checks

- A valid generic response carrying a benign unknown key at every converted
  non-authority response site decodes and returns no undeclared key.
- A response carrying an unknown authority-shaped key is refused.
- A response carrying a new member of a closed enum is refused.
- An undeclared safe delegated capability request/result crosses the canonical
  Protocol decoder; provider-shaped handles, credentials, locators,
  permissions, authority fields, and named authority refs remain refused while
  ordinary opaque `*_ref` handles stay relayable.
- One real worker control session processes an undeclared safe capability frame
  and a following known frame, proving version skew does not end the loop.
- Header capture proves the generic transport sends exactly the generation
  declaration and all three lifecycle clients omit it.
- Packed-consumer proof exercises header emission, key removal/refusal, and the
  undeclared relay against installed tarballs with
  `proof_level=local_integration`; development pin proof remains explicitly
  non-release.

## Release Convergence

Release is blocked until the Gateway publishes a signed final handoff whose
tag, commit, Protocol tree, archive, provenance, conformance, and certificate
identity pass `npm run bootstrap:gateway-handoff`. Consume that archive and
replace the development divergence with one coherent frozen-tree/lock/pin
commit. The ordinary full gate, release package paths, and acceptance packet
must then pass without `--development`.

After convergence, bump all three worker manifests to `0.76.2` and regenerate
`package-lock.json` with `node_modules` absent in a dedicated version commit.
The patch level is justified because this release ships compatibility and
behavior repairs without removing or changing a public invocation.

## Publication Boundary

Follow `docs/release-and-enrollment.md`: push main, read its `check.yml` result,
run the tag workflow dry-run, then tag and watch publication. Public checksum
and signature readback, `ceal update`, installed version readback, the
read-only surface probe, and handoff reconciliation are required before calling
the release verified.

Push, tag, workflow dispatch, publish, Gateway apply, and live provider actions
remain separate external writes. This contract does not authorize a Gateway
selection/apply or provider/Slack call.

## Deliberately Not Doing

- B2 Gateway-served next steps and the remaining B3 guide fallback wait for the
  Gateway lane named in the roadmap.
- A new enum member is not made additive; it remains a breaking contract
  change.
- The generic plugin publisher is not used for this worker lane. The repo-owned
  tag workflow and `docs/release-and-enrollment.md` remain the publish owner.
