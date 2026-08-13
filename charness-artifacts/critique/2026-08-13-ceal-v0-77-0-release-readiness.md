# Ceal Worker v0.77.0 Release Readiness Critique

Date: 2026-08-13
Decision: publish `ceal-v0.77.0` from the final clean `ceal-cli` candidate
Status: act-before-tag findings remain

## Decision Under Review

Release the Worker that consumes signed Gateway Protocol handoff v0.72.21,
serves the exact v6 leased-control contract including result materialization,
and separates editable-source behavior proof from immutable artifact proof.

## Failure Angles

- The privileged GitHub Environment can be structurally present but unable to
  publish the exact candidate because its protection, credentials, commit, or
  assembled inventory approval is absent or stale.
- A tag can bind an intermediate commit while final source-authority repairs or
  the release notes are still outside the candidate.
- A changed release workflow can pass local tests but fail only after an
  immutable tag is spent unless the dispatch-only assembly lane runs first.
- Local package and native proofs do not substitute for the repository-owned
  worker pre-tag preflight or for public signed readback.
- Provider execution can be incorrectly inferred from a signed Worker contract
  even though this tag reaches only artifact-level proof.

## Counterweight Pass

- Act before tag: finish and commit the source/artifact authority repairs; run a
  clean full check; push the exact candidate and require its `check.yml` run.
- Act before tag: run the changed release lane by `workflow_dispatch`, bind the
  exact candidate commit and assembled `SHA256SUMS` digest in the protected
  `ceal-cli-release` Environment, and supply only the required Environment-local
  publishing credentials.
- Act before tag: require the Gateway repository's worker pre-tag preflight to
  return `ok: true` for `ceal-v0.77.0` and the exact `ceal-cli` root.
- Bundle anyway: keep the 0.77.0 changelog entry and its explicit non-claims in
  the candidate even though the current preflight does not enforce it.
- Valid after tag: install through `ceal update`, read back the signed version,
  then register and read back the embedded guide.
- Over-worry: lack of a live provider roundtrip before the Worker tag. The tag
  proves the signed consumer artifact, not Gateway advertisement or provider
  execution, and the changelog says so.

## Structured Findings

- F1 | act-before-tag | evidence: live readback + source | action: fix external
  boundary | `ceal-cli-release` currently has no protection rule, no
  `CEAL_ENV_CLOUDFLARE_ACCOUNT_ID`, no `CEAL_ENV_CLOUDFLARE_API_TOKEN`, and stale
  approved commit/digest values; the workflow requires all four facts.
- F2 | act-before-tag | evidence: source/worktree | action: finish locally |
  final candidate must contain every release note and authority repair and pass
  `npm run check` cleanly.
- F3 | act-before-tag | evidence: owner procedure | action: dry-run | this
  release changed `.github/workflows/ceal-release.yml`, so dispatch-only assembly
  is mandatory before tag creation.
- F4 | act-before-tag | evidence: host rule | action: preflight | run
  `npm run release:pre-tag-preflight -- --surface worker --tag ceal-v0.77.0
  --repo-root /home/ubuntu/ceal-cli` from `/home/ubuntu/ceal` and require
  `ok: true`.

## Recheck Commands

```sh
gh api repos/corca-ai/ceal-cli/environments/ceal-cli-release \
  --jq '{protection_rules, deployment_branch_policy}'
gh variable list -R corca-ai/ceal-cli --env ceal-cli-release
gh secret list -R corca-ai/ceal-cli --env ceal-cli-release
gh secret list -R corca-ai/ceal-cli
git -C /home/ubuntu/ceal-cli status --short
npm run check
gh run list --repo corca-ai/ceal-cli --workflow ceal-release.yml
npm run release:pre-tag-preflight -- --surface worker --tag ceal-v0.77.0 \
  --repo-root /home/ubuntu/ceal-cli
```

## Reviewed Identity

- Signed Protocol handoff: `gateway-protocol-handoff-v0.72.21`
- Gateway commit: `aa4bc9f65c88a445f957cd33f105894e8df2f814`
- Frozen Protocol tree: `e20497d4ebe25a675012c676448e14eea4da891c`
- Candidate version: `0.77.0`
- Final Worker commit: intentionally unresolved until the findings above close

## Fresh-Eye Satisfaction

Parent-delegated bounded release critique. The reviewer found no additional
artifact-identity, monotonic-upgrade, rollback, or provider-proof blocker.

