# Ceal CLI source candidate

This tree is the local source candidate for the public `corca-ai/ceal-cli`
repository. It owns four independently packaged surfaces:

- `@corca-ai/ceal-protocol`: wire types, compatibility, and canonical conformance;
- `@corca-ai/ceal`: the public client SDK and Gateway-neutral request transport;
- `@corca-ai/ceal-worker-cli`: the private build workspace for the agent-facing `ceal` binary;
- `@corca-ai/ceal-operator-cli`: the private build workspace for the operator-facing `cealctl` binary.

`@corca-ai/ceal` names only the client SDK. It does not contain the CLI,
Agent runner, Gateway server, or an umbrella SDK.

The two commands deliberately have separate help, command registries,
credential-context identifiers, and package archives. `ceal` does not contain
operator or credential-management commands. `cealctl` does not contain worker
capability calls or worker profile access.

Both commands use conventional text only for progressive `--help` discovery.
Every non-help result, including parser failures, is exactly one compact YAML
document. The public commands reject `--json` and `--format json`; typed callers
use `@corca-ai/ceal`, whose HTTP wire remains JSON.

The repository also owns two Agent Skill packages under `skills/`:
`ceal-guide` for worker capability use and `cealctl-guide` for operator/control
work. They teach a help-driven method and deliberately contain no copied command,
target, integration, instance, or release catalog.

## Local closure proof

From a generated candidate checkout:

```sh
npm ci
npm run check
```

The repository extraction verifier additionally packs all four packages,
installs them into an isolated consumer, runs only the installed binaries, and
scans the archives for private paths and cross-command implementation. Its
cold-start guide test receives only each guide and the built matching binary,
then discovers a read-only route through help and parses its YAML result.

## Outbound Gateway discovery

`ceal capabilities` remains a local unavailable-state readback when no Gateway
connection options are supplied. For the first remote acceptance path, it can
perform an outbound-only authenticated handshake and capability discovery:

```sh
read -r -s CEAL_TOKEN
printf '%s\n' "$CEAL_TOKEN" | ceal capabilities \
  --endpoint https://gateway.example.test/api/ceal/v1 \
  --profile profile:narnia \
  --request-id narnia:acceptance:001 \
  --token-stdin
unset CEAL_TOKEN
```

The token is accepted only through stdin and is never rendered in YAML. Remote
plain HTTP is rejected; HTTP is allowed only for loopback tests. The command
opens the request from the client to Gateway and requires no listening port on
the worker machine. This surface proves handshake/discovery only: it does not
yet import a persistent local profile, pull runner jobs, execute a provider
action, or reach production audit custody.

## Native platform builds and first release lane

Native local builds support `linux-arm64` and `linux-amd64`; each build must run
on its target architecture and cross-architecture output is refused. After
`npm ci` and `npm run check`, build both standalone Node SEA commands from the
same source tree, selecting the current host platform:

```sh
npm run release:binaries -- \
  --version 0.64.0 \
  --platform linux-amd64 \
  --out dist \
  --json
```

The builder emits `ceal-<platform>`, `cealctl-<platform>`, one platform release
manifest, the bundled dependency notice, and `SHA256SUMS`. It
smoke-runs both commands before returning success, including discovery of the
worker `profiles`/`capabilities` and operator `enrollments` workflow commands.
Before calling transferred artifacts ready, compare both installed checksums to
the exact platform build output and run both `ceal commands` and `cealctl
commands`; a version string alone does not distinguish two unpublished
candidate builds. Node 22.19 or newer is a
build input; the installed SEA commands do not require Node. This local
`linux-amd64` result is an unsigned acceptance artifact, not an approved release.
The first signed tag workflow remains deliberately `linux-arm64` only and
packages one checked compiled candidate through two isolated SEA assembly runs
in an unprivileged job, requires identical outputs,
and hands the exact set to a separate protected release job. That job signs
each of the five primary assets with GitHub Actions OIDC and uploads them with
their signature and certificate sidecars to a draft release. The legacy
`cealctl-release.yml` filename is retained because it is part of the signing
identity verified by the installer.

The privileged job is gated by the `ceal-cli-release` environment. Its
`CEAL_CLI_APPROVED_COMMIT` variable must equal the tagged commit and
`CEAL_CLI_APPROVED_SHA256SUMS_SHA256` must equal the approved digest of the
unprivileged build's `SHA256SUMS`. A non-empty draft is reused only when its
full 15-file primary/sidecar inventory and remote bytes/signatures verify. A
partial or unexpected draft fails with an explicit delete/recreate instruction
instead of overwriting assets.

### Install or update both commands

