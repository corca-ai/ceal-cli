# Quality Review
Date: 2026-08-19
Title: Worker Markdown lint receiving gate

## Scope

Target boundary: the Worker-owned Markdown quality surface, added in local
commit `ada59b34e8461fed400e748585a4a36a37bbaa75`. The slice owns full and
staged Markdown scope, local policy/dependency, package/check/pre-commit
reachability, gate-contract tests, and the Markdown documentation needed to
explain the receiving contract. It also repairs a retained test-harness race
exposed by the broad proof. Agent changes, Gateway edits, the upstream Charness
authoring preflight, baselines, explicit-any, production typecheck policy, and
the remaining D1 gates are out of scope.

## Surface Contract Review

- semantic coverage: `partial` — Worker source, package/check/hook contracts, local scope, retained tests, mutation proof, and broad local gates were traced; Gateway's Charness preflight is intentionally not claimed.
- surface: Worker Markdown full/staged routes, local policy/dependency, pre-commit hook, check chains, gate contract, docs, and the shared test-build environment seam.
- owner: Worker owns the receiving Markdown route and its contracts; Gateway remains the producer reference for the non-equivalent source shape; Charness owns the omitted authoring preflight.
- source authority: Gateway `scripts/check-markdown.sh:1-28` and `scripts/check_doc_authoring_preflight.py:1-6`; Worker implementation is a receiving contract, not a copied Charness tree.
- projections: tracked/non-ignored untracked Markdown for full checks, changed index Markdown for staged checks, local config/dependency resolution, package/hook/check reachability, and focused contract tests.
- state scope: Worker worktree and staged index only; no runtime service or external state.
- transitions: Git enumerates the selected paths, markdownlint-cli2 reads the local policy and files, and the route returns its lint verdict; missing policy returns 2.
- proof boundary: direct routes, focused contracts, raw tools typecheck, reachability, full `check:unit`, full `check`, pre-commit, and mutation-red/snapshot-restore-green.
- unexamined axes: Gateway preflight equivalence, other OS/Node versions, remote CI/release, Linux runtime, and remaining D1 ports.

## Current Gates

- `node --test test/contract/check-markdown.test.ts`: 4/4; combined Markdown plus repo-build contracts: 26/26.
- Worker `npm run lint`, raw tools typecheck, reachability, gate-contract, full/staged Markdown routes, and `git diff --check`: passed.
- Worker `check:unit` proof result `/tmp/ceal-proof-jobs/worker-d1-markdown-check-unit/result.20260819-markdown-attempt4.json`: exit 0, 45,215 ms.
- Worker full `check` proof result `/tmp/ceal-proof-jobs/worker-d1-markdown-check/result.20260819-markdown-check-attempt1.json`: exit 0, 85,640 ms; 69 pass, 1 skip, 0 fail.
- Commit pre-commit route: passed, including staged Markdown over 6 changed files. Full Markdown route enumerated 19 files and reported 0 issues.

## Mutation / Restore Proof

- Snapshot `/tmp/ceal-worker-markdown-proof.Q4Ya5N/README.md`: injecting an extra blank line made `npm run lint:markdown` exit 1 with `README.md:3 MD012`; restoring from the snapshot returned SHA-256 `06719b795979b68b297b36f4f7a9b180fb4ec0692d1a65d4188023912a89c3d8`, and the full route returned 0.
- The focused staged violation returned 1, while a missing `.markdownlint-cli2.jsonc` returned 2. Restoration used the current snapshot rather than `git checkout`, preserving the intended committed Markdown edits.

## Runtime Signals

- runtime source: structured proof-runner result JSON under `/tmp/ceal-proof-jobs`; no persistent trend capture.
- runtime hot spots: no stable ranking; the one-off full-check duration is recorded under `## Current Gates`, not promoted to a runtime hot-spot claim.
- coverage gate: targeted routes, full/staged Markdown, `check:unit`, full `check`, and pre-commit passed locally.
- evaluator depth: deterministic local gates plus bounded fresh-eye review; no Gateway preflight, live, release, or remote evaluator applied.

