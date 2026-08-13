# Implementation Contract

Date: 2026-08-13
Title: Session Lifecycle Capability Cut
Status: locally proven

## Problem

The Worker is not public, but `CealCommandRuntime` still exposes three flat raw
session mutation hooks (`saveSession`, `removeSession`, and
`withSessionStateLock`) solely for source compatibility with hypothetical
embeddings. `runCealCommand` then projects that input into a second semantic
session facade. The compatibility input also keeps unlocked enrollment,
refresh, and logout fallbacks alive even though the shipped CLI always owns a
locked profile store.

This is API and ownership debt, not a persisted-record migration. The current
`client-session.json` V1/V2 parser and serializer remain unchanged.

## Slice

Replace the raw and projected session APIs with one session lifecycle
capability:

- `CealCommandRuntime` carries an optional `session` capability and no flat
  session reader or writer hooks.
- A configured capability has four required operations: `load`,
  `commitEnrolled`, `ensureCurrent`, and `logout`.
- One production factory owns capability construction. It receives the
  canonical locked store and the timing, revocation transport, clock, and
  session-derived cleanup dependencies it needs. Product code and in-memory
  fixtures both use this factory; neither assembles the four operations by
  hand.
- The shipped composition root creates exactly one capability from a valid
  home-backed profile store and none when that store cannot be created.
- Enrollment/adoption, refresh, status/discovery/call/observer reads, and logout
  consume the same capability directly.
- Remove the compatibility projection, raw-key classifier, unlocked fallbacks,
  and tests whose only subject is legacy embedding shape.
- Test fixtures may construct the canonical capability with an in-memory
  locked store; they must not introduce a product compatibility adapter.

## Success Criteria

1. `CealCommandRuntime` and generated declarations contain none of
   `loadSession`, `saveSession`, `removeSession`, or `withSessionStateLock`.
2. `runCealCommand` does not project or mask a second runtime object; command
   handlers receive the one semantic dependency contract.
3. The shipped runtime creates exactly one all-or-none session lifecycle
   capability when a valid home-backed profile store exists. Invalid or absent
   `HOME` produces no partial session capability, covered by a child-process
   fixture that does not substitute a temporary home.
4. Enrollment/adoption replacement remains one locked compare/dispose/write
   interval; refresh remains locked identity check plus refresh-token CAS;
   logout remains locked revoke-before-remove. Removing the locked interval
   makes a focused mutation red.
5. Preflight still reads current state before consuming an enrollment code or
   starting an adoption transaction.
6. Missing-session behavior is expressed by an absent capability, not partial
   combinations of reader/writer hooks.
7. Current session-store V1/V2 read/write behavior and payload tests are byte-
   shape unchanged.
8. Status, discovery, calls, observer wiring, enrollment/adoption, refresh, and
   logout all read through `runtime.session`; an exact source/dist search proves
   no raw hook remains.
9. Focused Worker package tests and `npm run check:unit` pass. The known signed
   Protocol pin divergence remains a release/full-gate residual rather than
   being restamped in this slice.

## Constraints

- Do not edit `packages/ceal-protocol`, package versions, signed handoff locks,
  release inputs, installed binaries, or Gateway state.
- Do not add deprecations, aliases, adapters, dual signatures, retired names,
  fallback readers, or migration tests for the removed runtime API.
- Do not change the persisted session schema or infer migration work without an
  observed non-current payload.
- Do not preserve class/prototype/lazy-getter behavior whose only purpose was
  the removed external embedding contract.
- Ordinary unlocked reads may remain; this slice requires all mutations and
  refresh compare-and-set transitions to stay inside the canonical store lock.

## Proof Boundary

Local Worker source, declarations, deterministic tests, build output, and
bounded fresh-eye review. No push, tag, publish, install, apply, or live
Gateway/provider claim belongs to this slice.

## Implementation Evidence

- The public runtime now carries only `session?: CealSessionCapability`; the
  raw hooks and projected command context are deleted.
- Product composition and deterministic fixtures use the same
  `createCealSessionCapability` factory over locked stores.
- The focused lock mutation failed as intended, the real missing-`HOME` child
  proof passed, and current V1/V2 payload tests remained green.
- `npm run check:unit` passed from the staged target tree in proof job
  `ceal-cli-session-lifecycle-check-unit/20260813c` (58.235 seconds).
- Two bounded fresh-eye reviewers found no Act Before Ship blocker against the
  current code packet.