The installer supports Linux arm64 and requires a POSIX shell, `cmp`, `curl`,
`cosign`, `flock`, `sha256sum`, `mktemp`, `readlink`, `uname`, and standard Linux
userland. Pin an explicitly approved
dual-binary tag; before the first such release, GitHub's `latest` pointer may
still identify a legacy `cealctl`-only release. The installer therefore rejects
an omitted `CEAL_VERSION` instead of resolving `latest`.

```sh
CEAL_VERSION=v0.64.0 sh ./install.sh
```

The default command directory is `$HOME/.local/bin`; it must be on `PATH`.
Set `CEAL_INSTALL_DIR` to use another user-owned directory. System-wide or
privileged installation is not supported. The installer preserves an existing
directory's mode and unrelated files.

`install.sh` downloads the five signed primary files plus sidecars, constrains
the signing identity to this repository, workflow, issuer, and tag, validates
the exact signed checksum inventory, checks both binary digests, and smoke-runs
both commands. It installs the pair into one versioned generation and switches
one shared `current` pointer under an exclusive lock. Rerunning with another
approved `CEAL_VERSION` updates both commands together; a verification failure
or interrupted pointer switch preserves the previous generation. A successful
update retains the previous generation locally, but automatic rollback is not
performed. Reinstall an explicitly approved earlier dual-binary tag to roll
back. Legacy `v0.1.1` is not a dual-binary rollback. One-command and unsigned
installation are unsupported.

## Release boundary

The npm publication set is exactly `@corca-ai/ceal-protocol` and
`@corca-ai/ceal`. The worker and operator CLI workspaces are private build
inputs for the signed standalone binaries and must never be published to npm.
Because npm cannot use staged publishing to create a new package, the first
`0.64.0` pair requires a maintainer's direct 2FA bootstrap under the temporary
`bootstrap-0-64-0` tag, protocol first and client second. Registry readback of
both exact package versions is required before moving a dist-tag.

Later versions use `.github/workflows/npm-package-stage.yml`, the protected
`ceal-npm-release` environment, and npm trusted publishing with OIDC. That
workflow stages only the two public packages under a version-specific
non-default tag. Promotion remains a separate human-2FA decision after exact
registry readback. The protected environment must bind the exact Protocol and
Client tarball SHA-256 values as well as commit and version. The workflow stages
those exact tarballs and preserves its inputs and stage output even when the
second package fails.

Before approval, a maintainer uses `npm stage list`, `npm stage view`, and
`npm stage download` to verify both stage IDs and downloaded tarballs against
the preserved pair. Approve only when both exact stages exist. If only Protocol
was staged, either repair and stage the exact Client or reject the orphan with
2FA before rerunning; never promote a one-package state. Trusted-publisher
tokens intentionally cannot perform this human readback/recovery lane. npm
versions are immutable; post-publication recovery is an additive patch or
dist-tag correction, not an unpublish plan.

The release surfaces have distinct jobs:

| Surface | Producer | Meaning | Consumer |
| --- | --- | --- | --- |
| `release-contract.json` | source maintainers | package, protocol, platform, and blocker intent | builders and reviewers |
| npm release manifest | `build-release-manifest.mjs` | local npm archive names and digests | package closure review |
| platform release manifest | platform builder | lifecycle-neutral SEA names and digests | release audit/readback |
| `ceal-cli-seed-manifest.json` | extraction preparation | public distribution-source inventory | extraction composition verifier |

The signed platform manifest is audit/readback metadata, not an independent
installer authorization oracle; the installer authorizes the fixed release set
through tag-bound signatures, exact signed checksums, and binary smoke. None of
these surfaces alone proves an upload, publication, or installation. After the two
CLI archives are built, generate their digest-bearing local manifest with:

```sh
node scripts/build-release-manifest.mjs \
  --out <dir> \
  --artifact ceal=<worker-cli.tgz> \
  --artifact cealctl=<operator-cli.tgz> \
  --json
```

The builder reads `package/package.json` from each npm tarball and rejects a
package name, version, or single-command `bin` mismatch before recording the
digest. That identity check does not replace the closure verifier's pre-extract
archive safety, full text/content, dependency, install, and command checks.

This source candidate is MIT-licensed but is not a release or publication
claim. The exact first-party license is in `LICENSE`; locked build/development
dependency attribution is in `THIRD_PARTY_NOTICES.json`. Executed
signature/release proof, additive public-source push, and release publication
remain explicit blockers. The existing `v0.1.1` tag and
release are observed legacy `cealctl`-only distribution pointers, not immutable
dual-binary rollback refs. Source rollback is separate from installed-command
rollback. It is a normal additive revert to immutable commit
`f458a0bce291123644c84efdbeb48d5255a74c64`; a future dual-binary release needs
its own immutable artifact and rollback evidence.
