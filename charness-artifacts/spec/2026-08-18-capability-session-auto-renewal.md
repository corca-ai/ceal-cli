# Capability Discovery Session Auto-Renewal

Date: 2026-08-18
Title: Capability discovery session auto-renewal and 401 diagnosis
Status: implemented locally; ceal-prod readback complete; Gateway discovery follow-up pending

## Problem

On macOS, the installed worker had a renewable but expired Gateway access
credential. `ceal capabilities --fresh --detail` spent a network round trip on
the expired credential, rendered the Gateway's non-protocol 401 as a generic
`invalid_response`, and required a separate manual `ceal session refresh`
before the same discovery could be attempted again. The worker already owns a
locked, fail-closed refresh path, and the Gateway's access lifetime is short by
design, so the normal stored-session discovery path should use that path when
the local access credential is no longer current.

Before this slice, the source intentionally resolved capabilities in `observe`
mode and only retried a typed `authentication_failed` response. A Gateway 401
that was not itself a valid Ceal envelope was therefore rendered as a generic
protocol failure, even though the HTTP transport retained its status.

## Capability Contract

For the stored-session `ceal capabilities` and `ceal capabilities targets`
routes:

1. Load the current local session under the existing session lock.
2. If its access credential is no longer current and the existing refresh
   credential is usable, refresh it once before the Gateway handshake.
3. Use the resulting access credential for the handshake and discovery. Local
   access freshness is the only automatic-refresh trigger. A typed
   `authentication_failed` or an HTTP 401 after a current credential was sent
   is a terminal authentication diagnostic for this invocation; it never spends
   the one-time refresh credential merely because a proxy or Gateway rejected a
   request.
4. Render a redaction-safe `session_refresh` outcome using the existing parent
   vocabulary: `none`, `refreshed`, `refresh_failed`, or `quarantined`. `none`
   means no refresh path was entered, while `refreshed` means the worker
   obtained a current session through that path; it does not claim that this
   process alone performed the durable rotation.
   A target selector refusal keeps its existing `ceal.error.v1` exit-2 shape,
   but carries the same outcome when capability preflight already renewed the
   stored session, so the route does not hide a session side effect.
5. Preserve the existing discovery cache, `--fresh`, profile selection,
   protocol decoding, request-id, and target-catalog semantics. Credential
   freshness and discovery freshness remain separate facts.

The direct `--endpoint ... --token-stdin` form has no stored refresh context and
is unchanged. Local-only routes (`help`, `version`, `commands`, guide routes,
session status, and observer) never refresh.

## Current Slice

Implement the capability catalog and target-selection path only:

- add one invocation-scoped renewal state owned by `runCapabilities` and passed
  through stored-session resolution, handshake, and discovery;
- recognize an HTTP 401 transport response as an authentication diagnostic
  without weakening response decoding or trusting the 401 body; it is not an
  automatic refresh trigger;
- expose the session-effect declaration independently from the route's external
  `effect`, using `session_effect: refresh_if_needed` for the changed routes,
  and emit `session_refresh` in every `ceal.capabilities.v1` success and failure
  envelope. A post-discovery selector refusal also carries the field in its
  generic error envelope. Direct-token mode emits `session_refresh: none`;
- keep protocol-invalid HTTP 200 responses distinct from authentication failure
  and state that the client protocol is unsupported/unverified rather than
  directing the operator to refresh again. A 401 after a successful preflight
  refresh also must not direct the operator into a redundant refresh loop;
- replace the tests that currently require observation routes to never rotate a
  stored session with tests for one safe preflight refresh, bounded 401
  diagnostics, and no status-triggered or duplicate refresh.

## Fixed Decisions

- Automatic refresh is limited to a stored session whose local access token is
  no longer current. A current token is sent without a speculative refresh.
- The renewal context is created once by `runCapabilities` and owns one
  `preflight_attempted` flag plus the observed outcome. Stored-session
  resolution is the only place that may spend the refresh credential; handshake
  and discovery receive the resulting session but cannot refresh it. A
  preflight attempt is therefore the entire budget for this route.
- A failed or ambiguous v1 refresh keeps the existing durable quarantine and
  never replays the one-time refresh credential.
