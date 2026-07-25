# Ceal CLI source candidate

This tree is the local source candidate for the private `corca-ai/ceal-cli`
repository. It is a transitional composite: its current source authority is the
public `@corca-ai/ceal` client SDK and the agent-facing `ceal` worker.

## Ownership status

- `corca-ai/ceal-cli` owns `@corca-ai/ceal`, `@corca-ai/ceal-worker-cli`, and
  `skills/ceal-guide`.
- `corca-ai/ceal` owns `@corca-ai/ceal-protocol`, `cealctl`, `cealctl-guide`,
  their release/install contract, and canonical conformance.
- The protocol, `packages/ceal-operator-cli`, and `skills/cealctl-guide` paths
  remaining here are frozen compatibility inputs until the migration ledger's
  Stage 5 deletion gate. Do not add a Gateway/operator feature, release
  surface, guide, or command to them; consume the Gateway-issued artifact.

The workspace still contains four historical package directories so packed
consumer and deletion gates can be proved:

- `@corca-ai/ceal-protocol`: frozen Gateway compatibility input;
- `@corca-ai/ceal`: the public client SDK and Gateway-neutral request transport;
- `@corca-ai/ceal-worker-cli`: the private build workspace for the agent-facing
  `ceal` binary;
- `@corca-ai/ceal-operator-cli`: frozen Gateway operator compatibility input.

A worker source build consumes only a supplied packed Gateway protocol artifact.
Run `node scripts/verify-gateway-protocol-consumer.mjs --help` for that local,
no-network consumer proof.

`@corca-ai/ceal` names only the client SDK. It does not contain the CLI, Agent
runner, Gateway server, or an umbrella SDK.

The historical composite kept the two commands deliberately separate: distinct
help, command registries, credential-context identifiers, and package archives.
That separation remains compatibility evidence, not permission to make this
worker repository a `cealctl` producer. `ceal` does not contain operator or
credential-management commands; the frozen `cealctl` package does not contain
worker capability calls or worker Session material.

Both command surfaces use conventional text only for progressive `--help`
discovery. Every non-help result, including parser failures, is exactly one
compact YAML document. The public commands reject `--json` and `--format json`;
typed callers use `@corca-ai/ceal`, whose HTTP wire remains JSON.

