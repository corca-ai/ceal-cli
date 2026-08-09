# To the Gateway lane: a signed protocol handoff for 0.72.13

## What is blocked

The worker release that carries the **v5** leased-consumer contract. Their C11a
batch needs it, and a plain release of `main` does not serve it: the installed
`ceal-v0.75.0` ships protocol 0.72.12, and the v5 gate in
`packages/ceal-worker-cli/src/leased-consumer-control-session.ts:603` requires
`decodeCealLeasedConsumerCapabilityNotification` to be a function on the
protocol's public surface.

## What is true today, and how to re-check each line

- **The owner has the symbol, in work it has not pushed.** The local checkout's
  `HEAD` is far ahead of its own `origin/main` and zero behind —
  `git -C ../ceal rev-list --count origin/main..HEAD` and its reverse — and
  0.72.13 lives only in that unpushed range:
  `git -C ../ceal show origin/main:packages/ceal-protocol/package.json` still
  says 0.72.12 while `git -C ../ceal show HEAD:...` says 0.72.13. So a tag cut
  today would tag work no clone or CI runner can see. Build the local copy and
  read its public index:
  `npm --prefix ../ceal/packages/ceal-protocol run build` then
  `node -p 'Object.keys(await import("../ceal/packages/ceal-protocol/dist/index.js")).length'`
  — 140 exports, among them
  `decodeCealLeasedConsumerCapabilityNotification`, declared in
  `leased-consumer-notification.ts` and re-exported from the package index. The
  owner's version is 0.72.13.
- **The vendored copy does not.** `rg -n decodeCealLeasedConsumerCapabilityNotification
  packages/ceal-protocol/src/` finds nothing; the same search against the owner's
  `src/` finds the declaration, which is the positive control for that absence.
- **There is no signed handoff for it.**
  `git -C ../ceal ls-remote --tags origin 'gateway-protocol-handoff-*'` and
  `git -C ../ceal tag --list 'gateway-protocol-handoff-*' --sort=-v:refname` both
  top out at `gateway-protocol-handoff-v0.72.12`, which is what
  `gateway-protocol-handoff-lock.json` already binds. The remote answers with
  other tags (`v0.70.3` and its neighbours), so the empty result is a property of
  the tree and not of the query.

## Why this repository cannot resolve it

Re-vendoring on its own makes things worse, not better. Moving
`packages/ceal-protocol` to the owner's tree without a matching lock puts
`source.commit` out of agreement with `gateway.commit`, and
`scripts/verify-protocol-vendor-pin.mjs` fails
`proof_shipment_protocol_divergence` — which `docs/gates.md`
`## The Vendored Protocol Copy Has A Recorded Source` records as **fatal**,
blocking release, packing, and the acceptance packet. Today the pin is `agreed`
and those paths are open. A declared divergence is a quarantine rather than a
clearance, so declaring it here buys nothing either.

## This is an order, not a deadlock

The Gateway lane's C11a batch is recorded as waiting on a worker release, and
that is true of its *final* step. It is worth saying plainly that nothing in the
producing workflow waits on this lane:
`.github/workflows/gateway-protocol-handoff-release.yml` in `corca-ai/ceal`
triggers only on a `gateway-protocol-handoff-v*.*.*` tag push, and
`rg -n 'ceal-cli|vendor/|worker' <that file>` finds nothing while
`rg -c 'ceal-protocol' <that file>` finds two — the positive control for that
absence. The handoff can be cut without any worker artifact.

The order is therefore one-directional: handoff tag, then a v5-capable worker
release, then the Gateway's consumption of it. This lane cannot move first.

## What unblocks it

A `gateway-protocol-handoff-v0.72.13` release on the Gateway
protocol-handoff origin, cut from pushed work, with the archive, the protocol tarball digest, and the
Sigstore provenance the existing lock records for 0.72.12. This repository then
re-vendors the copy and re-pins `protocol-vendor-pin.json` and
`gateway-protocol-handoff-lock.json` in one commit, per `AGENTS.md`
`## Ownership`.

## Who owes the answer

The Gateway lane, `corca-ai/ceal`. Their
`charness-artifacts/critique/2026-08-08-c11a-v5-handoff-release-readiness-critique.md`
is where the readiness of that release was last assessed; this request does not
restate its conclusions, only that the tag it concerns does not exist yet.

## Non-claims

- Nothing here was fetched from the handoff origin. The tag claim is from
  `ls-remote` against `corca-ai/ceal`, which says what refs exist and nothing
  about what any release asset contains.
- This request does not assert that 0.72.13 is otherwise ready to ship, or that
  re-vendoring it would leave the worker's v4 path unaffected. `docs/debt.md`
  carries the v4 `decodeProjectionRequester` reasoning that a re-vendor retires.