- A direct token supplied through stdin never reads or mutates the stored
  session and emits `session_refresh: none`.
- HTTP 401 is a local transport fact used only to classify authentication and
  render a bounded next action. The worker does not parse or render an
  untrusted 401 body and never refreshes solely because of that status.
- The changed command declarations use `session_effect: refresh_if_needed`;
  the observed result field is separate and uses `none | refreshed |
  refresh_failed | quarantined`.
- A successful handshake followed by an HTTP 200 protocol-invalid discovery
  response is not repaired by refresh and remains a Gateway/proxy/protocol
  compatibility failure.
- No Gateway or frozen Protocol source changes are part of this slice.

## Probe Questions

- Does the deployed `ceal-prod` endpoint accept the refreshed access token and
  return a decodable discovery response? **Answered by live readback:** the
  refreshed token was accepted by the handshake, but discovery returned HTTP
  200 with `protocol_invalid` for client protocol `1.3.0`. This remains an
  external Gateway/proxy compatibility issue rather than a reason to retry
  refresh.

## Deferred Decisions

- Applying the same `session_refresh` result contract to `ceal receipt show` and
  `ceal acceptance emit`; reopen when the capability slice is live and either
  route is observed to force a separate manual refresh for the same expired
  session. Their output schemas have separate allow-list owners.
- Reworking the already-renewing `ceal call` path to consume the same shared
  invocation state and prove that its preflight and post-auth retry cannot both
  rotate a session; reopen when call timing or refresh-count evidence shows a
  duplicate rotation.
- Changing the Gateway's unauthenticated HTTP envelope to include a typed
  protocol response or a server protocol-version diagnostic; reopen when the
  bounded client diagnostics still cannot distinguish a Gateway response from a
  proxy response in a recorded production incident.
- Automatically repairing guide registration conflicts and any browser/raw
  provider fallback; reopen only under a separately specified atomic ownership
  contract.

## Non-Goals

- Refreshing local-only commands or refreshing a current access token merely to
  make a request “fresh”.
- Retrying discovery indefinitely or retrying a malformed protocol response.
- Treating a successful handshake as proof of capability discovery or provider
  access.
- Copying credentials between hosts, creating a second `ceal-dev` profile, or
  changing the existing `ceal-prod` endpoint.
- Tagging, pushing, publishing, installing, or applying a release in this
  implementation slice.

## Deliberately Not Doing

- We are not making every worker route auto-refresh in this slice. The reported
  waste occurs before capability/resource discovery, and changing receipt and
  acceptance schemas at the same time would widen the proof surface without
  improving that first-use path. The deferred sibling contract remains visible
  above.
- We are not adding a server-version field by guessing from a malformed response.
  The worker can report its supported protocol and the observed response class;
  the Gateway owns a future versioned diagnostic if that is insufficient.

## Constraints

- Worker source authority is `/home/ubuntu/ceal-cli`; Gateway and Protocol source
  authority remains `/home/ubuntu/ceal`.
- Reuse the existing locked refresh/quarantine path and redaction rules.
- Preserve the signed Protocol input and the installed version document.
- Keep command declarations, help, `ceal commands`, output schema, and tests
  derived from one source of truth where the repository already provides one.
- Real provider or Gateway writes are outside the local implementation proof.

## Success Criteria

1. With an expired renewable stored session and a cold cache or `--fresh`, one
   capabilities invocation sends exactly one refresh request, uses the current
   access token returned by the renewal context for every live handshake and
   discovery request, and emits `session_refresh: refreshed`.
2. With a current stored session, the invocation sends no refresh request and
   emits `session_refresh: none`; the stored session remains unchanged.
3. With a current local token that receives a typed auth rejection or HTTP 401,
   the invocation performs no automatic refresh, preserves the bounded status /
   response-kind diagnostics, and gives a non-looping authentication next
   action.
4. If preflight refresh fails ambiguously or the session is already quarantined,
   no capability request is sent with the same one-time credential; the output
   remains `ceal.capabilities.v1` and says `session_refresh:
   refresh_failed` or `quarantined` with the existing recovery.
5. An HTTP 200 protocol-invalid response after a verified handshake reports a
   protocol/discovery incompatibility with bounded diagnostics and does not
   instruct the operator to refresh again.
