# Worker CLI Startup Friction Reduction

Date: 2026-08-17
Title: Worker CLI startup friction reduction
Status: complete local diagnostic slice; automatic renewal and link migration are follow-up contracts

## Problem

The macOS dogfood report showed a high-cost failure path for an otherwise small
private-link read:

- the signed guide was staged but not registered;
- `ceal guide register codex` stopped on an earlier Ceal-managed link and
  required manual deletion;
- an expired session required a separate explicit refresh;
- `ceal capabilities --fresh --detail` then failed as `invalid_response` with
  `live_gateway_checked: false`, although DNS/TLS/HTTP reached the Gateway and
  the handshake timing reported success;
- the final capability/resource resolver answer was unavailable, so the
  operator correctly did not bypass Ceal through a browser or raw provider API.

Before this slice, the Worker source confirmed the shape of the waste. The capabilities
runner resolves stored access in `observe` mode and only retries after a typed
Gateway `authentication_failed` response
(`packages/ceal-worker-cli/src/index.ts:542-567, 829-878, 910-926`). A non-JSON
401 is rejected by the HTTP transport as `invalid_response` while retaining its
HTTP status internally (`packages/ceal-client/src/http-transport.ts:26-58,
153-175`), but the Worker catch path currently reduces that context to one
string (`packages/ceal-worker-cli/src/index.ts:588-600, 1682-1770`). Embedded
guide registration already distinguishes exact managed links from foreign
occupants, but deliberately turns the managed case into a manual conflict
(`packages/ceal-worker-cli/src/agent-guide.ts:389-409, 640-662`).

## Capability Contract

Reduce the normal installed-client path to the smallest honest sequence:

1. Help, local guide/status, session status, and observer startup remain local
   and never refresh a session.
2. A stored-session Gateway route (`capabilities`, target selection, receipt
   readback, acceptance evidence, and capability calls) loads the session and
   refreshes it once, only when the access credential is no longer current and
   the existing locked refresh path can safely attempt rotation. The route then
   begins its own handshake/request with the rotated session. A direct
   `--endpoint ... --token-stdin` request has no stored refresh context and is
   unchanged.
3. The command contract exposes the two independent axes: the route's external
   effect and its local session effect. A read-only Gateway route may therefore
   say `effect: read_only` and `session_effect: refresh_if_needed` without
   pretending that credential rotation did not happen. Explicit enrollment,
   refresh, and logout remain separately visible actions.
4. `ceal capabilities` uses the advisory catalog cache by default. `--fresh`
   remains an explicit opt-in for a live discovery claim or a known policy/
   authorization change; no guide bootstrap step may require it merely to read
   the available route shape. A successful cached response must keep saying that
   only the handshake was live.
5. An exact earlier Ceal-managed guide link is replaced automatically after a
   final ownership re-check. A foreign file, directory, foreign symlink, or
   ambiguous/racing occupant is never removed and remains a conflict. The
   replacement reports the resulting registration state and does not require a
   second human command.
6. A transport/protocol failure preserves safe diagnostics: operation,
   correlation/request id when one exists, HTTP status when a response arrived,
   response content type, and a bounded response classification. Response bodies,
   authorization material, refresh credentials, and untrusted server text are
   never rendered. The result distinguishes `network_reached`,
   `handshake_verified`, and `discovery_verified` so `live_gateway_checked:
   false` cannot be read as “the host was unreachable” after a successful
   handshake.

## Current Slice

This contract currently closes only the local failure-diagnostics slice. It must
make the macOS observation actionable without changing the Gateway protocol or
silently changing read-only command boundaries:

- Extend `CealHttpTransportError` with structured, redaction-safe context rather
  than changing the Gateway's authoritative response decoder.
- Thread the request id/operation and response status/content type/classification
  into Worker failure output.
- Add a phase observation to capability failures: session resolution,
  network/HTTP response, protocol handshake, or discovery. Keep
  `live_gateway_checked` backwards compatible while making the phase fields
  authoritative for new readers.
