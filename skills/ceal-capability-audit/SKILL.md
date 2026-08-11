---
name: ceal-capability-audit
description: "Run an exhaustive, evidence-backed audit of the live Ceal capability surface: inventory every discovered capability, verify user-scoped read and explicitly authorized write paths, measure per-command latency and response size, and publish a transparent observation report. Use when a user explicitly wants exhaustive integration coverage, a cost/evidence ledger, failure and wasted-work accounting, or a GitHub report from a Ceal capability audit."
---

# Ceal Capability Audit

Use this skill for one job: turn a live Ceal session into an honest capability
inventory, bounded provider probes, and a durable cost-aware observation record.
Use the installed `ceal` binary and the `ceal-guide` contract as the source of
truth. Do not replace them with a provider CLI, browser automation, remembered
capability IDs, or a static catalog.

## Contract

Produce three linked surfaces:

1. a live capability inventory;
2. a per-command evidence and cost ledger;
3. a problem-first report saved as a dated local artifact and, only when the
   user authorizes it and the discovered surface permits it, published through
   Ceal-mediated GitHub.

The canonical implementation is `skills/ceal-capability-audit`. Keep provider
differences in discovered contracts and run artifacts. Do not fork this skill
for Notion, Google, Slack, or GitHub.

## Cold start

1. Read the installed `ceal-guide` package completely, following every reference
   it links for the selected scenario. If the host cannot resolve that package,
   stop rather than substituting a checkout-relative copy. Re-read its leaf-help
   and receipt rules whenever the effect, target, or write contract changes.
2. Run `ceal --help`, then the selected command family help and every child leaf
   help named by that help. Stop if a required leaf omits `Effect`, `Evidence`,
   `Result schema`, or `Recovery/readback`.
3. Run `ceal capabilities --profile <profile> --fresh --detail`. Treat this
   response, not command discovery, as the capability inventory and input
   contract. Record every returned `capability_id`, `effect`, target requirement,
   input contract, write contract, evidence requirement, readiness, and any
   `non_claims`.
4. State the audit scope before calls: named source URLs, named providers,
   explicitly authorized writes, safe exclusions, and the desired report target.
   A user exclusion such as “Slack message.create was reviewed separately” is
   recorded as `safety_skipped`, not silently omitted.

## Measurement

Run every non-help Ceal command through the bundled measurement helper:
resolve `SKILL_DIR` to this installed skill package's directory first.

```sh
python3 "$SKILL_DIR/scripts/measure_ceal.py" \
  --label <short-step-name> -- ceal <command> <args>
```

The helper preserves bounded command output, enforces its declared wall-time
and per-stream limits, and terminates the command process group when either is
exceeded. Its `CEAL_AUDIT_METRIC` line never copies operands or file contents.
Record:

- `local_elapsed_ms`: wall-clock time around the whole CLI process;
- `stdout_bytes` and `stderr_bytes`: exact captured byte counts;
- `estimated_stdout_tokens`: `ceil(stdout_bytes / 4)`, explicitly a rough size
  estimate rather than tokenizer accounting;
- command label, settlement, exit code, and the bounded Ceal YAML result separately.

Do not invent historical timing or token counts. If an earlier run was not
measured, record `measurement_gap` and do not silently rerun an irreversible
write merely to fill the gap. Gateway `gateway_elapsed_ms`, when present in a
receipt, is a different metric and must not be presented as local CLI time.

For long text inputs such as a report, use `--file-arg text=<path>` before `--`;
the helper appends the UTF-8 file contents as one `text=...` capability argument
without shell quoting or retyping waste. Check the capability's byte limit
before invoking the command.

## Coverage algorithm

Cover every capability returned by live discovery at least at the strongest
safe level available:

- For each read capability, select a bounded target using only returned target
  refs. Call one representative bounded input that satisfies its discovered
  contract and read the complete result and receipt.
- For a named URL, first try the selected capability's URL match. If the leaf
  contract permits resolution, use `resource.resolve`, then use only the opaque
  resource ref it returns. If resolution or target selection returns no target,
  stop that write path and report the Gateway boundary.