6. Direct token mode emits `session_refresh: none`, and local-only routes retain
   their current no-refresh behavior.
7. A selector refusal reached after a preflight renewal preserves
   `session_refresh: refreshed` in its generic error envelope and does not spend
   another refresh attempt.

## Acceptance Checks

- `unit`: capability catalog and target-selection fixtures cover current,
  expired-renewable, typed-auth-rejected, HTTP-401-rejected, refresh-failed,
  quarantined, and direct-token sessions; each asserts request count, token
  sequence where a live request occurs, the exact `session_refresh` value, safe
  recovery, and credential/body redaction. The raw 401 fixture asserts zero
  automatic refreshes.
- `unit`: one renewal context is created per `runCapabilities` invocation and
  its preflight outcome is reused by handshake and discovery; a preflight
  refresh followed by an auth rejection proves no second refresh occurs. The
  non-quarantined `refresh_failed` outcome is also exercised before any Gateway
  capability request.
- `unit`: command help and `ceal commands` expose `effect` and the independent
  `session_effect: refresh_if_needed` policy for both changed routes.
- `integration`: a bounded local Gateway fixture proves the rotated token is
  used for both handshake and live discovery and that a protocol-invalid 200
  after handshake gets the protocol-specific next action without refresh advice.
- `e2e` (separate external readback after local proof): **executed** with
  `npm run build:worker`, then
  `node packages/ceal-worker-cli/dist/bin.js --timing capabilities --fresh --detail`
  against the existing `ceal-prod` session HOME. Exit code was 3 because
  discovery remained unproven; the full YAML/timing and before/after
  `ceal session status` are recorded below. No separate dev endpoint was
  created. The readback rotated the stored prod session.
- `unit`: the existing refresh-quarantine tests remain green.
- `unit`: a target selector refusal after preflight renewal retains
  `session_refresh` even though its established `ceal.error.v1` envelope exits
  with code 2.

## Boundary Ownership

- Session persistence, renewal budget, command declaration, and Worker output:
  `corca-ai/ceal-cli`.
- Gateway 401 envelope and server protocol/version diagnostics:
  `corca-ai/ceal`.
- Real `ceal-prod` session readback: this machine's operator session; the
  implementation proof may use it only after deterministic tests pass.
- Release tag/push/publish/install/apply: separate external boundaries.

## Claim Ledger

