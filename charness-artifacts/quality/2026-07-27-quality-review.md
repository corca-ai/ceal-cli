# Quality Review
Date: 2026-07-27
Title: Quality Review — second pass, after the morning baseline's moves landed

## Scope

Target boundary: repo-wide, re-run against the shifted baseline. The morning review's four
`active` gate moves all landed today, so this pass asks what the *new* code claims that is not
true rather than re-deriving the gate inventory.

Ambient repo findings: one false standing claim in the logout path and two drifted observer
declarations — all found by the delegated reviewer, all fixed this turn.

## Current Gates

- `npm run check` (final), `npm run check:unit` (iteration), `npm run lint` = `biome check .`
  inside both. `.githooks/pre-push` runs the iteration gate — the full gate on a tag push — and
  `install-git-hooks.mjs --check` proves the clone enforces it.
- `.github/workflows/check.yml` runs the full gate on push/PR to `main`, ubuntu + macOS. Every
  other workflow is a tag-triggered release lane and proves nothing about a branch.
- New today, enforced by `test/contract/repo-gates.test.mjs`: `timeout-minutes` on every job of
  every non-frozen workflow, and `CEAL_REQUIRE_PLATFORM_PROOFS` derived from the build matrix
  on the release lane; `cealctl-release.yml` is a named exemption because it is frozen.
- `npm audit` and `--omit=dev`: 0 vulnerabilities.

## Runtime Signals

- runtime source: missing — `render_runtime_summary.py` reports `runtime source: not configured` and cannot rank gates. <!-- reproduction-source -->
- runtime hot spots: unavailable — no structured samples. Single `time` runs are under
  `## Commands Run` and are not a trend; the release tier is believed dominant from the
  2026-07-26 measurement, not from anything measured this turn.
- coverage gate: no floor configured; confidence is gated by negative probes, not a percentage.
- evaluator depth: deterministic gates only — no Cautilus adapter, and nothing this turn was
  validation-shaped output.

## Healthy

- Every gate move recommended this morning landed, each verified by deletion rather than by a
  green run: removing the spool lock loses 5 of 6 receipts; deleting `process.exitCode = 3`
  fails; dropping `darwin` from `install-ceal.sh` *or* the release matrix fails; removing any
  `timeout-minutes` fails.
- The lock's seven branches each have a probed test — none existed before today on either side
  of the extraction. `prepareDirectory`'s race is closed and *reproducible*: six racing
  processes fail the pre-fix code 20 runs out of 20. Supply chain clean, frozen boundary held.

## Weak

- **`probe-surface.test.mjs:62-63,78-82` proves isolation on a branch that never executes.**
  `probe-surface.mjs:92` spawns `dist/bin.js` under plain `node`, so `bin.ts:38` hands
  `process.execPath` to the guide store, `agent-guide.ts:168-172` resolves no staged guide, and
  `guide register` always answers `guide_unavailable` — a document with no paths in it. The
  `doesNotMatch(HOME)` assertion is vacuous and the `if (reported)` branch that pins
  `CLAUDE_CONFIG_DIR` containment is dead; deleting the pinning at `probe-surface.mjs:102-103`
  keeps the suite green. Not confirmed by execution.
- **Two observer fixtures no longer model the store they stand in for.**
  `observer.test.mjs:586-608` returns a spool state without `drops`/`spoolPresent`, `:573-583`
  a session without its refresh fields. They stay green because `droppedAppends` tolerates a
  missing counter — a defence for a *runtime callback* now absorbing a *test*. `.mjs` runs
  `dist`, so `tsc` never notices.
- **`cli.test.mjs:1928` asserts serialization without asserting overlap.** If startup skew lets
  the first process finish first, the second finds a rotated session, never refreshes, and the
  test passes with the lock removed. Today's race tests carry a barrier-margin assertion for
  exactly this; this one predates it.
- **The new privacy sweep is name-shaped, not store-shaped.** `observer.test.mjs:380` matches
  `client-*.json|receipt-spool*` literals and sits exactly at its own `>= 4` floor. A future
  store named `capability-index.json` is invisible, and the declaration goes quietly false
  again for the original reason.

## Missing

- **`docs/operator-acceptance.md` still does not exist** — carried, now sharper. Every step of
  `docs/release-and-enrollment.md:32-40` runs on `vinc` (`ssh oc`, the owner `cealctl` copy),
  and no document names a person, an access path, or a fallback. Without that session the
  maximum reachable proof is `version`/`commands`/`guide status`/`observe`, and nothing says
  so. Worse on the release lane: a successor missing a credential discovers it by burning a
  tag, which `CHANGELOG.md` records can never be reused.
- **Structured gate timing.** No `command_timing_log`, so the only alternative to the stale
  figures `AGENTS.md` forbids quoting is re-measuring by hand each session.
- **No temp-file sweep on the credential store.** `receipt-spool.ts:229` sweeps orphaned `.tmp`
  files on every append; `profile-store.ts` and `discovery-cache.ts` do not. A crash between
  `writeFileSync` and `renameSync` leaves `~/.ceal/.client-session.<pid>.<hex>.tmp` forever — a
  0o600 file holding both tokens. The store that most needed the sweep is the one without it.

## Deferred

- `skills/ceal-guide/SKILL.md:19-23` vs `skills/cealctl-guide/SKILL.md:22-26`: near-duplicate
  family (`inventory_doc_duplicates`, 0.95). `cealctl-guide` is frozen, so the dedup is a
  request to `corca-ai/ceal`, filed only if the duplication starts costing something.
- `packages/ceal-operator-cli`'s non-recursive `../src` sweeps: sent to `vinc` in
  `docs/requests/2026-07-27-to-gateway-lane.md`. Frozen here.
