# Operator Acceptance

What a `ceal-cli` maintainer can prove alone, what needs the Gateway lane, and
what the release lane needs before a tag is worth spending. Written for a
successor who inherits this repository without inheriting anyone's credentials.

Roles, not hosts: this repository is owned by the **worker lane** (worker CLI,
client SDK, `ceal-guide`). Gateway routes, connector execution, Profile policy,
audit custody, `cealctl`, and the canonical protocol are owned by the **Gateway
lane**, a different operator on a different machine. `AGENTS.md` declares this
checkout's lane directly; every step below that says "the Gateway lane" means a
request to that operator, not a command you can run here.

Re-verify rather than quote. Every fact below was read from the repository or
from GitHub on 2026-07-27 and each one carries the command that re-reads it. A
figure copied out of this file into a claim is exactly the failure this file
exists to prevent.

## The Ceiling Without A Gateway Session

These representative routes need nothing but a built or installed worker CLI.

| Route | Proves |
| --- | --- |
| `ceal version` | which build is installed |
| `ceal commands` | the declared route surface, effects included |
| `ceal guide status` | the signed embedded guide carrier is available, and where it would register |
| `ceal session status` | whether this HOME has a configured client session |
| `ceal observe` | the local page renders this client's cached state; serves until Ctrl-C |

`ceal guide status` needs a **signed installed release**, not a session: the
complete guide directory is embedded in the real executable and is materialized
only by explicit registration, so a `node dist/bin.js` run from a checkout
answers `guide_unavailable` no matter how healthy the install is. That is a
property of the dev build, not a failure.

Gateway- and session-bound routes fail closed without a Gateway-issued client
session, and failing closed is the correct answer rather than a broken one:

- `ceal capabilities`, `ceal capabilities targets` — `client_session_unavailable`
- `ceal call`, `ceal receipt show` — no session to authorize or read back with
- `ceal session enroll` — needs an enrollment code the Gateway lane issues

Local routes are separate: `ceal update` and `ceal guide register codex|claude`
need no Gateway session, but they are local writes and are not part of a
read-only ceiling probe.

Read the ceiling back yourself, in a throwaway HOME that cannot touch real state:

```
npm run build
npm run probe -- ceal commands
npm run probe -- ceal session status   # expect status: unconfigured, exit 0
```

`capabilities`, target discovery, `receipt`, and `acceptance` are declared
`read_only` and must not rotate an expired or rejected Gateway session. Probe
them through the guard; if the stored bearer is no longer usable, run the
separately declared `remote_write` route `ceal session refresh`. `ceal call`
remains `remote_write` and may renew before its already-write-capable operation.

The commands above prove the checkout-built surface in a throwaway HOME. A
separate signed-install run of `ceal version` and `ceal guide status` proves the
installed release and its embedded guide carrier. Neither level proves that any
capability executes, that a receipt is real, that a Profile policy decided
anything, or that an audit record exists. Do not describe work at either level
as verified end to end — `AGENTS.md` requires naming the highest proof level
actually reached.

## What Needs The Gateway Lane

Re-enrollment ends with one local command, but every step that makes it possible
runs on the Gateway lane's host against the owner copy of `cealctl`. The local
step is inert without the code those steps produce, so a successor without that
access has no substitute and no fallback path:

- issuing an enrollment code (`cealctl enrollments create`) — Gateway lane only
- any live capability, receipt, or audit readback — requires the session that
  code produces
- a dev-instance re-enrollment — **destroys this host's existing prod binding**,
  so it is never a casual verification step. The client now refuses it rather
  than performing it silently: enrolling or adopting a different identity names
  the bindings that changed and revokes the session it declined to keep, and
  `--force` is the only path that replaces one. That turns a silent loss into a
  deliberate one; it does not give the prod binding back.

The route in: ask the Gateway lane operator directly. This lane's standing
practice is to leave the request as a written prompt under `docs/requests/`, so
the ask is reviewable and the answer has something to attach to.

## Before Spending A Release Tag

A tag is not retryable. `CHANGELOG.md` records which tags were burned and why,
and a burned tag is never reused — so a successor who tags to find out whether
they have access pays a version number to learn it. Check first.

The worker release lane fires on `ceal-v*.*.*` and drives
`.github/workflows/ceal-release.yml`. Its `ceal-cli-release` Environment must be
protected before release and must own the release-origin identity and credential:

