# Protocol Quarantine

The frozen `packages/ceal-protocol` copy is a reviewed development baseline,
not a shippable worker release input. The current `protocol-vendor-pin.json`
records a divergence between that copy and the Gateway-signed handoff lock.

## Disposition

The Gateway Protocol owner in `corca-ai/ceal` must publish one final signed
Gateway Protocol handoff after its scheduled C1 work. Its archive and
provenance must bind the final Gateway commit and exact Protocol tree.

When that artifact exists, this repository must bootstrap and verify it, rerun
the consumer proof, and replace the vendored tree, dependency, pin, lock, and
generated contracts in one coherent commit. Until then, development-only proof
may continue, but release, packing, and installed-worker acceptance remain
refused.

## Non-claims

- This record does not authorize a Gateway push, tag, publication, selection,
  apply, provider call, or worker release.
- Local Protocol and packed-consumer tests do not substitute for the required
  signed handoff.
