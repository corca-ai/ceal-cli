# Operator Acceptance

What a `ceal-cli` maintainer can prove alone, what needs the Gateway lane, and
what the release lane needs before a tag is worth spending. Written for a
successor who inherits this repository without inheriting anyone's credentials.

Roles, not hosts: this repository is owned by the **worker lane** (worker CLI,
client SDK, `ceal-guide`). Gateway routes, connector execution, Profile policy,
audit custody, `cealctl`, and the canonical protocol are owned by the **Gateway
lane**, a different operator on a different machine. `AGENTS.md` resolves which
lane a given checkout is from `hostname`; every step below that says "the Gateway
lane" means a request to that operator, not a command you can run here.

Re-verify rather than quote. Every fact below was read from the repository or
from GitHub on 2026-07-27 and each one carries the command that re-reads it. A
figure copied out of this file into a claim is exactly the failure this file
exists to prevent.

## The Ceiling Without A Gateway Session

These need nothing but a built or installed worker CLI. They are the whole set.

| Route | Proves |
| --- | --- |
| `ceal version` | which build is installed |
| `ceal commands` | the declared route surface, effects included |
| `ceal guide status` | the signed guide asset resolves beside the binary, and where it would register |
| `ceal observe` | the local page renders this client's cached state; serves until Ctrl-C |

`ceal guide status` needs a **signed installed release**, not a session: the
guide is resolved relative to the real executable, so a `node dist/bin.js` run
from a checkout answers `guide_unavailable` no matter how healthy the install
is. That is a property of the dev build, not a failure.

Everything else fails closed without a Gateway-issued client session, and
failing closed is the correct answer rather than a broken one:

- `ceal capabilities`, `ceal capabilities targets` — `client_session_unavailable`
- `ceal call`, `ceal receipt show` — no session to authorize or read back with
- `ceal session enroll` — needs an enrollment code the Gateway lane issues

Read the ceiling back yourself, in a throwaway HOME that cannot touch real state:

```
npm run build
npm run probe -- ceal commands
npm run probe -- ceal session status   # expect status: unconfigured, exit 0
```

`capabilities`, `receipt`, and `acceptance` may rotate an expired Gateway
session before performing their read, so their declared effect is
`remote_write`; probe their help rather than bypassing the guard.

**This is the ceiling.** With no session you can prove the CLI's shape, its
declared effects, its local rendering, and its refusals. You cannot prove that
any capability executes, that a receipt is real, that a Profile policy decided
anything, or that an audit record exists. Do not describe work at this level as
verified end to end — `AGENTS.md` requires naming the highest proof level
actually reached, and this level is `surface`.

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
`.github/workflows/ceal-release.yml`. It needs two repository-level values:

```
gh variable list -R corca-ai/ceal-cli     # expect CEAL_RELEASE_CLOUDFLARE_ACCOUNT_ID
gh secret list   -R corca-ai/ceal-cli     # expect CEAL_RELEASE_CLOUDFLARE_API_TOKEN
```

Both were present on 2026-07-27. The workflow re-checks them at run time and
fails the job by name if either is empty, so an empty one costs the tag.

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
it is failing, `npm run check:protocol-dev` still exercises the protocol and
client suites — its output is stamped `proof_level: development_only` and must
not be cited as release or installed-worker evidence. `docs/gates.md` says what
the check does and does not cover.

Signing is keyless — cosign uses the workflow's OIDC identity, so there is no
signing secret to hold and nothing to check beyond the workflow being allowed to
run under `id-token: write`.

You also need push and tag rights on `corca-ai/ceal-cli`. Verify without
spending anything:

```
gh api repos/corca-ai/ceal-cli --jq '.permissions'
```

Then follow `docs/release-and-enrollment.md`, whose final `ceal update` →
readback step is what turns a published artifact into an accepted one.

### The npm lane is a separate, currently unconfigured lane

Bare `v*.*.*` tags trigger `.github/workflows/npm-package-stage.yml` — not the
worker lane. They also triggered the frozen `cealctl-release.yml` until that lane
was deleted, so the tag now belongs to the npm lane alone. The npm lane gates on
environment variables in `ceal-npm-release`, and that environment held **no
variables** on 2026-07-27:

```
gh api repos/corca-ai/ceal-cli/environments/ceal-npm-release/variables --jq '.variables[].name'
```

With `CEAL_NPM_BOOTSTRAP_COMPLETE` unset the workflow's first gate refuses
immediately, so a bare `v*` tag pushed today burns that version for a publish
that cannot happen. Bare `v*` tags also belong to the frozen dual release lane
described in `AGENTS.md`; this lane does not push them.

## Naming What You Could Not Prove

State the reachable level and the gap, both. A local test run is not
released-binary proof, a released binary is not a live provider readback, and a
readback against a dev instance is not one against prod. If the strongest proof
you reached is `surface`, say `surface` and name what a session would have
added — an unproven claim stated plainly costs the next maintainer nothing,
while a claim stated at the wrong level costs them the debugging.
