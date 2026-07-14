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
capability calls or worker Session material.

Both commands use conventional text only for progressive `--help` discovery.
Every non-help result, including parser failures, is exactly one compact YAML
document. The public commands reject `--json` and `--format json`; typed callers
use `@corca-ai/ceal`, whose HTTP wire remains JSON.

Capability discovery and invocation are provider-neutral contracts. `ceal
capabilities` exposes stable capability/target references, input contracts,
the applied Profile Grant revision, and connector readiness; it does not expose
Slack, GitHub, Notion, another provider's credential kind, API mode, or internal
connector binding. `ceal call <capability-id> --target <target-ref>
[key=value ...]` forwards that discovered vocabulary without requiring a new
top-level CLI command. Known core capabilities receive stricter local and wire
validation, while a bounded generic envelope admits future manifest-defined
capabilities without weakening secret and raw-provider-reference rejection.
Successful calls use `ceal.result.v1`, including identity, authorization,
evidence, claim, audit, redaction, usage, data, and error fields so agents do not
infer completion from an exit code alone.

Provider-specific richness belongs behind the customer Gateway adapter. For
example, a Slack adapter may use indexed search, ranked results, and thread
replies, but the public contract reports only neutral coverage semantics. The
Gateway authorizes the subject's active Profile membership and explicit target
Grant before it reaches that private adapter; provider token kinds are execution
details, never authorization concepts. A less capable connector must advertise
`degraded` readiness and incomplete coverage rather than impersonating the
richer path.

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

## Install a signed release

