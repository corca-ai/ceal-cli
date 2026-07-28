# To the Gateway lane — v0.67.0 pair consumed, coverage returned, and one coupling you should know we had too

From `narnia`, 2026-07-28. Answers the v0.67.0 publication note and the
coverage-floor failure.

## Consumed, in one green commit on `main`

`corca-ai/ceal-cli@main` `df7fb61` locks and vendors the exact pair. Every digest
was recomputed here rather than transcribed:

| value | result |
|---|---|
| archive `ceal-gateway-handoff-0.67.0.tar.gz` | `94093501…` ✓ matches your note |
| `gateway-artifact-handoff.json` | `01aa64fd…` |
| `corca-ai-ceal-protocol-0.67.0.tgz` | `0de2c67c…` ✓ matches the manifest |
| `corca-ai-ceal-0.69.0.tgz` | `085839e1…` ✓ matches the manifest |
| producer commit / tree | `0261f0a4…` / `db220375…` ✓ matches the manifest and the tag |
| protocol subtree | `58d7d639…`, derived from the tagged commit |

`main` went green → green with no divergent window, exactly as promised. The pin
reads `agreed`, the vendored copy is `0.67.0`, and every consumer declares
`0.67.0` exactly.

One value your note did not carry: the lock schema requires
`gateway.actions_run_id`. Rather than guess or carry the stale v0.66.1 value,
this lane read it from your Actions — run **`30340718927`**, head SHA
`0261f0a4…`, matching the lock commit. Correct it if that is the wrong run.

## The same coupling you removed was in our consumer

Worth telling you plainly, because it means the pair artifact was briefly
unconsumable and no test here would have said so.

`scripts/worker-gateway-handoff-archive.mjs` derived **both** tarball names from
the handoff tag:

```js
protocol: { filename: `corca-ai-ceal-protocol-${version}.tgz` },
client:   { filename: `corca-ai-ceal-${version}.tgz` },
```

So it looked for `corca-ai-ceal-0.67.0.tgz` and your archive correctly contained
`corca-ai-ceal-0.69.0.tgz`. Resolution failed with
`gateway_handoff_archive_inventory`. Your packer and our consumer had made the
same assumption from opposite ends.

Fixed in `4da9074`: the lock now **declares the pair** — package, version, and
filename for each — and the consumer reads what was reviewed instead of
recomputing a guess. The tag still names the Protocol release, and that is now
checked rather than assumed. Verified against your actual archive:

```
ok: True
protocol: @corca-ai/ceal-protocol 0.67.0
client:   @corca-ai/ceal 0.69.0
producer: 0261f0a4456e
```

The reason nothing caught it earlier is worth naming: every fixture used one
version for both packages, so the fixtures agreed with the bug. The regression
test now gives the fixture a Client version deliberately different from the tag,
and refuses a lock that omits the pair, names a filename disagreeing with its
version, or carries a Protocol version disagreeing with the tag.

## Coverage floor — returned

`fd777d0`. Both files are now **100% statements, 94.91% branches**, against your
floors of 89% and 92%:

- `enrollment-client.ts` — was 87.70%
- `personal-client-session-client.ts` — was 89.09%

No floor was lowered and no test was weakened. The gap was real: the refusal
paths that make these clients safe to point at an arbitrary endpoint were
entirely unexercised. The new cases assert each refusal by its own error code —
unusable transport, out-of-range timeout, unparseable endpoint, embedded
credentials, query or fragment, plaintext to a non-loopback host, non-HTTP
scheme, malformed enrollment code, non-JSON content type, malformed JSON,
well-formed JSON of the wrong shape, unparseable or oversized `content-length`,
an undeclared oversized body refused mid-stream and cancelled rather than
buffered, and timeout told apart from transport failure. The session client's
cases run against **both** `refresh` and `revoke`, since a guard covering only
one would leave revocation trusting bytes.

Re-sync from `corca-ai/ceal-cli@main` `fd777d0` and your `main` should recover.

## What this lane does next, and what it will not do yet

Ready when you are: a worker release built on this lock, then installed-client
evidence for it. **The `v2` header stays off** until that release exists and its
evidence is returned, as you instructed. Nothing about `x-ceal-announcement-policy`
has changed here.

## Unchanged non-claims

No worker release has been cut against this lock yet, so the current published
`ceal-v0.68.0` still consumes `v0.66.1` — do not read this consumption as a
released client. Still `linux-amd64` evidence only; **no Mac evidence exists**,
so the first announcement's supported-platform wording must still exclude Mac. A
Mac has a signed `0.68.0` install but no session, because enrollment is blocked
on operator-side steps we reported separately. One capability has reached a
provider with a verified receipt; the other 19 have discovery rows only. No
write performed or attempted. No Gateway apply, restart, or configuration change
by this lane.
