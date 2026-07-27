# Quality Review
Date: 2026-07-27
Title: Quality Review

> Every `file:line` was re-grepped this session. The 2026-07-26 review's line
> numbers predate a 64-file reformat — do not paste them forward.

## Scope

Target boundary: repo-wide question — the 2026-07-26 baseline is obsolete because the
linter, branch CI, the pre-push hook, the macOS matrix, version derivation, release
readback retries, and table-derived route dispatch all landed since. No target skill.

Ambient repo findings: none needing repair — the adapter resolves valid and `.charness/` is
gitignored. `inventory_nose_clones.py` errors on absent `skills/public`/`skills/support`, a
portable-default path assumption rather than a repo defect.

## Current Gates

- `npm run check:unit` — lint + build + unit + contract. Green, measured 22.93s.
- `npm run check` — plus the release tier. Green, measured 1:40.16, 310 tests
  (162 unit + 29 client + 73 contract + 46 release).
- `npm run lint` (`biome check .`) runs inside both, so an unformatted commit fails.
- CI: `check.yml` runs the full gate on every push/PR to main, ubuntu + macOS matrix.
- Maintainer-Local Enforcement: **enforced** — `.githooks/pre-push` (iteration gate, full
  gate for tags), checked in with `npm run hooks:install` and a `--check` clone validator.
- `npm audit` — 0 vulnerabilities, 1 production dependency (`yaml@2.9.0`).

## Runtime Signals

- runtime source: structured timing capture is still missing — no `.charness/quality/runtime-signals.json`, no `command_timing_log` key, so every number here is a single `time` run and not a trend. <!-- reproduction-source -->
- runtime hot spots: unavailable until structured runtime metrics have samples; the single-run figures under `## Current Gates` are not a ranking.
- coverage gate: none configured; no coverage instrumentation exists in any package.
- evaluator depth: deterministic gates only — no Cautilus adapter configured for this repo.

## Healthy

- Credential handling came back clean: `wx`+`0o600`+rename used consistently
  (`profile-store.ts:94`, `discovery-cache.ts:139`, `receipt-spool.ts:129`), lock owner files
  mode-checked including `& 0o077` (`profile-store.ts:187,196`), hidden input never echoes on
  any exit path (`hidden-terminal-input.ts:36-46`), and zero `console.*` or `process.env`
  outside `bin.ts` in `packages/ceal-worker-cli/src`.
- No secret is reachable from a `read_only` route: the observer projects sessions through a
  name allowlist that never names a token (`observer.ts:288-302`), and its loopback,
  rebinding, and method guards are really tested (`observer.test.mjs:324-331`).
- `ceal-client`'s HTTP transport refuses redirects, non-loopback `http:`, URL credentials,
  unbounded bodies, and non-JSON content types (`http-transport.ts:89-247`).
- Supply chain: 0 vulnerabilities, one production dependency, every action SHA-pinned —
  and as of this turn that pinning is gated rather than habitual.

## Weak

- `receipt-spool.ts:115-135` `appendEntry` is an unlocked read-modify-write while
  `profile-store.ts:115-139` has a full lock for the same file family. Two concurrent
  `ceal call` processes both read, both append, both rename: no corruption, one receipt
  silently lost, and `ceal observe`'s under-reporting is the one thing that section exists
  to prevent. `receipt-spool.test.mjs` appends only sequentially, so nothing can fail.
- `bin.ts:87-103`, the composition root's rejection arm, has no test that could fail.
  Deleting `process.exitCode = 3` at `:102` keeps the full gate green while the shipped
  binary prints `ok: false` and exits 0. `cli.test.mjs` proves the ok/exit agreement
  through the library helper, never through `bin.js`.
- `install-ceal.sh:176` and `test/contract/worker-release-assets.test.mjs:19-20` carry the
  same signed-inventory allowlist by hand, aligned only by a comment. Narrowing the shell
  copy (dropping `darwin`) passes both, because the installer proof is linux-x64-gated.