- Follow only Gateway-returned target/catalog cursors with the same capability.
  Follow a capability result continuation only when its discovered contract
  declares the continuation field. Do not decode, construct, or reuse cursors.
- For named targets, verify every meaningful capability on that target. For
  unrequested targets, one bounded representative probe per capability is
  enough; do not enumerate all provider records just to inflate coverage.
- For writes, require `effect: write`, an explicit write contract, a user-scoped
  target, a stable idempotency key when required, and provider readback. Do not
  execute an unrelated irreversible write merely because it is discoverable.
- For missing capabilities, do not guess a route. Use `capability_absent`.

The minimum ledger row is:

```text
capability | target | effect | input summary | outcome | proof level |
local_elapsed_ms | gateway_elapsed_ms | stdout_bytes | stderr_bytes |
estimated_stdout_tokens | request_ref | receipt/readback | waste or next action
```

## Outcome discipline

Use the strongest honest proof level per action:

- `surface`: help, discovery, or target catalog only;
- `worker_queued`: shaped request reaches the capability bridge;
- `host_decision`: Gateway accepts or rejects target, policy, and readiness;
- `provider_roundtrip`: provider result or observable side effect is read back;
- `agent_choice`: a fresh agent/evaluator selects this skill from the natural
  language prompt. Do not claim this unless it was actually tested.

Keep these states distinct in the ledger and report:

- `readback_verified` / `provider_roundtrip`;
- `gateway_request_failed` or another structured `error.kind`;
- `connector_unavailable`;
- `rate_limited`;
- `outcome_unknown` until `ceal receipt show <request_ref>` resolves it;
- `not_read_back`;
- `capability_absent`;
- `target_unavailable`;
- `safety_skipped`.

If a write returns unknown, do not create a new idempotency key or claim success.
Inspect the receipt after a short wait. If the Gateway confirms no audited outcome,
retry the same intended effect with the same idempotency key only when the
Gateway recovery contract permits it; otherwise leave it unresolved for the
operator.

## Report and GitHub publication

Write the complete dated report to the adapter's `output_dir`. Read
`references/report-template.md` before drafting it. The report must preserve:

- source URLs and access mode, without secrets;
- exact scope and explicit exclusions;
- chronological commands and their measured cost;
- capability-by-capability success, absence, rejection, connector failure, and
  unproven boundary;
- what was wasted and what would reduce it;
- provider/readback evidence and request/receipt refs where safe;
- the final proof-level matrix and non-claims.

When the user asks for a GitHub report, prefer a discovered
`github.issue.create` route and verify the created issue by provider readback.
If it is absent but a user-authorized related issue and
`github.issue.comment.create` exist, append a clearly labeled fallback report
and say that no new issue was created. Never fall back to `gh` or a raw GitHub
API when the audit is specifically about Ceal. If the first report write is
`rate_limited`, wait briefly and reuse the same idempotency key. A comment write
is not issue creation.

Do not include Slack `message.create` in a report when the user says it was
separately reviewed; retain the omission as an explicit `safety_skipped` scope
entry if the user wants exhaustive inventory accounting.

## Safety and boundaries

- Never ask for or expose credentials, tokens, secret files, raw provider IDs,
  or raw provider payloads.
- Never mutate policy, credentials, registration, release state, or control
  surfaces.
- Never infer that exit code zero or a successful target catalog means provider
  execution.
- Do not report an unavailable or surface-only capability as working.
- Preserve user-supplied private URLs as source constraints; do not open them
  outside the discovered Ceal route.

## Closeout vocabulary

Use these literal terms in the ledger and report when applicable:

`surface`, `worker_queued`, `host_decision`, `provider_roundtrip`,
`agent_choice`, `readback_verified`, `not_read_back`, `outcome_unknown`,
`gateway_request_failed`, `connector_unavailable`, `rate_limited`,
`capability_absent`, `target_unavailable`, `safety_skipped`, `measurement_gap`.

## References

- `references/report-template.md` — required durable audit report shape.