```
gh variable list -R corca-ai/ceal-cli --env ceal-cli-release # expect CEAL_ENV_CLOUDFLARE_ACCOUNT_ID plus the two CEAL_CLI_APPROVED_* variables
gh secret list   -R corca-ai/ceal-cli --env ceal-cli-release # expect CEAL_ENV_CLOUDFLARE_API_TOKEN
```

The workflow re-checks them at run time and fails the job by name if either is
empty, so a missing Environment value costs the tag.

The proof/ship state no longer needs a separate look to avoid a wasted tag: it is
a gate failure. A green `npm run check` already means the protocol bytes this
repository tests against are the bytes a release would ship from the locked
handoff archive. To read it directly, offline and with no Gateway session:

```
node scripts/verify-protocol-vendor-pin.mjs   # exit 0 only when shippable
```

A non-zero exit with `proof_shipment_protocol_divergence` names the vendored
copy's Gateway commit and the one the lock binds, and it blocks the release,
packing, and acceptance-packet paths independently of whether any test ran. While
it is failing, `npm run check:protocol-dev` still verifies the development
vendor identity and exercises the client suite — its output is stamped
`proof_level: development_only` and must
not be cited as release or installed-worker evidence. `docs/gates.md` says what
the check does and does not cover.

Signing is keyless, but publishing is privileged. The `sign-and-publish` and
rollback activation jobs use the `ceal-cli-release` Environment, whose approved
commit and SHA256SUMS digest are rechecked before signing or release-origin
mutation. Distinct `CEAL_ENV_*` names make missing Environment credentials fail
closed instead of falling back to legacy repository-wide values.

The repository's unprotected `main` policy does not authorize an unprotected
release boundary. Before spending a tag, verify the Environment has a real
protection rule and inspect tag rules rather than trusting the workflow comment:

```
gh api repos/corca-ai/ceal-cli/environments/ceal-cli-release --jq '{protection_rules, deployment_branch_policy}'
gh api repos/corca-ai/ceal-cli/rulesets --paginate
gh api repos/corca-ai/ceal-cli/environments/ceal-cli-release/variables --jq '.variables[].name'
gh secret list -R corca-ai/ceal-cli --env ceal-cli-release
gh secret list -R corca-ai/ceal-cli
```

Expect `CEAL_CLI_APPROVED_COMMIT`,
`CEAL_CLI_APPROVED_SHA256SUMS_SHA256`, and
`CEAL_ENV_CLOUDFLARE_ACCOUNT_ID` in the Environment variables, and
`CEAL_ENV_CLOUDFLARE_API_TOKEN` in its secrets. Do not release while the
Environment has no protection rule, while any expected value is absent, or while
a legacy `CEAL_RELEASE_*` credential remains configured. Also confirm no
Cloudflare token is available repository-wide. A tag is a candidate input;
Environment approval is the privileged release decision.

You also need push and tag rights on `corca-ai/ceal-cli`. Verify without
spending anything:

```
gh api repos/corca-ai/ceal-cli --jq '.permissions'
```

Then follow `docs/release-and-enrollment.md`, whose final update → binary
readback → explicit guide registration/readback step turns a published artifact
into an accepted one. The exact tagged `ceal-v0.76.1` installer is a required
direct-update compatibility proof; no bootstrap reinstall is part of the
directory-carrier rollout.

### The npm lane is a separate, currently unconfigured lane

Bare `v*.*.*` tags trigger `.github/workflows/npm-package-stage.yml` — not the
worker lane. They also triggered the frozen `cealctl-release.yml` until that lane
was deleted, so the tag now belongs to the npm lane alone. The npm lane gates on
environment variables in `ceal-npm-release`, and that environment held **no
variables** on 2026-07-27:

```
gh api repos/corca-ai/ceal-cli/environments/ceal-npm-release/variables --jq '.variables[].name'
```

With `CEAL_NPM_BOOTSTRAP_COMPLETE` unset the unprivileged proof job refuses
before checkout or source execution, so a bare `v*` tag pushed today burns that
version for a publish that cannot happen. Only its downstream Environment-bound
job has OIDC permission. This lane does not push those tags.

## Naming What You Could Not Prove

State the reachable level and the gap, both. A local test run is not
released-binary proof, a released binary is not a live provider readback, and a
readback against a dev instance is not one against prod. If the strongest proof
you reached is `surface`, say `surface` and name what a session would have
added — an unproven claim stated plainly costs the next maintainer nothing,
while a claim stated at the wrong level costs them the debugging.