## Healthy

- Worker has typed full/staged Markdown routes, a checked-in local policy, an exact dependency, contract tests, package/check/pre-commit reachability, and docs that name the partial semantic boundary.
- The route fails closed for a missing local policy and does not inspect `charness-artifacts/`, `.charness/`, `.cautilus/`, or `.pytest_cache/`.
- The Markdown mutation is red and snapshot restore is green; the broad proof also remained green after the test harness stopped mutating global `PATH`.
- No ratchet, baseline, diagnostic suppression, production `skipLibCheck`, Gateway source edit, or copied upstream Charness tree was added.

## Weak

- The Worker route is intentionally not equivalent to Gateway's Charness authoring preflight; upstream packaged source is not a Worker-owned dependency.
- Markdown policy currently disables MD013 line-length enforcement, so this slice does not claim a line-length cleanup.
- Worker Knip configuration/tag hints remain nonblocking output owned by existing config; the full check printed the same nine hints.

## Missing

- Gateway's authoring preflight is not ported; import-resolution, secrets, and Agent duplicate-detector D1 gates remain.
- No Linux runtime, CI, release, or cross-host proof was possible or in scope on this macOS host.

## Deferred

- Kant's fresh-eye finding was accepted as a partial-contract boundary only because the preflight omission, local scope, and reachability are stated in source/docs/tests; no second code repair was required.
- The global `PATH` mutation in the timeout fixture was repaired as retained-path test debt, not worked around by serializing or rerunning the proof.

## Advisory

- Worker Knip output: `npm run check` printed three existing configuration hints and six existing tag hints; owned by `knip.json`/existing annotations, deferred to a separate quality sweep.
- Dirty-checkout attestation: `postcheck` intentionally did not record a receipt for 20 differing paths; this is expected while the local slice is being assembled, not a hidden check failure.
- Full Gateway Charness authoring preflight: explicit scope-out because the Worker has no owned packaged helper; this is a partial receiving contract, not a complete port.

## Delegated Review

- status: executed.
- Kant's bounded fresh-eye review covered source-of-truth scope, package/hook/full-check reachability, local policy, and the non-equivalence to Gateway's preflight; findings were received and dispositions recorded.
- The primary reread the fixed Gateway wrapper, Worker implementation, contract test, docs, package scripts, and hook before accepting the partial contract.
- No second code-repair round was required after the review.

## Commands Run

- Worker: `node --test test/contract/check-markdown.test.ts`; `node --test test/contract/repo-build.test.ts test/contract/check-markdown.test.ts`; `npm run lint`; `npm run lint:types:raw:tools`; `npm run lint:markdown`; `npm run lint:markdown:staged`; `npm run lint:reachability`; `node test/gate-contract-lib.ts`; `npm run check:unit`; `npm run check`; and commit pre-commit.
- Worker mutation: injected an extra blank line into `README.md`, ran `npm run lint:markdown`, restored `/tmp/ceal-worker-markdown-proof.Q4Ya5N/README.md`, compared SHA-256, and reran the full route.
- Structural repair: targeted repo-build contracts before and after replacing global `PATH` mutation with a per-call `buildEnv`.

## Recommended Next Quality Moves

- active continue D1 with the next independent structural gate; preserve source-tree identity, receiving policy/config/test/hook contracts, and mutation/restore proof.
- passive decide whether a future Worker slice should consume the upstream Charness authoring preflight through an owned dependency because the current checkout does not own that packaged helper; do not copy its cache or silently widen this gate.
- passive address the existing Worker Knip hints in a separate quality sweep until that sweep owns their disposition; do not alter this Markdown gate to suppress them.

## History

- [Previous Worker quality review](history/2026-07-26-quality-review.md)
