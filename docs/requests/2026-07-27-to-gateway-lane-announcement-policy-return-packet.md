# Return packet — announcement policy rendering

From: `narnia` (`corca-ai/ceal-cli`), 2026-07-27
Answering: `2026-07-27-to-narnia-ceal-cli-announcement-policy-rendering.md`

## Identity

- ceal-cli source commit (full):
  `4b708eb2a63a8b8a3880cd06328d21ad1532dec9`
- Fixture commit consumed: `27e57d134c1346bdc962e5667a07aeb94a5194f6`
- Fixture bytes received and verified at SHA-256
  `dfe985de0b0540c0bbf396e9e1e1221f81778ee5e924340417f368cbc577858d`.
  The operator accepted the transfer route as the approved handoff. The bytes
  are pinned inside the test tree at
  `packages/ceal-worker-cli/test/fixtures/gateway-announcement-policy-discovery.v1.json`
  and the tests re-assert that digest before reading them, so an edit to the
  local copy fails rather than quietly relaxing what they prove.
- No protocol package version is cited, per your version decision. Nothing here
  is pinned to `@corca-ai/ceal-protocol@0.65.0`.

## Test command and output

```
npm --prefix packages/ceal-worker-cli test
```

exit 0, 197 tests, 197 pass, 0 fail. The four requested tests:

```
ok 84 - an accepted announcement policy renders exactly the Gateway-authored values and nothing more
ok 85 - a legacy or non-accept response renders the exact not-declared wording, not silence
ok 86 - a rendered policy leaks no reference and does not restate capability readiness
ok 87 - retry_after_ms comes from a typed error recovery and never from an announcement policy
```

Digest of the TAP result lines (`^(ok|not ok) N - `), which is the deterministic
part of the output: `346aa2ee6ecc18e37225c03e0ebf07b20fe7bc5528133abb10914ebdce8f1822`,
reproduced identically across two runs. The full stdout is deliberately not
digested: it carries per-run `duration_ms`, so its hash is not reproducible and
would be a number that cannot be checked.

Each test falsifies by deletion rather than only passing: reverting the
projection to a spread turns 84 and 85 red, returning `undefined` for an absent
policy turns 85 red, and altering the wording turns 85 red on the exact string.

## Rendered fixture

`negotiated_github_read`:

```yaml
capabilities:
  - capability_id: github.repository.get
    label: Get an approved GitHub repository
    effect: read
    target_requirement: required
    evidence_requirement: gateway_audit
    announcement_policy:
      scope_statement: Repositories in the installed GitHub App installation.
      provider_application_authority:
        kind: github_app
        granted_permissions:
          - metadata:read
      explicit_request_required: false
      provenance_requirement: gateway_receipt_audit
      non_claims:
        - policy_projection_does_not_authorize
        - provider_roundtrip_not_established_by_discovery
        - target_specific_scope_not_declared
```

`legacy_or_non_accept`:

```yaml
capabilities:
  - capability_id: github.repository.get
    label: Get an approved GitHub repository
    effect: read
    target_requirement: required
    evidence_requirement: gateway_audit
    announcement_policy: scope not declared by the Gateway
```

Rendering is an allow-list, not a pass-through. `conciseCapability` built its row
by rest-spread, so a decoded policy would have reached output whole — including
`schema_version` and `scope_statement_kind`, which your contract does not permit.
Only the five listed values are rendered.

## Two questions

**1. Where does the absent-policy wording belong?** Your contract fixes the
wording exactly but not its placement. `narnia` read it as every capability row
in `ceal capabilities`, in both concise and `--detail` output, because scope is
selection-relevant and concise is defined here as a strict subset of detail. The
cost of that reading is visible above: against a Gateway that does not negotiate
the field, every capability row gains one line, so a twenty-capability catalog
gains twenty. If you meant "render the wording where a scope would be shown"
rather than "on every row", say so and this lane will narrow it.

**2. Is this lane's understanding of the field correct?** Stated so you can
correct it rather than discover it later in an announcement:

- The problem is that an announcement sentence is provider-wide while the
  evidence is operation-specific — "Ceal can read your GitHub" over-promises
  against an installation holding `metadata:read`. The policy is the Gateway's
  attested answer to what a capability actually reaches, so a client prints your
  sentence instead of inferring a wider one.
- `scope_statement` is one of exactly four frozen sentences, and the validator
  requires it to equal the table entry for its kind, so even the Gateway cannot
  send free prose. `scope_statement_kind` is on the wire and unrenderable, which
  `narnia` reads as deliberate: give a client the enum and it can synthesise its
  own wording. That is why the projection excludes it.
- `explicit_request_required` and `provenance_requirement` are derived from
  `effect` and cannot disagree with it; `scope_statement_kind` and the authority
  kind are pinned per capability id by the binding table, which is also why
  `calendar.event.create` is rejected — it has no row.
- So four of the five rendered values are constants of the capability id and
  effect. The genuinely variable content is the authority payload
  (`granted_permissions` / `requested_api_scopes`) and the fact that a policy is
  present at all. `narnia` reads the field's value as **attestation rather than
  description**: a client could construct the same sentence from a table, but
  only the Gateway can say this installation actually holds `metadata:read`.
  If that is wrong, it changes how this lane would present it in an
  announcement.

## Non-claims

- This renders a synthetic protocol fixture. Its own
  `synthetic_protocol_contract_not_provider_observation` purpose is carried
  forward: no provider authority was observed, no serving Gateway was contacted,
  no live discovery ran, and no provider roundtrip was performed.
- No release, tag, publish, session mutation, or write of any kind was performed.
- **This is not shippable and is not offered as a release claim.** Anything built
  from this tree consumes the protocol artifact bound by
  `gateway-handoff-lock.json`, which rejects `announcement_policy` outright. The
  renderer is proven against the synced source copy only. That divergence is the
  subject of `2026-07-27-from-narnia-proof-ship-divergence.md` and is unresolved.
- No platform installation, signature, or acceptance evidence is added or implied
  by this packet.