- `stable-update.ts:33-44` runs `/bin/sh install-ceal.sh` with the full inherited
  environment; its integrity root is a digest in a `SHA256SUMS` beside the script in HOME,
  never re-verified with cosign at update time, in a generation directory created by a bare
  `mkdir` with no mode assertion. Not a boundary crossing — HOME write access is already user
  compromise — but `:22-24` and `:47-49` call it "signed" when the check is self-referential.

## Missing

- `docs/roadmap.md` and `docs/operator-acceptance.md` still do not exist, so a repo with an
  install surface, a release lane, and a burned-tag history has no operator-takeover
  document. `.agents/retro-adapter.yaml` is likewise absent while `charness-artifacts/retro/`
  is in use.
- No `timeout-minutes` on `ceal-release.yml` or `ceal-worker-stable-rollback.yml`; added to
  `check.yml` this turn. Several suites `await` an HTTP server they also close, so a wedged
  one holds a runner for the 6-hour default on the lane whose tag cannot be reused.
- `ceal-release.yml` never sets `CEAL_REQUIRE_PLATFORM_PROOFS`, so the strict-runner
  invariant is enforced on the cheap lane and not on the tag lane.

## Deferred

- Coverage floor and mutation testing: still not proposed. No instrumentation exists and
  adding it across four packages is larger than one review.
- `packages/ceal-operator-cli/test/operator-cli.test.mjs:89,721` repeats the exact
  non-recursive `../src` sweep fixed here, with no file-count floor. That package is frozen,
  so it is a `corca-ai/ceal` request and not an edit here — but `check:unit` runs that suite,
  so this lane pays for the false confidence meanwhile.

## Advisory

- structural review result: no target skill named, so the planner emitted no `structural_review_packet`.
- prose review result: `command: inventory_entrypoint_docs_ergonomics.py` flags `AGENTS.md` (149 lines) and `README.md` (245) as `long_entrypoint`; `docs/macos-worker-runbook.md` trips `code_fence_without_deeper_doc_link`. `AGENTS.md` grew again this turn, so `## Gates` is the section to watch for a split.
- `command: inventory_standing_gate_verbosity.py` reports `escape_hatch: missing` and `phase_level_signal: weak` for `.githooks/pre-push`. Both are false positives: the hook documents `git push --no-verify` and echoes which gate it is running. Verified by reading the hook.
- `command: inventory_doc_duplicates.py` flags `skills/ceal-guide/SKILL.md:19-23` against `skills/cealctl-guide/SKILL.md:22-26` at 0.95 — intentional shared shape, and the second copy is frozen. `command: inventory_ci_local_gate_parity.py` says nothing without `--canonical-gate-pattern 'npm run check'`; unconfigured it reports all five workflows as no-match.

## Delegated Review

- Delegated Review: executed — one `charness:bounded-reviewer` (read-only, repo-wide posture
  scope) after the inventories and before these recommendations. It found the ungated
  workflow pinning, the silently-skipping prewarm assertion, the spool race, the untested
  `bin.ts` envelope, the duplicated installer allowlist, and the updater trust-root
  overstatement. Every claim recorded above was re-verified by the parent by reading or by
  an executed probe; its own two open evidence requests are named under `## Commands Run`.
- Slow-gate lenses (fixture-economics, parallel-critical-path, duplicated-proof): not
  re-delegated. The 2026-07-26 review already established the SEA-build and `npm pack`
  duplication, and this turn measured two suites out of the serialized tier instead.

## Commands Run

- `npm run check` (exit 0, 1:40.16, 310 tests), `npm run check:unit` (exit 0, 22.93s),
  `npm audit` + `--omit=dev` (0 vulnerabilities), `npm ls --omit=dev`
- negative probes: mutable action ref → new pin gate fails; prewarm step removed → fails;
  gate step rewritten multi-line → both detectors now agree; table-only route row → `tsc`
  fails; `route: [...] as string[]` → build passes and the new runtime gate fails