- Add deterministic transport tests for non-JSON 401, malformed JSON, schema
  mismatch, oversized response, and a typed Gateway denial; each must expose
  enough next action to distinguish auth, response shape, and reachability.
- Measure the normal catalog path separately: the current `observe`-mode
  fixture records zero refreshes, then handshake/discovery count and order. Do
  not change cache/`--fresh` semantics in this slice; the source already proves
  that the default can use a warm cache.

## Gate Ownership and Feedback Timing

The current Worker repository has no checked-in `.githooks/pre-commit`; the
`.githooks/` directory contains only the executable `pre-push` hook, and
`npm run hooks:install` configures `core.hooksPath` for that directory. The
ordinary hook path runs `npm run check:unit`, whose script owns `npm run
lint:types`, so a TypeScript error first appears at pre-push unless the operator
runs the type gate directly. This explains the observed timing; it is not a
typechecker that is intrinsically unable to run earlier.

Workflow debt is **tracked, not fixed in this slice**: `corca-ai/ceal-cli` owns
a future cheap changed-file pre-commit feedback check. It must supplement, not
replace, the full pre-push/CI gate and must not turn the slow release proof into
an every-commit action.

The following are explicit follow-up contracts, not acceptance obligations for
this slice:

- **Automatic session renewal:** change the read-only command contract only
  after defining `session_effect` as a declaration axis, an actual-result field,
  and one invocation-scoped refresh budget. The existing `call` renew path is
  not part of that change because it already uses `renew` mode.
- **Managed guide link migration:** keep the current conflict refusal until an
  atomic/no-follow conditional replacement or a shared registration lock plus a
  deterministic race proof exists. A mere lstat/re-check/unlink sequence is not
  sufficient.

## Fixed Decisions

- No automatic refresh for `--help`, `version`, `commands`, guide operations,
  session status, observer, or direct-token requests.
- Until the follow-up renewal contract is accepted, the currently declared
  read-only routes keep their explicit `ceal session refresh` recovery. This
  slice does not silently change that public boundary.
- A malformed/unknown refresh result keeps the existing fail-closed quarantine;
  the client must not replay a one-time v1 refresh credential.
- Foreign guide occupants are never deleted. The existing managed-link conflict
  refusal stays in force during this slice; “Ceal-managed” is not by itself
  enough authority for a non-atomic deletion.
- `--fresh` is not a default and is not a remedy for an expired access token.
  Session renewal happens before discovery selection; cache freshness and
  credential freshness remain separate facts.
- Diagnostics are allow-listed and bounded. HTTP status is numeric, content
  type is normalized, the response classification is an internal enum, and the
  correlation field is the outbound request id when no trusted Gateway
  correlation header exists.

## Probe Questions

- Does the deployed Gateway return a stable correlation header on malformed or
  non-JSON responses, or is the Worker request id the only safe correlation key?
- Does the Gateway's 401 response body/headers differ between expired access,
  revoked session, and a proxy/WAF response on each supported macOS route?
- Can the supported Node filesystem APIs provide a conditional no-follow unlink
  for the managed guide symlink, or must the implementation document the narrow
  re-check/replace race as a residual boundary?
- Which release acceptance command is the shortest honest proof that a macOS
  installed candidate refreshed once, used cached discovery by default, and
  registered a guide without manual link deletion?

## Deferred Decisions

- Changing Gateway HTTP error bodies or protocol response schemas. The first
  Worker slice must consume existing protocol truth and expose transport context;
  a producer change needs a separate Gateway/protocol contract.
- Replacing the advisory discovery cache with a push/invalidation channel.
- Automatic guide registration during binary update. Registration remains an
  explicit local write, but a known Ceal-managed stale link is migrated by the
  registration command itself.
- A cross-host credential/session daemon or refresh broker.

## Non-Goals

- Browser, raw Notion API, provider CLI, or any other bypass when the Gateway
  cannot authorize the requested source.
- Refreshing credentials for local-only inspection or silently changing the
  user's selected Profile.
- Deleting arbitrary skill files/directories or repairing a foreign host setup.
- Retrying a failed discovery request indefinitely, or treating a successful
  handshake as successful capability discovery.
