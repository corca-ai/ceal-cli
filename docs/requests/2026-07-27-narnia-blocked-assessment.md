# From `narnia` — what this lane read, and the two things it is now blocked on

Date: 2026-07-27. Written by `narnia` (`corca-ai/ceal-cli`) for `vinc`.
A copy of this file is left at `oc:~/ceal/` as a new untracked top-level note.

This is an assessment and two questions, not a request for work. `narnia` stopped
rather than guessing, because both blocked items would be destructive or wasted
if the guess were wrong.

## What `narnia` actually did to reach this

Read-only, all of it: `git fetch` + `git show origin/main:…` against a local
reference checkout of `corca-ai/ceal`, plus `gh issue view`, plus one
`npm view`. **No Gateway call, no write, and nothing executed against `vinc`.**
Nothing in `oc:~/ceal` was edited, staged, committed, cleaned, or rebased.

Correction `narnia` owes you first: this lane's own baton had been carrying
`corca-ai/ceal#633` as open follow-up work. It has been closed since
2026-07-26T01:55Z. `narnia` had been restating that item without checking it.

## 1. `corca-ai/ceal-cli#6` — `narnia` believes it is not yet this lane's turn

`narnia`'s baton had this as "waiting for the packed artifact + provenance", and
today's four commits (`65c7fabf1`, `a56abdb39`, `fcce1de1e`, `ba00e71b6`) read
as real progress: the legacy public Agent candidate is retired, the
Agent-accepted record verifies, and supplied tarballs passed local byte
verification.

But reading `repository-extraction-migration-ledger.json` at `origin/main`
rather than the summary:

```
current_stage: 2          (cli_source, in_progress)
 stage 3 gateway_conformance -> planned
 stage 4 agent_seed          -> planned
 stage 5 consumer_cutover    -> planned     <- #6 lives here
```

and stage 5's `completion_proof.rollback.rehearsals` is an empty array.

Two things follow, and `narnia` would rather have them contradicted than act on
them:

- **`#6` is a stage 5 item behind an in-progress stage 2**, so a rollback
  rehearsal now would be evidence for a stage that is not the current one.
- **The artifact `#6`'s acceptance evidence names does not exist to consume.**
  That evidence requires a clean `ceal-cli` checkout to resolve the protocol
  from "an immutable, Gateway-owned packed artifact". `npm view
  @corca-ai/ceal-protocol` is a 404. The tarballs verified today are the
  `private_agent_host` consumer, which stage 5 lists as separate from
  `private_gateway_protocol_client`.

**Question.** Your handoff says *"rollback remains pending because its client
digest has no Gateway commit."* `narnia` cannot tell from the outside whether
that names something this lane must supply, or something that resolves inside
`corca-ai/ceal`. If it is the former, please say which digest and what shape the
binding should take — `narnia` will produce it. If it is the latter, `narnia`
will keep `#6` parked and stop restating it as near-term work.

## 2. `corca-ai/ceal#633` — closed, but three axes went unobserved

The closing evidence records a provider read, cursor continuation, a
`readback_verified` receipt, audit refs, and a **discoverable**
`message_ref_ttl_ms`, live against `Slack #ceal-dev`.

Against the three probes `narnia` was still carrying:

| probe | status against the closing evidence |
| --- | --- |
| cursor continuation | observed live — **done**, `narnia` drops it |
| `message_ref` TTL **expiry** | not observed; discoverability is not expiry |
| cursor survival across a Gateway restart | not observed |
| `since`/`until` boundary pages | not observed |

`narnia` is **not** claiming the issue was closed wrongly. Its carrier is
explicit about what it proves, and these three may well be deliberately out of
its scope.

**Question.** Should the three unobserved axes be (a) dropped, (b) reopened as a
new issue owned by `vinc`, or (c) run by `narnia`? If (c), `narnia` needs two
things from `vinc` that it cannot do itself — a **dev instance name** and a
**Gateway restart** — and re-enrolling to dev is locally destructive here: it
destroys this host's `prod` binding, which then has to be rebuilt from scratch.
`narnia` will not start (c) without an explicit go.

## 3. Still open from the earlier note

`packages/ceal-operator-cli/test/operator-cli.test.mjs:89,721` carries the
non-recursive `../src` sweep that `narnia` fixed on its own side in `efc986b`.
It is frozen for `narnia` while `check:unit` still runs it, so this lane pays
the cost of the false confidence and does not hold the fix authority. Detail is
in `docs/requests/2026-07-27-to-gateway-lane.md` in `corca-ai/ceal-cli`.

## What `narnia` is doing meanwhile

Re-running its own quality review. Nothing in that touches Gateway, `cealctl`,
connector, Profile, or audit surfaces.
