# Session lifecycle capability code critique

Date: 2026-08-13

## Decision Under Review

Delete the public raw session hooks, projected command context, and unlocked
mutation fallbacks. Serve every command-side session lifecycle operation from
one all-or-none capability built by the production factory over the canonical
locked store.

## Execution

Two bounded parent-delegated fresh-eye reviewers independently traced the code
packet, generated declarations, tests, and storage payload behavior. Both
reported no Act Before Ship blocker after the implementation settled.

## Fresh-Eye Satisfaction

parent-delegated

## Packet Consumed

`charness-artifacts/critique/2026-08-13-session-lifecycle-capability-code-packet.json`

## Reviewed Input Identity

- Packet SHA256: `add0d0055bc7ba988f5ce69a121612db91239c91c3be769e0539b69657086d6f`
- Identity SHA256: `e225820f86178aadfb5b5322fb98119c54dfef7f4909f35d32ea1a2d8ef79ac7`
- Binding verdict: current
- Base HEAD: `42a05916e6d17c656854240ed44e57dd9ddb80e2`

## Angles

- Contract shape: one required four-operation capability or no capability.
- Ownership: one production factory used by the public binary and deterministic
  test fixtures.
- Security ordering: enrollment lock interval, refresh identity/CAS, and
  revoke-before-remove logout.
- Operability: true missing-`HOME` child process and generated declaration
  surface.
- Persistence: V1/V2 parser and serializer byte shapes remain unchanged.

## Findings

- The implementation exposes only `session?: CealSessionCapability`; the flat
  `loadSession`, `saveSession`, `removeSession`, and `withSessionStateLock`
  hooks and the projected command context are absent from source and generated
  declarations.
- Production and test fixtures both construct the capability through
  `createCealSessionCapability`; fixtures provide an in-memory locked store
  rather than hand-assembling semantic operations.
- Enrollment/adoption, refresh, and logout no longer have unlocked mutation
  fallbacks. The retained paths preserve compare/dispose/write under one lock,
  refresh-token CAS, and revoke-before-remove respectively.
- Status, discovery, call, adoption, and observer readers now use the same
  capability. A child process with `HOME` omitted proves the capability is
  absent rather than partially configured.
- `profile-store.ts` changes only interface visibility and return typing; the
  current V1/V2 payload formats and their exact-shape tests are unchanged.

## Counterweight Triage

### Act Before Ship

None remaining.

### Bundle Anyway

- Stage the deleted projected-context file before the repository gate so
  `git ls-files` reflects the intended tree.
- Rebuild and repeat the paired positive-control/absence scan after staging.

### Valid but Defer

- Locking ordinary read-only loads without a reproduced invariant failure.
- Signed Protocol pin convergence and immutable Worker release proof.

### Over-Worry

- Source-compatibility adapters, deprecation aliases, or persisted-data
  migration for this private pre-public API cut.

## Deliberately Not Doing

This slice does not change or migrate the current V1/V2 stored session payload.
It does not preserve raw hooks for hypothetical package embeddings, and it does
not widen into signed release, publish, selection, or live instance apply.

## Boundary Ownership

- Producer: Worker public binary composition root.
- Consumer: Worker command handlers and deterministic fixtures.
- Owning surface: one session lifecycle capability factory backed by the
  canonical locked profile store.
- Verdict: moved-to-owner.

## Next Move

Stage the bounded tree, run the unit repository gate from that exact index
shape, record the closeout evidence, and commit locally.