- Tagging, pushing, publishing, installing, or applying a release in this local
  implementation slice.

## Constraints

- Worker source authority is `/home/ubuntu/ceal-cli`; Gateway source/protocol
  changes stay in `/home/ubuntu/ceal` and require a separate boundary decision.
- Preserve the signed protocol and release input pins unless a separate
  producer/consumer handoff is intentionally cut.
- Preserve secret redaction and the current lock/quarantine ordering around
  one-time refresh credentials.
- Use the repository's existing guide ownership marker and discovery cache
  validators; do not add parallel ownership or freshness sources.
- The installed release's version document remains byte-stable.

## Success Criteria

1. A malformed/non-JSON Gateway response produces an error containing the
   operation, request/correlation id, HTTP status, content type, response
   classification, and a phase-specific next action without token/body leakage.
2. A failure after a successful protocol handshake states that network/HTTP
   reachability and handshake verification succeeded while discovery did not;
   no output claims capability availability or provider/resource access.
3. A failure during handshake states that an HTTP response was received but the
   protocol handshake was not verified; a non-JSON 401 is not guessed to be a
   refreshable session.
4. The normal catalog path's deterministic fixture records zero refreshes under
   the current `observe` contract, then handshake/discovery counts and order.
   Existing warm-cache behavior remains one live handshake plus zero discovery
   probes; `--fresh` remains the explicit live discovery override.
5. Focused Worker/client tests and the local deterministic gates pass. No
   external release boundary is crossed in this slice.

## Acceptance Checks

- `unit`: renewal mode tests cover current, expired-renewable, expired-
  unrenewable, refresh-unknown, and concurrent invocation paths. **Follow-up
  contract; not run by this slice.**
- `unit`: command help/`ceal commands` expose `effect` and `session_effect`
  independently for every changed route. **Follow-up contract; not run by this
  slice.**
- `unit`: guide migration replaces only a verified managed link and preserves
  foreign files, directories, and links. **Follow-up contract; current slice
  retains the conflict refusal.**
- `unit`: HTTP transport diagnostics classify non-JSON, malformed JSON, schema
  mismatch, oversize, and typed denial responses without exposing bodies.
- `integration`: a bounded local Gateway fixture proves handshake/discovery
  phase readback and records zero refreshes plus handshake/discovery counts
  without changing the stored-session renewal contract.
- `macOS candidate`: reproduce the reported non-JSON 401 against an installed
  candidate and retain the full YAML/timing payload. This is required before
  saying the external cause is resolved; Linux fixtures alone do not prove the
  macOS HTTP seam.
- `release`: run the focused local gates and `npm run check`. The repo-owned
  release pre-tag preflight and any macOS candidate release proof belong to the
  follow-up renewal/migration release bundle. Push/tag/publish/install/apply
  remain separately approved external boundaries.

## Boundary Ownership

- Worker session lifecycle, command declarations, guide registration, client
  transport diagnostics: `corca-ai/ceal-cli`.
- Gateway response/header behavior and any protocol-level error contract:
  `corca-ai/ceal`.
- Installed macOS binary and real Gateway session readback: operator-owned
  candidate acceptance; local Linux tests may not stand in for it.
- Release tag/push/publish/install/apply: separate external side-effect
  boundaries; this slice does not perform them.

## Claim Ledger

