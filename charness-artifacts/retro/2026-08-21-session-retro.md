# Session Retro

Date: 2026-08-21

## Context

This retro covers the Worker/client diagnostic-propagation slice after the O3
refresh observation: a bounded response shape now travels from the shared
session exchange to the Worker refresh error, and a stale capability fixture
was repaired when retained-path proof exposed it. The slice matters because
the Gateway response was useful but the old consumer discarded its shape.

Strong evidence is the direct client/Worker test output, package builds,
changed-path ESLint, typechecks, and the root-owned proof-runner receipt. The
reviewer's findings remain provisional until the primary re-reads every
load-bearing claim; the missing auto-retro configuration is a structural
observation, not a product failure.

## Window

From the first implementation diff through the focused proof, root
`build:worker`, and the in-flight `check:unit` proof on 2026-08-21. No push,
tag, release, PR creation, PR publication, Gateway apply, or provider write was
performed.

## Evidence Summary

- `node test/run-source-tests.ts packages/ceal-client/test/personal-client-session-client.test.ts` — 14/14 passed, including JSON object/array/scalar, malformed JSON, non-JSON, bounded fields, protocol-invalid success bodies, and direct raw-body/secret non-retention.
- `node test/run-source-tests.ts --test-name-pattern="session refresh preserves a bounded Gateway response shape" packages/ceal-worker-cli/test/cli.test.ts` — 1/1 passed across JSON and non-JSON responses with unchanged `session_refresh_attempt_unknown`, retryability, exact next action, old-token custody, and token-safe output.
- `node test/run-source-tests.ts --test-name-pattern="capabilities --capability" packages/ceal-worker-cli/test/cli.test.ts` — initially 1/4 passed because the helper emitted discovery v2 to a v3 decoder; after the fixture repair, 4/4 passed.
- `npm exec --no -- eslint <seven changed paths>` — pass after fixing import sorting and one max-line violation.
- `npm run build` in `packages/ceal-client`, `npm run build` in `packages/ceal-worker-cli`, `npm run lint:types:raw:packages`, and `npm run lint:types:raw:tests` — pass.
- `npm run build:worker` from the sibling root — pass; both generated contract reports said `changed: false`.
- Root proof-runner run `ceal-cli-check-unit` (`diag-shape-20260821-03`) ended with exit 1 after the retained-path unit lane passed. The remaining 8 reds are frozen `packages/ceal-protocol` contract baselines (six conformance digest mismatches, one gateway-proof claim expectation, and one protocol-negotiation range expectation); a positive-control diff showed no Protocol changes in this slice. Disposition: `ran-fail-deferred` to the frozen Protocol owner, not a green claim and not a reason to retry the same bundle.
- `python3 .../check_auto_trigger.py --repo-root /home/ubuntu/ceal-cli` — `state: not-established` because the adapter leaves both auto-trigger keys unset; this is not a `false` verdict.
- `mine_closeout_telemetry.py --detail` — zero readable records; gate-runtime history is unavailable, so no efficiency claim is made.

## Waste

- The first root proof-runner invocation used `/home/ubuntu/ceal-cli/scripts/run-proof-job.ts`, which does not exist. The runner is owned by the Gateway repo at `/home/ubuntu/ceal/scripts/run-proof-job.ts`; the positive-control file search repaired the command before retrying. This was an ownership-resolution failure, not evidence that `check:unit` failed.
- The first combined Worker test run surfaced a retained capability fixture family returning `ceal.gateway_discovery.v2` while the decoder required v3. Treating those three reds as unrelated baseline debt would have taught the next session to rerun around a broken fixture. Updating the owned helper to v3 plus `phase: target_page` fixed the producer/consumer shape and all four selector tests passed.
- The first lint run exposed two import-sort violations and one max-line violation introduced by the patch. They were repaired at the source span before any retry; no lint bypass was used.
- The first focused raw-body assertion used the scalar text `false`, which also appeared in another serialized error field and produced a false red. Replacing it with a unique JSON string scalar repaired the test oracle itself before rerunning; the lesson is that negative retention sentinels must be unique, not merely valid.

## Critical Decisions