Capability discovery and invocation are provider-neutral contracts. `ceal
capabilities` exposes the active Profile's current capability contracts,
readiness, recovery, and a bounded target-catalog summary; it intentionally
does not dump a target inventory. The default output is concise (id, label,
effect, and target requirement per capability); pass `--detail` to include each
capability's full `input_contract`. `ceal capabilities targets --capability
<capability-id> --match <text-or-url>` returns a bounded, current selection of
opaque target references. Neither surface exposes Slack, GitHub, Notion, another
provider's credential kind, API mode, or internal connector binding. `ceal call
<capability-id> --target <target-ref> [key=value ...]` forwards only that
discovered vocabulary without requiring a new top-level CLI command or
client-side provider grammar. The Gateway validates capability input, Profile
scope, and connector execution; the client preserves a bounded generic wire
envelope and rejects secret or authority material. Successful calls use a
compact result envelope with primary data and verified readback identity. Rich
audit evidence is read only on demand so agents do not infer completion from an
exit code alone.

`ceal observe` serves the loopback-only (`127.0.0.1`, Host-header guarded)
read-only Workbench page and JSON endpoint over the client's cached local
state. The page's first navigation keeps the masterplan's two views
deliberately separate — **My agent work** (the agent-runtime activity below)
and **Ceal** (session, capability cache, install, guide, receipts) — plus a
**Privacy & retention** view that declares the local sources this client
reads, the receipt-spool retention bounds, and the fixed no-forwarding
boundary (`gateway_forwarding: none`, `provider_contact: none`). The state
covers:
session identity with token material structurally redacted, the cached
capability/target catalog with its age and TTL, the managed install
generation, agent-guide registration, and the local receipt spool. It performs
no Gateway or provider contact. The receipt spool is an owner-only, size- and
retention-bounded record of each receipt-bearing `ceal call` outcome as an
allowlisted metadata projection (request/audit references, capability, target,
status, evidence, safe error kind) — never call arguments, purpose text,
provider payloads, or token material. It is advisory client evidence for the
local Workbench view; the Gateway audit ledger stays authoritative through
`ceal receipt show`, and a spool failure never changes call behavior.

The observer also renders a read-only agent-runtime audit view (`ceal-audit`):
the Claude adapter lists sessions under `~/.claude/projects` and the Codex
adapter lists rollouts under `~/.codex/sessions` by identity, recency, and
size with collector health (`active`/`stale`/`inactive`/`unknown`) and
coverage `transcript-observed`. The newest three sessions per adapter
additionally carry a bounded event summary (`session_events` depth): lines are
parsed locally under fixed byte/line budgets, but only fixed-vocabulary kind
counts, integer totals, and re-serialized timestamps surface — transcript
content, prompts, and tool arguments never do, truncation and unreadable
transcripts are always declared, and remaining sessions stay inventory-only
until an explicit per-session drill-down (`/api/observer/v1/agent-session/…`)
runs the same bounded scan on demand; the ref is grammar-validated and never
joined into a path. When a runtime's own transcript supplies token accounting
(Claude per-request `message.usage`, Codex cumulative `token_count`), the
event summary adds per-session token figures that name their source and scan
completeness; an unsupplied field or session is omitted, never rendered as
zero, figures are not comparable across runtimes, and no latency figure is
derived because neither runtime supplies one.
**My agent work** also lists local suggestions:
deterministic rules over the rendered sections (stale collector, missing
capability cache, repeated non-completed calls, unknown-outcome receipts),
each linked to its observed evidence and never a model judgment.
Neither adapter's coverage claim generalizes to the other, and nothing is
forwarded to the Gateway in this stage.

Provider-specific richness belongs behind the customer Gateway adapter. For
example, a Slack adapter may use indexed search, ranked results, and thread
replies, but the public client neither reimplements that behavior nor turns it
into a Slack command. The Gateway authorizes active Profile membership and the
Profile-owned connector scope before it reaches that private adapter; provider
token kinds are execution details, never authorization concepts. A less capable
connector must advertise `degraded` readiness rather than impersonating a
richer path.

## Local closure proof

From a generated candidate checkout:

```sh
npm ci
npm run check
```

The composite extraction verifier still packs all four historical packages,
installs them into an isolated consumer, and scans the archives for private
paths and cross-command implementation. It remains deletion-gate evidence only;
it is not a worker-release builder.

## Worker release boundary

`.github/workflows/ceal-release.yml` is the worker-only release route: a
`ceal-v*` tag builds the asset set per platform from the locked Gateway
handoff archive, merges one exact inventory, signs every asset with cosign
keyless, and publishes the exact bytes to the worker static origin. GitHub is
the source and tag-bound OIDC signer identity; it is not a release artifact
origin. A successful tag run promotes that verified release to the stable lane
(`CEAL_VERSION=stable` / `ceal update`) by rotating
`releases/worker/stable/ceal-worker-stable-release.json` last.
The historical dual `install.sh`, `release:binaries`,
`release:manifest`, bare `v*` tags, and
`.github/workflows/cealctl-release.yml` remain frozen compatibility material.
Do not execute, amend, publish, or use them to install either command from
this checkout.

### Installing the worker

```sh
curl -fsSL https://ceal.borca.ai/releases/worker/stable/install-ceal.sh \
  | CEAL_VERSION=stable sh
```

The installer needs only `curl`, `awk`, and the usual POSIX text tools, all of
which a stock Linux or macOS host already has; it bootstraps a pinned `cosign`
when one is absent. There is no Python, Node, or package-manager prerequisite,
and `ceal` itself is a standalone binary.

Worker distribution is the worker-owned static-origin prefix
`https://ceal.borca.ai/releases/worker/` — never the Gateway-owned
`releases/gateway/`. Each signed release set is published under
`releases/worker/<tag>/`, and `CEAL_VERSION=stable` resolves
`releases/worker/stable/ceal-worker-stable-release.json`
(`ceal.worker_stable_release.v1`: the stable tag plus the SHA-256 of that
tag's `SHA256SUMS`, which the installer re-checks against the downloaded
signed inventory). Promotion rotates that pointer together with the bootstrap
copy `releases/worker/stable/install-ceal.sh` used above; the stable lane
re-verifies every asset — including `install-ceal.sh` itself — from the
versioned prefix. Until the first stable worker tag is published, these stable
URLs 404; install an explicit published static tag instead:

