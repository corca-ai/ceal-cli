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

- `narnia` — this lane, and it owns **`corca-ai/ceal-cli` only**: worker CLI,
  client SDK, `ceal-guide`, and the Claude and Codex guide hosts. Local
  checkouts: `~/codes/ceal-cli`, and `~/codes/ceal` as a consumer/reference copy.
- `vinc` — the Gateway lane, reachable as `ssh oc`, checkout `~/ceal`. It owns
  Gateway routes, connector execution, Profile policy, audit/receipt custody,
  `cealctl`, canonical protocol/conformance, **and `corca-ai/ceal-agent`**.

`ceal-agent` moved to `vinc` on 2026-07-27, after this lane had already landed
`gateway-artifact-handoff.json` and its verifier there (through
`corca-ai/ceal-agent@474ac96`). Treat that work as handed over, not as a
standing narnia responsibility: `~/codes/ceal-agent` on this host is a stale
checkout of another lane's repository, so do not commit or push from it. An
`agent` change this lane believes is needed is a request to `vinc`.

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

The historical dual release lane is frozen the same way, which this section used
to leave to `README.md` alone: `install.sh`, `scripts/build-platform-binaries.mjs`
(`release:binaries`), `scripts/build-release-manifest.mjs` (`release:manifest`),
bare `v*` tags, and `.github/workflows/cealctl-release.yml`. Do not execute,
amend, or publish them. They are ordinary tracked files here, so nothing stops an
edit mechanically — the constraint is that `corca-ai/ceal` mirrors them, and a
one-sided change breaks that copy.

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
- `npm run lint` is `biome check .` — lint, format, and import order — and runs
  inside both gates; `npm run lint:fix` applies every safe fix. It is `check`
  rather than `lint` on purpose: an unformatted commit must fail the gate, not
  merely drift. `biome.json` excludes the frozen packages deliberately — do not
  widen its `includes` to lint code this lane may not edit. `lineWidth` is 140
  with tabs, which is this tree's own shape rather than a new house style.
  Formatting-only commits belong in `.git-blame-ignore-revs`, which
  `npm run hooks:install` wires into the clone. Three lint rules are off for
  reasons JSON cannot carry, so check here before re-enabling one:
  `noNonNullAssertion` (`options[index]!` after a bounds check is the idiom),
  `useTemplate` (every hit is `.join("\n") + "\n"`, which a template worsens),
  and `noTemplateCurlyInString` (every hit is `${...}` inside a *shell* script
  string, where it is the shell's syntax and not a JS template). A rule with no
  findings does not belong in that list — enable it instead.
- `.github/workflows/check.yml` runs the full gate on every push and pull
  request to `main`. The other workflows are release lanes that trigger only on
  tags, so they prove nothing about a branch.
- `npm run hooks:install` points `core.hooksPath` at `.githooks/`, whose
  `pre-push` runs the iteration gate — or the full gate for a tag push, because
  a failed release tag cannot be reused. Run it once per clone;
  `node scripts/install-git-hooks.mjs --check` reports whether this clone is
  actually enforcing it.
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

## Release And Enrollment Lanes

Both are standing procedures, not session state, so they live here rather than in
a baton that would restate them every time.

- Release: bump the three manifests — `package.json`, `packages/ceal-client`,
  and `packages/ceal-worker-cli` including its exact `@corca-ai/ceal` pin — then
  `npm i` to regenerate `package-lock.json`, which `npm run check` does not gate
  but the tagged workflow's `npm ci --ignore-scripts` does. Nothing else carries
  the version: source reads it from its own manifest, and `repo-gates` fails a
  commit that retypes it or lets the manifests disagree. Then `npm ci` →
  `npm run check` → commit → push `main` → confirm `origin/main` is that commit →
  tag → watch → `ceal update` → readback. `CHANGELOG.md` owns which tags are
  burned and why; a burned tag is never reused.
- Re-enrollment (a worker session binds one instance, so switching is locally
  destructive): on the Gateway host (`ssh oc`) use the owner copy at
  `~/ceal/packages/ceal-operator-cli` — the installed `cealctl 0.65.3` there is
  the other lineage and has no `enrollments` route — then
  `cealctl login <admin-origin> --session <name>` followed by
  `cealctl enrollments create --client narnia --profile work --subject hwidong
  --instance <name> --operator-session <name>`, and locally
  `ceal session enroll --code-stdin`. A web-shell activation code is not this
  code: `ceal-ops admin-api invite` can never carry `ceal.client.enroll`.

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
