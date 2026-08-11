# Client Boundary Quality Sweep

## Current Slice

Repair the concrete `ceal-client` request/response boundary defects reproduced
during the repository-wide quality review. Keep the frozen Protocol package and
the sibling Gateway repository unchanged.

## Fixed Decisions

- A configured lifecycle timeout bounds the caller even when an injected fetch
  or response body ignores abort.
- A schema-valid success body on non-success HTTP status is invalid; typed
  Protocol failures on non-success status remain valid.
- Lifecycle clients accept the exact `application/json` media type with optional
  parameters. The generic transport additionally retains its deliberate
  `application/*+json` support, but neither accepts a later semicolon token.
- Device-adoption poll requests pass through the canonical Protocol request
  decoder before any fetch.
- The quality adapter's declared surface probe is a complete read-only command.

## Success Criteria

- An abort-ignoring fetch and a non-terminating injected body both reject as
  `request_timeout` within the configured lifecycle deadline.
- Enrollment and personal-session clients reject non-success HTTP responses
  whose decoded body claims success, while their typed failure tests stay green.
- `application/jsonp`, `application/json-seq`, and
  `text/plain; application/json` are rejected; parameterized JSON remains
  accepted at the lifecycle boundary.
- Invalid or extra poll request fields fail before fetch and a valid poll emits
  the canonical exact request shape.
- The adapter-derived CLI probe executes successfully after the ordinary build.

## Deferred Decisions

- No release, protocol re-pin, B1 work, or live Gateway proof belongs to this
  slice.
- Broader test-runner parallelism is deferred because measured standing gates
  remain within their declared budgets and the sweep found no proof-preserving
  speed change to justify.
