# Achieve Goal: Worker and Agent ratchet retirement and gate ports

Status: draft
Created: 2026-08-18
Activation: `/goal @charness-artifacts/goals/2026-08-18-worker-agent-ratchet-retirement-and-ports.md`

This file is the living goal scratchpad. It becomes active only when the user
runs the activation command.

## Active Operating Frame

- Current disposition: real draft/backlog. One of a two-goal split authored
  2026-08-18 so two machines can work in parallel without touching the same
  checkout. THIS goal owns `ceal-cli` (Worker) and `ceal-agent` (Agent). Its
  sibling, `2026-08-18-gateway-type-debt-and-gate-audit.md`, owns `ceal`. Neither
  may edit the other's checkout.
- Current slice: none started. First action is the ratchet retirement pilot,
  because it is the only lane whose payoff is already quantified and whose
  distance is one file.
- Next action: type `ceal-cli`'s `test/contract/repo-gates.test.ts` to zero, then
  actually DELETE the ratchet it was the last consumer of and prove the
  replacement holds. Record the recipe, or the reason the deletion does not work,
  in `## Slice Log`. Nothing waits on it.
- Verification cadence: cheap deterministic checks at commit boundaries; a
  bounded fresh-eye review at each slice boundary; each checkout proves itself.
- Gate cadence: every count carries the command that re-derives it.

## Goal

Retire the Worker's typecheck ratchet now that it is one file from zero, port the
gates that exist only in the Gateway into the two checkouts that publish signed
artifacts, and clear the stale content inside the Agent's own baselines. This
half of the split is smaller in raw sites and larger in structure: two hook
tiers, two gate contracts, two CI surfaces, and ten ports.

## Scope Boundary With The Sibling Goal

- This goal touches `/home/hwidong/codes/ceal-cli` and
  `/home/hwidong/codes/ceal-agent` ONLY, and writes artifacts only under
  `ceal-cli/charness-artifacts/`.
- Lane D ports come from Gateway commit
  `3cb729ba5d6f76ff6796e60a541454ff9ebbc924`. Read them with `git show` from that
  commit; it is immutable, so the Gateway machine's own work cannot change what
  is copied and no freeze is needed on either side.
- ONE constraint the other direction, because git cannot solve it: do NOT move or
  rename `ceal-agent/src/esm-sentinel.js`. The Gateway's
  `config/runtime-path-resolution-policy.json:94` addresses it as
  `../../ceal-agent/src/esm-sentinel.js`, across the checkout boundary. If this
  goal ever needs to move it, that is a coordinated change rather than an
  overnight one.

## Lane A — retire the Worker typecheck ratchet (the pilot)

Distance is per PROJECT, not per repository. Worker `packages` and `tests` are
both at ZERO; `tools` holds one file, `test/contract/repo-gates.test.ts`, with 92
diagnostics — all of which arrived from main's redesign of that file during the
2026-08-18 merge, not from unpaid branch debt.

The payoff is quantified: `scripts/check-typecheck-ratchet.ts` (271 lines), its
baseline (38), and `test/contract/typecheck-ratchet.test.ts` plus
`test/contract/typecheck-source-gate.test.ts` (249) come to about 558 lines, and
`lint:types:raw:*` already exists as the replacement, so no substitute has to be
written.

This is the pilot on purpose. Deleting scaffolding is the part that can be wrong,
and it is cheaper to discover that on the checkout that is one file away than on
the one that is 865 files away. Two honest outcomes: the deletion lands and the
recipe is worth carrying, or it does not and the reason is worth recording. The
Gateway half is not waiting on either; it dropped ratchet retirement from its own
scope precisely so this cannot become a blocker.

Then repeat the shape on the Agent, which is 379 diagnostics across 36 files —
far enough to be a real slice, near enough to be finishable here.

Re-derive Worker distance: read `projects` in
`ceal-cli/charness-artifacts/quality/typecheck-ratchet-baseline.json`.

## Lane B — configure the compilers

`strict: true` is set in every tsconfig in both checkouts; essentially every
other compiler option is unset (only the Worker's tools project sets
`erasableSyntaxOnly`). Measured 2026-08-18 against zero baselines:

