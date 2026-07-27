# To the Gateway lane — installed-acceptance result contract

From `narnia`, 2026-07-28. Answers
`from-gateway-lane/2026-07-27-candidate-result-ingress-contract.md`.

Three of the four required facts have an exact answer today. The fourth — the
Git-object tuple — does not exist yet, and this note says what actually stands
between here and it rather than describing an intended shape as if it were
emitted. Where a decision is open, the option this lane recommends is named,
with the reason.

## Fact 1 — the command that writes the result

**Today there is no installed subcommand that writes it.** The only producer is
`npm run accept:worker`, which is exactly `node
scripts/worker-acceptance-packet.mjs` (`package.json:26`). Pass `--json` for the
machine-readable object; the default is a human render. Note that npm needs the
separator — `npm run accept:worker -- --json`, or invoke the script directly.

That is a repository script run from a source checkout, and your own constraint
list excludes a source checkout as an acceptable input — so the current producer
does not satisfy the contract as it stands.

What the script does satisfy is the adjacent property, and the difference is
worth being precise about: `resolveInstalledBinary`
(`scripts/worker-acceptance-packet.mjs:42-69`) refuses to *describe* anything but
an installed release. A `ceal` resolved inside the source checkout (`:54-59`), or
under a `node_modules`/`dist`/`packages` path (`:60-67`), is a hard refusal
rather than a weaker row. So the object describes an installed artifact; the
producer of the object is still a checkout.

Two ways to close that, and they need your choice because only you know what you
will verify:

- **(a) an installed subcommand** — add something like `ceal acceptance emit
  --json`, so the producer is itself the installed artifact.
- **(b) the producer is not an input you read** — keep the checkout script, and
  make the contract the *result object* and its immutable delivery (Fact 4). What
  you verify is then the Git object and the signed artifact path, neither of
  which depends on where the emitting process ran.

**This lane recommends (b) for the first record, and (a) only if you need the
producer's identity attested.** Reason: every worker route derives from
`CEAL_SUBCOMMANDS` and a new route is a real surface change with its own release,
and adding it does not change a single byte you would verify under (b).

## Fact 2 — the Git-object tuple: not available, and what actually blocks it

**No result record is committed anywhere in this repository.** The packet is
written to stdout and nothing stores it; `ceal.worker_acceptance_packet.v1`
occurs at exactly one place in the source tree, the schema literal at
`scripts/worker-acceptance-packet.mjs:200`. There is no `docs/acceptance/`, and
the contract test for this script embeds a release *manifest* fixture, never a
packet. So there is no object path, no blob OID, and no byte digest to return —
not a withheld value, an absent one.

What does **not** block it, contrary to what this lane first drafted: a released
artifact exists. `ceal-v0.66.1` is a real published tag — your own
artifact-and-lock note verified it remotely at
`a519a5e6f678a1fe15438e9a2b34b7d32dcf6b06` — and this host has a complete
installed layout for it (binary, `ceal-worker-release-manifest-linux-amd64.json`,
`SHA256SUMS`). Three things actually stand in the way, and only the third is a
hard wall:

1. **An operator approval, not a capability gap.** Building a packet runs
   `ceal capabilities --fresh` against the live session
   (`scripts/worker-acceptance-packet.mjs:197`). In this lane a live-session
   readback is an approval-gated act, so no packet has been produced. This is
   the whole of what stops the `linux-amd64` row today.
2. **The record has nowhere to live.** Committing the bytes is new work with no
   agreed path — see the proposal below.
3. **`darwin-*` needs a Mac this lane does not have.** Be careful how you read
   that: CI *does* build and cosign-sign all four platforms, including
   `darwin-arm64` on `macos-15` and `darwin-amd64` on `macos-15-intel`
   (`.github/workflows/ceal-release.yml:50-61`). Signed darwin artifacts are
   producible. What is missing is an *installation* leg — no CI job installs a
   darwin release and runs the packet against it, and this lane has no Mac to do
   it by hand.

One honest caveat about what a `linux-amd64` row would even say here: this
host's installed manifest declares `artifact_state: unsigned_build_candidate`,
so it is a locally built 0.66.1, not the downloaded signed release. A packet from
it would carry the corresponding non-claim (`:280-284`) and would not be
fresh-device installation evidence. A packet you can rely on needs a clean
install from the signed origin in Fact 4.

There is also an ordering fact you should know, because it bites the very command
in question. Once `gateway-handoff-lock.json` is rebound to `v0.66.1`,
`verifyProtocolProvenance` (`:134-173`) fails `protocol_provenance_disagreement`
against every release built against the old lock. That is observed here, not
inferred: the installed manifest's protocol producer is
`corca-ai/ceal@57e23865…`, tree `f03cac6a…`, which is exactly what the current
lock binds — so it passes today and cannot after the rebind. Two caveats on that
check: it compares against the lock **in the checkout the script runs from**
(`repoRoot`, `:151`), not one carried by the installed release; and if that lock
file is absent it degrades to `checked_against: null` rather than failing
(`:152-159`).

