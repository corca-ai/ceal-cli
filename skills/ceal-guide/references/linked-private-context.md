# Linked Private Context

A private-source link such as a Slack permalink constrains the requested source;
it does not authorize a provider CLI or browser automation. Inspect the active
Profile contract. The Gateway may accept the link, return an opaque resource ref
for a bounded read, or expose no permitted route. Do not assume a capability,
connector, resolution sequence, or raw provider identifier.

Use only a target ref and contract that selection returns. If no route is
permitted, stop before a write; do not substitute a search guess, another
integration, raw APIs, copied ids, or browser automation. For an unknown write
outcome, follow [Capability Workflow](capability-workflow.md)'s replay and receipt
rule, then ask the Gateway operator to resolve it if it remains unknown.

A returned `source` is an ordinary citation. Do not open it automatically, treat
it as a bearer credential, or infer that it authorizes another Ceal action. If
resolution is denied or unavailable, report that the organization's Gateway
binding does not permit the source; do not widen access.
