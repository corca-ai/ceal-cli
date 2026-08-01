# `gateway-protocol-handoff-v0.71.6` Consumed; `ceal-v0.71.0` Released

Authoring host: `narnia`. Repository: `corca-ai/ceal-cli`.

## 1. Verification of the immutable origin

All four assets fetched from
`https://ceal.borca.ai/releases/gateway-protocol-handoff/gateway-protocol-handoff-v0.71.6/`
(HTTP 200 each). No Gateway checkout, workspace, link, or personal-session path
was used to obtain the archive. `v0.71.3`, `v0.71.4`, and `v0.71.5` were never
fetched.

- Archive SHA-256 `6a979c6325a832b8d2b1e595ca386f68244353a2aab19166c1fc547ce2c71e34`,
  matching the published `SHA256SUMS`.
- `cosign verify-blob` **Verified OK** against certificate identity
  `https://github.com/corca-ai/ceal/.github/workflows/gateway-protocol-handoff-release.yml@refs/tags/gateway-protocol-handoff-v0.71.6`
  and issuer `https://token.actions.githubusercontent.com`. The certificate's
  Fulcio claims carry commit `cd350024…`, run
  `https://github.com/corca-ai/ceal/actions/runs/30684849631/attempts/1`,
  repository `corca-ai/ceal`, and environment `ceal-gateway-release`.
- Member inventory is exactly five regular files, no links or directories:
  `.ceal-protocol-handoff-owner`, `corca-ai-ceal-protocol-0.71.6.tgz`,
  `gateway-leased-consumer-control-conformance.json`,
  `gateway-protocol-handoff.json`, `gateway-protocol-provenance.json`.
- Manifest, provenance, and control conformance cross-check clean: manifest
  Protocol `sha256`/`bytes`/`integrity` against the tarball bytes; both sidecar
  digests against their files; provenance and control conformance both naming
  producer commit `cd350024…` and protocol subtree `3ca6fe3a…`; packed
  `package.json` name/version and the exact export set `[".", "./conformance"]`;
  `npm_shasum` against the tarball's SHA-1. Sixteen checks, zero failures.

## 2. Consumption identity

Source commit **`d07300f94cd263fd8ca504a83685de5e32aab120`** on `main`.

`gateway-protocol-handoff-lock.json` (new; supersedes and deletes
`gateway-handoff-lock.json`):

| field | value |
| --- | --- |
| `gateway.commit` | `cd350024743342bfaf65716ec909695918771d49` |
| `gateway.tree` | `24897031285d482b954cc378e53fb7e95e8163c5` |
| `gateway.protocol_tree` | `3ca6fe3a1b650dbe6414bd5cbd77d9a6b843924b` |
| `gateway.tag` | `gateway-protocol-handoff-v0.71.6` |
| `gateway.actions_run_id` | `30684849631` |
| `gateway.origin` | `https://ceal.borca.ai/releases/gateway-protocol-handoff` |
| `protocol.sha256` | `fa8418622d12511c98cd7fe1b497bdf453bfd3947c720008f1052dd4571aa1f1` |
| `archive.sha256` | `6a979c6325a832b8d2b1e595ca386f68244353a2aab19166c1fc547ce2c71e34` |
| `archive.handoff_manifest_sha256` | `ab2f0be83ebacef3999b4966d429b6c202d260ca095061202365c5ee3455a523` |

`protocol-vendor-pin.json` is `agreed`, non-diverged: `source.commit`
`cd350024…`, `source.tree` = `shipped.protocol_tree` = `3ca6fe3a…`, and
`git rev-parse HEAD:packages/ceal-protocol` returns that same subtree.

## 3. Release

- Tag **`ceal-v0.71.0`**, Actions run `30686719029` (success), all four
  platforms signed and published.
- Stable pointer advanced to `ceal-v0.71.0`
  (`sha256sums_sha256 dbdc5e5bb4f20505b80a62e3371f1589288edeea4331092c9d71cf63cc84074b`).
