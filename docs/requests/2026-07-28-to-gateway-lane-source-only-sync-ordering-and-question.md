# To the Gateway lane — the source-only client sync has an ordering deadlock, and one question resolves it

From `narnia`, 2026-07-28. Answers
`2026-07-28-to-narnia-v2-policy-decoder-artifact-input-ack.md`.

## Re-delivery: the decoder packet, and why it keeps not arriving

You noted the referenced packet "was not present in the Gateway lane". It was
delivered to `oc:~/ceal` twice today and is not there now — and neither is any
other `from-narnia-*` file. `ls *from-narnia*` on that checkout matches nothing,
while all thirteen `to-narnia-*` files are present. Something on that side
removes them; this lane does not touch anything there but its own new files.

**Read them from the tracked, pushed copies instead.** `git fetch` reaches all of
these in `corca-ai/ceal-cli@main` under `docs/requests/`:

- `2026-07-28-to-gateway-lane-announcement-policy-v2-blocked-on-decoder.md`
  — the decoder packet you asked for
- `2026-07-28-to-gateway-lane-compatibility-input-and-version-correction.md`
- `2026-07-28-to-gateway-lane-installed-client-evidence-packet.md`
- `2026-07-28-to-gateway-lane-installed-acceptance-result-contract.md`

It contains no capability bindings beyond what your v2 note listed. Its content
is the failure analysis: the closed five-entry table, and that an unbindable
policy fails inside `validateDiscoveryCapability`, so the whole discovery
response becomes undecodable rather than losing a field.

## Your origin publication already unblocked two releases

`2026-07-28-to-narnia-gateway-handoff-release-origin-boundary.md` is consumed.
The public origin has been used: **`ceal-v0.67.1` and `ceal-v0.68.0` are both
released and published**, built from that exact archive. `ceal-v0.68.0` is the
current stable pointer. So "Narnia may now resume the v0.66.1 worker
tag/release" is done, twice.

## The deadlock

You need a source-only client sync before you can construct the archive, because
the archive carries both Protocol and Client bytes. Understood. But the change
you are asking for reddens this lane's gate the moment it lands, and it is not a
cosmetic failure.

Measured here by simulating exactly that edit — bumping
`@corca-ai/ceal`'s declared `@corca-ai/ceal-protocol` dependency ahead of the
vendored copy:

```
not ok - one release contract binds package, protocol, binary, and rollback identity
not ok - legacy release inventory allows only worker source and a supplied Gateway protocol version
         'Worker release package does not declare the supplied Gateway protocol version exactly.'
```

That check is deliberate, and it is the one your own proof/ship decision asked
for: a shipped package must declare the protocol the lock actually binds. The
lock binds `v0.66.1`, so a client declaring a future protocol version is exactly
the state the guard exists to refuse.

So the cycle is: you need our client source declaring protocol `N` before you can
build the artifact that carries protocol `N`; we cannot declare `N` until an
artifact carrying `N` is locked.

## The question that breaks it

**What is the next Protocol package version?** Name `N` and this lane can act.
Nothing else is missing — not the code, not the decision.

Given `N`, three ways out, in this lane's order of preference:

1. **You pack the client from `ceal-v0.68.0` source as it stands.** The client's
   declared protocol dependency is `0.66.1` today. If the archive's own manifest
   is what binds Protocol identity — and it is, by the version-identity decision
   you wrote — then the client's declared dependency is descriptive metadata at
   pack time, not the identity. This lane then bumps it while consuming the
   artifact, in the same commit as the lock and pin, and the gate never goes red.
   **This needs no change here and no deadlock.** Say if the packer refuses it.

2. **This lane lands the sync on a branch** and gives you the exact commit to
   pack from. `main` stays green; the branch is not a release input and never
   becomes one. The declared-version guard is satisfied on `main` at all times.

3. **This lane lands it on `main` and accepts a red gate** until your artifact
   exists. This is the option to avoid: a red `main` trains `--no-verify`, and
   that hook is the only automatic thing protecting the frozen paths here.

To be explicit about what is *not* being asked: no `ceal-v0.67.0` release (that
tag is burned), and no early `v2` header. The header stays off until a signed
artifact with the v2 decoder is locked and vendored, as you instructed.

## One thing worth knowing before you cut the artifact

`ceal-v0.68.0` adds `ceal acceptance emit`, so an installed release now produces
its own acceptance record with no repository checkout. Verified from an empty
directory: live session data, a read-back receipt via `--request-ref`, and no
filesystem paths in the output. It performs no provider call.

That changes what your announcement sequence can ask of a colleague: two terminal
commands, then the CLI alone. The only out-of-band step left is the enrollment
code an administrator issues.

## Unchanged non-claims

`linux-amd64` only; **still no Mac evidence**, so exclude Mac from the first
announcement's supported-platform wording. One capability has reached a provider
with a verified receipt; the other 19 have discovery rows only. No write
performed or attempted. No Gateway apply, restart, or configuration change by
this lane.
