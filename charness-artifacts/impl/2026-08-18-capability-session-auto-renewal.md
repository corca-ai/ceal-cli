# Capability Session Auto-Renewal Closeout

## Implemented

- `ceal capabilities` and `ceal capabilities targets` inspect the stored
  Gateway session under the existing locked session path and renew it once when
  local access is expired but refreshable.
- A locally current session, a rejected current token, and a completed refresh
  never trigger a second refresh or replay the Gateway request.
- Capability success, Gateway rejection, HTTP 401, protocol-invalid discovery,
  and selector refusal all carry the invocation's bounded `session_refresh`
  outcome where the result schema supports it.
- Route declarations now expose `session_effect: refresh_if_needed` separately
  from the remote `effect`, so agents can distinguish a local credential
  rotation from a provider-facing operation.
- HTTP 401 is classified as `authentication_failed` with bounded observation;
  the response body, bearer token, and refresh credential are not rendered.
- A post-handshake HTTP 200 protocol-invalid discovery response identifies the
  client protocol and tells the operator not to refresh again.
- URL-shaped target selector refusal preserves the generic `ceal.error.v1`
  envelope while carrying the refresh outcome, so a renewed session does not
  erase the failure context.

## Capability Delivered

On the real `ceal-prod` session, an expired stored access token is refreshed
automatically before capability discovery. The current Worker can prove the
Gateway handshake after renewal, but the live Gateway still returns an HTTP 200
protocol-invalid discovery response; capability availability therefore remains
unproven until the Gateway/protocol owner repairs that boundary.

## Contract Source

`charness-artifacts/spec/2026-08-18-capability-session-auto-renewal.md`

The Worker owns session preflight, result shaping, and no-replay behavior.
Gateway/protocol owns the discovery response and its compatibility contract.
No separate development endpoint or profile is introduced; the live readback
uses the configured `ceal-prod` endpoint.

## Verification

- `npm --workspace packages/ceal-worker-cli run build` passed.
- Focused capability/selector contract tests passed: 6/6, with a separate
  selector/discovery run passing 2/2.
- Full Worker package test run passed: 401 total, 398 passed, 0 failed, 3
  skipped, 108100.582685 ms.
- `npm run build:worker` passed and reported unchanged generated contracts.
- `git diff --check` passed before closeout commit.
- Live source-built readback on `ceal-prod`:
  `node packages/ceal-worker-cli/dist/bin.js --timing capabilities --fresh --detail`
  exited 3 after about 19.1 s. It reported `session_refresh: refreshed`,
  `live_gateway_checked: true`, handshake verified, and discovery
  `http_status: 200`, `response_kind: protocol_invalid`. Timing was refresh
  1313.934 ms, handshake 202.888 ms, discovery 16785.388 ms.
- A direct `ceal session status` after that readback reported
  `access_status: current`, confirming the refreshed stored session.
- The required fresh-eye review delivered findings on the second bounded
  attempt; boundary fingerprint verification returned `ok: true`,
  `verdict: clean`, and no drift. The first accepted spawn produced no result
  and is recorded as delivery debt, not as review approval.

## Lint Gate

- Lint Gate: ran-fail-deferred `npm run lint:types:tools` — existing broad
  TypeScript errors in `scripts/` and `test/contract/`; owned by the separate
  agent-2 TypeScript quality lane. `lint:types:packages`, Biome, build, focused
  tests, and the full Worker package test passed. The broad pre-push hook was
  not retried after this structural failure.

## Truth Surface Sync

`README.md`, `docs/handoff.md`, `docs/operator-acceptance.md`, the capability
route declarations, the implementation spec, the debug artifact, and this
closeout agree on preflight-only renewal, `session_refresh`, no replay after
HTTP 401, and the remaining Gateway discovery mismatch.

## Boundary Ownership

`owned-correctly`

- Producer: Worker session store/renewal path produces the current token and
  refresh outcome; Gateway produces the handshake/discovery response.
- Consumer: Worker capability and target routes consume the token and render
  bounded diagnostics for agents.
- Owning surface: Worker owns renewal and CLI contracts; Gateway/protocol owns
  HTTP 200 protocol compatibility and discovery decoding.
- Disposition: Gateway discovery mismatch is tracked in
  `../ceal/charness-artifacts/spec/2026-08-18-gateway-discovery-protocol-diagnostics.md`.

## Critique

`Critique: full parent-delegated bounded fresh-eye implementation review`.
The reviewer found and the implementation repaired: stale acceptance/claim
ledger evidence, missing expired-plus-401 and non-quarantined refresh-failure
fixtures, missing direct-token `session_refresh: none` assertion, and selector
refusal dropping the refresh outcome. The repaired source and tests were
re-read; the review boundary fingerprint is clean. Reviewer delivery itself is
recorded as a Charness/host delivery debt because the first accepted spawn had
no retrievable result and required one bounded retry.

## Claim Ledger

| Claim | Source | Re-check | Status |
| --- | --- | --- | --- |
| Capability routes run one renewal preflight and pass its context through the Gateway result | `packages/ceal-worker-cli/src/index.ts:568-622,863-946` | `rg -n 'createCapabilityRenewalContext|session_refresh|preflightAttempted|ensureCurrentSession' packages/ceal-worker-cli/src/index.ts` | verified-by-reading |
| Current-token Gateway rejection does not refresh or replay | `packages/ceal-worker-cli/src/index.ts:926-946,1773-1889` and `packages/ceal-worker-cli/test/cli.test.ts` | focused authentication/no-retry test command in Verification | verified-by-test |
| `session_effect` is independent from remote effect | `packages/ceal-worker-cli/src/command-definitions.ts:24-36,98-109` | `npm run probe -- ceal capabilities --help` | verified-by-reading |
| Selector refusal preserves the generic error contract and renewal outcome | `packages/ceal-worker-cli/src/index.ts:610-612` and `src/command-surface.ts` | focused selector refusal test command in Verification | verified-by-test |
| Real `ceal-prod` refresh succeeded but discovery remains protocol-invalid | live readback recorded in `charness-artifacts/spec/2026-08-18-capability-session-auto-renewal.md` | rerun the exact source-built command and `ceal session status` | verified-by-live-readback |

## Residual Risks

- `unverified-future`: Gateway discovery returns HTTP 200 with an invalid
  response after a successful handshake; this is a Gateway/protocol follow-up,
  not a Worker refresh failure.
- `deferred-quality`: the broad `lint:types:tools` lane remains red in the
  separate TypeScript cleanup; no blind retry or no-verify workaround is used
  here.
- `unverified-future`: no signed Worker publish, tag, install, release, or
  service apply is claimed.
- Charness/host reviewer result delivery remains structurally less enforced
  than the documented delivery contract; the incident is durable in the debug
  artifact and retro rather than silently treated as a clean review.

## Completion Categories

- `durable`: Worker source, tests, route declarations, operator docs, spec,
  debug record, retro, and this closeout.
- `external-writes`: none; no push, tag, publish, release, or apply.
- `test-only`: renewal/error/selector fixtures and timing/readback evidence.
- `verification`: local build/tests plus real `ceal-prod` source-built
  handshake/readback at `surface` proof level; discovery is explicitly not
  proven.
- `unverified-future`: Gateway protocol repair, signed distribution, installed
  macOS readback, and full quality-lane repair.

## Next Slice

Gateway/protocol owner should diagnose and fix the HTTP 200 protocol-invalid
discovery response, then rerun capability discovery through the signed
handoff. The Worker slice is locally complete; external release boundaries
remain separately approved.

Instance apply: not applicable (Worker CLI source only; no Ceal service was
changed).