- Keep this implementation slice diagnostic-only. The response shape is additive; refresh disposition, retry semantics, attempt custody, and Gateway state remain unchanged. The acceptance boundary is the named spec, not a live recovery claim.
- Repair the stale capability fixture in the same slice because it was a local retained-path failure in the exact Worker test file being exercised. The repair changed only the fixture's current protocol shape; it did not weaken the decoder or alter production behavior.
- Keep the live same-attempt readback and any Gateway cause attribution separate. The local proof establishes safe propagation, not recovery, and no PR or external publication is required by this goal.

## North Star Alignment

The sibling repository's governing rules say one fact has one home and sibling
populations must be inspected when an invariant is fixed (`AGENTS.md:86-94`).
That held for the response shape: the shared session exchange owns the bounded
shape (`packages/ceal-client/src/session-http-client.ts:23-48`) and the Worker
derives its output from the typed error (`packages/ceal-worker-cli/src/client-session.ts:165-188`).
The same rule was initially mis-applied by the stale `twoCapabilityDiscovery`
fixture, which duplicated an old v2 wire fact beside a v3 decoder; the fixture
was brought back to the current producer/consumer contract.

The repository also requires bounded local proof and separately owned external
boundaries (`AGENTS.md:96-105`). That held: the root proof runner owns the
long-running check, while no push, tag, GitHub write, Gateway write, or release
publish was attempted. The named failure signatures this run encountered were
wrong command ownership, stale producer/consumer shape, and lint drift at an
import/module boundary.

## Expert Counterfactuals

- John Ousterhout's deep-module lens would have asked before implementation
  whether the shared exchange was the one owner of every safe response fact and
  whether the Worker output was a projection rather than a second decoder. That
  question is now answered by the typed `response_shape` handoff, but it would
  also have exposed the v2 fixture as a second, stale protocol authority before
  the broad test run.
- Gary Klein's premortem lens would have started from “what would make this
  green result untrustworthy?” and listed wrong runner path, stale generated
  shape, and token-bearing metadata. The path positive-control, v2/v3 fixture
  failure, exact shape assertions, and secret-negative assertions are the
  resulting safeguards. The unestablished auto-trigger probe remains explicitly
  manual rather than being treated as a green skip.

## Sibling Search

- same layer: session exchange, personal-client error, Worker refresh output | decision: same waste, fix now | proof: changed-path diff plus client/Worker focused tests
- abstraction up: root proof runner versus sibling package scripts | decision: diagnostic-only | proof: `/home/ubuntu/ceal/scripts/run-proof-job.ts` and `await-job.ts` positive-control search; no runner ownership change in this slice
- specialization down: capability discovery test helper versus current v3 decoder | decision: same waste, fix now | proof: initial `protocol_invalid` output named v2, then the v3 target-page helper passed all four selector tests
- mental-model siblings: retro auto-trigger adapter and plugin-owned workflow | decision: intentional boundary | proof: `check_auto_trigger.py` returned `state: not-established`; this session recorded the state and did not edit plugin cache or invent a trigger verdict

## Portable Candidate

- Abstract pattern: before retrying a failed proof command, positive-control the
  command's owner and then execute the smallest retained consumer that can expose
  a stale producer/consumer shape. Triggering evidence: the misplaced proof
  runner and v2/v3 fixture failure in this slice. Intended consumer: repo-owned
  implementation/quality workflows with multiple sibling checkouts. Destination:
  create-skill. First-prompt acceptance claim: “A command failure is not
  classified until its owning file is positively located and one changed-path
  consumer proves the suspected contract.”

## Next Improvements

- workflow: resolve command ownership with a positive-control file search before any long proof retry; freeze reviewed source paths before delegating fresh-eye review; keep slow gates in the root proof runner; record an exact owner/debt disposition when a frozen contract lane fails.
- capability: configure the sibling retro adapter's auto-trigger keys only if the repo wants automatic surface-triggered retros; until then, treat `state: not-established` as a manual-retro decision, never as `triggered: false`.
- memory: update the active goal and sibling handoff after the sibling commit so the diagnostic slice, stale-fixture repair, live-readback non-claim, and no-new-PR boundary are all durable.

## Lesson Evaluation

Lesson evaluation: {"reason":"no lesson evaluator declared","score_event_count":0,"session_id":"none","status":"not-configured"}

## Persisted

Persisted: yes: charness-artifacts/retro/2026-08-21-session-retro.md