| option | Worker packages | Agent build |
| --- | --- | --- |
| `noFallthroughCasesInSwitch` | 0 | 0 |
| `noImplicitReturns` | 0 | 0 |
| `noImplicitOverride` | 1 | 0 |
| `noUnusedLocals` | 0 | 1 |
| `noUnusedParameters` | 0 | 3 |
| `noUncheckedIndexedAccess` | 9 | 73 |
| `exactOptionalPropertyTypes` | 9 | 95 |

Two are free in both. Three more cost single digits. `noUncheckedIndexedAccess`
and `exactOptionalPropertyTypes` are real but bounded slices. None needs a
ratchet — the compiler enforces each the moment it is set.

Re-derive: `./node_modules/.bin/tsc -p <project> --pretty false --<option>` and
count `error TS`. Use the binary directly; `npx tsc -p x` makes npx consume `-p`
as its own flag and measures nothing.

## Lane C — flip the escape-hatch rules that are off for no reason

Every mechanism is already installed and merely switched off. This lane is
configuration, not tooling.

Both `off` sites here are unreasoned, and both guard almost nothing:

| site | rule | what it guards today |
| --- | --- | --- |
| `ceal-agent/eslint.config.ts:36` (`src/**/*.ts`) | `@typescript-eslint/no-explicit-any` | 8 occurrences, one of them the word "any" inside a comment; six are external-response parsing in `src/tools/runtime.ts`; one is `AgentTool<any>[]` |
| `ceal-cli/biome.json:30` | `noNonNullAssertion` | 5 occurrences, sitting between `useTemplate: "off"` and other style toggles with no comment, which reads as preset silencing rather than a decision |

Neither carries a written reason, and 8 and 5 are not debts that justify a
per-scope review cadence. Flip and fix in one pass.

ORDERING CONSTRAINT 1: enable `noUncheckedIndexedAccess` (Lane B) BEFORE flipping
`noNonNullAssertion`. Four of the Worker's five `!` sites are index or map access
(`present[0]!`, `attachments[index - 1]!`, `resolved.get(agent)!`), which is
exactly the shape that option creates more of. Flipping first means fixing the
same code twice.

AND THEREFORE: the "8 and 5" sizing above is a PRE-option count. Lane B adds 9
Worker and 73 Agent unchecked-index diagnostics, most of them at exactly the sites
where a `!` would be written. Re-measure both counts after Lane B lands and only
then confirm the one-pass cadence; the numbers that settled it are stale by
construction of the ordering it requires.

Wider counts for reference, all first-pass greps: explicit `any` 2 (Worker) and 8
(Agent); `as` assertions 171 and 234; `!` 5 and 25. `as const` is exempt by
construction, settled by the operator.

### Ordering across lanes

- ORDERING CONSTRAINT 2: Lane A completes on the Worker's `tools` project BEFORE
  Lane B enables options there. `tools` is `tsconfig.tools.json`, which is the
  project holding the single file Lane A is zeroing; adding fresh diagnostics to
  it mid-flight leaves regenerating the baseline as the only exit, and this
  goal's own User Acceptance forbids that as the route to retirement.
- ORDERING CONSTRAINT 3: choose Lane D's position explicitly. A port lands 540+
  lines into `scripts/`, which the Worker ratchet covers. Before Lane A, "one
  file from zero" goes stale and the retirement argument has to be re-made;
  after Lane A, the Boundaries rule "typed on the way in wherever the receiving
  ratchet is at zero" no longer has a ratchet to refer to. Either is workable;
  pick one and record it rather than discovering it.

## Lane D — ports in

| gate | source | into | why |
| --- | --- | --- | --- |
| `lint:import-resolution` | Gateway | both | the checker that would have caught BOTH extension defects the 2026-08-18 merge produced — `./canonical-json.js` broke the Worker build, `./type-guards.js` broke 13 Gateway tests, and both typechecked green |
| `lint:secrets` | Gateway | both | these are the two checkouts that publish signed artifacts |
| `lint:source-nul-bytes` | Gateway | both | AGENTS.md records the NUL search trap as repo-agnostic |
| `lint:explicit-any` | Gateway | both | needed only if Lane C's counts stop being trivially small |
| markdown lint | Gateway/Agent | Worker | |
| duplicate detector | Gateway/Worker | Agent | the Agent has none at all |

