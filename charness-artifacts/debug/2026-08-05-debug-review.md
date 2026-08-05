# Debug Review
Date: 2026-08-05

## Problem

After a previously successful Calendar call, `ceal capabilities --fresh` returned
`ok: false`, `status: unavailable`, and `error.kind: gateway_request_failed`.

## Correct Behavior

Given a current email-first Ceal session and a granted Calendar Profile, live
capability discovery should return Calendar capability contracts and bounded
targets; a read-only Calendar request should then complete with verified
Gateway readback.

## Observed Facts

- Host is `narnia`; installed binary is `/home/hwidong/.local/bin/ceal`, version
  `0.72.9`, protocol `1.3.0`.
- `ceal session` reports the email-first subject, `profile:work`, and a current
  access token after renewal.
- The local discovery cache from `2026-08-04T22:37:40Z` contains
  `calendar.availability`, `calendar.event.get`, and `calendar.event.search`.
- The local receipt spool records a successful `calendar.event.get` at
  `2026-08-04T22:39:56Z`.
- Repeated `ceal capabilities --profile profile:work --fresh` calls fail at the
  live catalog route with `gateway_request_failed`; no provider action is
  claimed for those requests.
- Live target selection succeeds for `calendar.event.search --match calendar`.
  It returns two granted targets, both advertising `readiness: degraded`.
- A bounded search on `target:calendar:adf1817b9c0b90ff27bbc5c2` for
  2026-08-05 KST completed. Receipt `ceal:5ae5e1e2-f04d-4214-a1fb-3fb4dbc86561:call`
  is `verified`, `authorization: allowed`, `outcome: succeeded`.

## Reproduction

```sh
ceal capabilities --profile profile:work --fresh
```

The smallest successful contrast is:

```sh
ceal capabilities targets --profile profile:work \
  --capability calendar.event.search --match calendar --limit 5
```

## Candidate Causes

- The Gateway full-catalog route currently emits a new or unrecognized typed
  error; the target-scoped route remains healthy.
- Full-catalog serialization or policy projection is failing while the bounded
  Calendar projection remains valid.
- The local session, TLS path, or Calendar grant is invalid.

## Hypothesis

- The failure is route-specific at the Gateway catalog boundary, and the exact
  server reason is hidden by the installed worker's fallback classifier.
  Disconfirmer: a successful full-catalog discovery response, or a Gateway
  audit/log record exposing a different failure class.

## Verification

- Confirmed route-specific behavior: full catalog fails, target selection
  succeeds, and Calendar provider read plus receipt readback succeeds in the
  same current session.
- Disconfirmed a general session/TLS/Calendar-grant failure as the cause of
  this read: the same binding reached the provider with `authorization: allowed`.
- Exact Gateway-side cause remains candidate because the CLI renders unknown
  Gateway failure codes as `gateway_request_failed`.

## Root Cause

Confirmed at the observable boundary: the full capability-catalog discovery
route is rejected while scoped target discovery and Calendar calls work. The
underlying Gateway rejection reason is not recoverable from this worker result;
`classifyGatewayFailure` falls back to `gateway_request_failed` for an unknown
or unrecognized error code (`packages/ceal-worker-cli/src/call-result-output.ts:360`).

## Invariant Proof

- Invariant: when Gateway discovery emits a route-specific failure, the worker
  must surface the exact safe failure class before an agent claims catalog
  availability.
- Producer Proof: live Gateway target discovery and the verified Calendar
  receipt prove the scoped routes are independently reachable; the full catalog
  produces the structured rejection envelope.
- Final-Consumer Proof: installed `ceal` surfaces `ok: false` and
  `error.kind: gateway_request_failed` for the full catalog.
- Interface-Shape Sibling Scan: compared catalog discovery, target selection,
  and call/readback routes; only the unfiltered catalog route fails.
- Non-Claims: no Gateway logs, raw error code, or full catalog response was
  available; no policy or provider configuration was changed.

## Detection Gap

- Client error classifier | unknown Gateway codes collapse into the generic
  `gateway_request_failed` (`packages/ceal-worker-cli/src/call-result-output.ts:360`)
  | expose a safe, versioned catalog-route failure class or Gateway diagnostic
  reference without leaking provider or credential data.

## Sibling Search

- Mental model: a successful provider call implies every discovery route is
  healthy; the live evidence disproves that.
- Discovery-route axis: full catalog versus bounded target selection | decision:
  keep route-specific status and diagnose independently | proof: live commands.
- Execution axis: Calendar search call versus discovery | decision: call only
  with Gateway-issued target refs and contracts | proof: verified receipt.
- cross-file: Gateway error taxonomy and client `classifyGatewayFailure` need a
  versioned contract; follow-up: catalog-discovery-error-taxonomy.

## Seam Risk

- Interrupt ID: capability-catalog-gateway-seam
- Risk Class: external-seam, repeated-symptom
- Seam: Gateway full discovery response/error -> installed worker classifier.
- Disproving Observation: a fresh full catalog succeeds or exposes a typed
  error that the worker already preserves.
- What Local Reasoning Cannot Prove: the Gateway's current server-side route
  condition or its provider configuration.
- Generalization Pressure: factor-now

## Interrupt Decision

- Resolution: open
- Critique Required: no
- Next Step: spec
- Handoff Artifact: charness-artifacts/spec/2026-08-05-capability-catalog-discovery-error-contract.md

## Prevention

Keep scoped target discovery and execution usable as separate proof levels, but
preserve a safe Gateway error taxonomy for the catalog route so an agent can
distinguish transient Gateway rejection, catalog serialization failure, and
authorization denial without guessing.
