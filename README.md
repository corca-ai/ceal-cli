# Ceal CLI source candidate

This tree is the local source candidate for the private `corca-ai/ceal-cli`
repository. It is a transitional composite: its current source authority is the
public `@corca-ai/ceal` client SDK and the agent-facing `ceal` worker.

## Ownership status

- `corca-ai/ceal-cli` owns `@corca-ai/ceal`, `@corca-ai/ceal-worker-cli`, and
  `skills/ceal-guide`.
- `corca-ai/ceal` owns `@corca-ai/ceal-protocol`, `cealctl`, `cealctl-guide`,
  their release/install contract, and canonical conformance.
- The cealctl surface reached the migration ledger's Stage 5 deletion gate and is
  gone from this tree. It was not compatibility material by then, it was a stale
  fork: `corca-ai/ceal` carried two source files this copy never had and six that
  differed, had rewritten the operator guide wholesale under
  `packages/official-skills`, and had moved the installer to
  `packaging/cealctl/install-cealctl.sh`. What went with it —
  `packages/ceal-operator-cli`, `skills/cealctl-guide`, `install.sh`,
  `release-contract.json`, `ceal-cli-seed-manifest.json`,
  `scripts/build-platform-binaries.mjs`, `scripts/build-release-manifest.mjs`,
  `.github/workflows/cealctl-release.yml`, and the `test:legacy-compatibility`
  suite that existed to audit them. Do not re-vendor any of it; read
  `corca-ai/ceal`.
- `packages/ceal-protocol` is the one frozen input left. Do not add a
  Gateway/operator feature, release surface, guide, or command to it; consume the
  Gateway-issued artifact and re-pin.

`protocol-vendor-pin.json` records the Gateway commit and `packages/ceal-protocol`
subtree the frozen protocol copy was taken from, alongside the protocol subtree
inside the locked handoff archive a release consumes. `node
scripts/verify-protocol-vendor-pin.mjs` binds the three offline, and both
failures are fatal: the copy drifting from its recorded source, and a divergence
between the copy and the shipped archive. The second fails
`proof_shipment_protocol_divergence`, because it means what this repository tests
is not what a release would ship. A divergence may still be declared — naming a
disposition owner and a tracked request under `docs/requests/` — but a
declaration is a quarantine, not a clearance, and re-syncing the copy or bumping
`gateway-protocol-handoff-lock.json` expires it. `npm run check:protocol-dev` is the
development-only path that keeps working meanwhile; it proves nothing about a
release or an installed worker and says so in its own output.

The check reaches no remote, so it cannot see the copy falling behind its owner,
and `source.commit` is a recorded observation rather than a locally verified one
— confirming it needs the owner checkout. `shipped.protocol_tree` is no longer in
that category: the signed protocol handoff declares the producer's protocol
subtree and the lock records it. The
divergence verdict compares `source.commit` against the lock's `gateway.commit`
rather than the pin's two tree fields, so it is not computed entirely from
author-written values — but `source.commit` is still self-recorded, which makes a
divergence detectable without making convergence observable.

The worker workspace contains exactly the three packages that the worker
release builds. The frozen operator directory used to sit beside them, outside
dependency installation and worker CI so that a worker protocol update could
never make `npm ci` resolve the old operator's independently frozen protocol
pin. It is deleted now, and `repo-gates.test.mjs` asserts its absence rather
than its exclusion.

- `@corca-ai/ceal-protocol`: frozen Gateway compatibility input;
- `@corca-ai/ceal`: the public client SDK and Gateway-neutral request transport;
- `@corca-ai/ceal-worker-cli`: the private build workspace for the agent-facing
  `ceal` binary.

A worker source build consumes only a supplied packed Gateway protocol artifact.
Run `npm run verify:protocol-consumer -- --help` for that local, no-network
consumer proof.

`@corca-ai/ceal` names only the client SDK. It does not contain the CLI, Agent
runner, Gateway server, or an umbrella SDK.

