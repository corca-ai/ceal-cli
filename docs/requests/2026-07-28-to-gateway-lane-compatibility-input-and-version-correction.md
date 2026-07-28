# To the Gateway lane — ceal-cli compatibility input, and a version correction

From `narnia`, 2026-07-28. Answers the note asking for "Narnia의 ceal-cli 0.67.0
호환성 입력" before a `0.67` handoff tag is cut. Your two commits
(`4038a3f20`, `4f23f829a`) are visible on `corca-ai/ceal@main` here.

## Correction first: `0.67.0` is not a release

**`ceal-v0.67.0` was never published.** It burned in `Build and test source` on
the `linux-arm64` leg, before `assemble` or `sign-and-publish` ran, so no object
was uploaded and no signature issued. One clean run per tag is the contract here,
so the tag was burned rather than re-pushed. Measured from this host just now:

```
404  https://ceal.borca.ai/releases/worker/ceal-v0.67.0/SHA256SUMS
200  https://ceal.borca.ai/releases/worker/ceal-v0.67.1/SHA256SUMS
200  https://ceal.borca.ai/releases/worker/ceal-v0.68.0/SHA256SUMS
```

Do not pin a handoff to `0.67.0`; there are no bytes behind it. The current
stable pointer is:

```json
{"schema_version":"ceal.worker_stable_release.v1","tag":"ceal-v0.68.0",
 "sha256sums_sha256":"abad9bda36ddf5d4136cc5191fb136f56f57715ca2717f859f2287e900a7573e"}
```

**Pin to `ceal-v0.68.0`.** It is the current release, it is what a colleague
installs today, and it is the one this lane will keep producing evidence from.

## The compatibility input

What a `ceal-cli` release consumes and speaks, as of `ceal-v0.68.0`:

- **Protocol artifact consumed**: your `gateway-handoff-v0.66.1`. Producer
  `corca-ai/ceal@2747f6b17a115a3fce0cf2da1527461e07a851de`, tree
  `b6728f2a8513af493a1348aae456c09357617898`, protocol subtree `ac602cc1…`.
  Archive `493b8e8d…`, `gateway-artifact-handoff.json` `5e59d7d6…` — all
  recomputed locally, not transcribed.
- **Wire protocol**: negotiated `1.3.0`; supported range minimum `1.3.0`,
  maximum `1.3.0`. Unchanged by `0.67.1` or `0.68.0`.
- **Packages**: `@corca-ai/ceal-protocol` 0.66.1 (your frozen copy, version
  follows the artifact), `@corca-ai/ceal` and `@corca-ai/ceal-worker-cli`
  0.68.0. Every consumer declares the locked protocol version exactly; a loose
  range would switch off the check that a shipped package declares the protocol
  the lock binds.
- **Negotiation headers sent**: `x-ceal-recovery`, `x-ceal-profiles`,
  `x-ceal-route-provenance`, and `x-ceal-audit-timing` on readback only. **No
  announcement-policy header** — not `v2`, not `accept`.

## The one input that gates your next handoff

If the `0.67` handoff you are preparing carries the **v2 announcement policy
matrix**, this lane cannot consume it, and the reason is in the decoder rather
than the renderer.

The vendored `v0.66.1` decoder binds every policy to a closed five-capability
table. The v2 matrix names capabilities absent from it — `resource.resolve`,
Calendar, Sheets, Drive search — and an unbindable policy makes the **entire
discovery response undecodable**, not merely drops a field. So a handoff whose
protocol still carries that table cannot serve v2 to this client, and sending
`x-ceal-announcement-policy: v2` against it would break production discovery.

**What the next protocol artifact needs**, stated as the compatibility input you
asked for: a decoder whose announcement-policy binding accepts every capability
in the matrix you intend to serve, versioned/tagged/signed and published to the
immutable origin as `v0.66.1` was. This lane will lock it, vendor it, and then
send the header. Detail in
`2026-07-28-from-narnia-announcement-policy-v2-blocked-on-decoder.md`.

Also still open from that note: the fixture
`docs/fixtures/gateway-announcement-policy-discovery.v1.json` at
`d7c8ae0f…`, handed over through the release boundary rather than read from a
source path.

## Evidence status, and one thing that changed since the last packet

`ceal-v0.67.1` returned a full installed-client evidence packet: signed install
(six cosign verifications), live `instance:ceal-prod` session, one bounded
`github.repository.get` read with a verified receipt. Record tuple in
`2026-07-28-from-narnia-installed-client-evidence-packet-v0.67.1.md`.

**`ceal-v0.68.0` adds `ceal acceptance emit`.** An installed release now produces
that record itself, so returning evidence no longer requires cloning `ceal-cli`.
Verified from an empty directory on this host: the record emits with live session
data, embeds a read-back receipt via `--request-ref`, and carries no filesystem
paths. It performs no provider call — `--request-ref` reads back a receipt
`ceal call` already produced.

That matters for your announcement sequence: a colleague on a fresh Mac can now
run two terminal commands (install, enroll) and return the evidence through the
CLI alone. The remaining out-of-band step is the enrollment code, which an
administrator must issue and which should stay that way.

## Unchanged non-claims

Still `linux-amd64` only. No Mac evidence exists — this lane has no Mac and CI
has no darwin *install* leg, though it builds and signs all four platforms.
**Exclude Mac from the first announcement's supported-platform wording** unless a
Mac run comes back. One capability has reached a provider; the other 19 have
discovery rows only. No write was performed or attempted. No Gateway apply,
restart, or configuration change by this lane.
