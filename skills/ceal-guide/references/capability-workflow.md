# Capability Workflow

Use these rules after the core guide selects a capability-oriented task.

## Discover And Select

- Command discovery is navigation only. Live capability discovery owns current
  capabilities, input contracts, readiness, and target-catalog size.
- A warm catalog is advisory because every call re-validates at the Gateway.
  Add `--fresh` when the result must claim live discovery or grants may just have
  changed. Cached discovery reports only the narrower claims it actually proves.
- Discovery intentionally omits target inventory. When selection is required,
  use the target child with one discovered capability and only a selector form
  declared by current Gateway guidance or leaf help. Target selection is a
  separate contract from the capability's `input_contract`: do not reuse a call
  argument, source URL, or opaque resource ref as `--match` unless that selector
  form is explicitly declared. Omit `--match` when help permits a bounded
  unfiltered page.
- Read `target_selection.request_kind` with `target_catalog`. When a `match`
  request returns a complete catalog with `target_count: 0`, the request
  included a selector and the Gateway response contained no current targets;
  that response alone does not prove the Profile has no authorized target for
  the capability. Follow its returned `next_action` to inspect a bounded
  unfiltered page. A resolver may return an opaque ref for another capability's
  call input without making that ref a valid target selector.
- Treat `selector_not_supported` as navigation, not an empty authorization
  result. Follow its exact `next_action`: select an opaque target without the
  rejected URL selector, resolve the URL through the catalog-declared resolver
  when present or the canonical `resource.resolve` fallback, and pass only the
  returned opaque handle as a declared call argument.
- Follow an opaque target `next_cursor` only for the same capability. Result
  paging is separate: use only the continuation field and bounds declared by
  that capability. If concise discovery omits them, run
  `ceal capabilities --profile <profile-ref> --detail`. Its detailed
  `input_contract` is the source of truth for required call-input fields and
  result bounds, including capabilities that enumerate or resolve resources. It
  is not the target-selector contract. If it declares no continuation field,
  report the page as bounded.
- Use only ids, fields, target refs, cursors, and request refs returned by help or
  the Gateway. Never construct or decode opaque refs, substitute raw provider
  ids or paths, or infer a field from a label or another capability. A catalog
  grant is not backend readiness, and success on one route proves nothing about
  another. This workflow is not interchangeable with legacy worker fixtures,
  provider commands, or raw provider identifiers.

## Interpret And Recover

- Parse the complete YAML and branch on `ok`, which agrees with the exit code and
  means the command answered what it was asked, not that the state is good. One
  installed document is frozen byte for byte and answers no `ok`; at exit 0 it
  answered. On failure read `error.kind`, then only fields actually present.
- Read returned artifacts before answering. Claim a write only when discovery
  declares `effect: write`, its contract was followed, and the exact required
  evidence is present. A call result reports this at
  `receipt.verification.gateway_audit_readback`; `ceal receipt show` reports it
  at `verification.gateway_audit_readback`. `verified` proves a Gateway journal
  event was read; it does not prove provider state. Require a separately
  declared provider-state readback before making that stronger claim.
- Keep one stable idempotency key only when the discovered write contract requires
  one. For an unverified or unknown outcome, preserve the exact returned
  `receipt.request_ref`, the original call inputs, and the original idempotency
  key when one was required. Inspect that receipt; do not create another request
  or key, repeat the write, or treat `audit_event_not_found` as permission to
  retry. This Worker exposes no retry authorization for that write; leave it
  unresolved for the operator.
- On a structured error, follow its recovery or next action and rediscover help
  if installation or runtime drift may have changed the surface.
