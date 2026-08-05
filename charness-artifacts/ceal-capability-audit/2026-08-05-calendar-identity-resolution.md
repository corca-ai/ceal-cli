# Ceal capability audit report

## Source and scope

- Source origin: live Ceal personal-client session on `narnia`
- Source identity: Gateway session `instance:ceal-prod`, `profile:work`,
  email-first subject bound to the current device
- Access mode: private Gateway-issued client session; no credentials or tokens
  copied into this report
- Freshness: live measurements on 2026-08-05 Asia/Seoul; local cache snapshot
  dated `2026-08-04T22:37:40.496Z` is marked stale/advisory
- User-authorized writes: file a GitHub issue in `corca-ai/ceal`; no Ceal
  provider write was performed
- Explicit exclusions: no policy/credential/registration mutation; no Slack
  or message writes; no guessed capability route; no raw provider payloads
- Source preservation: `source-text` — this report preserves the commands,
  structured outcomes, measured costs, and non-claims from the session

## Run metadata

- Date/time and timezone: 2026-08-05, Asia/Seoul
- Ceal binary/protocol version: `0.72.9` / `1.3.0`
- Profile ref: `profile:work`
- Gateway instance ref: `instance:ceal-prod`
- Report target: `corca-ai/ceal`
- Highest proof level reached: `provider_roundtrip` + `readback_verified`
- `agent_choice` run: no — the natural-language-to-capability selection path
  itself was not tested; the installed CLI was invoked explicitly

## Capability inventory

The required live catalog command returned `gateway_request_failed`, so a
complete current inventory was not available. The local cache contained 20
capabilities, but it is advisory and not treated as current proof.

| Capability | Effect | Target(s) | Contract/readiness | Probe | Outcome | Proof | Cost |
|---|---|---|---|---|---|---|---|
| `calendar.event.search` | read | 2 live targets: `Calendar Corca Team`, `Calendar Corca Team Calendar` | discovered live; both `granted`, `readiness: degraded`; required `time_min`, `time_max` | bounded KST day query on returned opaque target | 1 result; provider payload intentionally omitted | `readback_verified` | 28,011.775 ms local; 26,353 ms Gateway; 994 stdout bytes |
| `calendar.availability` | read | not selected | cache-only contract; current catalog unavailable | not run | `measurement_gap` / unproven current route | surface only | not measured |
| `calendar.event.get` | read | historical opaque Calendar target | cache plus prior local receipt only | historical call on 2026-08-04 | prior success recorded; not repeated in this audit | historical `readback_verified` | `measurement_gap` |
| `github.issue.create` | write | none | not present in cached capability inventory; current full catalog unavailable | not guessed or invoked | `capability_absent` at the available discovery boundary | not proven | not run |
| `github.issue.comment.create` | write | live target `GitHub corca-ai/ceal` available | target grant present, `readiness: degraded`; write contract required idempotency and provider readback | target selection only; no issue number supplied | `safety_skipped` | host decision only | 11,049.962 ms; 3,730 stdout bytes |
| `github.issue.get` | read | live target `GitHub corca-ai/ceal` available | target grant present, `readiness: unknown`; input requires issue number | target selection only; no issue number supplied | `safety_skipped` | host decision only | 16,078.183 ms; 3,589 stdout bytes |

## Chronological observation log

Earlier help, session, discovery, and call commands were run before the audit
measurement helper was introduced; they are retained below as
`measurement_gap`, not silently assigned timings.