| Claim | Source | Re-check command | Verification level | Status |
| --- | --- | --- | --- | --- |
| Stored capabilities access currently uses `observe` mode before handshake. | `packages/ceal-worker-cli/src/index.ts:542-567,829-878` | `rg -n 'resolveStoredGatewayAccessResult|requestCapabilityHandshake' packages/ceal-worker-cli/src/index.ts` | verified-by-reading | verified |
| The Worker retries a capability handshake only after a typed `authentication_failed`, so non-JSON 401 cannot trigger refresh. | `packages/ceal-worker-cli/src/index.ts:910-926` and transport decoder | `rg -n 'shouldRetryAuthentication|invalid_response' packages/ceal-worker-cli/src/index.ts packages/ceal-client/src/http-transport.ts` | verified-by-reading | verified |
| Transport now retains request/operation/status/content-type/response-kind diagnostics and Worker emits them in phase-aware output. | `packages/ceal-client/src/http-transport.ts:26-58,153-247`; `packages/ceal-worker-cli/src/index.ts:588-600,1682-1770`; `packages/ceal-worker-cli/src/gateway-diagnostics.ts:1-75` | `rg -n 'response_kind|gateway_observation|gatewayTransportObservation' packages/ceal-client/src packages/ceal-worker-cli/src` | verified-by-reading and test-proven | verified |
| Type errors are owned by `check:unit` and are first run by the ordinary pre-push hook; no pre-commit hook is checked in. | `.githooks/pre-push:116-130`; `package.json:29-32,45-48`; `.githooks/` listing | `ls -la .githooks; rg -n 'check:unit|lint:types|hooks:install|pre-commit|pre-push' .githooks package.json scripts/install-git-hooks.ts` | verified-by-reading and command-proven | verified; faster pre-commit feedback tracked as workflow debt |
| Default catalog path can serve a usable cache and `--fresh` bypasses it. | `packages/ceal-worker-cli/src/index.ts:603-653`; `packages/ceal-worker-cli/src/discovery-cache.ts:8-36` | `rg -n 'wantsFresh|discoveryCacheEntryUsable|DEFAULT_DISCOVERY_CACHE_TTL_MS' packages/ceal-worker-cli/src/index.ts packages/ceal-worker-cli/src/discovery-cache.ts` | verified-by-reading | verified |
| Exact earlier Ceal-managed guide links are currently refused rather than migrated. | `packages/ceal-worker-cli/src/agent-guide.ts:389-409,640-662` | `rg -n 'managed_previous|Remove the existing link|registrationDisposition' packages/ceal-worker-cli/src/agent-guide.ts` | verified-by-reading | verified |
| Existing tests explicitly require manual cleanup for a legacy managed link. | `packages/ceal-worker-cli/test/agent-guide.test.ts:497-520` | `sed -n '497,520p' packages/ceal-worker-cli/test/agent-guide.test.ts` | verified-by-reading | verified |
| The macOS report observed HTTP 401/handshake success but no verified discovery. | operator-provided payload in this task | reproduce with `ceal --timing capabilities --fresh --detail` on the affected installed candidate and retain the full YAML/timing payload | operator-provided fact; not repo-proven | observed, pending candidate reproduction |

## Critique

- Interrupt Source: external Gateway/HTTP response seam plus local filesystem
  registration seam.
- Seam Summary: a Worker-only change can preserve request/transport context and
  make refresh/registration efficient, but it cannot prove the cause of a
  malformed Gateway response or hosted macOS race without candidate readback.
- Chosen Next Step: narrow the first implementation to the Worker/client local
  diagnostic envelope and deterministic phase/count tests; keep automatic
  read-only renewal and managed-link deletion as separate follow-up contracts.
- Impl Status: complete for the local diagnostic implementation slice.
- Impl Status Reason: transport diagnostics and phase/count proof are landed;
  automatic refresh changes a declared command boundary and managed-link
  replacement deletes a path, so both remain separately contracted.
- What Disproving Observation Is Resolved: source inspection resolves that the
  current cache is not the reason every capability call is slow; the expensive
  path is explicit `--fresh` or a cache miss after the handshake. The report's
  live 401 remains an external observation until reproduced against a candidate.

### Fresh-eye Findings and Dispositions

- Security/ownership: **defer Slice B**. Rechecking a managed symlink before
  unlink does not make the deletion conditional; a foreign occupant can race
  into the gap. Keep the existing conflict refusal until an atomic/no-follow
  primitive or a proved shared registration lock exists.
- Security/ownership: **fix before any future Slice A**. A pre-renewal followed
  by an authentication retry can otherwise force two refresh attempts in one
  invocation. The renewal budget/state must be shared across preflight and
  retry, with an exact request-count test.