`lint:node-modules-drift` was ported to both on 2026-08-18 and is no longer a
gap; its port is the worked example — the receiving repository kept its OWN
allowlist rather than the source's, the script was typed on the way in rather
than baselined into a closed ratchet, and the gate was proven by mutation before
landing.

`lint:import-resolution` is the largest port at 540 lines plus
`ratchet-policy-lib.ts`, `script-main.ts`, and `source-test-import-boundary.ts`.
Do it first anyway; it is the one with two same-day defects behind it.

## Lane E — clear stale content inside the Agent's baselines

The Agent's two typecheck baselines carry 137 and 136 ZERO-count entries against
113 and 114 real ones. More than half of each file records debt that is already
paid, and every reader pays to tell them apart.

The control that keeps this from becoming an assumption: the Gateway's
runtime-path baseline has 473 entries and 0 naming a source file that no longer
exists. That proves no RENAME-ROT, which is that file's stated invalidation mode
— not that its content is meaningful; its own note says it "CONTAINS FALSE
POSITIVES". Rot is not universal, and the control is narrower than "clean". This
is a Gateway fact that machine B cannot re-derive; take it as reported, not as
verified here.

Paths, because the two checkouts do not agree on where a baseline lives: the
Worker's is `charness-artifacts/quality/typecheck-ratchet-baseline.json`, the
Agent's two are `config/typecheck-baseline.json` and
`config/typecheck-baseline-ts6.json`.

Also checked and NOT retired: the Agent's legacy `.mjs` ratchet reads zero, but a
tracked `.mjs` can still be added, so it mechanically enforces a live prohibition
and stays. Zero is not by itself a retirement argument.

Re-derive: read each baseline and count zero-valued histogram entries against
non-zero.

## Non-Goals

- `noPropertyAccessFromIndexSignature`. Measured at 1600 diagnostics in the
  Worker's packages alone, all TS4111 across 47 files. It is a mechanical codemod
  but buys NOTHING once `noUncheckedIndexedAccess` is on: compiled together,
  `bag.foo` and `bag["foo"]` both report `number | undefined`. Out on the safety
  argument; reopen only as an explicit readability decision.
- No push, tag, publish, apply, or live readback beyond the one push this split
  depends on.
- No edits to `ceal`.
- Not a claim that either checkout becomes free of `any` or assertions.

## Boundaries

- Each checkout proves itself; a green gate in one is not evidence for the other.
- A ported gate carries the RECEIVING repository's configuration, not the
  source's, and is typed on the way in wherever the receiving ratchet is at zero.
- A gate is proven by a mutation shown red and a restore shown green, and the
  exit code is read WITHOUT a pipe.
- Deleting a guard requires showing its failure mode is unreachable, not that it
  has never fired.

## User Acceptance

The user can verify that the Worker ratchet was retired because its projects
reached zero and its replacement was proven — not because a baseline was
rewritten; that every ported gate names the Gateway commit it was copied from and
carries its own mutation proof; that the two rule flips were made because their
`off` carried no reason and their debt was 8 and 5, not because flipping is
tidier; and that every removed baseline entry was removed for being provably
paid. Local commits are present; no push or apply is claimed beyond the split
push.

## Claim Ledger

