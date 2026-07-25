# Session Retro
Date: 2026-07-25

## Context

One work unit: resolving corca-ai/ceal-cli#1 (the signed guide's mandated descent
was not completable because `capabilities targets` had no leaf help, and the
guide demanded an opaque cursor where `message.search` returns an integer
offset), through causal review, implementation, resolution critique, release
`ceal-v0.65.5`, and issue closeout. This retro asks where that unit spent effort
it did not have to, under a less-but-better filter.

## Evidence Summary

- Host log `~/.claude/projects/-home-hwidong-codes-ceal/4a798cb3-….jsonl`:
  window 09:38:42Z → 11:22:52Z (~104 min), 192 tool calls (Bash 137, Edit 30,
  Agent 5, Read 12), 186k output tokens.
- Measured blind polling: 10 `sleep` calls totalling 1360s (22.7 min ≈ 22% of the
  session) waiting on bounded reviewers whose completion notification never
  arrived; each result was finally hand-extracted from
  `…/subagents/agent-*.jsonl` with an ad hoc python reader.
- 3 × `npm run check` at ~96s each (~5 min). Targeted equivalents measured at
  1.4s (worker package), 1.0s (operator package), and 4 tests (guide contract).
- 13 tool calls spent discovering the closeout carrier's required shape
  (`validate-closeout-draft` ×3 failing, `describe_closeout_draft_shape.py`,
  reading `issue_verify_closeout_body.py`) — all after the prose was drafted.
- `mine_closeout_telemetry.py`: 0 records; this repo has no closeout-telemetry
  stream yet, so no recurrence claim is available from it.
- Commits `2f454b0`, `557746d`, `26bf3c1`, `c522ab0`, `5fff7e9`; released tag
  `ceal-v0.65.5`; issue CLOSED 10:58:42Z.

## Waste

- **Blind subagent polling (22.7 min, measured).** The five bounded reviewers
  were the right call, but retrieving their output was improvised each time:
  sleep, guess, sleep again, then read the transcript by hand. The retrieval path
  — not the review — was the cost.
- **Template-last on a validator-gated artifact.** The issue closeout carrier was
  written as prose, then reverse-engineered against its floor (`JTBD:`,
  `Root Cause:`, `Debug Artifact:`, `Siblings:` requiring the literal words
  *decision* and *proof*, `Prevention:`, `Critique: <checked-in path>`,
  `Behavior:`, `AI-provenance:`, `Manual close reason:`). The always-loaded rule
  already says use the template first and validate the contract before filling
  detail; routing through `describe_closeout_draft_shape.py --stub` first would
  have removed 13 discovery calls and 3 failed validations.
- **Critique-after-commit rework.** The `--help`-as-operand hazard (a help probe
  reaching the enrollment runner and prompting for a device-enrollment code) and
  `cealctl enrollments create`'s wrong `result_schema` were found *after* slice 1
  landed, so slice 2 rewrote the dispatch path slice 1 had just written and
  re-touched the same four files. Both were findable mechanically before writing
  the table: enumerate every source that already accepts a route
  (`GUIDE_ACTIONS`, `parseEnrollmentOptions`, `parseReceiptOptions`,
  `parseAccessOptions`, …) and every declared schema against its emitter.
- **Additive fix shape.** The declaration was added *beside* the existing
  acceptance literals rather than replacing them, so two sync gates and three
  copies of a row parser now exist only to keep two sources agreeing. The
  counterweight correctly deferred the refactor, but the shape is why the
  residual risk exists at all.
- **Gate over-running.** Three full `npm run check` runs where the repo rule is
  targeted gates at commit boundaries and the full gate at final proof. Gate
  debt: `npm run check` ≈96s is dominated by release-artifact and native-binary
  tests that cannot observe CLI help behavior; there is no unit-only script, so
  the cheap loop is not reachable by name.
- **zsh word-splitting false alarm.** `for a in "guide status --help"; node bin $a`
  passed each string as one argv (zsh does not word-split unquoted parameters),
  producing seven bogus `unknown_command` results that read like a real
  regression until re-checked. One wasted diagnostic cycle.
- **Truncated boundary question.** I offered push-only vs push-and-close, omitting
  release — and the operator immediately asked why we would not just release. The
  reporter's JTBD only completes on the installed binary, so the delivery chain
  (commit → push → release → runtime readback → close) was one decision, not two.

## Critical Decisions

- Classifying #1 as `bug` and running the causal review *before* design. It
  produced the load-bearing insight (the shared guide-contract gate was depth-1
  only, which is why this shipped green) and the cealctl sibling family.
- Verifying every reviewer claim in source before acting. That is what separated
  the real credential-prompt hazard from the stylistic findings.
- Taking the guide-wording branch on mismatch #2 instead of forcing an opaque
  continuation. Later confirmed by pulling the Gateway: `message.search` still
  declares `offset` with `maximum: 1000` and issues no cursor.