```text
label: installed-surface-help
command family/leaf: ceal --help; session adopt/help; capabilities/help; call/help
effect: read_only
target: installed worker surface
input summary: progressive help discovery
local_elapsed_ms: measurement_gap
gateway_elapsed_ms: n/a
stdout_bytes: measurement_gap
stderr_bytes: measurement_gap
estimated_stdout_tokens: measurement_gap
exit code: 0
ok/status/error.kind: help; no non-help result
request_ref: none
receipt/readback: none
proof level: surface
waste / next action: none; help was required by the installed guide

label: initial-session
command family/leaf: ceal session
effect: read_only
target: local session store
input summary: inspect email-first session
local_elapsed_ms: measurement_gap
gateway_elapsed_ms: n/a
stdout_bytes: measurement_gap
stderr_bytes: measurement_gap
estimated_stdout_tokens: measurement_gap
exit code: 0
ok/status/error.kind: ok / configured; first observation had expired access, later renewal made access current
request_ref: none
receipt/readback: local state only
proof level: surface
waste / next action: run live discovery; no token material exposed

label: live-catalog-prior-attempts
command family/leaf: ceal capabilities --profile profile:work --fresh [--detail]
effect: read_only
target: full Gateway capability catalog
input summary: fresh current inventory
local_elapsed_ms: measurement_gap
gateway_elapsed_ms: n/a
stdout_bytes: measurement_gap
stderr_bytes: measurement_gap
estimated_stdout_tokens: measurement_gap
exit code: 3
ok/status/error.kind: false / unavailable / gateway_request_failed
request_ref: not returned
receipt/readback: none; non-claim says no provider action/audit custody
proof level: host_decision
waste / next action: repeated because the first response gave only a generic recovery action

label: live-catalog
command family/leaf: ceal capabilities --profile profile:work --fresh --detail
effect: read_only
target: full Gateway capability catalog
input summary: measured fresh current inventory
local_elapsed_ms: 26,746.942 ms
gateway_elapsed_ms: n/a
stdout_bytes: 523
stderr_bytes: 0
estimated_stdout_tokens: 131
exit code: 3
ok/status/error.kind: false / unavailable / gateway_request_failed
request_ref: not returned
receipt/readback: none; no provider action or production audit custody
proof level: host_decision
waste / next action: Gateway-side catalog route needs an actionable safe error

label: email-calendar-target-selection
command family/leaf: ceal capabilities targets
effect: read_only
target: `calendar.event.search`
input summary: `--match bae.hwidong@corca.ai --limit 5`
local_elapsed_ms: 26,756.09 ms
gateway_elapsed_ms: not exposed
stdout_bytes: 1,492
stderr_bytes: 0
estimated_stdout_tokens: 373
exit code: 0
ok/status/error.kind: true / available / none
request_ref: discovery request returned in output; no provider request
receipt/readback: none; target_catalog complete with target_count 0
proof level: host_decision
waste / next action: user-supplied Calendar identity did not resolve; do not call without a returned target

label: calendar-target-selection
command family/leaf: ceal capabilities targets
effect: read_only
target: `calendar.event.search`
input summary: `--match calendar --limit 5`
local_elapsed_ms: 26,735.623 ms
gateway_elapsed_ms: not exposed
stdout_bytes: 2,393
stderr_bytes: 0
estimated_stdout_tokens: 599
exit code: 0
ok/status/error.kind: true / available / none
request_ref: `ceal:ef95d808-3036-483d-bfe2-aa3082345bea:discover`
receipt/readback: target_catalog complete; 2 granted targets
proof level: host_decision
waste / next action: target labels are available, but no email-to-target mapping is declared

label: calendar-read-today
command family/leaf: ceal call calendar.event.search
effect: read_only
target: `target:calendar:adf1817b9c0b90ff27bbc5c2`
input summary: 2026-08-05T00:00:00+09:00 through 2026-08-06T00:00:00+09:00; Asia/Seoul; limit 25
local_elapsed_ms: 28,011.775 ms
gateway_elapsed_ms: 26,353
stdout_bytes: 994
stderr_bytes: 0
estimated_stdout_tokens: 249
exit code: 0
ok/status/error.kind: true / completed / none
request_ref: `ceal:29675cdf-a1db-457d-916a-663a161b229c:call`
receipt/readback: `verified`; audit `gateway-audit:cbfabdd7-f083-4998-9968-fd10c69e31dc`; authorization allowed; outcome succeeded
proof level: provider_roundtrip + readback_verified
waste / next action: bounded read succeeded, but the target was selected by label, not user email

label: calendar-read-receipt
command family/leaf: ceal receipt show
effect: read_only
target: prior Calendar request
input summary: request ref above
local_elapsed_ms: 1,934.522 ms
gateway_elapsed_ms: 26,353 (the original call's audit timing)
stdout_bytes: 550
stderr_bytes: 0
estimated_stdout_tokens: 138
exit code: 0
ok/status/error.kind: true / verified / none
request_ref: same as above
receipt/readback: verified Gateway audit; grant revision 6
proof level: readback_verified
waste / next action: none

label: github-comment-target-selection
command family/leaf: ceal capabilities targets
effect: read_only (write capability target discovery)
target: `github.issue.comment.create`
input summary: `--match corca-ai/ceal --limit 5`
local_elapsed_ms: 11,049.962 ms
gateway_elapsed_ms: not exposed
stdout_bytes: 3,730
stderr_bytes: 0
estimated_stdout_tokens: 933
exit code: 0
ok/status/error.kind: true / available / none
request_ref: discovery request returned in output
receipt/readback: target `GitHub corca-ai/ceal`; no comment written
proof level: host_decision
waste / next action: requires an existing issue number and stable idempotency key

label: github-issue-get-target-selection
command family/leaf: ceal capabilities targets
effect: read_only
target: `github.issue.get`
input summary: `--match corca-ai/ceal --limit 5`
local_elapsed_ms: 16,078.183 ms
gateway_elapsed_ms: not exposed
stdout_bytes: 3,589
stderr_bytes: 0
estimated_stdout_tokens: 898
exit code: 0
ok/status/error.kind: true / available / none
request_ref: discovery request returned in output
receipt/readback: target `GitHub corca-ai/ceal`; no issue number to read
proof level: host_decision
waste / next action: use `charness:issue` for the explicitly authorized new issue
```

