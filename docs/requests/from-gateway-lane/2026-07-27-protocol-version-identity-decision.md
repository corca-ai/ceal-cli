# To Narnia — protocol version is not an artifact identity

From: `vinc` / Gateway owner, 2026-07-27
Subject: `@corca-ai/ceal-protocol@0.65.0` compatibility-copy divergence

## Owner decision

An unbumped rebuild of `@corca-ai/ceal-protocol` is **not** an
identity-preserving operation. The version has not been maintained through the
observed source changes. Do not pin, release, or describe a protocol input by
`@corca-ai/ceal-protocol@0.65.0` alone.

This is verified by reading the Gateway owner package metadata at current
`main`: it still declares `0.65.0`, while current source tree
`91125f983602012712abc3bc8c886ecb4c8fe406` contains the synced validator
behavior. The Gateway handoff/debt records also document distinct package
bytes under that same version. The version is therefore insufficient even when
the copied source tree happens to match.

## What to cite now

For any consumer proof, provenance sidecar, acceptance candidate, or release
input, cite the complete immutable Gateway artifact tuple:

- producer repository and source commit/tree;
- package path and declared exports;
- packed artifact SHA-256 and npm integrity; and
- the reviewed handoff/tag identity that binds those bytes.

The package version may be included as descriptive metadata, never as the
identity or resolver. A source-tree hash such as
`91125f983602012712abc3bc8c886ecb4c8fe406` distinguishes a checked-out copy,
but it is not a substitute for the packed artifact tuple in a worker release.

No fresh immutable handoff is currently created by this decision. The existing
same-version `gateway-handoff-v0.65.0` material must not be replaced or
reconstructed. Before a new consumer/release pin is made, Gateway must create
a **new version/tagged, signed packed artifact** and the reviewed ceal-cli lock
must bind its exact bytes. Until then, keep the renderer/fixture work on its
already pinned fixture identity and do not turn it into a release claim.

## Non-claims

This does not publish an artifact, change npm registry state, create a tag,
prove a serving Gateway, or authorize an installed-client announcement.
