# Implementation Contract: Pre-Handoff Worker Closeout

## Capability

Finish every `ceal-cli`-owned task that does not require the Gateway's final
signed Protocol handoff, without editing the frozen Protocol copy or crossing a
publication boundary.

## Fixed Decisions

- The reviewed local `0.72.17` packet remains a quarantined development
  baseline, not the final contract. The Gateway schedules one final signed cut
  after C1 and further Protocol-owned disclosure work.
- Do not consume an intermediate `0.72.18` packet merely to restamp the current
  quarantine. Re-review and re-pin the exact final signed artifact once.
- `ceal capabilities`, target discovery, receipts, and acceptance are already
  observation-only at HEAD. Credential rotation remains owned by explicit
  `ceal session refresh`; do not re-implement that completed repair.
- No push, tag, release, publish, Gateway apply, or sibling-repository edit is
  authorized by this slice.

## Acceptance Checks

1. Establish the npm Protocol artifact embedded in signed `ceal 0.76.1` from
   its installed release manifest, checksum inventory, release tag, and build
   input chain; keep it distinct from the displayed wire protocol version.
2. Make current continuation surfaces say that `0.72.17` was superseded in
   content and that final re-pin/release waits for the post-C1 signed handoff.
3. Re-check every remaining locally actionable finding before changing code;
   do not duplicate repairs that HEAD already contains.
4. Preserve a zero diff under `packages/ceal-protocol`.
5. Pass focused contract checks, `check:protocol-dev`, and `check:unit`. Keep
   contract behavior independent of the live checkout's readiness with a real
   converged scratch repository, while proving each ship-facing entry point
   refuses a divergent fixture before later work. The full release gate stays
   red until the signed handoff converges.

## Deferred Decisions

- The identity and contents of the final Gateway Protocol handoff.
- B2's served ordered guidance and caller-identity schema, and therefore final
  B3 installed-guide dogfood.
- Any release version, tag, publication, installation, or Gateway selection.