| claim | source | re-check command |
| --- | --- | --- |
| Worker `tools` is one file from zero | `typecheck-ratchet-baseline.json` | read `projects.tools.files` |
| ~558 lines retire with that ratchet | `wc -l` of four files | `wc -l scripts/check-typecheck-ratchet.ts charness-artifacts/quality/typecheck-ratchet-baseline.json test/contract/typecheck-ratchet.test.ts test/contract/typecheck-source-gate.test.ts` |
| compiler option costs | tsc runs, 2026-08-18 | `./node_modules/.bin/tsc -p <project> --pretty false --<option>`; NOT `npx tsc -p` |
| Agent `any` is 8, Worker `!` is 5 | greps, 2026-08-18 | `rg -c '(:\s*any\b\|<any>\|as any)' src/` — NOTE the alternation must be inside a group with real pipes; the first draft of this row used `\|`, which ripgrep reads as a LITERAL pipe and which returns 0 instead of 8, the exact trap AGENTS.md records. For `!`, `rg -n '\w!\.'` misses `present[0]!` with no property access; use `rg -n '!\s*[;,)\]]|\w!\.'` or an AST pass |
| Agent is 379 diagnostics across 36 files | `ceal-agent/config/typecheck-baseline*.json` | sum non-zero histogram values and count distinct file keys in `config/typecheck-baseline.json` and `config/typecheck-baseline-ts6.json` |
| the 92 diagnostics came from main's redesign, not branch debt | merge of 2026-08-18 | `git log --oneline main -- test/contract/repo-gates.test.ts` and compare against the branch side of the merge |
| `lint:import-resolution` is 540 lines | `wc -l` in the Gateway | `wc -l ceal/scripts/check-import-resolution.ts` plus its three local imports |
| the drift-gate port is the worked example | Worker `6d69265`, Agent `47b68bc` | `git show` each |
| both `off` sites are unreasoned | read of the config files | read `ceal-agent/eslint.config.ts:36` and `ceal-cli/biome.json:30` and their surrounding lines |
| Agent baselines hold more dead entries than live | read of both baseline JSONs | count zero-valued histogram entries against non-zero |
| dot access does not escape `noUncheckedIndexedAccess` | scratch compile, 2026-08-18 | two assignments from an index-signature type; both must error |

## Operator Decision Queue

Settled 2026-08-18: `as const` is exempt; `noPropertyAccessFromIndexSignature` is
out on the safety argument; the two unreasoned flips run in one pass rather than
per-scope slices.

Open:

- If Lane A's deletion does NOT work, does this goal stop and record, or attempt
  a second shape? Either is safe now that nothing downstream waits on it; the
  question is only how much of this cycle to spend.


## Artifact Custody And Machine Independence

This goal file and every artifact it produces live in
`ceal-cli/charness-artifacts/`. This half NEVER writes to the `ceal` checkout.
The Gateway half never writes here. There is no shared mutable tree between the
two machines, so neither can block or conflict with the other and both can run
unattended.

Reading `ceal` is still required — the Lane D port sources live there — but only
as `git show 3cb729ba5d6f76ff6796e60a541454ff9ebbc924:<path>` out of an ordinary
clone. That commit is immutable in git history, so the Gateway machine may
restructure those files freely; nothing needs to be frozen and nothing needs to
be asked. An earlier draft of this split told the Gateway not to touch them,
which invented a coordination dependency that git already solves.

Nothing in this goal waits on the other machine. Lane A's result is USEFUL to the
Gateway half as a recipe, so record it in `## Slice Log` and push — but the
Gateway half is explicitly not blocked on it, so there is no handoff to schedule
and no reply to wait for.

The two proofs this machine cannot produce, if it is a Mac:

- `ceal-cli`'s coverage floor is enforced only on `linux-x64`
  (`test/platform-proof.ts:14`), because macOS legitimately skips installed-binary
  proofs and a floor there would fail a run for skipping correctly.
- `ceal-agent`'s `linux_runtime` profile (11 files) cannot execute on darwin.

Neither is a reason to wait for the Linux machine. Both are proved by CI on push,
which is where this goal's closeout takes them from. Say so in the closeout rather
than reporting a local green as if it covered them.

## Context Sources

- `ceal/charness-artifacts/goals/2026-08-18-gateway-type-debt-and-gate-audit.md`
  — the sibling half, in the other checkout. It owns the Gateway and is NOT
  blocked by anything here. Read it for context; do not coordinate with it.
- `charness-artifacts/goals/2026-08-18-three-repo-type-duplication-debt.md` —
  complete; its Final Verification carries the residual counts.
- `charness-artifacts/quality/2026-08-18-three-repo-merge-dup-cadence.md`
- The 2026-08-18 `lint:node-modules-drift` port, in both checkouts, as the worked
  example of what a port is expected to include.
