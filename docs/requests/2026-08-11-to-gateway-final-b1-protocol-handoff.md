# To the Gateway lane: publish the final B1 Protocol handoff

## What is quarantined

`ceal-cli` now develops B1 against the corrected local Protocol `0.72.16`
packet issued from Gateway commit
`ce5db611c12546dabb91d33328169493c8c3b2af`, Protocol tree
`379ea7bccb43ed78df1d12afed9f5f52b0f1072d`. The packet corrected both
consumer-reproduced boundary defects and is sufficient for local development
and packed-consumer proof.

The last signed handoff remains `gateway-protocol-handoff-v0.72.13`. Therefore
`protocol-vendor-pin.json` declares a proof/shipment divergence and every
release, native pack, and installed-acceptance path remains quarantined.

## What unblocks convergence

After the remaining Protocol subtree work is final, publish one canonical
signed Gateway protocol handoff whose archive and provenance bind the final
Gateway commit and exact Protocol tree. The consumer will bootstrap that public
artifact, verify its tag, certificate, member set, checksums, provenance, and
conformance, then replace this divergence with one coherent frozen-tree, lock,
pin, dependency, generated-contract, and workflow-input commit.

## Who owes the answer

The Gateway Protocol owner in `corca-ai/ceal`. The `ceal-cli` owner may develop
against the local packet but cannot clear or publish the divergence.

## Non-claims

- This request does not authorize a Gateway push, tag, publication, selection,
  apply, or provider call.
- Local Protocol and packed-consumer tests are development proof only.
- The exact final handoff version and identity are intentionally not predicted
  before the remaining Gateway Protocol subtree work finishes.
