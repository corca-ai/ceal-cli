# ceal-cli

Source repository for the agent-facing `ceal` worker, the `@corca-ai/ceal`
client SDK, and `skills/ceal-guide`.

Read the smallest truth surface that answers your question before widening
scope, and update it when reality changes it:

- [README.md](README.md) — ownership status and what each package directory is.
- [docs/handoff.md](docs/handoff.md) — current state, `Next Session` work,
  settled decisions, and the release lane.
- [docs/gates.md](docs/gates.md) — why the lint exemptions, the probe rule, and
  the route/dispatch table are shaped the way they are.
- [docs/release-and-enrollment.md](docs/release-and-enrollment.md) — the two
  standing procedures, step by step.
- [docs/operator-acceptance.md](docs/operator-acceptance.md) — what a maintainer
  can prove without a Gateway session, and what a release tag needs first.
- `worker-release-inputs.json`, `gateway-handoff-lock.json` — release and
  Gateway-contract inputs.

This file holds only the rules those surfaces do not already carry. A rule that
has grown an explanation belongs in one of them, with the rule left here.

## Host And Lane

Resolve the lane from `hostname`, never from a document's pronoun.

- `narnia` — the normal source-owner lane for **`corca-ai/ceal-cli`**: worker
  CLI, client SDK, `ceal-guide`, and the Claude and Codex guide hosts. Its
  checkout is `~/codes/ceal-cli`.
- `vinc` — the Gateway lane, reachable as `ssh oc`, checkout `~/ceal`. It owns
  Gateway routes, connector execution, Profile policy, audit/receipt custody,
  `cealctl`, canonical protocol/conformance, **and `corca-ai/ceal-agent`**.
  For the current repository-separation and internal-announcement initiative,
  `vinc` is also the integrated operating checkout for `corca-ai/ceal-cli` at
  `/home/ubuntu/ceal-cli`: it may implement, verify, commit, and publish that
  repository. This is an operating assignment, not a transfer of the package's
  source authority or a reason to edit Gateway-owned frozen inputs.

`ceal-agent` moved to `vinc` on 2026-07-27, after this lane had landed
`gateway-artifact-handoff.json` and its verifier there (through
`corca-ai/ceal-agent@474ac96`). That work is handed over, not a standing
responsibility: `~/codes/ceal-agent` here is a stale checkout of another lane's
repository, so do not commit or push from it. An `agent` change this lane
believes is needed is a request to `vinc`.

Handoff and goal documents are written by whichever host authored them, so
`this host` in `~/codes/ceal/docs/handoff.md` means **`vinc`**. Resolve every
such deictic reference against `hostname` before quoting a lane assignment, and
write host names rather than pronouns into any lane statement you author.

`oc:~/ceal` is another lane's working checkout carrying uncommitted work. Leave
notes there as new untracked top-level `*.md` files; do not edit, stage, commit,
clean, or rebase anything else.

## Frozen Paths

Frozen compatibility inputs owned by `corca-ai/ceal`:
`packages/ceal-protocol`, `packages/ceal-operator-cli`, `skills/cealctl-guide`,
and the historical dual release lane — `install.sh`,
`scripts/build-platform-binaries.mjs`, `scripts/build-release-manifest.mjs`,
bare `v*` tags, `.github/workflows/cealctl-release.yml`. Do not execute, amend,
or publish those compatibility release-lane files.

The worker source projection has been removed from `corca-ai/ceal`: Gateway now
consumes only the signed `vendor/ceal-cli` artifact. There is no mirrored
`packaging/ceal-cli-source/` path to keep synchronized and no Gateway source
copy to edit. This repository remains responsible for its own worker source,
worker quality gates, worker release workflow, and `ceal-v*` tags; the frozen
Gateway inputs above remain Gateway-owned compatibility material.

## Gates

- `npm run check:unit` is the worker-source iteration gate; `npm run check` is
  the final worker gate, and its worker release suite dominates its cost. Frozen
  Gateway compatibility tests run only through explicit
  `npm run test:legacy-compatibility`, never pre-push or CI. Prefer the narrow
  worker gate until closeout.
