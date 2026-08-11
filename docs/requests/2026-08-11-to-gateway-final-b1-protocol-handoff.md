# To the Gateway lane: correct and publish the final B1 Protocol handoff

## What is quarantined

`ceal-cli` evaluated B1 against the local Protocol `0.72.16`
packet issued from Gateway commit
`ce5db611c12546dabb91d33328169493c8c3b2af`, Protocol tree
`379ea7bccb43ed78df1d12afed9f5f52b0f1072d`. It corrected both defects
reproduced in `0.72.14`, but installed-consumer review found one remaining
authority boundary defect: undeclared capability arguments carrying
`grant_ref`, `policy_ref`, `scope_ref`, or `role_ref` cross the canonical v5
decoder and reach the worker's delegated Unix-socket seam. Named authority
references must be refused while ordinary opaque handle references remain
relayable.

The `0.72.16` packet also lacked table-driven proof for every
`retainDeclaredResponseKeys` response-object site. Its owner suite proved
representative envelope, error, and recovery locations but not the
discovery capability/target, call/redaction, readback event/receipt, and
failure-envelope siblings. This is an acceptance-proof requirement, not a
request to loosen any authority object or closed enum.

The last signed handoff remains `gateway-protocol-handoff-v0.72.13`. Therefore
`protocol-vendor-pin.json` declares a proof/shipment divergence and every
release, native pack, and installed-acceptance path remains quarantined.

## Local correction received

The unsigned local packet declares Protocol `0.72.17` from Gateway commit
`cd3f5f4b8fe1757ca97c12512f9f5066db989840`, Protocol tree
`857545f9b5fc3eb76f84679f76080ca081902103`; the sibling checkout contains that
commit and exact subtree. This is the corrected local response to
the decoder and owner-matrix request. The packet itself declares
`proof_level=local_state` and no signature or publication, so this request stays
open only for the canonical signed final handoff.

## What unblocks convergence

Publish one canonical signed Gateway protocol handoff whose archive and
provenance bind the received `0.72.17` commit and exact Protocol tree.
The consumer will bootstrap that public artifact, verify its tag, certificate,
member set, checksums, provenance, and conformance, rerun the installed B1
proof, then replace this divergence with one coherent frozen-tree, lock, pin,
dependency, generated-contract, and workflow-input commit.

## Who owes the answer

The Gateway Protocol owner in `corca-ai/ceal`. The `ceal-cli` owner may develop
against the local packet but cannot clear or publish the divergence.

## Non-claims

- This request does not authorize a Gateway push, tag, publication, selection,
  apply, or provider call.
- Local Protocol tests and packed-consumer integration are development proof
  only; neither substitutes for the requested signed handoff.
- The signed handoff must bind the received `0.72.17` identity exactly; a later
  source change requires a new local consumer review before publication.