## Provider and safety findings

- Provider roundtrip: one bounded Calendar search succeeded and its Gateway
  receipt was verified. The event payload is intentionally not copied here.
- Gateway rejection: the full live capability catalog returned
  `gateway_request_failed`; the worker did not expose a precise server code.
- Connector failures: none observed on the successful Calendar call. Target
  discovery advertised `readiness: degraded`, so readiness is not equated with
  provider success.
- Unknown outcomes: none.
- Absent capability: `github.issue.create` was not present in the cached
  inventory and the live full inventory was unavailable; no guessed route was
  invoked.
- Safety skips: no Calendar write, no GitHub issue/comment write through Ceal,
  and no policy or credential mutation.
- Measurement gaps: all earlier pre-audit commands and the historical
  2026-08-04 Calendar call were not timed by `measure_ceal.py`.

## Waste and improvement opportunities

- The full catalog route took about 26.7 seconds and returned only a generic
  failure, causing repeated discovery retries. A stable safe error kind or
  diagnostic reference would remove this retry waste.
- The user supplied a Calendar identity, but target selection only returned
  human-readable labels and returned zero for the email. A Gateway identity-to-
  target resolver or canonical calendar-id match would remove label guessing.
- A current complete catalog was unavailable, so the audit could not honestly
  cover every capability. The smallest improvement is to restore the catalog
  route before claiming exhaustive capability coverage.

## Final claims and non-claims

- Proven: the email-first session is current and bound to an opaque Gateway
  subject; live target selection can find two granted Calendar targets by label;
  a bounded Calendar read can reach the provider and receive verified audit
  readback.
- Proven: `bae.hwidong@corca.ai` does not resolve to a Calendar target through
  the current `--match` route; the route answered a complete zero-target page.
- Not proven: that the supplied email is accepted by the Gateway as a canonical
  provider Calendar ID; the target catalog did not expose that mapping.
- Not proven: a complete current capability inventory; full catalog discovery
  failed.
- Not run: `github.issue.create` through Ceal, because it was not discovered;
  the requested GitHub issue will be filed through the explicit
  `charness:issue` workflow instead.
- Next operator action: make the email/calendar-id-to-target relationship an
  explicit Gateway resolution contract, and preserve the catalog-route error
  class so agents can diagnose this boundary without guessing.