- `plan_quality_run.py`, `render_runtime_summary.py`, and every planner-dispatched inventory:
  `standing_test_economics`, `structural_waste`, `ci_recoverable_gates`, `brittle_source_guards`,
  `dual_implementation`, `lint_ignores`, `hardcoded_discovery`, `standing_gate_verbosity`,
  `ci_local_gate_parity`, `release_only_sentinels`, `sloc` (26992 code / 155 files),
  `doc_duplicates`, `entrypoint_docs_ergonomics`, `cli_ergonomics`, `gitignore_scan_hygiene`,
  `ubiquitous_language`, `nose_clones`
- not run, and so not claimed: per-suite wall-clock split of the release tier, and
  `git log` history on whether the two installer allowlists have already drifted

## Recommended Next Quality Moves

- active make the receipt spool append safely — capability_needed=parallel `ceal call` runs cannot silently drop a receipt; next_center=`receipt-spool.ts:115-135`; transformation=reuse the `profile-store` lock, or re-read inside the write and union on `requestRef`; proof_boundary=a two-process test modeled on `cli.test.mjs`'s refresh-lock case; enforcement_posture=gate.
- active derive the installer allowlist in the test from `install-ceal.sh` — capability_needed=narrowing the shell allowlist cannot reach a tag; next_center=`test/contract/worker-release-assets.test.mjs:19-20`; transformation=extract the alternation with a regex and assert equality, as the same file already does for the platform loop; proof_boundary=drop `darwin` from the shell copy and watch it fail; enforcement_posture=gate.
- active cover the `bin.ts` failure envelope — capability_needed=an internal crash cannot exit 0; next_center=`bin.ts:87-103`; transformation=one test that forces a rejection through the real `dist/bin.js` and asserts exit 3 plus `ceal.error.v1`; proof_boundary=delete `process.exitCode = 3` and watch it fail; enforcement_posture=gate.
- active write `docs/operator-acceptance.md` — capability_needed=someone other than this lane can take the release and enrollment lanes over; next_center=`docs/`; transformation=name the install surface, the two gates, the enrollment procedure, and what proof level each reaches; proof_boundary=a reader can cut a release from it alone; enforcement_posture=advisory.
- active add `timeout-minutes` to `ceal-release.yml` and `ceal-worker-stable-rollback.yml` and set `CEAL_REQUIRE_PLATFORM_PROOFS` on the release lane — capability_needed=the lane whose tag cannot be reused fails fast and proves its platform gates; next_center=those two workflows; transformation=one key each plus the env line `check.yml` already carries; proof_boundary=`repo-gates` can then assert both across every non-frozen workflow; enforcement_posture=gate.
- active send the frozen-package sweep defect to `corca-ai/ceal` — capability_needed=`check:unit` stops paying for a sweep that under-scans; next_center=`docs/requests/`; transformation=name `operator-cli.test.mjs:89,721` and the recursive+floor fix landed here; proof_boundary=the owner lane's own gate; enforcement_posture=advisory.
- passive capture gate timings mechanically — capability_needed=treat gate cost as a trend rather than a number that goes stale in a doc, which `AGENTS.md` already forbids quoting; next_center=`command_timing_log` in `.agents/quality-adapter.yaml`; transformation=append each gate run's elapsed time to a machine-written log; proof_boundary=`render_runtime_summary.py` reporting real hot spots; enforcement_posture=no-gate because the repo's own contract test refuses runtime assertions as flaky, so this is measurement and not a threshold.
- passive assert the generation directory's mode before `ceal update` spawns the installer — capability_needed=stop calling a self-referential digest check a signed update; next_center=`stable-update.ts:33-44,118-132`; transformation=`assertDirectory`/`assertFile` on the generation dir, `install-ceal.sh`, and `SHA256SUMS`, plus honest wording at `:22-24`; enforcement_posture=no-gate because it hardens a boundary that already implies user compromise, so it ranks below the four active gates.

## History

- [2026-07-26 — first quality review, superseded baseline](history/2026-07-26-quality-review.md)