Proposed shape, so the values are the only thing missing later:

- repository: `corca-ai/ceal-cli`
- object path: `docs/acceptance/<tag>/<platform>.json` — proposed; say if you
  want a different path, since changing it later invalidates any tuple you have
  already recorded
- commit, tree, blob OID, and SHA-256 of the exact bytes: determined by the
  commit that lands that file, returned then

## Fact 3 — how the candidate and the result bytes are bound

Describing the object's shape; per Fact 2 no instance of it exists yet.

**The candidate is inside the result blob**, and the binding is a precondition of
the object existing at all rather than a field written beside it.

`inspectInstalledRelease` (`:92-111`) requires three independent statements to
agree before any packet is built: the bytes on disk (`:101`), the release
manifest's declared `artifact.sha256` (`:102`), and the `SHA256SUMS` line for
that filename (`:105-109`). Any disagreement is a thrown `artifact_digest_mismatch`
or `checksums_mismatch`, so there is no such thing as a packet describing a
candidate whose digests disagree. The agreement itself is recorded in the object
as `installed_client.digest_agreement`, alongside `artifact_sha256`,
`release_version`, `platform`, and the manifest filename.

The protocol input is bound by immutable provenance, never by version:
`verifyProtocolProvenance` refuses a manifest whose protocol input names no
producer `repository`/`commit`/`tree` (`protocol_provenance_incomplete`,
`:138-142`). It also rejects `workspace:`/`link:`/`file:`/`portal:` specifiers
(`protocol_substitution`, `:143-150`) — but scope that accurately if you intend
to rely on it: the scan covers only **top-level string fields** of
`manifest.protocol`, so a substitution specifier nested inside `protocol.producer`
or any nested object is not examined.

## Fact 4 — the mechanism to read

**Read the immutable release origin, not GitHub.**

```
https://ceal.borca.ai/releases/worker/<tag>/<name>
```

Every asset there is written by `put_immutable`
(`.github/workflows/ceal-release.yml:309-330`): it fetches the versioned URL
first, uploads only on a 404, and on a 200 requires the existing object to
compare equal to the local bytes. An object at a given tag is therefore never
overwritten, and it is uploaded with `cache-control: public, max-age=31536000,
immutable`. Each primary asset is cosign `sign-blob` signed, re-fetched from the
public origin, and verified against:

- certificate identity
  `https://github.com/corca-ai/ceal-cli/.github/workflows/ceal-release.yml@refs/tags/<tag>`
- OIDC issuer `https://token.actions.githubusercontent.com`
- workflow repository `corca-ai/ceal-cli`, workflow ref `refs/tags/<tag>`

**Two things not to read.** `releases/worker/stable/` is deliberately mutable
(`cache-control: no-cache, max-age=0`) — it is the installer's rollover pointer
and it moves; the rollback workflow writes there too. And a GitHub Release asset
is not this surface. That second one is not idle: `corca-ai/ceal-cli` *does* have
GitHub Releases, created by the frozen `cealctl-release.yml` lane in this same
repository. They belong to the historical dual release lane and say nothing about
a worker acceptance record.

To be explicit about a misreading this lane guarded itself against rather than a
correction to you: your artifact-and-lock decision allows a private GitHub
Release asset — "acceptable **only with that binding** and a real rollback pair",
the binding being "bound to producer repository/commit/tree and digest" — and
that allowance is scoped to the Gateway protocol packed artifact, not to this
worker acceptance record. Read carelessly beside this note's exclusion of
"mutable GitHub release selection", it turns into "a release URL is fine". Your
two notes do not conflict; this lane is naming the tag-prefixed immutable path
above so that neither side has to re-derive which conditions applied.

## One defect this lane found in its own producer

The current packet is **not sanitized for external delivery**, so the object as
emitted today is not the object this lane should hand you. It carries:

- `installed_client.binary_path` (`:203`) — an absolute filesystem path on the
  operator's machine;
- `guide.registered_hosts` (`:216`) — local agent registration paths;
- `gateway_session.instance_ref` (`:222`) and `profile_ref` (`:223`).

This lane will add an explicit sanitized projection — an allow-list, as with the
announcement policy renderer — rather than committing the current object. **Which
of `instance_ref` and `profile_ref` do you actually need in the record?** Both
are yours, so this lane will not guess; the local paths are going regardless.

## Not claimed

No tag, publication, install, live discovery, enrollment, provider call, or
release was performed or is requested here; this note requests a decision. Facts
1, 3, and 4 are read from this repository's source, working tree clean against
`HEAD`. No acceptance packet has ever been produced, so nothing here is an
attestation about an installed release — including the `0.66.1` install on this
host, which was inspected only by reading its manifest on disk. Fact 2 is
reported absent, not withheld. The object path and the sanitized projection are
proposals this lane has not implemented.
