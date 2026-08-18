# Quality Review
Date: 2026-08-19
Title: Worker and Agent source-NUL structural gate port

## Scope

Target boundary: the Gateway source-NUL gate from immutable commit
`3cb729ba5d6f76ff6796e60a541454ff9ebbc924`, ported to the Worker and Agent
sibling checkouts. The port owns raw-byte detection in tracked source, staged
index coverage at pre-commit, package/check reachability, gate contracts, and
retained-path tests. Baselines, explicit-any, production typecheck policy,
Gateway edits, and the remaining D1 gates are out of scope.

## Surface Contract Review

- semantic coverage: `partial` — source behavior, receiving gate chains, hook/index semantics, contracts, tests, and local broad gates were traced; no CI/release or Linux-runtime claim.
- surface: Worker and Agent source-NUL structural gates, normal/staged routes, package chains, pre-commit hooks, and retained tests.
- owner: Worker and Agent own their receiving checker/config/hook/test contracts; Gateway owns the fixed source contract.
- source authority: Gateway files at commit `3cb729ba5d6f76ff6796e60a541454ff9ebbc924`; Gateway remained read-only.
- projections: normal tracked-source scan, staged index-source scan, package/check or lint reachability, hook command extraction, and pure-function tests.
- state scope: tracked source worktrees and staged index paths in the two receiving repositories; no runtime service or external state.
- transitions: Git enumerates paths, the checker reads worktree or index content, reports file/line and returns nonzero for a raw byte; clean returns zero.
- proof boundary: direct tests, normal/staged commands, Worker contract tests, Agent quality/gate tests, `check:unit`, `check:contributor`, and mutation-red/snapshot-restore-green.
- unexamined axes: newline-bearing source paths, other OS/Node versions, Linux Agent runtime, CI/release, and remaining structural gate ports.

## Current Gates

- Worker source-NUL tests: 4/4; `repo-gates.test.ts`: 54/54; normal/staged routes: passed.
- Agent source-NUL plus gate-contract tests: 11/11; `test:quality`: 9/9; normal/staged routes: passed.
- Worker `check:unit` proof job: exit 0, 41,875 ms. Agent `check:contributor`: exit 0, 28,993 ms.
- Agent `check` reached lint/static quality, then its Linux-only runtime lane refused on macOS with `linux_runtime_requires_linux`; the portable contract route passed.

## Mutation / Restore Proof

- Worker snapshot `/tmp/ceal-d1-worker-nul-proof.kNDgRI/check-no-legacy-mjs.ts`: appending one raw NUL made `npm run lint:source-nul-bytes` exit 1 at line 157; snapshot restore returned hash `a750859ec8c379da468686eb30c17c2fa7e980ab`, and normal/staged routes returned 0.
- Agent snapshot `/tmp/ceal-d1-agent-nul-proof.OV2924/check-no-legacy-mjs.ts`: the same mutation exited 1 at line 136; restore returned hash `c92bdb3089f598b4312d7a06846e3dbaea815f02`, and normal/staged routes returned 0.
- Both restores used current snapshots, not `git checkout`; intended staged diffs remained unchanged.

## Runtime Signals

- runtime source: structured proof-runner result JSON under `/tmp/ceal-proof-jobs`; no persistent trend capture.
- runtime hot spots: no stable hot-spot ranking; recorded durations are command-level observations, not a benchmark.
- coverage gate: targeted source/gate tests and the portable broad routes passed; the Agent Linux-only lane was platform-refused.
- evaluator depth: deterministic local gates plus bounded parent-delegated fresh-eye review; no live or release evaluator applied.

## Healthy

- Both receiving repositories have typed checker implementations and focused tests; no copied test family remains under `scripts/` unreachable.
- Normal checks enumerate all tracked source; pre-commit preserves the Gateway staged changed-path/index contract, without claiming it rescans unchanged tracked files.
- The Gateway staged-mode missing `execFileSync` import was corrected only in the receiving ports; no Gateway source was edited.
- No ratchet, baseline, count manager, diagnostic suppression, or production `skipLibCheck` change was added.

## Weak

- Git path output remains newline-delimited to match the fixed Gateway helper; newline-bearing paths are a tracked follow-up, not a receiving-only semantic change.
- Read failures are skipped, matching the Gateway unreadable-file/staged-deletion contract; this gate does not claim fail-closed unreadability detection.
- Worker Knip hints and Agent negative-fixture diagnostics remain expected nonblocking output owned by their existing configs/tests.

## Missing

- Import-resolution, secrets, markdown, and duplicate-detector D1 gates are not ported by this sub-slice.
- No Linux Agent runtime, CI, or release proof was possible or in scope on this macOS host.

## Deferred

- Fresh-eye findings on staged scope and unreadable files were checked against the fixed Gateway source/test contract and accepted; newline serialization remains in the active goal Claim Ledger.
- Mutation/restore evidence is recorded here, in both impl closeouts, and in the Worker goal Claim Ledger before local commit.

## Advisory

- Worker Knip output: `command: npm run lint:unused` printed nine existing configuration/tag hints; owned by `knip.json`, deferred to a separate quality sweep.
- Agent fixture output: `command: npm run check:contributor` printed existing verifier/adapter negative-fixture diagnostics; owned by those public suites, with no new source-NUL failure.
- Newline path scope: `artifact: active goal Claim Ledger` records the shared source-integrity follow-up rather than silently changing one receiving port.

## Delegated Review

- status: executed.
- Three parent-delegated medium-tier reviewers covered reachability, byte/index portability, and source-of-truth/scope counterweight; findings were received and dispositions recorded.
- Both `reviewer_boundary_fingerprint.py verify` commands returned `ok: true`, `verdict: clean`, and empty drift for the D1 snapshots. An initial invocation without `--before` returned exit 2 and was repaired with the exact snapshot paths.
- No second code-repair round was required because round 1 produced no code repair.

## Commands Run

- Worker: focused source/gate tests, `npm run lint`, raw tools typecheck, normal/staged source-NUL routes, and proof-runner `npm run check:unit`.
- Agent: focused source/gate tests, `npm run test:quality`, `npm run lint`, normal/staged source-NUL routes, proof-runner `npm run check`, and `check:contributor`.
- Both: raw-NUL mutation, current-snapshot restore/hash comparison, `git diff --check`, and reviewer-boundary verification.

## Recommended Next Quality Moves

- active continue D1 with the next independent Gateway structural gate; preserve receiving policy/config/test/hook contracts and repeat mutation/restore proof.
- passive track newline-safe Git path serialization until newline-bearing source paths become in-scope; keep one shared source-integrity decision rather than a new baseline.
- passive address the existing Worker Knip hints until a separate quality sweep owns them.

## History

- [Previous Worker quality review](history/2026-07-26-quality-review.md)