- Releasing and running `ceal update` for runtime proof instead of closing on
  local green — the only channel that could show the reporter's own command
  working.

## Expert Counterfactuals

- **Douglas Engelbart (system-improving-itself; briefed by the planner).** Treat
  human + language/method + tooling as one unit: the reviewer *result-retrieval*
  step was performed five times by hand and never became tooling, so every future
  session pays it again. Engelbart's move is to stop after the first improvised
  retrieval and make it a named command, then continue the review. Applied here
  that converts 22.7 min of sleeping into one deterministic read, and it is the
  single highest-leverage change in this list because it compounds across every
  skill that spawns bounded reviewers.
- **John Ousterhout (deep modules, eliminate special cases).** He would judge the
  fix by whether the number of places that know a route exists went *down*. It
  went from three (option prose, per-command parser literals, one hand-patched
  help exception) to three (declaration table, per-command parser literals, sync
  gates) — two special cases deleted, one layer added. The less-but-better shape
  is to make the declaration the *only* source dispatch consults, which deletes
  `GUIDE_ACTIONS`, the action-name literals, both sync gates, and the row-parser
  copies. Fewer features, less code, one owner — and the deferred recurrence risk
  disappears rather than being documented.

## Sibling Search

- same layer: the critique artifact written this session
  (`charness-artifacts/critique/2026-07-25-issue-1-leaf-help-resolution.md`) was
  also authored prose-first and passed its floor only by luck | decision: same
  class, diagnostic-only for this slice | proof: local payload proof (it passed
  `validate-closeout-draft`'s critique binding) | follow-up: covered by the
  template-first workflow change below.
- abstraction up: every charness skill pairing a `validate_*` gate with a
  `describe_*`/`scaffold_*` producer (issue, critique, retro, spec, release) has
  the same prose-first failure mode; only `retro` forced the scaffold up front,
  and that is the one artifact that needed no rework | decision: same class,
  fix now in the workflow rule (scaffold/stub before prose) | proof: local
  payload proof this session — scaffolded retro cost 1 call, reverse-engineered
  closeout cost 13 | follow-up: deferred to a `corca-ai/charness` issue, since
  the skills are upstream-owned.
- specialization down: `describe_closeout_draft_shape.py --stub` already exists
  and was reached last instead of first | decision: intentional boundary — the
  tool is fine, the routing was wrong | proof: static scan | follow-up: none.
- mental-model sibling: "assume the contract, check later" also produced the zsh
  word-splitting false alarm — same shape, different substrate | decision: same
  class, fix now via the AGENTS.md shell rule | proof: local payload proof (seven
  bogus results, re-checked) | follow-up: none.

## Next Improvements

- workflow: scaffold or stub any validator-gated artifact *before* drafting its
  prose (closeout carriers, critique, spec, release notes) — the existing
  always-loaded template-first rule, applied to the closeout carrier where it was
  skipped; and when a slice declares a table for a dispatch surface, first
  enumerate every source that already accepts those routes and every declared
  schema against its emitter, so critique-found rework folds into slice 1.
- workflow: gate ladder as written — targeted package tests at commit boundaries,
  full `npm run check` once at final/pre-release proof; and when the JTBD only
  completes at delivery, put the whole chain (push → release → runtime readback →
  close) in one boundary question.
- capability: split `npm test` into `test:unit` (protocol + client + both CLI
  packages, ~3s) and `test:release` (root release-artifact and native-binary
  suites, ~90s) so the iteration gate is reachable by name; record the release
  suite as named gate debt rather than paying it per commit.
- capability: filed `corca-ai/charness#455` (deterministic bounded-reviewer
  result read so parents never sleep-poll) and `corca-ai/charness#456` (making the
  `describe_*`/`scaffold_*` stub the planner's `next_action` for closeout carriers
  the way it already is for retro artifacts). Structural pattern: improvised
  retrieval and prose-first authoring of contract-gated artifacts. Triggering
  instances: 10 sleep calls / 22.7 min, and 13 shape-discovery calls this session.
  Destination: upstream `charness` (plugin source is upstream-owned; not editable
  from this repo).
- memory: this artifact, plus the dispatcher-derivation residual written into the
  #1 close comment. Both landed after this retro: acceptance now derives from the
  declaration in both CLIs (`splitSubcommandRoute`), and `npm run test:unit` /
  `check:unit` name the fast gate. A third miss recorded the same day — a
  verification probe run against the real `HOME` revoked a live Gateway client
  session — became `npm run probe` plus two always-loaded rules in the `ceal`
  repo; the same "assume the contract, check later" shape as the zsh miss above.

## Persisted

Persisted: yes: charness-artifacts/retro/2026-07-25-session-retro.md
