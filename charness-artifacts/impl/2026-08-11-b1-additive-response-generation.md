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

The ceal-cli consumer side is implemented, but B1 is not complete or
releasable. Gateway Protocol `0.72.16` admits named authority references such as
`grant_ref` in undeclared capability arguments. The installed-consumer verifier
therefore rejects that packet with `b1_authority_boundary_failed` instead of
recording a false local-integration success.

## Contract Source

`charness-artifacts/spec/2026-08-11-b1-additive-response-generation.md` owns the
implementation and convergence contract. The Gateway-owned correction and
final signed handoff are tracked in
`docs/requests/2026-08-11-to-gateway-final-b1-protocol-handoff.md`.

## Verification

- `npm run check:protocol-dev` passed the quarantined vendor identity and the
  complete client package test suite.
- The focused worker control-session test passed, including the undeclared-safe
  then declared-frame sequence.
- The packed-consumer contract test passed by proving the known-bad development
  packet is refused at the authority boundary.
- Running `scripts/verify-gateway-protocol-consumer.mjs` against the actual local
  `0.72.16` packet exited with `b1_authority_boundary_failed`.
- The ordinary vendor-pin verifier exited with
  `proof_shipment_protocol_divergence`, which is the required release
  quarantine while the signed handoff still names `0.72.13`.
- Verification level: local checkout and packed-artifact development proof.
  There is no signed final-handoff, released-binary, installed-worker, or live
  Gateway/provider proof.

## Lint Gate

ran-pass `npm run lint`, `npm run lint:unused`,
`npm run lint:reachability`, `npm run lint:store-lock`, and
`npm run lint:duplicate-literal`. The pre-push and full release gates are not
claimed because their ordinary vendor-pin path correctly refuses the declared
proof/shipment divergence.

## Truth Surface Sync

The implementation contract, Gateway request, vendor pin, and
`docs/handoff.md` all identify `0.72.16` as a quarantined evaluation packet,
not corrected B1 acceptance proof. The transient `temp.md` note was removed
after its durable facts moved to those owners.

## Boundary Ownership

`owned-correctly` — ceal-client owns HTTP negotiation, the worker owns its
control-session composition, and the packed verifier owns installed consumer
proof. Named-authority classification and the complete converted-response-site
matrix remain Gateway Protocol work; the frozen vendored package was not
locally patched.

## Critique

Parent-delegated fresh-eye review found the named-authority-reference escape in
the canonical v5 decoder, reproduced it through the actual worker-to-UDS path,
and found two proof defects: a retyped client version and misleading dirty-tree
source provenance. The verifier now derives the version, records honest source
state, and fails specifically on the unresolved Protocol boundary. The review
fingerprint remained clean.

## Residual Risks

- Gateway must refuse named authority refs while retaining ordinary opaque
  handles in undeclared safe arguments.
- Gateway owner tests must exercise unknown-field removal at every converted
  response-object site, not only representative envelope locations.
- A final signed handoff must converge the frozen tree, lock, pin, dependency,
  and packed proof before any worker version bump or release approval.

## Next Slice

Consume the corrected Gateway packet, flip the temporary known-bad packed test
back to positive installed proof, and require the complete site matrix. After a
signed final handoff converges shipment, run the ordinary gates and ask the
operator before releasing `ceal-v0.76.2`.

## Completion Categories

- durable: client negotiation, lifecycle exclusions, worker sequence proof,
  packed-consumer behavior proof, and synchronized quarantine records.
- external-writes: none.
- verification: development pin, client and focused worker tests, static gates,
  actual-packet refusal, and fresh-eye critique.
- blocked-external: corrected Gateway Protocol packet and signed final handoff.
- unverified-future: release, installed worker, live Gateway, and provider
  readback.
