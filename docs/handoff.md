# Ceal CLI Roadmap Handoff

## Workflow Trigger

Continue only the `ceal-cli` lanes in the sibling
[`ceal` roadmap](../../ceal/docs/roadmap.md#current-execution-ledger). Do not
redo the Worker shutdown repair, installer PATH repair, or the invariant-method
part of #707 D3. Publication boundaries remain separately approved.

## Continuation Capability

Use signed `ceal-v0.76.1` as the exact Worker identity for Gateway coherent v5
selection. Preserve early-FD5 and unrelated-error failure in any follow-up. The
canonical `ceal-guide` now teaches intent-incremental help, profile-scoped
`--detail` contract discovery, and host-reachability diagnosis; keep dynamic
recommended order and caller identity owned by the Gateway.

## Current State

- The operator explicitly unfroze ceal-cli for this active-runner shutdown
  repair. The source, real child-FD5 oracle, mutation oracle, spec, and critique
  are locally complete.
- The pre-fix real-socket arm returned `clean:false`. The repaired arm returns
  `clean:true` with empty stderr, while FD5-first EOF and same-message/wrong-code
  errors remain false.
- The final local `check:unit` job is green. Gateway transport-only and active-
  runner durable compositions both reach Worker exit zero against the repaired
  local build; the active result records one abort and cancelled completion.
- Annotated tag `ceal-v0.76.1` resolves to
  `2edf126e1c7bf65900d40b449dce9ea4481c6ce7`; release run `31346152389`
  completed every build, assembly, signing, publication, and stable-pointer
  step.
- Fresh public readback verified all nine checksum-listed assets plus the
  separately signed `SHA256SUMS` against the exact Cosign identity. The public
  `SHA256SUMS` digest is
  `7f5e20c27b539af490fee6f2fe18746853506ac075e8e6d91b462336fe582b4a`.
- Installed `ceal` is `0.76.1`; Linux ARM64 binary digest is
  `5c893c8ab10575eab9da378c85d2ba300d2eb469bd6ed57d5207aae9569cfe04`.
- Gateway selection/apply and live provider/latency proof have not happened.
- The #707 D2 conditional PATH guidance is committed after `ceal-v0.76.1` at
  `3127df6`; it remains unreleased.
- The #707 D3 invariant-method slice is locally implemented in the canonical
  guide and bound to the installed-binary help path by
  `test/contract/worker-guide-contract.test.mjs`. This is local source/test
  proof, not a signed or installed guide claim and not full B3 completion.
- `npm run check` and `npm run lint:shell` pass for this slice. The separate
  maintainer-local duplication ratchet is red on clone families introduced by
  the preceding `d364ee5` client change; every reported member is untouched by
  this guide slice. Resolve or deliberately classify that debt before a push,
  rather than treating this slice's green final gate as a green pre-push hook.

## Next Session

1. Read the release record and use the exact signed 0.76.1 tuple for any Gateway
   coherent-v5 join; do not redo release work.
2. Keep D2 and the D3 invariant-method slice queued for the next explicitly
   approved Worker release; a green checkout is not installed proof.
3. Clear the maintainer-local duplication ratchet with an owned source repair or
   an explicit reviewed classification before the next push.
4. Implement B1 against the landed A3 server half: remove the client-owned fixed
   capability revalidation and exact-key wall, opt into
   `x-ceal-decode-generation: additive-v1`, and prove unknown non-authority keys
   are ignored at every response depth.
5. After B1/B2 establish additive response fields and Gateway-served next
   steps, finish B3 by replacing the guide's shipped exact sequence with the
   Gateway value plus the client fallback. Do not move a capability id into
   guide prose.

## Discuss

- Concurrent notification plus channel-loss abort idempotency remains a
  separate non-claim; it does not block the normal owned-shutdown repair.
- The response-latency proof belongs after signed selection and apply. It may
  overlap only disjoint local work and must not overlap another instance
  restart.
- The sibling roadmap/spec own whole-program status. A3 landed there while this
  slice was in progress; this Worker slice consumed that updated status without
  rewriting sibling-owned files.
- Refresh kept: exact public/install proof state, D2 release state, the bounded
  D3 prework state, and the next Gateway handoff.
- Refresh non-claims: no Gateway selection/apply, provider/Slack, latency,
  concurrent-close, or C11a completion proof.

## References

- [repair contract](../charness-artifacts/spec/2026-08-10-worker-owned-notification-shutdown.md)
- [implementation closeout](../charness-artifacts/impl/2026-08-10-worker-owned-notification-shutdown.md)
- [code critique](../charness-artifacts/critique/2026-08-10-worker-owned-notification-shutdown-code-critique.md)
- [v0.76.0 release record](../charness-artifacts/release/2026-08-09-ceal-v0-76-0.md)
- [v0.76.1 release record](../charness-artifacts/release/2026-08-10-ceal-v0-76-1.md)
