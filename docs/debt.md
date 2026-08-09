# Carried Debt

Items known and not scheduled. Re-check that an item is still true before
starting on it, and delete it here when it stops being. Every item below was
re-confirmed against the tree on 2026-08-09, each against the `file:line` it now
names; four were restated because the surface had moved under them. Confirmed is
not scheduled, and a later reader owes the same re-check.

Work that belongs to the standing goal lives in
[release-guard-reachability.md](release-guard-reachability.md), not here.
Everything else not listed is owned by the comment at the site and by
[gates.md](gates.md).

- **The vendored `packages/ceal-protocol` is behind its owner, and no local check
  can say so.** `protocol-vendor-pin.json` records Gateway commit `f9a02ff2…`;
  `git -C ../ceal rev-parse HEAD:packages/ceal-protocol` answers a different tree,
  and `git -C ../ceal log --oneline f9a02ff2..HEAD -- packages/ceal-protocol`
  lists what moved. That is not a defect on its own — the pin is an identity, and
  its own non-claims say the check reaches no remote. What makes it worth carrying
  is that some of those commits widened `decodeProjectionRequester`, which the
  worker reaches on the **v4** path it consumes
  (`packages/ceal-protocol/src/leased-consumer-control.ts:594` →`:600`), and the
  worker's decoders are closed exact-key validators.
  Checked on 2026-08-09 and currently safe, but only by reading the owner: the
  Gateway strips the new fields from v4 output —
  `scripts/agent-runtime/gateway-leased-consumer-control-dispatcher.mjs:95` passes
  `v5Request(request)` as `includeProviderIdentity`, and `:224` omits the field
  when it is false. Re-derive that from the emitting code, not from this note or
  from `charness-artifacts/critique/2026-08-08-c13-requester-provider-identity-premortem.md`,
  before the next release that keeps a stale pin. Re-syncing is the standing
  answer and **it is now blocked outside this repository**, which is a different
  reason from the one recorded before. The owner's local checkout carries
  0.72.13 with the symbol the v5 gate needs, but it is unpushed work —
  `git -C ../ceal show origin/main:packages/ceal-protocol/package.json` still
  says 0.72.12 — and the highest signed handoff is still
  `gateway-protocol-handoff-v0.72.12`
  (`git -C ../ceal ls-remote --tags origin 'gateway-protocol-handoff-*'`).
  This is an order rather than a deadlock, and the unrun step is theirs: their
  handoff workflow triggers on its own tag and names no worker input. Moving
  the copy without a matching lock fails `proof_shipment_protocol_divergence`,
  which is fatal, so re-vendoring today closes more paths than it opens.
  [requests/2026-08-09-to-gateway-protocol-handoff-v0-72-13.md](requests/2026-08-09-to-gateway-protocol-handoff-v0-72-13.md)
  is the tracked request and carries the re-checks.
  **That deferral expires with the v5 release.** The v5 gate in
  `leased-consumer-control-session.ts` requires
  `decodeCealLeasedConsumerCapabilityNotification` to be a function, which the
  vendored 0.72.12 does not export and the owner's 0.72.13 does — so a v5
  release cannot be cut without re-vendoring, and the "Gateway strips to v4"
  reasoning above stops applying the moment this worker declares v5.
- **The signed release manifest has no client package.**
  `ceal-worker-release-manifest-<platform>.json` records only the protocol, so a
  consumer is left with a source-owner claim. The fix puts the client in the
  manifest schema, which is release-affecting.
- **CI runs macOS but proves no install there.** `check.yml`'s `check-native` leg
  and the release lane's `darwin-arm64` build both set
  `require_platform_proofs: "0"`, and `test/platform-proof.mjs` grants a non-skip
  only on `linux`/`x64`, so every installed-binary and installer proof self-skips
  on macOS. Do not "fix" this by flipping the flag — requiring it across all of
  `linux-*` is what burned `ceal-v0.67.0`.
- **The first atomic-lock release still owes its one-time migration condition.**
  `release-and-enrollment.md` owns that condition and why an already-running
  legacy process cannot be brought into the new lock protocol. Remove this item
  after the first legacy-to-atomic update is accepted. Candidate/tombstone
  housekeeping remains separate: candidates are nonce-private, while retained
  tombstones must not receive a generic age-based cleanup that would reuse a
  late reclaimer's destination.
- **The v5 shutdown hang is closed, and it was reachable on the real channel.**
  All three inherited channels now go through `openInheritedReadable` in
  `packages/ceal-worker-cli/src/private-worker-transport.ts`, which adopts the
  descriptor with `net.Socket` so libuv reads it non-blocking on the event loop.
  `closeReadable` is bounded as well, and that bound is defence in depth rather
  than the fix — it was measured making the shutdown await settle while the
  process still never exited, which is the shape that would have shipped as done.
  `packages/ceal-worker-cli/test/leased-consumer-control-session.test.mjs` pins it
  on the descriptor Gateway actually supplies: `stdio: "pipe"` hands the child a
  Unix socketpair end on Linux, the same fact the FD-kind test above it pins. The
  control arm builds the stream the old way and hangs on purpose, so the fixed
  arm's pass cannot be vacuous; reverting `openInheritedReadable` turns the test
  red, and that was run.
  **This entry twice recorded a wrong reason and both are worth keeping.** It
  first named `closeReadable` as the fix, which the reproduction disproved. It
  then said the hang did not reproduce through inherited descriptors and that the
  socketpair case was untested and maybe not worth settling — the fresh-eye review
  re-ran it and got the opposite, three times. The `EAGAIN` that reading was built
  on came from the harness reusing one descriptor across both arms: `net.Socket`
  sets `O_NONBLOCK` on the shared open file description, so the arm that ran
  second inherited a non-blocking descriptor. Nothing about the tree; everything
  about the measurement.
- **Two published acceptance records overstate guide registration, and one leaks
  identity refs.** `docs/acceptance/ceal-v0.69.0/` and `ceal-v0.67.1/` were
  emitted while `registered_host_count` counted resolved host directories rather
  than registrations, and `ceal-v0.69.0/linux-amd64.yaml` carries
  `membership_ref` and `subject_ref` from the pre-`.v2` emitter. Both emitters are
  fixed; the records are historical artifacts and were left as written rather
  than rewritten after the fact. Anyone re-publishing them owes a re-emit, not an
  edit.
- **Nothing structural stops a new direct session writer.** The identity
  transition contract lives in `session-replacement.ts`, but a future command
  that calls `runtime.saveSession` itself bypasses it, which is exactly how issue
  10 happened. A regex sweep over worker source was rejected as the instrument:
  it cannot see aliasing or destructuring, so it buys allowlist maintenance and a
  false sense of enforcement. The structural version — making the raw save
  unreachable from the session commands — is its own slice.
