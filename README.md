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

No signed release, installer, tag, or GitHub workflow in this repository is
currently the worker-only release route. The historical dual `install.sh`,
`release:binaries`, `release:manifest`, bare `v*` tags, and
`.github/workflows/cealctl-release.yml` remain frozen compatibility material.
Do not execute, amend, publish, or use them to install either command from this
checkout.

The local worker preflight accepts an exact Gateway handoff only through
`release:worker:inputs` and `release:worker:package`. It requires the Protocol
tarball, its Gateway provenance sidecar, the enclosing handoff manifest, and a
caller-supplied SHA-256 of that manifest. The caller-supplied digest binds the
exact received packet; it does not authenticate its sender. The package command
then makes an isolated packed `ceal` consumer candidate containing no
`cealctl`, operator guide, copied Protocol source, tag, installer, or signing
claim.

A future signed worker route will add a worker-specific `ceal-v*` tag namespace,
workflow, asset allowlist, and installer. It must keep consuming a
Gateway-issued Protocol artifact rather than any local Protocol source.

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
