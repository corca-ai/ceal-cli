# Worker Client Diagnostic Propagation Critique

Date: 2026-08-21

## Decision Under Review

Implement the bounded session response-shape diagnostic from the shared client
exchange through the personal-client error and Worker `session refresh` output.
Keep the diagnostic additive: preserve refresh disposition, retry semantics,
attempt custody, and Gateway state. Align the retained capability-discovery
fixture to the already-shipped v3 producer shape without changing production
protocol behavior.

Out of scope: Gateway repair or attribution, protocol changes, live recovery,
apply/restart, new PR creation or publication, push, release, and merge.

## Failure Angles

- Boundary drift: a response-shape field could accidentally become a second
  protocol decoder or alter the existing `session_refresh_attempt_unknown`
  recovery path.
- Secret leakage: credential-shaped values could cross through metadata,
  headers, body keys, raw body retention, or a Worker YAML projection.
- False confidence: tests could assert only enumerable JSON or one JSON object
  branch while leaving malformed, non-JSON, array/scalar, oversized, and
  protocol-invalid branches unproven.
- Fixture drift: a stale retained-path producer fixture could be dismissed as
  baseline noise, or a test-only alignment could be mistaken for a protocol
  change.
- Broadening: read-refusal semantics, full boundary matrices, live 500 cause
  analysis, or recovery correlation could enlarge this diagnostic slice beyond
  its named contract.

## Counterweight Pass

- The first fresh-eye pass found three real blockers: embedded credential
  values in safe metadata, credential-shaped content types, and
  credential-shaped body keys. The implementation now uses one embedded
  credential predicate for all three and tests each boundary directly.
- Raw-body/access-token negative coverage was strengthened in the same security
  slice. A Worker route matrix for every client body kind remains a bounded
  follow-up because the route only forwards the already-typed shape and has no
  per-kind branch.
- Mapping read refusal to `malformed_json` is deferred: the fixed contract has
  no `read_refused` kind and explicitly uses `body_bytes: null` for refusal
  before measurement. Adding a new kind would be a separate contract slice.
- Exhaustive numeric/header/key endpoint matrices are over-worry for this
  slice; the cap, truncation, unsafe-key, oversized-header, and representative
  status tests cover the load-bearing bounds.
- The v2-to-v3 discovery fixture update is test-only retained-path hygiene,
  explicitly allowed by the named spec. It does not alter the decoder,
  protocol package, Gateway, or production behavior.
- Verdict after the fixes: no act-before-ship finding remains. The valid live
  HTTP 500 reproduction/correlation remains a named O3 follow-up and is not
  claimed here.

## Structured Findings

- F1 | bin: act-before-ship | evidence: strong | ref: packages/ceal-client/src/session-http-client.ts:14,148-175 | action: fix | note: Embedded credential-shaped metadata, content types, and body keys could cross the operator boundary; the shared predicate was made embedded-aware and direct tests now cover prefix/suffix values, a credential-bearing header, and a credential-shaped key. Fixed before closeout.

- F2 | bin: act-before-ship | evidence: strong | ref: packages/ceal-client/test/personal-client-session-client.test.ts:253-354 | action: fix | note: The focused client proof now covers object/array/scalar/malformed/non-JSON bodies, exact safe shape fields, raw-body absence, refresh/attempt/access-token absence, and the non-2xx success-body decoder branch. Fixed before closeout.

- F3 | bin: bundle-anyway | evidence: moderate | ref: packages/ceal-worker-cli/test/cli.test.ts:1878-1935 | action: defer | note: The Worker route directly proves JSON and non-JSON shape propagation, disposition, exact next action, old refresh-token custody, and attempt custody. A dedicated Worker YAML assertion for malformed_json and too_large is a bounded follow-up because both use the same additive forwarding branch already proven at the client boundary.

- F4 | bin: valid-but-defer | evidence: contested | ref: packages/ceal-client/src/session-http-client.ts:80-85; packages/ceal-client/src/request-bounds.ts:129-151 | action: defer | note: Read refusal and malformed declared length share the contract's malformed_json fallback with body_bytes null; introducing read_refused would require a new public kind and contract decision.

- F5 | bin: over-worry | evidence: moderate | ref: packages/ceal-client/src/session-http-client.ts:12-14,24-34; packages/ceal-client/test/personal-client-session-client.test.ts:358-468 | action: defer | note: Full endpoint matrices for every status/header/key boundary are not needed after the cap, truncation, unsafe-key, 129-byte content-type, and oversized-read checks pass.

- F6 | bin: over-worry | evidence: strong | ref: packages/ceal-worker-cli/test/cli.test.ts:4438-4469; /home/ubuntu/ceal/charness-artifacts/spec/2026-08-03-personal-client-refresh-recovery.md:64-69 | action: defer | note: The v3/target_page change is a test-only retained producer fixture alignment expressly allowed by the spec; no production protocol or Gateway source changed.

- F7 | bin: over-worry | evidence: strong | ref: packages/ceal-worker-cli/src/client-session.ts:165-190,577-585,692-696; packages/ceal-worker-cli/test/cli.test.ts:1918-1930 | action: defer | note: Existing failure kind, retryability, exact next_action, raw-token non-disclosure, old token, and durable attempt journal remain unchanged; response_shape is additive.

## Reviewer Tier Evidence

- Requested tier: gpt-5.6-luna with xhigh reasoning for the bounded angle and counterweight reviewers; the final bounded retry used gpt-5.6-luna with high reasoning after the first xhigh reviewers did not deliver within the bounded wait.

- Requested spawn fields: fork_context=false; model=gpt-5.6-luna; explicit reasoning_effort; no edits, no tests for reviewers, no live/external actions; exact frozen paths and partial-return instruction.

- Host exposure state: requested_fields_sent

- The spawn surface accepted the requested model/reasoning fields; no separate provider-application signal was exposed.

- Application state: n/a — no provider application confirmation was exposed, and no claim is made from its absence.

- Delivery state: findings-received (the counterweight and final bounded retry delivered reports; interrupted/no-delivery attempts were not used as evidence).

## Fresh-Eye Satisfaction

parent-delegated; the final bounded reviewer re-read the final frozen ranges after
the embedded-credential fixes and reported no act-before-ship finding.

## Reviewed Input Identity

<!-- No packet was consumed; the critique reviewed the named source files and
the named diagnostic spec directly. -->

## Boundary Ownership

- Producer: Gateway HTTP status, headers, and bounded response bytes as observed by the shared session exchange.

- Consumer: Worker `ceal session refresh` error YAML and its operator-facing diagnostic field.

- Owning surface: sibling `ceal-cli` client/Worker diagnostic seam; Gateway cause and live recovery remain O3-owned follow-up work.

- Verdict: owned-correctly