- Security/ownership: **fix before any future Slice A**. Route declaration
  (`session_effect: refresh_if_needed`) and actual result (`none`, `refreshed`,
  `refresh_failed`, or `quarantined`) are different facts and must not be
  collapsed.
- Usability/performance: **bundle into this diagnostics slice**. Warm cache
  still performs a live handshake, so acceptance must record refresh,
  handshake, discovery counts and order rather than claim “no network”.
- Counterweight: **narrow current work to Worker-local diagnostics**. Do not
  change Gateway response schemas/headers, auto-renew read-only routes, or
  delete managed links in this first implementation.
- Counterweight: **split release proof**. A local diagnostic proof, the later
  automatic-renewal proof, guide migration proof, macOS installed-candidate
  proof, and final release preflight are sequential bundles, not one initial
  acceptance gate. Environment-variable re-entry is not part of the proof.

## Canonical Artifact

`charness-artifacts/spec/2026-08-17-cli-startup-friction-reduction.md`

## First Implementation Slice

The Worker/client transport diagnostic envelope and phase/count tests are
complete. The next slice is to draft a separate automatic-session-renewal contract
with `session_effect` and a shared refresh budget; keep managed-link migration
blocked until its deletion race has an explicit safe primitive and mutation
proof.

## Closeout Ledger

- Implemented: durable Worker/client transport diagnostics, phase-aware
  capability failures, regression fixtures, README guidance, and this spec;
  external-writes: none; test-only: local Gateway fixtures and proof-job logs.
- Capability Delivered: malformed Gateway responses now report bounded
  request/HTTP/response facts and tell the operator whether handshake or
  discovery was actually proven, without exposing response bodies or secrets.
- Contract Source: this artifact's Fixed Decisions and Acceptance Checks.
- Verification: `npm run build:worker` passed; client transport tests passed
  (47/47); Worker full tests passed (393 pass, 3 skip, 0 fail); focused
  malformed-response and packaged-bin tests passed; the final pre-push
  iteration gate reached 238/238 contract tests after fixing the staged-source
  inventory and duplicate-ratchet findings; no provider_roundtrip or
  agent_choice claim.
- Lint Gate: ran-fail-fixed `bash .githooks/pre-push`; the final iteration gate,
  duplicate ratchet, and shell lint passed after fixing the new test ratchet
  counts, removing an unused diagnostic export, staging the new source file,
  extracting two new code-clone families, and recording one pre-existing test
  family re-key in `dup-review.json`.
- Truth Surface Sync: `README.md` and this spec; command effect declarations
  remain unchanged because automatic renewal is deferred.
- Boundary Ownership: Worker/client transport and CLI output are owned by
  `corca-ai/ceal-cli`; Gateway/protocol response changes remain outside this
  slice; Verdict: `owned-correctly`.
- Critique: full parent-delegated security/ownership, usability/performance,
  and counterweight review; findings are recorded above and the refresh/link
  changes remain explicitly deferred.
- Contract Updates: current-slice acceptance now records zero refreshes plus
  handshake/discovery order; automatic renewal and managed-link migration stay
  follow-up contracts.
- Retro: auto-trigger check returned `not-established` (`adapter-missing`), so
  no separate retro artifact was created; the actionable waste is recorded as
  the late type feedback and the tracked cheap pre-commit follow-up.
- Residual Risks: no macOS installed-candidate reproduction, no live Gateway
  roundtrip, no signed release, and no proof of a stable Gateway correlation
  header; the operator's original external 401 cause remains unclassified.
- Next Slice: define the `session_effect`/actual-result contract and one
  invocation refresh budget, separately prove managed-link migration, and then
  implement the bounded pre-commit type-feedback surface.

## Completion Categories

- durable: source, tests, README guidance, spec, and closeout ledger.
- verification: local worker/client build, focused suites, and final pre-push
  iteration proof at `worker_queued` level; no provider_roundtrip or
  agent_choice.
- external-writes: none; no push, tag, publish, install, or instance apply.
- unverified-future: automatic renewal, managed-link replacement, macOS
  candidate behavior, Gateway correlation headers, and final release proof.
