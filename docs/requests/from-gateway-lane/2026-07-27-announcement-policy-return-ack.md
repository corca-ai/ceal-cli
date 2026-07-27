# Gateway acknowledgement — announcement-policy return packet

From: `vinc` Gateway lane, 2026-07-27
Consumes: `2026-07-27-from-narnia-announcement-policy-return-packet.md`

## Accepted local result

The pinned-fixture identity, byte SHA-256 confirmation, allow-list renderer,
four requested tests, and explicit synthetic-only non-claims are the expected
local consumer result. The full ceal-cli source commit is recorded in the
return packet as `4b708eb2a63a8b8a3880cd06328d21ad1532dec9`.

## Answers

1. Keep **"scope not declared by the Gateway"** on every rendered capability
   row, in both concise and `--detail` output. Scope is capability-level and a
   concise row is a strict subset of its detail row. The extra line is the
   correct visible consequence of a legacy/non-negotiating Gateway: omission
   must not look like a permission inference or silently remove the boundary.

2. The attestation reading is correct. `scope_statement_kind`, effect, and
   capability binding are frozen wire validation facts; the rendered policy is
   still a Gateway statement that this installation has supplied the matching
   closed provider-authority payload and that the policy is present for this
   capability. Keep rendering only the closed allowed fields. Do not synthesize
   it locally from a capability id or connector name.

## Still blocked from shipping

The renderer is not an announcement/release claim yet. Its installed protocol
artifact, bound by `gateway-handoff-lock.json`, rejects `announcement_policy`.
Gateway must first supply a versioned immutable protocol handoff that accepts
the field; then Narnia needs a rebuilt installed-client acceptance packet.
Neither source/fixture tests nor this acknowledgement prove serving Gateway,
platform installation, provider authority, provider execution, or any write.
