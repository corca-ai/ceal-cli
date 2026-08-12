# Public Visibility for CI Cost: Decision Critique
Date: 2026-08-12

## Decision Under Review

Make `corca-ai/ceal-cli` public primarily to eliminate standard GitHub-hosted runner minute charges. This review decides the preconditions for that visibility change; it does not authorize a visibility change, ref deletion, history rewrite, force-push, or release action.

## Decision

Prefer a direct visibility change only after a complete public-surface audit and explicit legacy-surface decisions. Do not treat history rewrite or force-push as a normal part of this conversion.

## Capability at Stake

Preserve the worker release provenance and secret boundary while reducing the cost of the standard Linux and macOS GitHub-hosted CI lane. The existing gate deliberately retains macOS coverage for code changes: `.github/workflows/check.yml:1-37`.

## Failure Angles

- **Framing / diagnostic:** standard GitHub-hosted runners are free for public repositories, but artifacts, cache storage, and larger runners are separate cost surfaces. The success line must be runner-minute cost reduction, not an unsupported claim that all CI costs become zero. `.github/workflows/check.yml:59-212`; [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions).
- **Operational public surface:** making a private repository public exposes reachable code, allows forks, publishes Actions history and logs, and disables push rulesets. [GitHub visibility consequences](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility#changing-from-private-to-public).
- **Release provenance:** `ceal-v*` tags invoke the worker release workflow and its tag-bound signing identity; burned tags are not reused. `.github/workflows/ceal-release.yml:3-22`, `.github/workflows/ceal-release.yml:273-301`, `README.md:194-199`.
- **Historical scope:** the remote still contains `client-protocol-0.67.0-sync` and legacy `v0.1.0`, `v0.1.1`, and `v0.65.0` releases, including historical `cealctl` surfaces that current ownership puts in the sibling repository. `README.md:9-27`, `README.md:249-253`; reproduce with `git ls-remote --heads origin` and `gh api 'repos/corca-ai/ceal-cli/releases?per_page=100' --paginate`.

## Findings

- Current hosted-runner labels are standard public-runner labels (`ubuntu-24.04`, `ubuntu-24.04-arm`, `macos-15`), so the stated minute-cost objective is credible. `.github/workflows/check.yml:62`, `.github/workflows/ceal-release.yml:61-80`.
- The current repository settings need an explicit public-PR policy: `check.yml` uses `pull_request` and per-job `contents: read`, but the repository default workflow permission is currently write, allowed actions are all, and SHA pinning is not required. Reproduce with `gh api repos/corca-ai/ceal-cli/actions/permissions` and `gh api repos/corca-ai/ceal-cli/actions/permissions/workflow`.
- `main` is currently unprotected and the repository has no rulesets; public conversion does not itself remove a currently-enforced branch rule, but it must not disguise this governance decision. Reproduce with `gh api repos/corca-ai/ceal-cli/branches/main/protection` and `gh api repos/corca-ai/ceal-cli/rulesets`.
- The release environments have no protection rules, permit admin bypass, and current repository-level Cloudflare credential names differ from the environment-scoped names release workflows expect. This is a release-governance item, not proof that an external fork can access the secret. Reproduce with `gh api repos/corca-ai/ceal-cli/environments`, `gh api repos/corca-ai/ceal-cli/actions/secrets`, and `gh api repos/corca-ai/ceal-cli/actions/variables`.
- Code Security, secret scanning, secret-scanning push protection, non-provider patterns, and Dependabot security updates were enabled on 2026-08-12; CodeQL default setup is configured. This is discovery coverage, not proof that old refs, release assets, or Actions logs are safe. Reproduce with `gh api repos/corca-ai/ceal-cli` and `gh api repos/corca-ai/ceal-cli/code-scanning/default-setup`, then audit all refs/releases/logs before changing visibility.

## Counterweight Pass

### Act Before Ship

- Obtain a billing-owner baseline and define success as standard hosted-runner minute cost reduction; retain a separate storage/larger-runner budget. `gh api orgs/corca-ai/settings/billing/actions` is the intended reproduction, subject to billing authorization.
- Audit every branch, tag, release asset, Actions log/artifact, and enabled community surface for secrets, personal information, internal operational detail, and obsolete product material. Revoke or rotate any live credential before attempting to remove its references.
- Get the owner decision for legacy `cealctl` branch/tag/release material: retain it knowingly in public, or remove the named remote refs/assets only after consumers and the Gateway owner are checked.
- State in the conversion plan that broad history rewrite, tag movement, mirror force-push, and retagging are prohibited by default. Consider a narrowly scoped rewrite only when the audit proves a specific history exposure and its release/downstream impact has a separately approved migration plan.

### Bundle Anyway

- The default `GITHUB_TOKEN` permission is now read-only and Actions may not approve pull requests. Before public PRs are accepted, decide the fork-run approval policy and evaluate an allowlist plus mandatory full-SHA action pinning. The existing per-job read-only PR design is a sound starting point. `.github/workflows/check.yml:39-67`, `.github/workflows/check.yml:135-155`.
- Remove or rotate confirmed-obsolete repository-level Cloudflare credentials and enable public-repository secret scanning; make the changed `README.md:3` visibility claim and community policy match the chosen operating model.

### Valid but Defer

- Design of required reviewers and admin-bypass policy for `ceal-cli-release` and `ceal-npm-release` is a real release-governance decision. It should be completed before the next release, but it need not be conflated with public read/fork access if current tag/environment protections remain correctly scoped.

### Over-Worry

- "A public repository must be made clean by rewriting all history and force-pushing." GitHub visibility conversion does not require it, and this repository's tagged release provenance makes it an especially unsafe default.

## Acceptance Tightening

The conversion may proceed only when an owner has recorded all of the following:

1. a billing baseline and the bounded cost-success definition;
2. a completed public-surface audit and any credential revocation/rotation evidence;
3. a retain/remove decision for every legacy branch, tag, release, asset, and community surface that is not intended to be public;
4. a public-PR Actions policy with settings readback; and
5. an explicit no-rewrite/no-force-push default, with any exception approved as a separate provenance migration.

## Deliberately Not Doing

- No visibility setting, ref, release, artifact, secret, or workflow was changed in this review. GitHub repository settings changed afterwards: organization policy keeps forking disabled; Code Security, secret scanning, secret-scanning push protection, non-provider patterns, Dependabot security updates, and CodeQL default setup are enabled; the default `GITHUB_TOKEN` is read-only and Actions cannot approve PR reviews.
- No broad history rewrite or force-push is proposed merely to save CI budget.

## Structured Findings

- F1 | bin: act-before-ship | evidence: strong | ref: .github/workflows/check.yml:62; https://docs.github.com/en/billing/concepts/product-billing/github-actions | action: document | note: define success as public standard-runner minute reduction and retain a separate storage/larger-runner budget
- F2 | bin: act-before-ship | evidence: strong | ref: https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility#changing-from-private-to-public | action: document | note: audit and approve all public surfaces including Actions history and logs before visibility changes
- F3 | bin: bundle-anyway | evidence: strong | ref: .github/workflows/check.yml:39; gh api repos/corca-ai/ceal-cli/actions/permissions/workflow | action: fix | note: harden default Actions policy before accepting public fork PRs
- F4 | bin: act-before-ship | evidence: strong | ref: README.md:9; git ls-remote --heads origin | action: document | note: decide retain or remove historical cealctl branches, tags, releases, and assets by exact name
- F5 | bin: act-before-ship | evidence: strong | ref: gh api repos/corca-ai/ceal-cli; gh api repos/corca-ai/ceal-cli/actions/secrets | action: document | note: scan every public surface and revoke or rotate any live credential before exposure
- F6 | bin: over-worry | evidence: strong | ref: README.md:194; .github/workflows/ceal-release.yml:273 | action: document | note: broad history rewrite or force-push is not a prerequisite and threatens release provenance
- F7 | bin: valid-but-defer | evidence: strong | ref: gh api repos/corca-ai/ceal-cli/environments | action: defer | follow-up: deferred docs/release-and-enrollment.md | note: decide environment reviewers and admin-bypass policy as a release-governance slice

## Reviewer Tier Evidence

- Requested tier: high-leverage.
- Requested spawn fields: n/a (no critique adapter declares host-specific reviewer-tier fields).
- Host exposure state: metadata-hidden
- Application state: n/a (the host returned no applied-tier confirmation).
- Delivery state: findings-received.

## Fresh-Eye Satisfaction

parent-delegated. Three separate bounded reviewers returned a framing/diagnostic angle, an operational angle, and a counterweight triage. Parent-side boundary verification was clean after each reviewer: `/tmp/public-conversion-20260812-cost-framing.json`, `/tmp/public-conversion-20260812-ops.json`, and `/tmp/public-conversion-20260812-counterweight.json`.

## Reviewed Input Identity

No prepared packet was consumed; the repository has no critique adapter packet sections.

## Boundary Ownership

- Producer: GitHub repository visibility, Actions, release, and security settings; remote refs and release assets.
- Consumer: public source readers, fork contributors, installed-worker release consumers, and the organization billing owner.
- Owning surface: `corca-ai/ceal-cli` repository settings plus its remote ref/release inventory.
- Verdict: owned-correctly.

## Next Move

Prepare a public-conversion checklist/plan from the acceptance tightening above, then request separate approval for any GitHub setting, deletion, rewrite, or force-push it would perform.