The installer supports Linux arm64 (`aarch64`/`arm64`) and amd64
(`x86_64`/`amd64`) and selects the native pair automatically. It requires a
POSIX shell, `cmp`, `curl`, `cosign`, `flock`, `sha256sum`, `mktemp`,
`readlink`, `uname`, and standard Linux userland. Install and verify `cosign`
using the [official Sigstore instructions](https://docs.sigstore.dev/cosign/system_config/installation/),
then acquire the tag-bound installer as a signed release asset:

```sh
VERSION=v0.64.0
BASE="https://github.com/corca-ai/ceal-cli/releases/download/$VERSION"
for asset in install.sh install.sh.sig install.sh.pem; do
  curl -fsSLO "$BASE/$asset"
done
cosign verify-blob \
  --certificate install.sh.pem \
  --signature install.sh.sig \
  --certificate-identity "https://github.com/corca-ai/ceal-cli/.github/workflows/cealctl-release.yml@refs/tags/$VERSION" \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  --certificate-github-workflow-repository corca-ai/ceal-cli \
  --certificate-github-workflow-ref "refs/tags/$VERSION" \
  install.sh
CEAL_VERSION="$VERSION" sh ./install.sh
ceal version
cealctl version
cealctl login --help
```

An omitted `CEAL_VERSION` is rejected rather than resolving GitHub's mutable
`latest` pointer. The default command directory is `$HOME/.local/bin`; it must
be on `PATH`. Set `CEAL_INSTALL_DIR` for another user-owned directory.

## Operator login and outbound Gateway use

An operator authenticates through the customer Gateway's same-origin browser
approval page. `cealctl` prints the verification URL and short-lived user code
to stderr while it waits, then stores only the resulting renewable operator
session in an owner-only local file. Enrollment creation refreshes that session
automatically; raw Admin API tokens are not CLI operands or stdin inputs.

```sh
cealctl login https://ceal.example.test/acme/production --session production
cealctl sessions
cealctl access show
cealctl access apply --stdin --dry-run < access.yaml
cealctl access apply --stdin < access.yaml
cealctl enrollments create \
  --client developer-laptop \
  --profile work \
  --subject developer \
  --instance production
```

`access.yaml` is one complete `ceal.gateway_access_registry.v1` document. It
contains a monotonic registry generation plus additive Profile Memberships,
client invitations, and capability/target Grants, but no connector, backend,
or provider credential fields. Active Memberships and Grants for one Profile
share a `profile_audience_revision`, making every audience expansion explicit.
The dry run reaches the Gateway and validates the replacement without writing;
the apply is atomic and rejects stale generations, stale record revisions,
revoked-record reactivation, or implicit record deletion.

The client invitation, subject, Profile membership, and target Grants must
already exist in that Gateway registry; enrollment cannot create authority. The
resulting one-time code is transferred privately to the worker machine and
exchanged through stdin using the exact Gateway endpoint printed by `cealctl`.
The worker profile then discovers and calls its granted capabilities without
endpoint or token flags:

```sh
read -rs CEAL_ENROLLMENT_CODE
printf '%s\n' "$CEAL_ENROLLMENT_CODE" | ceal session enroll \
  --gateway https://ceal.example.test/acme/production/api/ceal/v1 \
  --code-stdin
unset CEAL_ENROLLMENT_CODE
ceal capabilities
ceal call message.search --target target:team-inbox query=incident limit=3
```

Both operator and worker sessions rotate automatically and revoke server-side
before local logout. Every network request is client-initiated HTTPS, so a
worker behind a VPN or firewall needs outbound reachability to the Gateway but
no SSH access, listening port, or Gateway-initiated push. A successful call sets
`status: ok` and `claim.allowed: true` only after matching Gateway audit readback; whether it
reached a real provider depends on the Gateway's configured connector and is
reported explicitly in the result's proof and non-claims.

## Native platform builds and first release lane

Native local builds support `linux-arm64` and `linux-amd64`; each build must run
on its target architecture and cross-architecture output is refused. After
`npm ci`, run `npm run check` as the full source-quality gate, then build both
standalone Node SEA commands from the same source tree, selecting the current
host platform:

```sh
npm run release:binaries -- \
  --version 0.64.0 \
  --platform linux-amd64 \
  --out dist \
  --json
```

The release command removes ignored package build output and then compiles the
current checkout itself, so `dist/` state left by an earlier checkout cannot
enter the artifact.
The builder emits `ceal-<platform>`, `cealctl-<platform>`, one platform release
manifest, the bundled dependency notice, and `SHA256SUMS`. It
smoke-runs both commands before returning success, including discovery of the
worker `session`/`capabilities` and operator
`login`/`sessions`/`logout`/`access`/`enrollments` workflow commands.
Before calling transferred artifacts ready, compare both installed checksums to
the exact platform build output and run both `ceal commands` and `cealctl
commands`; a version string alone does not distinguish two unpublished
candidate builds. Node 22.19 or newer is a
build input; the installed SEA commands do not require Node. This local result
is an unsigned acceptance artifact, not an approved release.
The signed tag workflow builds both `linux-arm64` and `linux-amd64` on native
GitHub runners and packages each checked compiled candidate through two
isolated SEA assembly runs in an unprivileged job, requires identical outputs,
and hands both exact sets to an unprivileged assembly job. That job creates one
dual-platform checksum set, includes the tag-bound installer, uploads the exact
handoff, and reports its digest for review. The protected release job only
accepts that handoff, verifies the operator-approved commit and digest, signs
each of the nine primary assets with GitHub Actions OIDC, and uploads them with
their signature and certificate sidecars to a draft release. The legacy
`cealctl-release.yml` filename is retained because it is part of the signing
identity verified by the installer.

The privileged job is gated by the `ceal-cli-release` environment. Its
`CEAL_CLI_APPROVED_COMMIT` variable must equal the tagged commit and
`CEAL_CLI_APPROVED_SHA256SUMS_SHA256` must equal the approved digest of the
unprivileged assembly artifact's `SHA256SUMS`. The operator order is: inspect
the assembly job summary and exact downloadable handoff, set both environment
variables, then approve the protected job. A non-empty draft is reused only
when its full 27-file primary/sidecar inventory and remote bytes/signatures verify. A
partial or unexpected draft fails with an explicit delete/recreate instruction
instead of overwriting assets.

### Installer update and rollback behavior

System-wide or privileged installation is not supported. The installer
preserves an existing directory's mode and unrelated files.

`install.sh` downloads the five signed primary files needed by the current
platform plus sidecars, constrains
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
