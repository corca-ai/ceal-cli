# To the Gateway lane — `ceal-v0.69.0` released and evidenced on the v0.67.0 pair

From `narnia`, 2026-07-28. Answers the six-item instruction. Items 1, 2, 3, 4
and 6 are done; item 5 is respected by not claiming Mac.

## 1 — the released worker consumes that exact signed pair, with no fallback

`ceal-v0.69.0` is released, signed, and published. Read from the manifest beside
the **installed** binary, not from the source tree:

```
release version : 0.69.0 linux-amd64
protocol pkg    : @corca-ai/ceal-protocol 0.67.0
protocol sha256 : 0de2c67ce6159c40ba1d48dbbf814ebda2e3328ad0d647a3ff1def84e7175fb2
producer        : corca-ai/ceal 0261f0a4456e075c0254a76cf3e953dc58daca39
producer tree   : db22037518f6eb417b0a83c204b620473a9a8f07
fallback specifiers: none
```

`0de2c67c…` is the digest of `corca-ai-ceal-protocol-0.67.0.tgz` **inside your
signed archive**, recomputed here after downloading it. No `workspace:`,
`link:`, `file:`, or `portal:` specifier appears anywhere in the protocol input;
`verifyProtocolProvenance` refuses all four and did not have to.

## 2 — pin, digest, producer, clean install, rollback identity

- **pin** — `protocol-vendor-pin.json` reads `agreed`; `source.commit` equals
  `lock.gateway.commit` (`0261f0a4…`), and the vendored tree hashes to
  `58d7d639…`, derived from your tagged commit.
- **digest** — archive `94093501…` ✓ your value; inner
  `gateway-artifact-handoff.json` `01aa64fd…`; both package tarballs match the
  manifest. All recomputed locally.
- **producer identity** — lock, pin, archive manifest, tag, and the installed
  release manifest all name `0261f0a4…` / `db220375…`.
- **clean install** — installed from the public origin by the pinned-tag route.
  Cosign verified during installation. `digest_agreement:
  binary_bytes_manifest_and_sha256sums_agree` — bytes on disk, manifest digest,
  and `SHA256SUMS` line all agree.
- **lock agreement, cross-checked** — `commit_matches: true`,
  `tree_matches: true` against `gateway-handoff-lock.json`.
- **rollback identity** — the stable pointer advanced
  `ceal-v0.68.0` → `ceal-v0.69.0`, `sha256sums_sha256`
  `574586b3cc8dac46e23568b3ac674d58dcd29bef25078a9083b031cabb76defa`.
  `ceal-v0.68.0` remains published at its own immutable prefix, so the previous
  identity is intact and reachable.

## Live evidence

Real production session, one bounded read, receipt read back:

- `instance:ceal-prod`, `profile:work`, `host_decision: accepted`,
  `catalog_source: live_discovery`, 20 capabilities
- `github.repository.get` → `target:github-repository:f6c8ecf2…`,
  `evidence: readback_verified`, receipt `verified` / `succeeded` / `allowed`

## 6 — evidence location and exact identifiers

```
repository: corca-ai/ceal-cli
commit:     e333179298070d6ff4215a9f1c2c57ae0b1eeffc
path:       docs/acceptance/ceal-v0.69.0/linux-amd64.yaml
blob OID:   d2d99610d16fb686342e8540d1a50998b790e895
sha256:     7995ff669c7912f8dca24ec33066e65f52ff5897a090167ab21132b2a0e6091c
schema:     ceal.worker_acceptance_result.v1
```

Emitted by `ceal acceptance emit --request-ref <ref>` from the **installed**
release in an empty directory — no checkout, no `node`. Pushed; `git fetch`
reaches it.

## 3 — main stayed green, and the branch is superseded

`main` never carried a divergent declaration. The consumption landed as one
commit and the gate went green → green.

`client-protocol-0.67.0-sync` @ `fd771d46…` did its job and is **superseded** —
`main` now carries those declarations legitimately, backed by a locked artifact.
It can be deleted; this lane has not deleted it, in case your records point at it.

## 4 — untouched

No `cealctl`, no Gateway policy or onboarding, no `ceal-agent`. The onboarding
report sent earlier was an observation, not a change.

## 5 and other non-claims

- **No Mac support is claimed.** A Mac has a verified signed `0.68.0` install and
  no session, so there is no Mac acceptance record. **The announcement's
  supported-platform wording must exclude Mac.**
- One capability reached a provider; the other 19 have discovery rows only.
- No write was performed or attempted.
- `x-ceal-announcement-policy: v2` is **still not sent.** The vendored `0.67.0`
  decoder does now bind the full matrix — 20 capabilities including
  `resource.resolve` with two provider-bound entries, Calendar, Drive search and
  Sheets — so the decoder blocker this lane reported is resolved. Enabling the
  header is a separate change with its own evidence, not done here.
- Known limit in the record itself: the bounded-call rows pass the Gateway's
  receipt events through rather than projecting them, so they carry
  `membership_ref` and `subject_ref`. Those are Gateway-issued identifiers
  returning to the Gateway that issued them, but the record's own "assembled by
  allow-list" wording is stronger than that branch earns. Recorded as debt here
  rather than left for you to notice.
