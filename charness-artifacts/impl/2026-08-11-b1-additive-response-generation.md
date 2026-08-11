# B1 Additive Response Generation Closeout

## Implemented

- The generic Gateway HTTP transport sends the Protocol-owned additive decode
  generation on every semantic operation while retaining the eligible legacy
  accept headers for the rolling transition.
- Enrollment, device-adoption, and personal-session transports remain outside
  that generic negotiation and prove that they omit the generation header.
- Client response tests prove benign unknown envelope and handshake fields are
  removed while authority-shaped fields and closed-enum drift remain fatal.
- A real worker control session relays one undeclared safe capability and then
  processes a declared capability without ending the session.
- The packed-consumer verifier now installs packed client, worker, and Protocol
  artifacts and exercises the B1 header, decoder, and control-session behavior.
  Its worker-source record distinguishes a committed baseline from working-tree
  package bytes and binds the exercised tarballs by digest.

## Capability State

The ceal-cli consumer side and corrected B1 development proof are complete, but
B1 is not releasable. Gateway Protocol `0.72.17` refuses the named authority
references found in `0.72.16`, retains ordinary opaque handles, and carries the
complete converted-response-site matrix. The local packet is unsigned, so the
installed-tarball consumer result remains `local_integration`, not shipment.

## Contract Source

`charness-artifacts/spec/2026-08-11-b1-additive-response-generation.md` owns the
implementation and convergence contract. The remaining signed handoff is tracked in
`docs/requests/2026-08-11-to-gateway-final-b1-protocol-handoff.md`.

## Verification

- `npm run check:protocol-dev` passed the corrected vendor identity and the
  complete client package test suite.
- The focused worker control-session test passed, including the undeclared-safe
  then declared-frame sequence.
- The packed-consumer contract test passed against the corrected Protocol and
  retained no default workspace.
- Running `scripts/verify-gateway-protocol-consumer.mjs` against the actual local
  `0.72.17` tarball returned `ok:true`, `proof_level:local_integration`, removed
  unknown keys, refused authority keys, closed enums, and all four named
  authority refs, then relayed an undeclared-safe frame followed by a known one.
- The vendored owner tests passed locally for the complete response-site matrix
  and its source-site coverage guard.
- The ordinary vendor-pin verifier exited with
  `proof_shipment_protocol_divergence`, which is the required release
  quarantine while the signed handoff still names `0.72.13`.
- Verification level: local checkout and packed-artifact development proof.
  There is no signed final-handoff, released-binary, installed-worker, or live
  Gateway/provider proof.

## Lint Gate

ran-fail-deferred `bash .githooks/pre-push`
`docs/requests/2026-08-11-to-gateway-final-b1-protocol-handoff.md`. Its lint,
unused-export, reachability, store-lock, duplicate-literal, build, and package
coverage phases passed; the contract tier refuses release/acceptance positives
under the declared proof/shipment divergence. The development gate passes.

## Truth Surface Sync

The implementation contract, Gateway request, vendor pin, package manifests,
lockfile, and `docs/handoff.md` identify `0.72.17` as corrected local B1 proof
and the signed `0.72.13` lock as the remaining shipment blocker.

## Boundary Ownership

`owned-correctly` — Producer: the Gateway Protocol owner produces authority-key
semantics, response projection, the owner matrix, and the signed handoff.
Consumer: ceal-cli consumes the exact frozen tree and owns HTTP negotiation,
worker relay, packed integration proof, and shipment refusal. The frozen copy
was synchronized mechanically from the sibling commit and tree declared by the
unsigned packet, not patched locally; only a signed handoff can authenticate
that producer identity for shipment.

## Critique

Critique: full parent-delegated runtime/consumer and artifact/release-proof
reviews found no code blocker and confirmed the signed divergence. Both found
a stale Gateway request that still asked for the received correction; that
truth surface and the aggregate-development-gate wording were repaired. The
review boundary fingerprint was clean after each result; findings were received.
Reviewer tier was high-leverage by review class, with reused host-defaulted
reviewers and no provider-applied override metadata.
A distinct claims reviewer then qualified unsigned producer identity, corrected
the split dependency/shipment state, and repaired the completion vocabulary;
its fingerprint was also clean. Those round-two repairs close under the
two-round cap rather than claiming a third unrun review.

## Residual Risks

- A final signed handoff must converge the frozen tree, lock, pin, dependency,
  and packed proof before any worker version bump or release approval.
- The owner matrix binds site count and behavior but could be strengthened by a
  unique site-identity guard; that is Gateway-owned and not a consumer blocker.

## Next Slice

Wait for the exact signed `0.72.17` handoff, bootstrap and converge the shipment
lock/pin, run the ordinary gates, then ask the operator before releasing
`ceal-v0.76.2`.

## Completion Categories

- durable: client negotiation, lifecycle exclusions, worker sequence proof,
  packed-consumer behavior proof, and synchronized quarantine records.
- external-writes: none.
- test-only: the vendored owner matrix, focused fixtures, and disposable packed
  consumer workspace do not ship as worker runtime behavior.
- verification: development pin, owner matrix, client and focused worker tests,
  actual packed-artifact integration, static phases, and fresh-eye critique.
- unverified-future: signed final Gateway Protocol handoff, release, installed
  worker, live Gateway, and provider readback.
