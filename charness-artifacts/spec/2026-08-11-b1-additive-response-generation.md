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

Gateway commit `22e151053747ae1db8d5ea3ebe969a7c7756521a` proposed the repair in
Protocol `0.72.14`. Its local packet is development evidence only, and release
critique reproduced two boundary defects in it: authority nouns followed by
revision/version metadata are stripped rather than refused, and undeclared
capability arguments admit locator/permission/authority-shaped keys. Do not
vendor this packet. A corrected replacement is required before implementation.

## Capability Contract

A released generic client declares one decode generation. The Gateway may add
a non-authority response key at any eligible depth without requiring another
worker release; the canonical decoder removes keys it did not declare before
returning a value. Unknown authority-shaped keys and closed enum members remain
fatal. A delegated control session relays an undeclared safe capability through
the generic argument/result boundary instead of dying on a fixed capability
table.

## Corrected Development Input Slice

- Consume the corrected tarball/provenance as a Gateway-issued artifact;
  never edit frozen Protocol source by hand.
- Use the tarball for packed-artifact proof. Re-vendor source/test/conformance
  only from the exact Gateway commit whose Protocol tree equals the packet's
  declared `protocol_tree`, then update dependencies and
  `protocol-vendor-pin.json` together.
- Declare the proof/shipment divergence with an owner and tracked request. This
  is quarantine: only `npm run check:protocol-dev` may be claimed while the
  shipped handoff lock still names `0.72.13`.
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
  permissions, and authority fields remain refused.
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