| Claim | Source | Re-check command | Verification level | Status |
| --- | --- | --- | --- | --- |
| Before this slice, stored capabilities access resolved in `observe` mode. | `git show HEAD:packages/ceal-worker-cli/src/index.ts` at the pre-slice resolver/handshake call sites | `git show HEAD:packages/ceal-worker-cli/src/index.ts | rg -n 'resolveStoredGatewayAccessResult|requestCapabilityHandshake'` | historical baseline, verified-by-reading | verified |
| Capability routes now create one renewal context, resolve stored access in `renew` mode, and pass the same outcome to handshake/discovery output. | `packages/ceal-worker-cli/src/index.ts:568-622,871-946,1035-1085` | `rg -n 'createCapabilityRenewalContext|resolveStoredGatewayAccess|session_refresh|requestCapabilityHandshake' packages/ceal-worker-cli/src/index.ts` | verified-by-reading + focused/full tests | verified |
| Handshake and discovery no longer own a refresh retry; local freshness is the only automatic-refresh trigger. | `packages/ceal-worker-cli/src/index.ts:926-946,979-983`; `packages/ceal-worker-cli/src/client-session.ts:480-509,538-540` | `rg -n 'loadStoredSessionForRenewalMode|requestCapabilityHandshake|sessionIsCurrent|ensureCurrentSession' packages/ceal-worker-cli/src/index.ts packages/ceal-worker-cli/src/client-session.ts` | verified-by-reading + focused tests | verified |
| HTTP transport retains a 401 status while classifying an invalid envelope as `protocol_invalid`, and the capability renderer maps raw 401 to bounded authentication diagnostics. | `packages/ceal-client/src/http-transport.ts:18-58,153-177,212-250`; `packages/ceal-worker-cli/src/index.ts:1799-1890` | `rg -n 'http_status|response_kind|protocol_invalid|unauthorized|gatewayUnavailableNextAction' packages/ceal-client/src/http-transport.ts packages/ceal-worker-cli/src/index.ts` | verified-by-reading + focused tests | verified |
| The changed top-level and target routes declare `session_effect: refresh_if_needed`, while receipt and acceptance remain explicit-refresh observation routes. | `packages/ceal-worker-cli/src/command-definitions.ts:24-36,98-109`; `packages/ceal-worker-cli/src/subcommands.ts:159-188,200-218` | `rg -n 'session_effect|Receipt readback never|acceptance' packages/ceal-worker-cli/src/command-definitions.ts packages/ceal-worker-cli/src/subcommands.ts` | verified-by-reading + help tests | verified |
| The Gateway personal access credential is minted for at most 15 minutes and refresh tokens have 30-day idle/90-day absolute limits. | `packages/ceal-core/src/gateway-client-http-security.ts:9-11,162-166`; `packages/ceal-core/src/gateway-personal-client-sessions.ts:7-9,63-85` | `rg -n 'PERSONAL_CLIENT_ACCESS_TTL_MS|REFRESH_IDLE_TTL_MS|REFRESH_ABSOLUTE_TTL_MS' /home/ubuntu/ceal/packages/ceal-core/src` | verified-by-reading | verified |
| Before the live readback, the prod session on this machine was expired but had renewal metadata. | live `ceal session status` payload from 2026-08-18 | `ceal session status` before the source-built capability command | live local-state readback | verified |
| No separate ceal-dev CLI endpoint is required for this slice. | user direction in current task; current stored session endpoint | `ceal session status` | operator decision + live local-state readback | verified |
| A target selector refusal after preflight renewal preserves the refresh outcome without another rotation. | `packages/ceal-worker-cli/src/index.ts` selector refusal call and `packages/ceal-worker-cli/test/cli.test.ts` selector refusal fixture | `node test/run-source-tests.ts --test-name-pattern='target selector refusal' packages/ceal-worker-cli/test/cli.test.ts` | focused test | verified |
| The source-built prod readback renewed the expired session once, completed handshake, and stopped at HTTP 200 `protocol_invalid` discovery. | live command output and timing recorded below | `node packages/ceal-worker-cli/dist/bin.js --timing capabilities --fresh --detail` followed by `ceal session status` | provider_roundtrip | verified with external residual |

## Live Readback

The readback used the current `ceal-prod` endpoint and stored operator session;
no `ceal-dev` endpoint or second profile was introduced.

- Before: `ceal session status` reported `access_status: expired`, with
  `expires_at: 2026-08-18T04:30:53.274Z` and renewal metadata present.
- Command: `node packages/ceal-worker-cli/dist/bin.js --timing capabilities --fresh --detail`.
- Exit: `3` after approximately `19.1s`.
- Timing: local refresh `1313.934ms` (`outcome: ok`), handshake `202.888ms`
  (`outcome: ok`), discovery `16785.388ms` (`outcome: error`).
- Output: `session_refresh: refreshed`; `live_gateway_checked: true`;
  `protocol_handshake_verified: true`; discovery HTTP `200`, content type
  `application/json; charset=utf-8`, response kind `protocol_invalid`; no
  capability catalog was claimed. The next action explicitly says not to
  refresh again and identifies client protocol `1.3.0` compatibility as the
  remaining boundary.
- After: `ceal session status` reported `access_status: current`, with
  `expires_at: 2026-08-18T04:55:24.724Z`; refresh idle and absolute limits
  remained configured.

Disposition: the Worker expiry/retry waste is fixed in this slice. The remaining
HTTP-200 protocol mismatch is owned by the Gateway/protocol surface and is
tracked in `charness-artifacts/spec/2026-08-18-gateway-discovery-protocol-diagnostics.md`.

## Critique

### Execution

Fresh-eye spec critique ran against the initial contract (input SHA256
`bf8ce295d76e06d42ec8298a56315b7f26e4d2dc6f986bd56a6e6672cdd716f9`) with
three named lenses and a separate counterweight. The reviewers were read-only;
no file, index, or worktree drift was observed. No critique packet was
consumed because this repository declares no critique packet sections.

### Fresh-Eye Satisfaction

