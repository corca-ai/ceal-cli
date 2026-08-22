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

This file says what a maintainer can prove and with which access. The reasons
behind the gates those proofs run through are in [gates.md](gates.md): which
lint rules are off on purpose, and which gates live in the pre-push hook rather
than in `npm run check`.

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
| `ceal guide status` | the source or signed guide carrier is available, and where it would register |
| `ceal session status` | whether this HOME has a configured client session |
| `ceal observe` | the local page renders this client's cached state; serves until Ctrl-C |

`ceal guide status` needs no Gateway session. A checkout-built `node dist/bin.js`
reports the canonical `skills/ceal-guide` as `carrier: source` with
`update_safe: false`; that is local source proof, not signed-install proof. A
signed native release reports its embedded carrier and remains the only release
or installation claim.

Gateway- and session-bound routes fail closed without a Gateway-issued client
session, and failing closed is the correct answer rather than a broken one:

- `ceal capabilities`, `ceal capabilities targets` — `client_session_unavailable`
- `ceal call`, `ceal receipt show` — no session to authorize or read back with
- `ceal session enroll` — needs an enrollment code the Gateway lane issues

Local routes are separate: `ceal update` and `ceal guide register codex|claude`
need no Gateway session, but they are local writes and are not part of a
read-only ceiling probe. Registering a source carrier links the mutable
checkout guide and does not make it signed or update-safe.

Read the ceiling back yourself, in a throwaway HOME that cannot touch real state:

```sh
npm run build
npm run probe -- ceal commands
npm run probe -- ceal session status   # expect status: unconfigured, exit 0
```

`capabilities` and target discovery are declared `read_only` with
`session_effect: refresh_if_needed`: an expired, refreshable stored session is
renewed once before the read, and the result reports the outcome. A locally
current or rejected token does not trigger another refresh. `receipt` and
`acceptance` remain read-only observation routes; after their stored bearer is
rejected, use the separately declared `remote_write` route `ceal session
refresh`. `ceal call` remains `remote_write` and may renew before its already-
write-capable operation.

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

The route in: ask the Gateway lane operator directly. A Protocol handoff is the
other thing only that lane can produce — `gateway-protocol-handoff-lock.json`
records which signed archive this repository consumes, and a successor arrives
through `npm run bootstrap:gateway-handoff`, never through correspondence copied
into this repository.

## Before Spending A Release Tag

A tag is not retryable. `CHANGELOG.md` records which tags were burned and why,
and a burned tag is never reused — so a successor who tags to find out whether
they have access pays a version number to learn it. Check first.

The worker release lane fires on `ceal-v*.*.*` and drives
`.github/workflows/ceal-release.yml`. Its `ceal-cli-release` Environment must be
configured before release and must own the release-origin identity and credential.
This is one-time environment configuration, not a per-release digest entry:

```sh
gh variable list -R corca-ai/ceal-cli --env ceal-cli-release # expect CEAL_ENV_CLOUDFLARE_ACCOUNT_ID
gh secret list   -R corca-ai/ceal-cli --env ceal-cli-release # expect CEAL_ENV_CLOUDFLARE_API_TOKEN
```

The workflow reads these stable credentials only from the privileged jobs. A
canonical maintainer tag push selects the release, and the workflow binds the
commit and assembled inventory automatically to that same run; no release-time
Environment variable update is required.

The proof/ship state no longer needs a separate look to avoid a wasted tag, and
no longer needs a separate concept either. The protocol bytes this repository
tests against are the archive a release ships, so a green `npm run check` has
already said so — `npm run lint:protocol-artifact` is inside both gates. To read
it directly, offline and with no Gateway session:

```sh
npm run lint:protocol-artifact   # exit 0 only when shippable
```

A non-zero exit is `vendored_artifact_missing` or `vendored_artifact_mismatch`
when `vendor/ceal-protocol/` does not hold the exact archive the lock binds, or
`invalid_gateway_handoff_lock` when the lock cannot say what to check against.
Any of them blocks the release, packing, and acceptance-packet paths
independently of whether any test ran. Re-acquire the archive with
`npm run bootstrap:gateway-handoff -- --tag <tag>` rather than editing either
file. `npm run check:protocol-dev` runs the same check plus the client suite; its
`--development` flag selects nothing weaker and its output says so, and neither
command is release or installed-worker evidence. `docs/gates.md` says what the
check does and does not cover.

Signing is keyless, but publishing is privileged. The `sign-and-publish` and
rollback activation jobs use the `ceal-cli-release` Environment for their
release-origin credentials. The release lane compares the assemble output with
the exact artifact downloaded by the privileged job; rollback does the same
with the immutable tag's verified handoff. Distinct `CEAL_ENV_*` names make
missing Environment credentials fail closed instead of falling back to legacy
repository-wide values. These same-run checks prove artifact identity, not a
separate human review of the generated digest.

The repository's unprotected `main` policy does not authorize an unreviewed
source change to publish by itself. Before spending a tag, inspect the
Environment's deployment policy and repository tag policy rather than trusting
the workflow comment:

```sh
gh api repos/corca-ai/ceal-cli/environments/ceal-cli-release --jq '{protection_rules, deployment_branch_policy}'
gh api repos/corca-ai/ceal-cli/rulesets --paginate
gh api repos/corca-ai/ceal-cli/environments/ceal-cli-release/variables --jq '.variables[].name'
gh secret list -R corca-ai/ceal-cli --env ceal-cli-release
gh secret list -R corca-ai/ceal-cli
```

Expect only `CEAL_ENV_CLOUDFLARE_ACCOUNT_ID` in the Environment variables and
`CEAL_ENV_CLOUDFLARE_API_TOKEN` in its secrets after the one-time configuration
cleanup. Do not release while the deployment policy is unexpectedly absent,
either credential is absent, or a legacy `CEAL_RELEASE_*` credential remains
configured. Also confirm no Cloudflare token is available repository-wide. No
per-release approval variable or human digest approval is required: an
authorized maintainer's canonical tag push is the release decision; the
Environment supplies credentials and the workflow proves same-run artifact
identity.

You also need push and tag rights on `corca-ai/ceal-cli`. Verify without
spending anything:

```sh
gh api repos/corca-ai/ceal-cli --jq '.permissions'
```

Then follow `docs/release-and-enrollment.md`, whose final update → binary
readback → explicit guide registration/readback step turns a published artifact
into an accepted one. The exact tagged `ceal-v0.76.1` installer is a required
direct-update compatibility proof; no bootstrap reinstall is part of the
directory-carrier rollout.

## Naming What You Could Not Prove

State the reachable level and the gap, both. A local test run is not
released-binary proof, a released binary is not a live provider readback, and a
readback against a dev instance is not one against prod. If the strongest proof
you reached is `surface`, say `surface` and name what a session would have
added — an unproven claim stated plainly costs the next maintainer nothing,
while a claim stated at the wrong level costs them the debugging.
