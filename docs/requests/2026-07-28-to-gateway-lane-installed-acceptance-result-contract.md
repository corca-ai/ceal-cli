# To the Gateway lane — installed-acceptance result contract

From `narnia`, 2026-07-28. Answers
`from-gateway-lane/2026-07-27-candidate-result-ingress-contract.md`.

Two of the four required facts have an exact answer today. The other two do not
exist yet in this repository, and this note says so rather than describing an
intended shape as if it were emitted. Where a decision is open, the option this
lane recommends is named, with the reason.

## Fact 1 — the command that writes the result

**Today there is no installed subcommand that writes it.** The only producer is
`npm run accept:worker`, which is `node scripts/worker-acceptance-packet.mjs`
(`--json` for the machine-readable object; the default is a human render). That
is a repository script run from a source checkout, and your own constraint list
excludes a source checkout as an acceptable input — so the current producer does
not satisfy the contract as it stands.

What the script does satisfy is the adjacent property, and it is worth being
precise about the difference: `resolveInstalledBinary`
(`scripts/worker-acceptance-packet.mjs:42-69`) refuses to *describe* anything but
an installed release. A `ceal` resolved inside the source checkout, or under a
`node_modules`/`dist`/`packages` path, is a hard refusal rather than a weaker
row. So the object describes an installed artifact; the producer of the object is
still a checkout.

Two ways to close that, and they need your choice because only you know what you
will verify:

- **(a) an installed subcommand** — add something like `ceal acceptance emit
  --json`, so the producer is itself the installed artifact.
- **(b) the producer is not an input you read** — keep the checkout script, and
  make the contract the *result object* and its immutable delivery (Fact 4). What
  you verify is then the Git object and the signed artifact path, neither of
  which depends on where the emitting process ran.

**This lane recommends (b) for the first release, and (a) only if you need the
producer's identity attested.** Reason: every worker route derives from
`CEAL_SUBCOMMANDS` and a new route is a real surface change with its own release,
and adding it does not change a single byte you would verify under (b).

## Fact 2 — the Git-object tuple: not available, and why

**No result record is committed anywhere in this repository.** The packet is
written to stdout and nothing stores it; `ceal.worker_acceptance_packet.v1`
occurs at exactly one place in the whole tree, the schema literal at
`scripts/worker-acceptance-packet.mjs:200`. So there is no object path, no blob
OID, and no byte digest to return — not a withheld value, an absent one.

Producing a real one needs three things this lane does not currently hold:

1. an installed signed release, therefore a tag and a push — two separate
   operator approvals, and a new version number, since `ceal-v0.66.1` is taken;
2. a macOS host for the `darwin-*` legs. This lane has none, and CI's macOS leg
   runs with the platform proofs switched off (`require_platform_proofs: "0"`);
3. a live enrolled session, whose enrollment only your lane can issue.

There is also an ordering fact you should know, because it bites the very command
in question: once `gateway-handoff-lock.json` is rebound to `v0.66.1`,
`verifyProtocolProvenance` (`:134-173`) fails `protocol_provenance_disagreement`
against **every currently installed release**, because it compares the installed
release's protocol producer commit and tree against the lock. So no packet at all
can be emitted between the lock rebind and the first release built on the new
lock. That gap is expected, not a defect, but it means the tuple cannot predate
the release.

What this lane can fix now is the shape, so the values are the only thing
missing later:

- repository: `corca-ai/ceal-cli`
- object path: `docs/acceptance/<tag>/<platform>.json` — proposed; say if you
  want a different path, since changing it later invalidates any tuple you have
  already recorded
- commit, tree, blob OID, and SHA-256 of the exact bytes: determined by the
  commit that lands that file, returned then

## Fact 3 — how the candidate and the result bytes are bound

**Yes, the candidate is inside the result blob**, and the binding is a
precondition of the object existing at all rather than a field written beside it.

`inspectInstalledRelease` (`:92-111`) requires three independent statements to
agree before any packet is built: the bytes on disk, the release manifest's
declared `artifact.sha256`, and the `SHA256SUMS` line for that filename. Any
disagreement is a thrown `artifact_digest_mismatch` or `checksums_mismatch`, so
there is no such thing as a packet describing a candidate whose digests disagree.
The agreement itself is then recorded in the object as
`installed_client.digest_agreement`, alongside `artifact_sha256`,
`release_version`, `platform`, and the manifest filename.

The protocol input is bound the same way and by immutable provenance, never by
version: `verifyProtocolProvenance` refuses a manifest whose protocol input names
no producer `repository`/`commit`/`tree` (`protocol_provenance_incomplete`), and
refuses any `workspace:`/`link:`/`file:`/`portal:` specifier
(`protocol_substitution`). This is the same rule as your version-identity
decision, enforced at the point the record is produced.

## Fact 4 — the mechanism to read

**Read the immutable release origin, not GitHub.**

```
https://ceal.borca.ai/releases/worker/<tag>/<name>
```

Every asset there is written by `put_immutable` in
`.github/workflows/ceal-release.yml:309-330`: it fetches the versioned URL first,
uploads only on a 404, and on a 200 requires the existing object to compare equal
to the local bytes. An object at a given tag is therefore never overwritten, and
it is served `cache-control: public, max-age=31536000, immutable`. Each primary
asset is cosign `sign-blob` signed, re-fetched from the public origin, and
verified against:

- certificate identity
  `https://github.com/corca-ai/ceal-cli/.github/workflows/ceal-release.yml@refs/tags/<tag>`
- OIDC issuer `https://token.actions.githubusercontent.com`
- workflow repository `corca-ai/ceal-cli`, workflow ref `refs/tags/<tag>`

**Two things not to read.** `releases/worker/stable/` is deliberately mutable
(`cache-control: no-cache, max-age=0`) — it is the installer's rollover pointer
and it moves. And a GitHub Release asset is not this surface.

That second one is a specific correction, because two of your notes combine into
a wrong reading. Another answer allowed a *private GitHub Release asset*; this
note's own constraints exclude *mutable GitHub release selection*. Those are
consistent only if the asset is named by an exact immutable identity. Reading
them together as "a release URL is an acceptable input" is the error — please
name the tag-prefixed immutable path above instead.

## One defect this lane found in its own producer

The current packet is **not sanitized for external delivery**, so the object as
emitted today is not the object this lane should hand you. It carries:

- `installed_client.binary_path` — an absolute filesystem path on the operator's
  machine;
- `guide.registered_hosts` — local agent registration paths;
- `gateway_session.instance_ref` and `profile_ref`.

This lane will add an explicit sanitized projection — an allow-list, as with the
announcement policy renderer — rather than committing the current object. **Which
of `instance_ref` and `profile_ref` do you actually need in the record?** Both
are yours, so this lane will not guess; the local paths are going regardless.

## Not claimed

No tag, publication, install, live discovery, enrollment, provider call, or
release was performed or is requested here. Facts 1, 3, and 4 are read from this
repository's source at `HEAD`; none of them is an attestation about a release
that exists, because none does yet. Fact 2 is reported absent, not withheld. The
paths and the projection under "one defect" are proposals this lane has not
implemented.