- Time a gate with `time npm run check` on the host in hand rather than quoting a
  figure from a document. The recorded numbers went stale unnoticed once already,
  and a stale figure makes an honest run look like a regression under the
  slow-test rule below.
- `npm run lint` is `biome check .` and runs inside both gates. Three rules are
  off on purpose and the frozen packages are excluded on purpose — read
  [docs/gates.md](docs/gates.md) before changing either.
- `.github/workflows/check.yml` runs the full gate on every push and pull request
  to `main`. Every other workflow is a release lane triggered only on tags, so
  none of them proves anything about a branch.
- `npm run hooks:install` points `core.hooksPath` at `.githooks/`, whose
  `pre-push` runs the iteration gate — or the full gate for a tag push, because a
  failed release tag cannot be reused. Run it once per clone;
  `node scripts/install-git-hooks.mjs --check` reports whether this clone is
  actually enforcing it.
- `protocol-vendor-pin.json` records which Gateway commit and subtree the frozen
  `packages/ceal-protocol` copy came from, and the gate fails when the copy moves
  without it. Re-sync and re-pin in one commit. A proof/ship divergence is
  **fatal** (`proof_shipment_protocol_divergence`) and blocks release, packing,
  and acceptance-packet paths on its own; it may still be declared with an owner
  and a tracked request under `docs/requests/`, but a declaration quarantines
  rather than clears, and re-syncing the copy or bumping the handoff lock expires
  it. `npm run check:protocol-dev` is the development-only path while it fails,
  and its output is not release or installed-worker proof. The check reaches no
  remote, so it says nothing about the copy falling behind its owner —
  [docs/gates.md](docs/gates.md) says what it does and does not cover.
- `npm run probe` is the only sanctioned way to poke an installed surface, and it
  refuses any route that is not `read_only`. A live readback against the real
  session is a different act — see [docs/gates.md](docs/gates.md).
- Worker routes and their dispatch both derive from `CEAL_SUBCOMMANDS`, so a
  route without a handler is a `tsc` failure. Do not reintroduce a fallthrough
  `else`, and do not remove either half of the pair of gates that keeps the type
  check honest — [docs/gates.md](docs/gates.md) says why.
- Run state-changing commands (commit, push, tag, publish) without output filters
  and read the exit code before retrying. Pipe-trimming is for read-only output.

## Boundaries

- Commit locally by default with an intent-focused subject. Ask before any push,
  tag, GitHub write, Gateway write, or release publish; approval for one of them
  does not carry to the next. The release and re-enrollment procedures those
  approvals gate are in
  [docs/release-and-enrollment.md](docs/release-and-enrollment.md).
- **Spawn subagents without asking.** The operator's authorization is standing,
  so a runtime default of "only on request" does not apply here — do not spend a
  turn confirming one. This is what makes a mandated fresh-eye review real: a
  review the author runs on their own work is not one. It is an authorization,
  not a quota, and a subagent is still the wrong tool for a lookup you can do in
  one read. What delegation does not transfer is trust: a subagent's finding is
  a claim to verify, and this lane has already had a review state a verdict it
  could not actually reach, because the agent had no `Bash` to diff against
  `HEAD`. Check what it could see before quoting its conclusion.
- Treat unexpectedly slow tests as suspicious and fix the test shape in the same
  slice when the cost is local; record an unavoidable slow gate as explicit debt
  with its command and elapsed time.
- Name the highest proof level actually reached. A passing local test is not
  released-binary proof, and a released binary is not a live provider readback.

## Conventions

- Speak to the operator in Korean unless they ask otherwise. Keep repo docs in
  English except `docs/handoff.md`.
- In `zsh`, never use `path` or `status` as a scratch or loop variable — both are
  tied to shell state. An unquoted parameter is also not word-split, so build
  multi-argument probes as arrays or `${=var}` rather than one bare string.