The historical composite kept the two commands deliberately separate: distinct
help, command registries, credential-context identifiers, and package archives.
That separation is now a repository boundary rather than a convention, and it is
not permission to make this worker repository a `cealctl` producer. `ceal` does
not contain operator or credential-management commands.

The command surface uses conventional text only for progressive `--help`
discovery. Every non-help result, including parser failures, is exactly one
compact YAML document. The public commands reject `--json` and `--format json`;
typed callers use `@corca-ai/ceal`, whose HTTP wire remains JSON.

Prefix a public command with `--timing` when diagnosing latency, for example
`ceal --timing capabilities --fresh`. The result remains the same single YAML
document on stdout; stderr receives `ceal.timing.v1` JSON Lines for fixed client
phases such as bootstrap, runtime import, session load/lock/refresh, Gateway
handshake/call/readback, observer scan, receipt-spool tail, and update stages.
Events contain only sequence, stage, monotonic elapsed time, and a fixed outcome
— never endpoints, identity references, request references, payloads, tokens, or
free-form errors. Ordinary invocations emit no timing events.

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
state. Its Overview counts the timestamp-only projection of every outcome still
present in the bounded local receipt spool while detailed receipt rows remain
limited to the newest subset. The timestamps are local receipt-record times, not
exact call-occurrence times; retention, dropped history, and local/advisory
authority stay visible. Correlated Agent work and monetary cost remain
explicitly unsupported because the current producers supply neither a
work-to-call relationship nor monetary cost; the page never joins by timestamp
or estimates currency from tokens. The Overview summarizes status and capability
labels only over the newest detailed receipt rows and labels that narrower basis;
the full retained timestamp projection remains the sole source for the activity
count. The Agent activity view summarizes session, event, and token-evidence
coverage per runtime without making a cross-runtime total or ranking. **Ceal
evidence** and **Setup & privacy** remain separate views. The latter declares the local
sources this client reads, the receipt-spool retention bounds, and the fixed
no-forwarding boundary (`gateway_forwarding: none`, `provider_contact: none`).
The state covers:
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

The real-browser proof is a maintainer-only verification surface. After normal
dependency installation, install its pinned Chromium build once and run the
proof:

```sh
npx playwright install chromium
npm run test:browser
```

The proof uses throwaway Agent roots plus a content-free synthetic populated
fixture. It checks first-load evidence wording, bounded detail versus retained
activity, mixed adapter coverage, view switching, independent theme/color
controls, a narrow viewport, and loopback-only requests. It is not part of the
shipped worker dependency graph and reads no real Agent state.

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
npm run hooks:install   # once per clone: points core.hooksPath at .githooks/
npm run check
```

`npm run check` is the final worker proof gate: lint, build, then every
worker-owned suite. Most of its wall clock is the release-artifact and
native-binary suites, which cannot observe CLI or client behavior. While
iterating, use the fast lane and keep the full gate for the last run before
pushing or tagging:

```sh
npm run check:unit   # lint + worker build + client/worker suites + test/contract
npm run test:release # release-artifact and native-binary suites only
npm run lint         # biome check: lint + format + import order
```

`npm run hooks:install` wires a `pre-push` hook that runs the iteration gate, or
the full gate for a tag push — a failed release tag cannot be reused.
`.github/workflows/check.yml` runs the full gate on every push and pull request
to `main` that changes code; a documentation-only change runs no gate, because
nothing its allowlist admits reaches a release input or a suite. The other
workflows are release lanes and trigger only on tags.

`npm run lint` runs `biome check .`, so formatting and import order are gated
rather than merely suggested; `npm run lint:fix` applies every safe fix. The
frozen packages are excluded on purpose. Formatting-only commits are listed in
`.git-blame-ignore-revs` so `git blame` skips them, which `npm run hooks:install`
configures for the clone.

Probing an installed surface is a read-only question, so route it through the
declared-effect guard rather than typing the binary at your own `HOME`:

```sh
npm run probe -- ceal capabilities targets --help
npm run probe -- ceal receipt show --help
```

The guard resolves the route through the same declaration help renders from,
refuses any route whose declared effect is not `read_only`, and runs in a
throwaway `HOME`. `--allow-effect <effect>` opts into a declared *local* write
while keeping the isolation; nothing in the guard can reach real local state.

The effect vocabulary names remote change as well as local: `remote_write` is a
route that may change the Gateway or a provider. It covers provider calls,
state-changing session leaves, and read routes that may first rotate an expired
Gateway session (`capabilities`, `receipt`, and `acceptance`). `--allow-effect`
refuses it, because the throwaway `HOME` is what makes
the hatch safe and it neutralizes local state only. It is what a route *may* do,
not what one invocation does: `call` is `remote_write` even for a capability
whose own effect is `read`.

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
The historical dual lane — `install.sh`, `release:binaries`, `release:manifest`,
and `.github/workflows/cealctl-release.yml` — is deleted. Bare `v*` tags now
belong solely to `.github/workflows/npm-package-stage.yml`, which stages
`@corca-ai/ceal-protocol` and `@corca-ai/ceal` to npm. To install `cealctl`, use
`corca-ai/ceal`; nothing in this checkout installs it.

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
URLs 404; install an explicit published static tag instead. Read the tag to use
from the newest `ceal-v*` heading in [CHANGELOG.md](CHANGELOG.md) — this README
does not restate a release number, because a pinned example goes stale silently
and a stale pin installs a superseded release:

```sh
TAG=ceal-v<version>   # newest ceal-v* heading in CHANGELOG.md
curl -fsSL "https://ceal.borca.ai/releases/worker/$TAG/install-ceal.sh" \
  | CEAL_VERSION="$TAG" sh
