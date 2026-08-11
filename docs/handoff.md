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
- The maintainer-local duplication ratchet is green again. The three public
  session-lifecycle clients now derive endpoint safety and bounded JSON exchange
  from package-private owners; their distinct public error contracts and route
  declarations are explicitly reviewed rather than hidden behind a generic
  callback surface. `npm run check:duplication` reproduces the verdict.
- A repository quality sweep repaired owned client-boundary defects without
  touching the frozen Protocol package: lifecycle deadlines now bound caller
  wait even when fetch/body work ignores abort, non-success status cannot carry
  a decoded success, JSON media-type parsing has one complete owner, and
  adoption poll uses the canonical request decoder before fetch. The full local gate and
  read-only command probe are green; this is source proof, not a release claim.
- Worker command dispatch now receives a physically narrowed internal context:
  raw session save, remove, and locked-store callbacks stop at the composition
  root, while fixed commit, renewal, and logout operations retain their existing
  transition owners. Class/prototype/accessor embedding compatibility and the
  physical boundary are covered by worker tests; this is local source/runtime
  proof and remains unreleased.
- The standing worker-guide contract now follows rendered help in-process and
  keeps only named checkout-binary smokes for root help, explicit deep help, and
  cold capability failure. The same slice replaced a scheduler-sensitive delay
  in the cross-process refresh proof with the second process's observed lock-wait
  event. This changes test execution shape only and is not signed or
  installed-worker proof.
- B1 release critique rejected the local unsigned Protocol `0.72.14` packet as
  a consumer input. Executed probes showed undeclared authority revision/version
  keys being stripped and undeclared capability arguments admitting
  locator/permission/authority keys. The Gateway-owner correction request is
  `docs/requests/2026-08-11-to-gateway-b1-corrected-protocol-handoff.md`; no
  frozen Protocol copy or pin moved.

## Next Session

1. Read the release record and use the exact signed 0.76.1 tuple for any Gateway
   coherent-v5 join; do not redo release work.
2. Keep D2 and the D3 invariant-method slice queued for the next explicitly
   approved Worker release together with the client-boundary and session-writer
   quality fixes; a green checkout is not installed proof. Ask before releasing.
3. Do not consume the known-bad local `0.72.14` packet. Wait for the Gateway
   owner to answer the tracked correction request, then use the corrected packet
   to develop the additive response decoder and delegated relay proof. A signed
   final handoff is still required before re-pin convergence and release. Add
   `x-ceal-decode-generation: additive-v1` only to the generic Gateway HTTP
   transport. The enrollment, adoption, and personal-session routes are separate
   authority protocols and must not send it.
4. Prove unknown non-authority keys are removed at every response depth and
   future safe capability frames reach the delegated UDS seam only after that
   canonical artifact is installed; preserve strict authority objects, enum
   values, notification bindings, and request envelopes.
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
- [client-boundary quality review](../charness-artifacts/quality/2026-08-11-codebase-quality-sweep.md)
- [client-boundary closeout](../charness-artifacts/impl/2026-08-11-client-boundary-quality-sweep.md)
- [session-writer quality review](../charness-artifacts/quality/2026-08-11-session-writer-ownership.md)
- [session-writer closeout](../charness-artifacts/impl/2026-08-11-session-writer-ownership.md)
- [worker-guide spawn economics](../charness-artifacts/quality/2026-08-11-spawn-economics.md)
- [worker-guide spawn closeout](../charness-artifacts/impl/2026-08-11-worker-guide-spawn-economics.md)
- [B1 release critique](../charness-artifacts/critique/2026-08-11-b1-v0-76-2-release-critique.md)
- [B1 corrected handoff request](requests/2026-08-11-to-gateway-b1-corrected-protocol-handoff.md)
- [v0.76.0 release record](../charness-artifacts/release/2026-08-09-ceal-v0-76-0.md)
- [v0.76.1 release record](../charness-artifacts/release/2026-08-10-ceal-v0-76-1.md)
