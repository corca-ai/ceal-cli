# Session Handoff

## Workflow Trigger

If this file is mentioned with no other task, read `## Current State`, then pick
from `## Debt` or do what the operator asked for. `ceal capabilities --fresh` and
`ceal call` are live-session, provider-touching acts: approval first.

## 2026-08-08 — the legacy lane is gone

Two slices.

**1. Test cleanup.** The criterion throughout: does this assertion breaking mean
a real defect, or only that two files were not hand-synchronized?

- The `release-contract.json` guide-digest assertion left the worker gate. The
  previous handoff recorded that "the release never reads that value" — that was
  **wrong**: `build-platform-binaries.mjs` read it and failed `guide_drift` on a
  mismatch. But that was the frozen legacy lane, and the worker lane's own
  `worker-release-inputs.json` names `release-contract.json` under
  `forbidden_release_inputs`. So the assertion did not belong in the worker gate,
  and it went to the suite that tested the lane consuming it — which has since
  been deleted along with that lane.
- `guide-contract.test.mjs` duplicated all four of `worker-guide-contract.test.mjs`'s
  contracts. It was the copy the lane split forked from.
- The workflow-sequence regex pinned `--fresh` as a literal, so a test titled
  "without command snapshots" was itself a snapshot, and `cc29047` broke it by
  making a documented authoring decision. It now pins order and profile scoping.
- Elsewhere: exact npm-script strings became file-set membership plus a runner
  check; ordered `workspaces` and platform literals became the claim itself; a
  duplicated raw-YAML tag trigger went in favour of the parsed one; the
  `platformProofTest` name inventory became its anti-vacuity floor. The test
  asserting `WORKER_CONTRACT_TESTS.length <= 20` against a constant declared in
  the same file was deleted.

**2. Deleting the legacy lane.** Checked against `../ceal` directly: the cealctl
material here was a **stale fork**, not a compatibility input.
`packages/ceal-operator-cli` was missing `access-command-help.ts` and
`bounded-json-response.ts` and differed in six more source files; the operator
guide had been rewritten wholesale into
`packages/official-skills/ceal-native/skills/cealctl-guide/SKILL.md`; the
installer had moved to `packaging/cealctl/install-cealctl.sh`. And
`packaging/ceal-cli-source/` is genuinely absent from that repo. This was the
Stage 5 deletion gate the README already described.

Deleted: `packages/ceal-operator-cli`, `skills/cealctl-guide`, `install.sh`,
`release-contract.json`, `ceal-cli-seed-manifest.json`,
`scripts/build-platform-binaries.mjs`, `scripts/build-release-manifest.mjs`,
`.github/workflows/cealctl-release.yml`, the four-file `test:legacy-compatibility`
suite, and the dead half of the development-only chain —
`scripts/build-worker-release-artifact.mjs`,
`scripts/verify-worker-release-inputs.mjs`, `release/worker-inputs.json` and their
tests.

**Kept, and why:**

- `.github/workflows/npm-package-stage.yml` and its bare `v*` tags. Not cealctl
  material: it is the only npm publish path `@corca-ai/ceal-protocol` and
  `@corca-ai/ceal` have. Operator's call.
- `scripts/verify-gateway-protocol-consumer.mjs`. **Not dead code** — it runs
  inside `npm run check` through `test/gateway-protocol-consumer.test.mjs` for
  about 16s, and proves two things the live lane cannot, because the live lane
  hand-extracts tarballs and never invokes npm's resolver: that a real install
  binds `package-lock` to the Gateway tarball rather than a workspace link or the
  registry, and that `import.meta.resolve` in the installed consumer lands under
  `node_modules/`. It now reads the live `worker-release-inputs.json` instead of
  the duplicate inventory it used to carry.

**Relocated, not dropped:** the release-identity claims only the deleted tests
made — worker is `private: true`, client and protocol stay publishable, consumers
pin the vendored protocol exactly — moved into `repo-gates.test.mjs`. The
`forbidden_release_inputs` content pin moved into `worker-release-inputs.test.mjs`,
which until then would have stayed green on an emptied list.

## Current State

- Version `0.74.0` (root and `packages/ceal-worker-cli` agree), latest tag
  `ceal-v0.74.0`.
- `gateway-protocol-handoff-lock.json` is the single record of handoff consumption.
- Four workflows: `check.yml`, `ceal-release.yml`,
  `ceal-worker-stable-rollback.yml`, `npm-package-stage.yml`.
- Gates: `npm run check` passes in about 1m44s, `check:unit` in about 43s, both
  timed with `time` on this host. Two suites only — `test:contract`,
  `test:release`.

## Debt

Carried from the previous handoff and **none of it re-confirmed**. Check that an
item is still true before starting on it.

- **The signed release manifest has no client package.**
  `ceal-worker-release-manifest-<platform>.json` records only the protocol, so a
  consumer is left with a source-owner claim. The real fix puts the client in the
  manifest schema, which is a release-affecting change.
- **The acceptance record's receipt branch is not an allow-list.** It passes a
  Gateway receipt event through without projection, so `membership_ref` and
  `subject_ref` ride along.
- **The record has two formats.** The repo script emits JSON, the installed
  command emits YAML.
- **CI has no macOS install leg.** Do not cite `require_platform_proofs` as the
  reason — that is about the release and installer suites, and requiring it across
  all of `linux-*` is what burned `ceal-v0.67.0`. It is narrowed to `linux-amd64`
  and gated there now.
- **The worker `createLock` race** is unresolved.
- **Requirement 3 has no behavioural test.** Divergence refusal across five paths
  is held only by a source-shape gate in `repo-gates.test.mjs`, because a
  converged live pin cannot falsify it behaviourally.
- **`assertWorkerReleaseSourcePath` has no production caller.** The
  forbidden-path enforcement in `worker-release-inputs.mjs:220` is reached only
  from tests, so the inventory may be declared and enforced nowhere.

Everything else is owned by the comment at the site and by [gates.md](gates.md).

## References

- [Gate detail](gates.md) · [release and enrollment](release-and-enrollment.md) ·
  [operator acceptance ceiling](operator-acceptance.md)
- [docs/requests/](requests/) — where a divergence declaration must point; the
  split-era correspondence that filled it was deleted on 2026-08-08 and is in `git log`