- Branch gate `check.yml` run `30686625997` was green on the released commit
  before the tag was pushed.

## 4. Clean-machine Linux proof (`narnia`)

Fetched from the public release origin only, into an empty directory:

- `cosign verify-blob` on `ceal-linux-amd64` **Verified OK** against
  `https://github.com/corca-ai/ceal-cli/.github/workflows/ceal-release.yml@refs/tags/ceal-v0.71.0`.
- Binary SHA-256 `c087bd6f0300bd8bc02f5aff0e3c0074782de8f098ef3a6598d4e7fc4a4c3f57`,
  matching the published `SHA256SUMS`.
- `./ceal-linux-amd64 version` → `version: 0.71.0`, `protocol_version: 1.3.0`.
- The signed platform manifest binds Protocol `0.71.6`, tarball digest
  `fa841862…`, producer commit `cd350024…`, protocol subtree `3ca6fe3a…`.

This is a published-binary proof on Linux. It is **not** an install-script
proof, not a live Gateway session, and not a provider readback.

## 5. What the packet shape change cost, and what it did not

The client tarball left the packet. It was never a build input — the builders
already packed `@corca-ai/ceal` from `packages/ceal-client`, which this
repository owns — so no builder changed. What it was is a witness. The claim
"the client declares this Protocol version" is now re-derived locally from
`packages/ceal-client/package.json` and `packages/ceal-worker-cli/package.json`,
which the resolver already asserted. Nothing that check covered was lost.

What *was* lost is stated as debt rather than glossed: the signed worker release
manifest records only the Protocol, and `@corca-ai/ceal`'s bytes used to be
covered transitively through the Gateway packet's client record. That transitive
path is gone. A consumer pinning client bytes now has only a source-owner claim.
The fix is a manifest schema addition, which is release-affecting and was not
made inside a consumption slice.

`gateway-leased-consumer-control-conformance.json` is bound but **not
interpreted**: its bytes must match the signed manifest and its source identity
must match the packet's producer commit and protocol subtree. This repository
implements no leased-consumer control surface and claims none. It is a distinct
family from the vendored `gateway-leased-consumer-call-conformance.json`, which
is unchanged.

## 6. One thing the Gateway lane should know

The signed archive carries the **built** package only — `dist/`, `conformance/`,
`LICENSE`, `package.json`. It does **not** carry the `packages/ceal-protocol`
source subtree, and `protocol-vendor-pin.json` pins the vendored copy by that
subtree's tree hash. So the archive alone could not satisfy the request's step 2:
the source bytes came from an operator-pulled reference checkout of
`corca-ai/ceal` at `cd350024…`.

That is weaker than it should be, and it is worth closing on your side. Two
things make it tolerable this time rather than acceptable in general:

1. The subtree hash `3ca6fe3a…` is declared by the signed manifest *and* the
   signed provenance, so the copy was checked against signed material rather
   than trusted. The pin gate now enforces that agreement
   (`shipped_lock_mismatch`), which closed a documented two-field forgery bypass.
2. The vendored source builds to a `dist/` **byte-identical** to the one inside
   the signed tarball (narnia, Node 22.22.1, TypeScript 5.9.3).

If the handoff carried the protocol source subtree — or a signed source archive
member reproducing tree `3ca6fe3a…` — the reference checkout would drop out of
this lane's consumption path entirely. Requested.

## 7. Remaining blocker for Mac email-first-device acceptance

Unchanged by this slice, and not a client-source blocker. `ceal-v0.71.0` ships
signed `darwin-arm64` and `darwin-amd64` binaries, and `ceal session adopt` plus
the device-enrollment decoder are in the released source. What is missing is a
consenting named-device acceptance record, which needs Gateway apply/mail
configuration and an enrollment path the Gateway host owns. This lane cannot
produce it. Announcement copy must continue to exclude Mac until it exists:
install-and-session evidence remains `linux-amd64` only.
