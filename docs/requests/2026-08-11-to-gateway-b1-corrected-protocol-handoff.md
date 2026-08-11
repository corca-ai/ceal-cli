# To the Gateway lane: correct the B1 Protocol boundaries before handoff

## What is blocked

`ceal-cli` B1 implementation and `ceal-v0.76.2` release are blocked on a
replacement for the local unsigned Protocol `0.72.14` packet. The packet is
internally identity-consistent, but two of its declared safety boundaries are
weaker in executable code than in its handoff prose.

## Reproduced boundary defects

### Undeclared authority-shaped response keys are stripped

`retainDeclaredResponseKeys` says an undeclared key naming identity, decision,
grant, policy, scope, or credential is refused. Its suffix matcher does not
cover authority nouns followed by revision/version metadata. The built
`0.72.14` decoder accepted and stripped these keys instead of refusing them:

- `grant_revision`
- `policy_version`
- `scope_revision`
- `credential_version`

Owner site:
`packages/ceal-protocol/src/gateway-validation-primitives.ts` at Gateway commit
`22e151053747ae1db8d5ea3ebe969a7c7756521a`.

### Undeclared capability arguments admit locator and authority keys

The undeclared-capability fallback applies `safeJson` to arguments, while the
generic result boundary applies the stronger `safeResultJson`. The built
decoder accepted all of these arguments:

- `{ "locator": "C0123456789" }`
- `{ "provider_locator": "/private/path" }`
- `{ "permissions": ["admin"] }`
- `{ "grant_revision": 99 }`
- `{ "policy_version": 99 }`

Owner sites:
`packages/ceal-protocol/src/leased-consumer-control.ts` fallback and safe-JSON
predicates at the same Gateway commit.

## What unblocks B1 development

Issue a replacement local packet whose exact Protocol commit/tree:

- refuses the reproduced undeclared authority/revision/version response keys,
  or narrows the normative authority claim with an explicit reason;
- makes the undeclared argument boundary locator/permission/authority-free, or
  documents and tests a deliberately different argument contract;
- adds direct negative cases for both defects;
- retains safe undeclared capability arguments/results and the additive
  non-authority key-removal behavior.

The packet must include the same provenance and conformance bindings as the
current local handoff. `ceal-cli` will bind source/test re-vendoring to the exact
commit/tree named by that packet and use the tarball for packed-consumer proof.

## What unblocks release

After the remaining Protocol subtree work is final, publish one signed Gateway
handoff through the canonical tag workflow. The worker consumer will bootstrap
the public assets, verify the tag/certificate/archive/provenance identities,
converge the frozen tree/lock/pin, and only then run its release path.

## Who owes the answer

The Gateway Protocol owner in `corca-ai/ceal`. The ceal-cli owner will not edit
the sibling Protocol source or vendor the known-bad packet.

## Non-claims

- This request does not claim the current local packet is signed, released, or
  selected.
- It does not authorize Gateway push, tag, publication, selection, apply, or a
  provider call.
- It does not require B2/B3, C1, or a general safe-JSON refactor to complete
  before the corrected B1 development packet; only the two reproduced boundary
  contracts block this consumer.
