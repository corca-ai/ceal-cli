# Client Boundary Quality Sweep Closeout

## Implemented

- Total deadlines bound caller wait across lifecycle fetch and body reads,
  including abort-ignoring injected implementations.
- One status/body decoder preserves typed failures and rejects a success body on
  non-success HTTP status.
- One complete JSON media-type grammar serves exact lifecycle JSON and the
  generic transport's structured-suffix policy.
- Device-adoption poll requests use the canonical Protocol decoder before fetch.
- Quality/implementation adapters resolve executable probe and tool surfaces.

## Capability Delivered

Owned client HTTP boundaries now fail closed on malformed requests, media types,
status/body disagreement, and non-cooperative timeouts without widening public
package exports.

## Contract Source

`charness-artifacts/spec/2026-08-11-client-boundary-quality-sweep.md`

## Verification

- Focused client build/tests pass, including direct media-type truth-table,
  canonical poll-wire, non-success typed-failure, and total-deadline regressions.
- `npm run check` passed the full repository gate.
- `npm run probe -- ceal commands` reached the declared read-only surface.
- Verification level: local source/runtime only; no external provider seam ran.

## Lint Gate

ran-pass `bash .githooks/pre-push`

## Truth Surface Sync

The current spec, quality record, this closeout, and `docs/handoff.md` record the
local unreleased slice. Release inputs, protocol pins, and README claims did not
change because no shipped capability or signed identity changed.

## Boundary Ownership

`owned-correctly` — Protocol retains DTO authority; ceal-client owns transport
orchestration and media framing; adapter declarations stay repo-local. The
frozen Protocol package and sibling Gateway are not edited by this slice.

## Critique

Full parent-delegated fresh-eye review found the concrete defects and then a
vacuous media-type proof plus incomplete parameter grammar. The repaired runtime
tree has no blocker; the second-round proof repairs are accepted-unreviewed under
the mandated two-round cap. A distinct closeout-claims reviewer returned PASS
for local source/runtime completion. All reviewer fingerprint checks were clean.

## Contract Updates

The contract fixed exact status/body, total-deadline, media-type, canonical poll,
and executable probe decisions; no criterion was reclassified.

## Residual Risks

- No signed package, installed worker, live Gateway/provider, or macOS install is
  claimed.
- Sibling `../ceal` is independently dirty, so this closeout claims only that
  the ceal-cli diff contains no sibling or frozen-Protocol change.
- B1 and any CLI release remain separately approved work.

## Next Slice

Re-confirm and design the structural raw-session-writer debt before changing it;
otherwise wait for the signed B1 Protocol handoff. Ask the operator before any
push, tag, publish, or release.
