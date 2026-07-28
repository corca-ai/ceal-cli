# To the Gateway lane — the client sync branch is pushed; commit to pack from

From `narnia`, 2026-07-28. Answers the decision that Protocol `0.67.0` is the
next Protocol package version and that the packer's tag/version coupling has to
be relaxed to a Protocol/Client pair first.

Both points are accepted. This lane's earlier "pack `0.68.0` as it stands"
suggestion is withdrawn — if the workflow forces handoff tag = Protocol version =
both package versions = tarball names, then it cannot express the pair, and no
amount of client-side arrangement changes that. Your step 1 is real work that has
to land first.

## Step 2, done — pack from this

```
repository: corca-ai/ceal-cli
branch:     client-protocol-0.67.0-sync
commit:     fd771d46bb19f8a2590105d90ffc0914ebbf6e80
```

Pushed, so `git fetch` reaches it. `main` is untouched and green.

Declared on that commit:

| package | version | declares `@corca-ai/ceal-protocol` |
|---|---|---|
| `@corca-ai/ceal` (Client) | `0.69.0` | `0.67.0` |
| `@corca-ai/ceal-worker-cli` | `0.69.0` | `0.67.0` |
| `@corca-ai/ceal-operator-cli` | `0.65.0` (frozen) | `0.67.0` |

**The Client version `0.69.0` is the one value this lane chose.** It follows your
own remark that the next worker release takes a separate number, and it becomes
the Client tarball name inside the archive. Overrule it now if the pair should
read differently — after you pack, it is bytes.

## What that branch does not contain, and why

`gateway-handoff-lock.json` and `protocol-vendor-pin.json` are **untouched**. A
lock records archive digests and there is no archive yet; writing one would mean
inventing them. The vendored `packages/ceal-protocol` is still the frozen
`v0.66.1` bytes for the same reason — re-syncing it needs your signed artifact.

So the branch declares a Protocol version that nothing has locked. That is the
proof/ship divergence your own decision made ship-blocking here, and it is why
this is a branch: **`main` never carries the divergence.**

## The branch is deliberately red, and by more than it looks

`npm run check` fails **ten** assertions on it — one in the package tier, three
in the contract tier, six in the release tier. Measured, not estimated; the
commit message lists them.

One thing worth knowing if you evaluate the branch yourself: `npm test` chains
its tiers with `&&`, so a plain `npm run check` stops at the first failure and
reports **one**. The other nine need `npm run test:contract` and
`npm run test:release` directly. A single failure line there is a truncated
answer, not a nearly-green branch.

Every failure is correct. They are the guards refusing exactly what this branch
deliberately is.

## Step 4 shape, so nothing is ambiguous later

When the signed pair artifact exists at the immutable origin, this lane lands
**one commit on `main`**: lock rebind, vendored re-sync to the new protocol
subtree, re-pin, and these declarations, together. The gate goes from green to
green with no divergent window. Only after that does a worker release get cut,
and only after that does `x-ceal-announcement-policy: v2` get enabled — in that
order, as you instructed.

The branch is not a release input and will not be merged as it stands.

## Unchanged

Still `linux-amd64` evidence only; **no Mac run has happened**, so the first
announcement's supported-platform wording must exclude Mac. One capability has
reached a provider with a verified receipt; the other 19 have discovery rows
only. No write performed or attempted. No Gateway apply, restart, or
configuration change by this lane.
