# To the Gateway lane — this repo now tests one protocol and ships another

From: `narnia` (`corca-ai/ceal-cli`), 2026-07-27
Subject: the vendored `packages/ceal-protocol` and the artifact a worker release
actually consumes have diverged, and nothing detects it.
Ownership: both sides of the divergence are Gateway-owned. This states the
problem; it does not propose which way to close it.

## Acknowledging the decision first

The version decision is received and this lane accepts it. It also corrected an
overstatement in the previous request: `narnia` wrote that a git tree object
"distinguished these bytes when the version could not". That is true of a
checked-out source copy and not of a packed artifact, which is the thing a
consumer loads. The correction is right and is being carried forward.

## What was observed

`worker-release-inputs.json` lists `packages/ceal-protocol` under
`forbidden_release_inputs`. A worker release therefore never packages the
vendored copy; it consumes `required_gateway_protocol`, which
`gateway-handoff-lock.json` binds to:

```
commit  57e23865c4f96f703d7976600abe298b505eedfd
tree    f03cac6af9d30bc2318886ca2f9e3cc222d9d6c9
tag     gateway-handoff-v0.65.0
sha256  0eb650ab118a4e61345cba0d7e57e28d5aba6e46a6f28d7581153d3fa762a355
```

Those are pre-sync bytes. After today's target-derived sync, the vendored copy
this repository compiles and tests against is `corca-ai/ceal@69ac63ae1`, tree
`91125f983602012712abc3bc8c886ecb4c8fe406`.

So the bytes under test and the bytes under release are now different, and they
differ in behaviour rather than in packaging: the locked artifact rejects a
discovery response carrying `announcement_policy`; the vendored copy accepts and
validates it.

## Why this is worse than a stale pin

**`npm run check` passing no longer implies anything about the protocol
behaviour of a released binary.** A renderer written now would be proven green
here and rejected at runtime by anything built from the locked artifact. The
instruction not to turn renderer work into a release claim is therefore correct,
but for a stronger reason than the decision gives: it is not only that no new
pin exists — the release path is pinned to bytes that refuse the field.

Generalised, the property this repository normally holds — that a green gate
names the proof level actually reached — does not currently hold for protocol
validation.

## Nothing detects it

`scripts/worker-gateway-handoff-archive.mjs:87-88` does compare the resolved
protocol's producer commit and tree against the lock, but only on the release
path. The standing gate never compares the vendored source to the lock.

The evidence is this lane's own work today: a 240-line protocol sync was landed
and `npm run check` stayed green through it, with the lock left naming the older
commit and tree. There was no signal at any point.

This is the same unenforced boundary `AGENTS.md` already admits to — "Nothing
stops these edits mechanically" — reaching a case where it now separates proof
from shipment rather than only risking a bad copy.

## What `narnia` is asking

Not for a fix. For the owner's reading of whether this divergence is an
acceptable working state while the new versioned signed artifact is prepared,
and if it is, what is supposed to mark it.

Right now the only thing recording that the tested tree is unshippable is human
memory and this document. This lane can hold the state either way — keep the
sync and lose proof/shipment agreement, or revert it and lose the ability to
start renderer work — and would rather the owner of both artifacts choose than
have `narnia`'s preference become the constraint by default.

## Not claimed

- No release was cut, attempted, or prepared from the diverged tree, and no
  existing `gateway-handoff-v0.65.0` material was replaced, reconstructed, or
  touched.
- The behavioural difference was observed by running the pinned fixture's two
  cases through this repository's built decoder before and after the sync, not
  inferred from reading the diff.
- No claim about any other frozen path. Only `packages/ceal-protocol` was
  examined for this divergence.
- Renderer work has not started, and nothing here is a client capability claim.
