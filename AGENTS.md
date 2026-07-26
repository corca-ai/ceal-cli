# ceal-cli

Source repository for the agent-facing `ceal` worker, the `@corca-ai/ceal`
client SDK, and `skills/ceal-guide`.

Read the smallest truth surface that answers your question before widening
scope, and update it when reality changes it:

- [README.md](README.md) — ownership status and what each package directory is.
- [docs/handoff.md](docs/handoff.md) — current state, `Next Session` work,
  settled decisions, and the release lane.
- `worker-release-inputs.json`, `gateway-handoff-lock.json` — release and
  Gateway-contract inputs.

This file holds only the rules those surfaces do not already carry.

## Host And Lane

Resolve the lane from `hostname`, never from a document's pronoun.

- `narnia` — this lane. Worker CLI, client SDK, `ceal-guide`, and the Claude and
  Codex guide hosts. Local checkouts: `~/codes/ceal-cli`, `~/codes/ceal-agent`,
  and `~/codes/ceal` as a consumer/reference copy.
- `vinc` — the Gateway lane, reachable as `ssh oc`, checkout `~/ceal`. It owns
  Gateway routes, connector execution, Profile policy, audit/receipt custody,
  `cealctl`, and canonical protocol/conformance.

Handoff and goal documents are written by whichever host authored them, so
`this host` in `~/codes/ceal/docs/handoff.md` means **`vinc`**, not the host
reading it. Resolve every such deictic reference against `hostname` before
quoting a lane assignment or an ownership claim. Write host names, not
pronouns, into any lane statement you author.

`oc:~/ceal` is another lane's working checkout carrying uncommitted work. Leave
notes there as new untracked top-level `*.md` files; do not edit, stage, commit,
clean, or rebase anything else.

## Frozen Paths

`packages/ceal-protocol`, `packages/ceal-operator-cli`, and
`skills/cealctl-guide` are frozen compatibility inputs owned by `corca-ai/ceal`.
Symmetrically, `corca-ai/ceal`'s `packaging/ceal-cli-source/` is the frozen copy
of this repository's source.

Do not originate an independent edit in a frozen copy on either side: change the
recorded owner first, then land a reviewed target-derived sync. The authority
and the deletion gates live in `repository-extraction-migration-ledger.json` in
`corca-ai/ceal` — as of Stage 2 the source-edit authority has transferred but
consumer cutover is pending and no deletion is authorized, so both copies stay.

## Gates

- `npm run check:unit` is the iteration gate; `npm run check` is the final one,
  and the release suite dominates its cost. Prefer the narrow one until
  closeout. Time them with `time npm run check` on the host in hand rather than
  quoting a number from a document — the recorded figures went stale unnoticed
  once already, and a stale figure makes an honest run look like a regression
  under the `Boundaries` slow-test rule below.
- `npm run probe -- <binary> <command> [route/options]` is the only sanctioned
  way to poke an installed surface: it refuses any route whose declared effect
  is not `read_only` and uses a throwaway `HOME`. A live readback against the
  real session is a different act — read the declared effect before typing the
  route, and never batch a state change into a list of checks.
- Route *acceptance* and leaf help derive from a declaration table:
  `CEAL_SUBCOMMANDS` in `packages/ceal-worker-cli/src/subcommands.ts`, and
  `CEALCTL_SUBCOMMANDS` in `packages/ceal-operator-cli/src/index.ts` — a frozen
  package, so a `cealctl` route is not an edit this lane originates.
  Dispatch is not table-driven. A worker route needs its table entry *and* its
  branch in the runner: `runSession` treats every non-`logout` session route as
  enrollment, and `runGuide` treats every non-`register` guide route as status.
  A table-only row therefore passes `check:unit` — which proves help and
  refusal, not routing — and misroutes in the shipped binary.
- Run state-changing commands (commit, push, tag, publish) without output
  filters and read the exit code before retrying. Pipe-trimming is for read-only
  output only.

## Boundaries

- Commit locally by default with an intent-focused subject. Ask before any push,
  tag, GitHub write, Gateway write, or release publish; approval for one of them
  does not carry to the next.
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
