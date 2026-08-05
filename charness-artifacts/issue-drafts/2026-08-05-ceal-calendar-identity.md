## Problem

An email-first Ceal session does not resolve the user's supplied Google Calendar identity to a Calendar target.

The reporter enrolled the device using verified-email identity and then asked to read their calendar. The supplied value was:

> `bae.hwidong@corca.ai`

The expectation is that this value, which is also the user's Calendar ID in this setup, can identify the user's calendar for a natural-language request such as “read my calendar”.

## Reproduction

Environment:

- Host: `narnia`
- Installed worker: `ceal 0.72.9`
- Protocol: `1.3.0`
- Gateway: `instance:ceal-prod`
- Profile: `profile:work`
- Session enrollment: email-first; current session is bound to an opaque Gateway `subject_ref`

Run:

```sh
ceal capabilities targets \
  --profile profile:work \
  --capability calendar.event.search \
  --match bae.hwidong@corca.ai \
  --limit 5
```

Observed result: `ok: true`, `status: available`, `target_catalog.complete: true`, `target_count: 0`.

As a control, the same live target-selection route with `--match calendar` returns two granted targets:

- `Calendar Corca Team`
- `Calendar Corca Team Calendar`

Both currently advertise `readiness: degraded`. A bounded read against the returned opaque target for `Calendar Corca Team Calendar` succeeded, with Gateway receipt `ceal:29675cdf-a1db-457d-916a-663a161b229c:call` verified as `authorization: allowed`, `outcome: succeeded`. The provider event content is omitted from this issue.

## Expected behavior

After email-first adoption, the authenticated subject and the canonical Calendar identity should be usable to resolve the user's intended Calendar target. The agent should either:

1. resolve `bae.hwidong@corca.ai` to one opaque Calendar target and read it; or
2. report a precise ambiguity if multiple Calendar targets are bound to that identity.

It should not require the agent to guess between team-labeled targets.

## Actual impact

- Email-first authentication establishes the requester identity, but that identity is not connected to the Calendar target catalog.
- The same value that identifies the user's Calendar cannot be used as a target-selection match.
- The natural-language request “read my calendar” therefore cannot safely select the user's calendar from the current public worker contract.
- A successful read through a remembered/labeled opaque target does not prove that target is the user's personal calendar.

## Related session evidence

The full live capability catalog also failed during this session:

```text
ceal capabilities --profile profile:work --fresh --detail
ok: false
status: unavailable
error.kind: gateway_request_failed
```

Scoped target discovery and the bounded Calendar call still worked, so this is not evidence that the session or Calendar connector is wholly unusable. It is a separate discovery/diagnostic boundary that made the agent's first attempt more expensive and less explainable.

Measured audit observations on 2026-08-05 Asia/Seoul:

| Operation | Result | Local elapsed | Gateway elapsed | Output |
|---|---|---:|---:|---:|
| Full live catalog | `gateway_request_failed` | 26,746.942 ms | not exposed | 523 bytes |
| Email target selection | complete zero-target page | 26,756.09 ms | not exposed | 1,492 bytes |
| Calendar label target selection | 2 targets | 26,735.623 ms | not exposed | 2,393 bytes |
| Bounded Calendar read | `readback_verified` | 28,011.775 ms | 26,353 ms | 994 bytes |

No credentials, tokens, raw provider IDs, or provider event payloads were included. No write was attempted.

## Suggested direction (non-binding)

Consider making the identity-to-target relationship explicit in Gateway discovery, for example by returning a safe canonical Calendar identity/alias for target selection or a subject-scoped default Calendar target. Preserve the ambiguity case when more than one Calendar is bound. Also expose a safe, versioned error class for the failing full catalog route instead of collapsing it to `gateway_request_failed`.

## Audit artifact

The complete local audit ledger is recorded at:

`charness-artifacts/ceal-capability-audit/2026-08-05-calendar-identity-resolution.md`
