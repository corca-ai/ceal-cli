# Capability Discovery Auto-Renewal Session Retro
Date: 2026-08-18

## Context

This retro covers the Worker capability-session slice: replacing the repeated
manual refresh path with one locked preflight renewal, bounded 401/protocol
diagnostics, and an honest `ceal-prod` readback. The next thing that matters is
keeping the Gateway discovery mismatch and the review-delivery failure from
becoming another hidden release delay. Claims below are tagged by evidence
strength where judgment is mixed with direct output.

## Window

From the initial macOS failure packet and local source trace through the final
source-built `ceal-prod` readback and closeout preparation on 2026-08-18.

## Evidence Summary

- Contract and implementation: `charness-artifacts/spec/2026-08-18-capability-session-auto-renewal.md`.
- Final Worker proof: `npm --workspace packages/ceal-worker-cli test` exited 0;
  the log recorded 401 tests, 398 pass, 0 fail, 3 skipped, and 108.100582s.
- Final build proof: `npm run build:worker` exited 0 with generated contracts
  unchanged; the package TypeScript build also exited 0.
- Final live proof: `node packages/ceal-worker-cli/dist/bin.js --timing capabilities --fresh --detail`
  against the existing `ceal-prod` session exited 3 after about 19.1s; it
  refreshed the expired session once, completed handshake, and received HTTP
  200 `protocol_invalid` during 16.8s discovery. `ceal session status` after
  the run reported `access_status: current`.
- Review proof: the first fresh-eye result was not delivered; an unnamed retry
  delivered a read-only review, and parent fingerprint verification reported
  `verdict: clean`, `drift: []`.

## Waste

- `bounded-reviewer-result-delivery` (strong): the first accepted reviewer
  spawn and repeated waits did not produce findings in the parent context;
  the host diagnostic classified it as `status: not-found`. The second unnamed
  retry delivered the review. The waste was in the retrieval boundary, not in
  the need for fresh-eye review. The durable debug record names this as
  Charness/host delivery debt.
- `gate-baseline-runtime` (strong): the final full Worker suite passed but took
  108.100582s on this host. This was the correct final verification phase, not
  an iteration rerun, but a passing 108s baseline is still gate-implementation
  debt. The reproduction command is recorded above; the owner is the Worker
  gate/test-shape surface, not the capability behavior itself.
- `pre-push-types-lane` (strong): the final `bash .githooks/pre-push` spent
  25s, passed formatting, package build, and package type ownership, then
  failed in the pre-existing broad `npm run lint:types:tools` lane with
  implicit-any/unknown errors across `scripts/`, `test/contract/`, and existing
  Worker tests. It is deferred to the separate TypeScript quality owner (agent
  2); the exact reproduction is `npm run lint:types:tools`. No blind retry was
  made.
- The original product waste was stale access being sent before a separate
  manual refresh. It is fixed now by the preflight renewal context and the
  final readback; no further manual refresh was needed to reach discovery.

## Critical Decisions

- Use the existing `ceal-prod` endpoint directly; creating a separate
  `ceal-dev` CLI profile would have tested a different boundary and added
  state without answering the operator's question.
- Refresh only when local access freshness says the stored credential is
  expired, once per `runCapabilities` invocation. Do not refresh again from a
  401 or protocol-invalid discovery response.
- Keep Gateway/protocol diagnosis out of the Worker patch. The Worker proved
  the refreshed token and handshake; the HTTP-200 malformed discovery response
  is now an explicit owner handoff.
- Treat a spawned reviewer as unproven until its findings text is in the parent
  context and the shared-tree fingerprint is verified. A timeout or clean tree
  is not a review result.

## North Star Alignment

The repository standard says the Worker owns its source while the sibling owns
canonical Protocol/Gateway surfaces (`AGENTS.md:18-25`), names the highest proof
level rather than collapsing local tests and live readback (`AGENTS.md:61-73`),
and gives every fact one home with sibling inspection (`AGENTS.md:75-83`). Those
facets held: renewal/output stayed in `ceal-cli`, the Gateway mismatch moved to
the parent spec, and local/full/live evidence were kept distinct. The
mis-applied principle was treating a route's external `read_only` effect as if
it implied no local session effect; the new `session_effect` declaration and
`session_refresh` result make both facts explicit. The failure signature was
the now-recorded `expired -> wasted first request -> manual refresh ->
handshake succeeds -> discovery protocol_invalid` sequence.

## Expert Counterfactuals

- Ousterhout's complexity lens would have asked before implementation whether
  the existing session-renewal primitive could own this boundary, instead of
  accepting “read-only” as the whole contract. That points to the smaller
  preflight context rather than a new retry subsystem.
- Charity Majors' observability lens would have required the final consumer's
  exact evidence before calling the route healthy: session outcome, handshake
  state, HTTP status, response class, and timing. That would have exposed the
  Gateway mismatch as soon as auto-renewal made the first request useful.

## Sibling Search

- same layer: `multi_agent_v1__wait_agent` plus the parent review handoff | decision: diagnostic-only | proof: first accepted spawn timed out without findings; the unnamed retry delivered the review and fingerprint remained clean
- abstraction up: Charness shared fresh-eye Result Delivery contract and `reviewer_result.py` | decision: valid follow-up outside the slice | proof: the contract already requires findings delivery, unnamed retry, and diagnostic classification; follow-up: deferred Charness reviewer-result delivery issue
- specialization down: this Worker closeout's review packet and fingerprint rail | decision: same waste, fix now | proof: the packet now requires parent-context findings and the closeout records `verdict: clean` separately from delivery
- mental-model siblings: `critique`, `prove`, and release/quality closeouts that consume bounded reviewers | decision: valid follow-up outside the slice | proof: the same result-delivery contract is shared across those workflows; follow-up: deferred Charness reviewer-result delivery issue

## Lesson Evaluation

Lesson evaluation: {"reason":"no-evaluator-declared","score_event_count":0,"session_id":"none","status":"not-evaluated"}

## Next Improvements

- workflow: keep the two-part review stop rule in every closeout — findings
  received in the parent context, then fingerprint verify — and use an unnamed
  one-shot spawn for bounded reviewers.
- capability: upstream a deterministic parent-facing reviewer result channel or
  make the existing `reviewer_result.py` retrieval part of the spawn wrapper;
  this is a portable candidate because critique, prove, and release consumers
  share the same failure shape.
- workflow: keep targeted tests at commit boundaries and pay the 108s full
  Worker suite once at final proof; route a measured split/fixture improvement
  to the Worker gate owner rather than hiding the baseline.
- memory: retain the final `ceal-prod` readback and Gateway follow-up in
  `charness-artifacts/debug/latest.md` and the capability spec; do not make a
  later session rediscover that auto-renewal is fixed while discovery remains
  unproven.

## Persisted

Persisted: yes: charness-artifacts/retro/capability-discovery-auto-renewal-session-retro.md
