# Stage 3 Worker-Readiness Verdict: C (blocked-by-gateway-handoff)

Date: 2026-07-24. Scope: Narnia-owned `ceal-cli` readiness for the next live
Stage 3 one-shot packet. The consumed 2026-07-24 opaque denial packet was not
re-called, re-read, or reclassified.

## Verdict

`blocked-by-gateway-handoff`. The currently installed immutable worker
artifact is not admissible for a complete Stage 3 packet (it cannot render
event-level `gateway_elapsed_ms`), the worker source fix and its tests already
exist on `main`, and the only missing input for a fixed immutable release is
the next compatible Gateway handoff archive: the release lane hard-fails
unless worker, client, and supplied Gateway Protocol versions match exactly
(`scripts/build-worker-release-package.mjs` `version_mismatch` guard), and the
locked archive supplies only the consumed `0.65.0` pair.

## Installed Artifact Identity (verified locally)

- Managed install: `/home/hwidong/.local/bin/ceal` →
  `releases/0.65.0-linux-amd64-3481e952…/ceal-linux-amd64`.
- `ceal version`: 0.65.0, protocol 1.3.0, supported range 1.3.0–1.3.0.
- Binary SHA-256:
  `5a64cbfd6b85c402707bed4eebcfa5178fa5229b11958850dd39956ecc76c076`.
- The 2026-07-24 HOTL packet's executing-artifact digest (`bc278fbc…`) does
  not match this binary or any installed release asset; that artifact's origin
  stays unconfirmed and is the Gateway owner's question, not retried here.
- Locked handoff (`gateway-handoff-lock.json`): tag `gateway-handoff-v0.65.0`,
  gateway commit `57e23865c4f96f703d7976600abe298b505eedfd`, archive
  `ceal-gateway-handoff-0.65.0.tar.gz` SHA-256 `0eb650ab…`, manifest SHA-256
  `fce0dc83…`, Actions run 30051088428.

## Denied-Receipt Projection Evidence (executed, loopback-only)

Method: a disposable loopback mock Gateway served the negotiated policy-denied
audit readback (`ceal.gateway_audit_event.v1`, `outcome: denied`,
`error_code: resource_not_available`,
`non_claims: [provider_execution_not_reached, production_audit_not_reached]`,
optional event-level `gateway_elapsed_ms: 6892`) to a target binary running
with an isolated fixture `HOME` (fixture tokens only). No external network, no
real session material, no Gateway contact.

- Installed 0.65.0 (`5a64cb…`), event WITH `gateway_elapsed_ms`: exit 0,
  `status: verified`, renders `error_code` and both `non_claims`, sends
  `x-ceal-audit-timing: accept`, but omits timing entirely. Fails the
  admissibility contract's timing requirement.
- Installed 0.65.0, event without timing: same projection, no timing (as
  expected).
- Current `main` build (`0e428ce`), same harness, event WITH timing: renders
  `timing.gateway_elapsed_ms: 6892` alongside `error_code`/`non_claims`.
- Source pinning: `ceal-worker-cli` test "a policy-denied receipt retains the
  error code, non-claims, and negotiated Gateway timing" (cli.test.mjs)
  passes on `main` (full 103-test suite, 2.9 s; repo `npm run check` clean).
- Version-control proof that the installed artifact cannot contain the fix:
  `f9ff341` (projection render) and `fe59f8c` (protocol audit-timing field
  sync) are NOT ancestors of tag `ceal-v0.65.0`.

## Exact Gateway Request

Produce the next signed Actions handoff archive so the worker owner can build
`ceal-v0.65.1`:

- Repository/workflow: `corca-ai/ceal`,
  `.github/workflows/gateway-handoff-archive.yml`, new tag
  `gateway-handoff-v0.65.1`, with the run's `actions_run_id` and artifact
  name.
- Archive: `ceal-gateway-handoff-0.65.1.tar.gz` containing
  `corca-ai-ceal-protocol-0.65.1.tgz`, `corca-ai-ceal-0.65.1.tgz`,
  `gateway-artifact-handoff.json`
  (`ceal.repository_extraction_gateway_handoff.v1`),
  `gateway-conformance-proof.json`, and `gateway-protocol-provenance.json`
  (`ceal.gateway_protocol_artifact.v1`).
- Protocol content requirement: the canonical
  `ceal.gateway_audit_event.v1` decode must include the negotiated optional
  event-level `gateway_elapsed_ms` (the field `ceal-cli` `fe59f8c` synced from
  canonical Gateway source), with wire 1.3.0 compatibility retained.
- Narnia will verify: archive SHA-256, handoff-manifest SHA-256, Gateway
  tag/commit/tree, workflow path, Actions run id, artifact name — recorded
  into a reviewed `gateway-handoff-lock.json` update before any build. Do not
  relabel or reuse the consumed 0.65.0 archive.

## New Stage 3 Packet Preflight (for the later one-shot approval)

1. Install the signed `ceal-v0.65.1` worker; record version/SHA-256/manifest.
2. Re-run this loopback denied-receipt probe against the installed 0.65.1
   binary; require `error_code`, both `non_claims`, and
   `timing.gateway_elapsed_ms` in the projection.
3. Gateway owner: both processes readback `source.status: match` with the
   same non-null serving commit, post-apply.
4. One-shot authorization issued; then exactly: one synthetic opaque
   `message.search` denial call
   (`target:slack-channel:000000000000000000000000`), one
   `ceal receipt show <returned-request-ref>`, one Gateway audit/ledger
   readback of the same request/audit ref. No discovery refresh, allowed
   call, connector check, enrollment, target/policy change, or provider
   write.
5. Validate the packet with
   `gateway conformance verify --packet … --json`
   (`ceal.narnia_stage3_opaque_unavailable_packet.v1`).

## Non-Claims

- Local verifier/probe success proves packet shape, projection, and
  correlation only — not one worker network attempt against the real
  Gateway, Gateway audit custody, hidden-resource existence, or provider
  behavior.
- This verdict does not prove the consumed packet's executing-artifact
  origin, does not claim Stage 3 conformance, and authorizes no tag, release,
  install, enrollment, or live call.
- The Gateway serving-identity readback in the preflight is Gateway-owned
  evidence; nothing here substitutes for it.

## Probe Harness (inline record)

Loopback mock + isolated HOME; run as
`node stage3-receipt-probe.mjs <ceal-binary> <with-timing|no-timing>`; the
mock returns the policy-denied readback above and records the
`x-ceal-audit-timing` request header. The full script matched the repo test
fixtures (`policyDeniedReadbackResponse`, `serializeStoredSession`) at
`main@0e428ce`.
