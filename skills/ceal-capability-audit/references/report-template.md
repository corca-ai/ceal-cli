# Ceal capability audit report

Use this as the durable report shape. Keep the headings even when a section is
empty; write `none observed` or `not run — <reason>` instead of silently
omitting a capability.

## Source and scope

- Source origin:
- Source identity:
- Access mode:
- Freshness:
- User-authorized writes:
- Explicit exclusions:
- Source preservation: `source-text`, `re-read-required`, or `source-degraded`

## Run metadata

- Date/time and timezone:
- Ceal binary/protocol version:
- Profile ref:
- Gateway instance ref:
- Report target:
- Highest proof level reached:
- `agent_choice` run: yes/no

## Capability inventory

For every discovered capability:

| Capability | Effect | Target(s) | Contract/readiness | Probe | Outcome | Proof | Cost |
|------------|--------|-----------|--------------------|-------|---------|-------|------|

Include absent writes and safety-skipped writes as rows; an unexecuted row is
not a failure and must not be presented as provider denial.

## Chronological observation log

For each command include:

```text
label:
command family/leaf:
effect:
target:
input summary:
local_elapsed_ms:
gateway_elapsed_ms:
stdout_bytes:
stderr_bytes:
estimated_stdout_tokens:
exit code:
ok/status/error.kind:
request_ref:
receipt/readback:
proof level:
waste / next action:
```

## Provider and safety findings

Separate:

- provider roundtrips;
- Gateway rejections;
- connector failures;
- unknown outcomes;
- absent capabilities;
- safety skips;
- measurement gaps.

## Waste and improvement opportunities

Name concrete duplicated discovery, failed pagination, URL-resolution retries,
unnecessary target enumeration, rate-limit waits, unmeasured work, and the
smallest change that would remove each waste.

## Final claims and non-claims

State what is proven, what is only surface/host decision, what was intentionally
not run, and what the next operator action is. Do not collapse readiness into
provider success.