```sh
curl -fsSL https://ceal.borca.ai/releases/worker/ceal-v0.65.3/install-ceal.sh \
  | CEAL_VERSION=ceal-v0.65.3 sh
```

As with any `curl | sh` installer, this initial bootstrap deliberately trusts
the TLS-authenticated release origin for the shell script. Cosign verification
begins before any worker executable is accepted; the bootstrap script itself
is re-verified as a signed versioned asset during installation. Supported platforms: `linux-arm64`,
`linux-amd64`, `darwin-arm64`, `darwin-amd64`. The installer verifies every
asset against its cosign keyless identity and the signed `SHA256SUMS`
inventory before an atomic generation switch under
`$CEAL_INSTALL_DIR/.ceal-cli/worker/` (default `~/.local/bin`), and the
installed `ceal update` re-runs the release-staged installer stable-only.
The tagged CI lane is configured to build and sign all four platforms; no
four-platform tag has been published yet. A Mac checkout
can still produce an unsigned local candidate for diagnosis
([docs/macos-worker-runbook.md](docs/macos-worker-runbook.md)), but the
installer fail-closes on it, so it is never an install or acceptance path.

`release:worker:inputs`, `release:worker:package`, and
`release:worker:native` accept exactly one `--gateway-handoff-archive`
argument. The archive must match a source-reviewed
`gateway-handoff-lock.json`, contain the exact six-file Gateway packet, and is
copied into a private temporary directory before its bytes are checked and it
is extracted. The release commands reject the former six raw file/digest
arguments, so a caller cannot replace the reviewed archive binding with a
caller-selected digest.

The committed `gateway-handoff-lock.json` pins the Gateway
repository/workflow, tag, commit/tree, Actions run and artifact name, archive
SHA-256, and embedded handoff-manifest SHA-256 for the one consumable archive.
The archive must contain exactly the marker, two package tarballs, manifest,
conformance proof, and Protocol provenance; it is extracted only into a
disposable directory for the preflight/package/native operation, and every
release command fails closed on any mismatch. The explicit
`*FromDevelopmentInputs` APIs remain test/development seams for assembling and
validating a raw local packet; they are not exposed through a release command,
do not authenticate a sender, and do not establish release readiness. This
local archive consumer does not download Actions artifacts or claim cosign
verification; the release workflow re-verifies the archive digest against the
lock before building.

The retired raw-input `worker-release:build` command is not an alternate
release route. Its implementation remains an import-only development/test
module and exits nonzero if invoked as a program.

The package command makes an isolated packed `ceal` consumer candidate; the
native command builds one host-native `ceal` executable from that internal
packed consumer (on macOS the Mach-O signature is removed before SEA
injection and ad-hoc re-signed after); and `release:worker:assets compose`
turns one native candidate into the installer-facing per-platform set —
`ceal-<platform>`, `ceal-worker-release-manifest-<platform>.json`, the signed
guide, notices, `install-ceal.sh`, and a checksum inventory — while
`release:worker:assets merge` combines per-platform sets into the one exact
release inventory (shared assets byte-identical, every platform a complete
binary+manifest pair; a platform never shares another platform's manifest).
Neither path may contain `cealctl`, an operator guide, copied Protocol
source, or a tag/signing claim outside the release workflow.

Gateway operators must obtain `cealctl`, its guide, installation/update path,
and operational instructions from the Gateway-owned `corca-ai/ceal` source. The
authoritative migration constraints are in its
`docs/specs/gateway-operator-cli-ownership-cutover.spec.md`; a worker release
must not derive operator behavior from the compatibility paths retained here.

This candidate is MIT-licensed but is not a release or publication claim. The
first-party license is in `LICENSE`; locked build/development dependency
attribution is in `THIRD_PARTY_NOTICES.json`. No tag, signed artifact, registry
publication, installed command, Gateway update, or provider action is proven by
the local closure checks above.