```

As with any `curl | sh` installer, this initial bootstrap deliberately trusts
the TLS-authenticated release origin for the shell script. Cosign verification
begins before any worker executable is accepted; the bootstrap script itself
is re-verified as a signed versioned asset during installation. New releases target
`linux-arm64`, `linux-amd64`, and `darwin-arm64` (Apple Silicon). Existing Intel
macOS releases remain immutable historical artifacts but receive no new stable update.
The installer verifies every
asset against its cosign keyless identity and the signed `SHA256SUMS`
inventory before an atomic generation switch under
`$CEAL_INSTALL_DIR/.ceal-cli/worker/` (default `~/.local/bin`), and the
installed `ceal update` re-runs the release-staged installer stable-only.
The tagged CI lane is configured to build and sign these three platforms. A Mac checkout
can still produce an unsigned local candidate for diagnosis
([docs/macos-worker-runbook.md](docs/macos-worker-runbook.md)), but the
installer fail-closes on it, so it is never an install or acceptance path.

`release:worker:inputs`, `release:worker:package`, and
`release:worker:native` accept exactly one `--gateway-handoff-archive`
argument. The archive must match a source-reviewed
`gateway-protocol-handoff-lock.json`, contain the exact five-file Gateway
packet, and is copied into a private temporary directory before its bytes are
checked and it is extracted. The release commands reject the former five raw
file/digest arguments, so a caller cannot replace the reviewed archive binding
with a caller-selected digest.

The committed `gateway-protocol-handoff-lock.json` pins the Gateway
repository/workflow, tag, commit/tree/protocol-subtree, Actions run, release
origin, Protocol package digest, archive SHA-256, and embedded
handoff-manifest SHA-256 for the one consumable archive, plus the Sigstore
identity a maintainer verified it against.
The archive must contain exactly the marker, the Protocol tarball, manifest,
leased-consumer control conformance, and Protocol provenance; it is extracted only into a
disposable directory for the preflight/package/native operation, and every
release command fails closed on any mismatch. The explicit
`*FromDevelopmentInputs` APIs remain test/development seams for assembling and
validating a raw local packet; they are not exposed through a release command,
do not authenticate a sender, and do not establish release readiness. This
local archive consumer does not download Actions artifacts or claim cosign
verification; the release workflow re-verifies the archive digest against the
lock before building.


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