- `AGENTS.md` reached 125 lines, not the 90 asked for; cutting further removes rules rather
  than explanations. Revisit only if the rule set itself shrinks.

## Advisory

- structural review result: not_applicable — no `skills/public`/`skills/support` tree, so no
  `structural_review_packet` was emitted and `nose_clones` errored on missing paths.
- prose review result: `entrypoint_docs_ergonomics` flags `README.md` (283 lines) and the two
  docs extracted today; heuristic, the extraction was deliberate and both carry 3 inbound links.
- `standing_gate_verbosity`: `escape_hatch: missing` for `.githooks/pre-push`; git's own
  `--no-verify` is the hatch and is undocumented. `sloc` 27810 code / 161 files, up from
  26992 / 155 — the lock module, drop counter, and their tests.
- Nothing found by `structural_waste`, `dual_implementation`, `hardcoded_discovery`,
  `lint_ignores`, `ci_recoverable_gates`, `release_only_sentinels`, `gitignore_scan_hygiene`;
  command: the corresponding `inventory_*.py`.

## Delegated Review

- Delegated Review: executed — one bounded fresh-eye reviewer (Read/Grep/Glob, no Bash). Seven
  findings, all source-traced; the top one was verified independently here before acting and
  was real. Findings 1, 4a, 4b fixed this turn; 2, 3, 5, 6, 7 recorded above and below. The
  reviewer could not execute, so its `probe-surface` claim is `Weak` pending one command.
- Slow-gate lenses (fixture-economics, parallel-critical-path, duplicated-proof): not
  re-delegated — the 2026-07-26 review established the SEA-build/`npm pack` duplication and
  nothing this turn changed the release tier's shape.

## Commands Run

- `npm run check` (exit 0, 1:38.70 and 1:48.07, 383 passing), `check:unit` (exit 0, ~23s, 336 passing), `npx biome check .` (clean), `npm audit` + `--omit=dev` (0 vulnerabilities)
- negative probes this turn: lock branches ×7; drop counter ×6; TOCTOU ×1 plus 20 repeat runs
  against pre-fix code (0 green / 20 red); privacy declaration ×2; logout spool clearing ×2
- `plan_quality_run.py`, `render_runtime_summary.py`, `inventory_sloc`, and every
  planner-dispatched inventory listed under `## Advisory`
- not run, and so not claimed: `npm run probe -- --allow-effect local_write ceal guide register
  claude` (would settle the `probe-surface` finding), and any per-suite wall-clock split

## Recommended Next Quality Moves

- active make the two `probe-surface` isolation assertions reachable — capability_needed=the probe guard's safety property is actually proven; next_center=`test/contract/probe-surface.test.mjs:78-82`; transformation=stage a fake `../../current/guide/SKILL.md` beside a copied `bin.js` in the test's own tmp tree, then delete the `else` branch; proof_boundary=remove the `CODEX_HOME`/`CLAUDE_CONFIG_DIR` pinning at `probe-surface.mjs:102-103` and watch it fail; enforcement_posture=gate.
- active give the atomic write protocol one owner and the credential store its sweep — capability_needed=a crash during `ceal session enroll` stops leaving a token-bearing `.tmp` file forever; next_center=a new `local-store-file.ts` plus `profile-store.ts:90-97`, `discovery-cache.ts:137-144`; transformation=move temp-name/`wx`/rename/chmod/sweep behind one helper taking the `UnsafeStore` callback already proven in `local-store-guards.ts`; proof_boundary=kill a writer between write and rename, then assert the next call sweeps it; enforcement_posture=gate.
- active build the observer fixtures from the real store — capability_needed=a required field added to `CealReceiptSpoolState` cannot leave a `.mjs` fixture behind; next_center=`observer.test.mjs:573-608`; transformation=use `createCealReceiptSpoolStore` over a tmp `HOME` as the neighbouring tests at `:66` and `:479` already do; proof_boundary=add a required field and watch the hand-rolled fixture fail where it now passes; enforcement_posture=gate.
- active write `docs/operator-acceptance.md` part (a) — capability_needed=a successor learns the no-session acceptance ceiling before spending a tag to find it; next_center=`docs/`; transformation=list the steps reachable with no session, state plainly that they are the ceiling without `vinc`, name the release-lane access artifacts and how to verify each before tagging, and name the counterpart role rather than a hostname; proof_boundary=a reader can state what they cannot prove; enforcement_posture=advisory.
- active make the privacy sweep store-shaped — capability_needed=a store file that breaks the naming convention still cannot go undeclared; next_center=`observer.test.mjs:380`; transformation=derive the set from `path.join(directory, …)` call sites rather than a filename regex, or gate the naming convention itself; proof_boundary=add a store file named outside the convention and watch it fail; enforcement_posture=gate.
- passive capture gate timings mechanically — capability_needed=gate cost becomes a trend rather than a figure `AGENTS.md` forbids quoting; next_center=`command_timing_log` in `.agents/quality-adapter.yaml`; transformation=append each run's elapsed time to a machine-written log; proof_boundary=`render_runtime_summary.py` reporting real hot spots; enforcement_posture=no-gate because the repo's own contract test refuses runtime assertions as flaky, so this is measurement and not a threshold.
- passive read the negotiated protocol version into the capability-cache key — capability_needed=a widened version range cannot silently degrade the write-caution path; next_center=`index.ts:1102-1107`; transformation=use `handshake.value.negotiated_protocol_version` as `index.ts:670` already does when writing, or drop the field from the key; enforcement_posture=no-gate because the decoder currently rejects every other value, so the defect is latent until the range widens.

## History

- [2026-07-27 — first pass, superseded by this one](history/2026-07-27-quality-review.md)
- [2026-07-26 — first quality review](history/2026-07-26-quality-review.md)