`parent-delegated` — bounded angle reviewers and the separate counterweight
completed under the repository's recorded delegation grant. The counterweight
was asked to stop at partial evidence and still delivered the required
four-bin triage.

### Implementation Fresh-Eye

The first implementation-review spawn was accepted but delivered no findings;
the host diagnostic returned `status: not-found`. Per the shared fresh-eye
delivery contract, that was recorded as a delivery failure rather than a
review result. One unnamed bounded retry then delivered findings. The parent
fingerprint verify was clean (`verdict: clean`, `drift: []`), and the reviewer
reported no file, index, or worktree mutation. Requested tier was medium in the
review packet; concrete host spawn-field application was not independently
observable.

The delivered review found three blockers, all now dispositioned: the live
readback and Claim Ledger were stale, acceptance text overclaimed untested
refresh branches, and a post-discovery selector refusal hid `session_refresh`.
The first two were synchronized with the actual evidence and new fixtures; the
selector path now carries the outcome in its existing generic error envelope.
The reviewer also confirmed that `ceal-prod` direct readback is the correct
boundary and that the remaining protocol-invalid response belongs to Gateway.

### Findings and Dispositions

#### Act Before Ship

- Fix the 401 scope by making local freshness, not raw status, the only
  automatic refresh trigger. A current-token 401 is diagnostic and terminal for
  this invocation; discovery is not replayed and no second refresh is spent.
- Fix the public vocabulary: declarations use `session_effect:
  refresh_if_needed`; result envelopes use `session_refresh: none | refreshed |
  refresh_failed | quarantined`.
- Keep capability operational failures in `ceal.capabilities.v1`, including
  preflight refresh failure; the established selector error remains
  `ceal.error.v1` but now carries its refresh outcome so session effects do not
  disappear.

#### Bundle Anyway

- Make the renewal context owner and observed token sequence explicit in the
  contract and fixtures; the context owns one preflight attempt and downstream
  stages cannot mutate it.
- Limit the rotated-token handshake/discovery criterion to cold-cache or
  `--fresh` live discovery; warm-cache success proves only a live handshake.
- Add reopening triggers to deferred sibling and Gateway diagnostics decisions.

#### Over-Worry

- A second broad negative matrix for every local-only command is unnecessary;
  existing dispatcher/probe tests already establish those boundaries. The
  changed capability tests still cover direct-token no-refresh explicitly.
- Extending this slice to receipt, acceptance, or call would increase proof
  surface without addressing the reported discovery first-use waste.

#### Valid but Defer

- `ceal-prod` readback is a separate post-local external boundary because it may
  rotate the stored session; it does not block local implementation proof.
- Gateway typed-401/version-envelope changes remain Gateway-owned follow-up
  work.

### Fixed/Probe/Defer Coherence Result

- Fixed: pass after the 401 scope, vocabulary, renewal-context owner, and output
  envelope were made explicit.
- Probe: pass; the only live probe is the existing `ceal-prod` response after
  local proof, and its answer is recorded as an external readback rather than
  invented in code.
- Deferred: pass after each item received a reopening trigger.

### Acceptance Check Coverage Result

All seven success criteria have matching unit, integration, or external-readback
checks above. The cache-hit qualification prevents a warm cache from being
misreported as a live discovery proof.

### Implementation State

The four initial Act Before Ship findings were incorporated into this contract
before implementation. The implementation fresh-eye blockers are now fixed or
recorded at their owning boundary. The local capability slice is implemented;
focused and full Worker test suites pass; the source-built `ceal-prod` readback
proved auto-renewal and handshake, while discovery remains blocked by the
Gateway/protocol mismatch recorded above. No separate dev endpoint is planned.

## Canonical Artifact

This document is the current capability-slice contract. The earlier
`2026-08-17-cli-startup-friction-reduction.md` remains the diagnostic parent and
records why automatic renewal was previously deferred; this artifact supersedes
only that follow-up decision for `capabilities` and `capabilities targets`.

## First Implementation Slice

The invocation-scoped renewal state, 401 classification, capability
declarations/output, focused fixtures, owner docs, and selector outcome
propagation are implemented. The source-built `ceal-prod` live readback is
complete; the next slice is the Gateway/protocol discovery diagnosis, followed
by a new readback. Release publication remains outside this slice.
