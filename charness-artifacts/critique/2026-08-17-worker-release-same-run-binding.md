# Worker Release Same-Run Binding Closeout

Date: 2026-08-17

Decision: remove mutable per-release approval identity variables from the Worker
release and rollback lanes. A canonical authorized maintainer tag push selects
the candidate; the privileged jobs use the `ceal-cli-release` Environment only
for stable release-origin credentials and deployment routing, and bind the
commit, artifact name, and signed inventory to the same workflow run.

## Scope

- `.github/workflows/ceal-release.yml`
- `.github/workflows/ceal-worker-stable-rollback.yml`
- `test/contract/repo-gates.test.ts`
- `docs/operator-acceptance.md`
- `docs/handoff.md`
- `docs/release-and-enrollment.md`

The versioned release assets and runtime code were not changed. No tag, push,
GitHub configuration write, package publish, or live instance apply occurred.

## Claim Ledger

| Claim | Source | Recheck | Level |
| --- | --- | --- | --- |
| The publish job receives only stable Environment credentials and checks the pushed canonical tag and assemble digest. | `.github/workflows/ceal-release.yml:281-321` | `node --test test/contract/repo-gates.test.ts` | verified-by-reading and test |
| The privileged job downloads an artifact named with this run's `github.sha` and verifies its inventory before signing. | `.github/workflows/ceal-release.yml:304-326` | `npm run check` | verified-by-reading and full gate |
| Rollback activation binds its downloaded handoff, pointer tag, inventory digest, and installer digest. | `.github/workflows/ceal-worker-stable-rollback.yml:142-170` | `node --test test/contract/repo-gates.test.ts` | verified-by-reading and test |
| Active workflow and operator-doc surfaces no longer use mutable per-release approval variables. | `test/contract/repo-gates.test.ts:1348-1365` | `node --test test/contract/repo-gates.test.ts` | verified-by-test with positive controls |

## Fresh-Eye Review

Fresh-Eye Satisfaction: parent-delegated. Two bounded read-only rounds were
completed. The first round required the workflow/docs/test update, explicit
rollback runbook, and a clear distinction between artifact identity proof and
human digest review. The second round found that rollback needed an explicit
pointer-tag assertion and mutation coverage; both were added before closeout.

The reviewer boundary fingerprints were clean in both rounds:

- `/tmp/worker-release-env-removal-20260817.snapshot`, window
  `worker-release-env-removal-20260817`
- `/home/ubuntu/ceal-cli/.charness/reviewer-boundary/snapshot.json`, window
  `worker-release-env-removal-round2-20260817`

Both verification results were `ok: true`, `verdict: clean`, with no drift.

## Verification

- `npm run check`: passed (client 46/46, worker 392/395 with 3 platform skips,
  contract 238/238, release 69/70 with 1 platform skip).
- `node --test test/contract/repo-gates.test.ts`: 37/37 passed.
- `npm run lint`: passed.
- `npm run lint:shell`: passed.
- `npm run lint:docs-graph`: passed.
- `npm run test:docs-graph`: 5/5 passed.
- `npm run lint:types:tests`: passed its existing diagnostic ratchet; no new
  diagnostics remain from this change.
- `git diff --check`: passed.

The repo-local proof runner referenced by the host rules is not present in this
checkout, so the Worker-owned `npm run check:unit` and `npm run check` commands
were run directly. The direct commands returned exit code 0.

## External Boundary and Deferred Cleanup

The live Environment still contains the two legacy approval variables from the
old workflow. They no longer participate in this local implementation, but
deleting them is a separate GitHub configuration write and must happen only
after the workflow change is pushed and that boundary is explicitly approved.
That cleanup is one-time configuration maintenance; it is not a release-time
operator step.

No human reviewer rule, protected-tag ruleset, or new approval surface was
invented. The remaining external proof is the actual pushed workflow run and
public signed readback after publication.
