# Capability brief: `ceal-capability-audit`

- Name: `ceal-capability-audit`
- Audience: agents using the installed personal-client `ceal` binary
- Trigger: a request to inventory, verify, compare, or report Ceal capabilities across providers, especially when the result should become a durable GitHub observation
- Concept: one bounded workflow that discovers every live capability, probes user-scoped targets, records provider/readback proof, measures command cost, and writes a problem-first observation record
- External: the Gateway-issued Ceal session; optional Ceal-mediated GitHub comment/report target; no raw provider CLI or secret fallback
- Repo-specific: canonical placement `skills/ceal-capability-audit/`; dated local artifacts under `charness-artifacts/ceal-capability-audit/`; `ceal-guide` is the upstream usage contract
- Accumulates: dated audit records and a per-command cost ledger; never stores credentials or raw provider payloads
- Failure boundary: distinguish capability absence, target selection failure, Gateway rejection, connector unavailability, rate limiting, unknown outcome, and provider readback
- Proof boundary: report `surface`, `worker_queued`, `host_decision`, `provider_roundtrip`, and `agent_choice` separately per action
- Portability decision: one shared implementation; no intentional fork, because provider-specific behavior belongs to discovered capability contracts and the report template stays provider-neutral
- Adapter posture: visible generic fallback for missing skill adapter; this repo's adapter records the artifact topology but not target IDs, credentials, or provider-specific defaults
