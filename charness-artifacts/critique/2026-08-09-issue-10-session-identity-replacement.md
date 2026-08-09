# Critique — issue 10 resolution: session enroll/adopt identity replacement

Target reference: code critique. Change under review: the uncommitted resolution
of [corca-ai/ceal-cli#10](https://github.com/corca-ai/ceal-cli/issues/10), which
adds `packages/ceal-worker-cli/src/session-replacement.ts` and routes both
`session enroll` and `session adopt` through it.

- Execution: four bounded fresh-eye subagents, three angles plus one separate
  counterweight, all `high-leverage`, all under the host's read-only reviewer
  envelope (Read/Grep/Glob only; each confirmed it held no write or shell tool).
- Fresh-Eye Satisfaction: `parent-delegated`.
- Packet Consumed: `n/a (no adapter sections)` — no `.agents/critique-adapter.yaml`.
- Reviewer boundary: rail-1 fingerprint window `issue10-critique` verified
  `verdict: parent-attributed`, `drift: []`, with
  `packages/ceal-worker-cli/src/session-replacement.ts` declared by the parent
  because the parent edited it inside the window. No undeclared drift.
- Delivery: `findings-received` for all four.

## Capability at stake

One home holds one session, so `enroll` and `adopt` are the only commands that
can substitute the identity behind every later `ceal call`, `ceal observe`, and
receipt. The capability is the operator's ability to know, and to refuse, that
substitution.

## Angles

1. Credential lifecycle and failure-window safety.
2. Declared-surface truthfulness and installed-consumer compatibility.
3. Recurrence prevention — would the new tests have caught the bug.

## Counterweight triage

### Act Before Ship — all applied

- **A replacement that fails to write disposed of nothing.** `--force` revoked
  the displaced session before `store.save`, so a save failure left the old
  session file pointing at a retired refresh family while the newly issued
  session stayed live and unreferenced. The refusal path already disposed of
  what it caused; this path did not. Now the save is wrapped: a failure revokes
  the incoming session and the result carries `previousSessionEnded`, which both
  commands render as a `next_action` saying the previous session is gone.
- **A success stayed silent about a displaced session it could not revoke.**
  `previous_session_revoked: unavailable` was a field only. Both success writers
  now compose `next_action` through `sessionReplacementNextAction`.
- **`first_session` inherited whatever local state was already there.** With no
  stored session but a leftover receipt spool — which carries no identity
  discriminator — a different subject would inherit up to thirty days of another
  subject's refs. Derived state is now cleared on every write except a renewal.
- **`session adopt`'s declared recovery was false.** `subcommands.ts` still said
  every failure leaves the store untouched. Rewritten to name the one path that
  does not.

### Bundle Anyway — applied

- Adopt's invalid-argument usage string omitted `--force` while the declared
  usage carried it.
- The conflict and replacement decisions were proven only through injected
  runtime seams, which never take the session state lock; the shipped binary
  always does. A bin-level test now enrolls into one real `HOME` three times —
  first session, refused different identity, then `--force` — and asserts the
  file on disk and which credential each step revoked.

### Over-Worry — recorded, not acted on

- **`already_unusable` could mask a live credential.** It cannot, and the
  evidence is the owner's implementation rather than inference:
  `/home/ubuntu/ceal/packages/ceal-core/src/gateway-personal-client-sessions.ts`
  `revokeSession` resolves the credential and calls `revokeFamily` even when the
  token record is already `used`, and returns only `ok`, `refresh_invalid`, or
  `refresh_revoked`. The two remaining codes in `RETIRED_REFRESH_CODES` are
  Protocol-permitted (`packages/ceal-protocol/src/personal-client-session.ts`)
  but not emitted by that revoke route. This also settles the issue's worst case:
  an `outcome_unknown` session whose token rotated server-side still has its
  family revoked.
- **A Gateway roundtrip inside the session state lock could make a concurrent
  refresh fail `refresh_busy`.** The arithmetic refutes it: the lock's waiter
  budget is `STATE_LOCK_MAX_WAIT_MS` in `profile-store.ts` and the revoke's HTTP
  deadline is the client default in
  `packages/ceal-client/src/personal-client-session-client.ts`; the worst path
  here is two serial revokes, which stays inside the waiter budget. Read both
  constants rather than trusting this sentence.
- Revoking a token the local store never persisted, on the refusal path: correct,
  and the only retirement path available for it.

### Valid but Defer

- **Nothing structural stops a future direct `runtime.saveSession` caller from
  bypassing the guard** — which is how this bug happened. Recorded in
  `docs/debt.md`. A regex sweep over worker source was rejected as the
  instrument: it cannot see aliasing or destructuring, so it buys allowlist
  maintenance and a false sense of enforcement. The structural version, making
  the raw save unreachable from the session commands, is its own slice.

## Deliberately not doing

- **Not comparing `registration_ref` or `client_ref`.** They name one enrollment
  artifact, not an identity, and a replacement code legitimately mints new ones
  for the same subject. Comparing them would refuse the recovery path the CLI's
  own `NOT_RENEWABLE` text sends operators to — a worse bug than the one fixed.
- **Not bumping `ceal.session_enrollment.v1` / `ceal.session_adoption.v1` for the
  new fields and the new `conflict` status.** No consumer branches exhaustively
  on either; the search that found none finds the strings it should under `src/`.
  No written rule in this repo requires the bump.
- **Not closing the compare-after-issue window.** An enrollment cannot know whose
  session a code buys until it spends it, so a crash between issuance and the
  refusal's revoke leaves a live session nothing can name. Inherent to the shape,
  documented at the head of `session-replacement.ts`.

## Residual non-claims

- Proof level reached is **local suite plus repository gate**, not installed
  release and not a live Gateway readback. No live `session enroll` or
  `session adopt` was run against a real Gateway during this resolution; both
  routes declare `remote_write` and consume a one-time approval.
- The adoption suite's revocation assertions are decision-level (an injected
  transport). The enrollment suite's are transport-level, against a real socket.
