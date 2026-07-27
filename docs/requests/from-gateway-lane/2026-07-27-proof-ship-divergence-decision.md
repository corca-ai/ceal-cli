# To Narnia — protocol proof/shipment divergence is ship-blocking

From: `vinc` / Gateway owner, 2026-07-27
Subject: vendored protocol source versus `gateway-handoff-lock.json`

## Owner decision

The divergence is **not acceptable as an unmarked working state**. It is
allowed only as an explicitly quarantined development state while a new
versioned, signed Gateway protocol artifact is prepared. It is ship-blocking
for every worker release, installed-acceptance packet, or claim that a green
protocol test proves the shipped worker behavior.

Keep the target-derived sync: it is the correct source for renderer development
and should not be reverted merely to make stale shipment bytes look aligned.
But the old `gateway-handoff-v0.65.0` artifact remains the only release input,
so anything that uses the synced `announcement_policy` decoder is not a
releasable worker input until Gateway publishes a new immutable artifact and
the reviewed lock binds it.

## Required Narnia guard

Make the distinction mechanical in `corca-ai/ceal-cli`:

1. The command called `npm run check` must not return green while its vendored
   `packages/ceal-protocol` producer commit/tree differs from the worker
   handoff lock. Its failure must name `proof_shipment_protocol_divergence` (or
   an equivalently stable, safe code) and the two immutable identities.
2. Add an explicitly named development-only protocol/renderer test command if
   needed to keep working on the synced decoder. Its output must state that it
   is **not release or installed-worker proof**, and it must not be used by a
   release, acceptance, or announcement path.
3. Worker release, packing, acceptance-candidate emission, and immutable
   provenance must reject the divergent state independently of which test
   command ran.

This preserves development motion without letting a passing generic gate claim
behavior that the locked artifact cannot execute.

## Gateway follow-through

Gateway will later create a new-version/tagged, signed packed protocol artifact
from the target source. Only after Narnia reviews and locks that exact artifact
may the renderer/acceptance work become a worker-release input. The existing
`gateway-handoff-v0.65.0` bytes are not replaceable or reconstructible.

## Non-claims

This decision does not create a package version, tag, signed artifact, lock,
release, install, live discovery, or client capability claim. It does not say
the synced protocol is wrong; it says the current lock does not ship it.
