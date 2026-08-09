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
  answer; it was declined here because `../ceal` had uncommitted work in flight
  and vendoring a half-finished tree is worse than vendoring an old one.
  **That deferral expires with the v5 release.** The v5 gate in
  `leased-consumer-control-session.ts` requires
  `decodeCealLeasedConsumerCapabilityNotification` to be a function, which the
  vendored 0.72.12 does not export and the owner's 0.72.13 does — so a v5
  release cannot be cut without re-vendoring, and the "Gateway strips to v4"
  reasoning above stops applying the moment this worker declares v5.
- **The receipt spool's drop counter can carry one byte across an identity
  change, and no lock can fix it.** `recordDrop` in
  `packages/ceal-worker-cli/src/receipt-spool.ts` is `@lockFree` on purpose — the
  tag at the declaration owns the reasoning — so `removeUnderLock`'s removal of
  `DROPS_FILE` under the spool lock does not close the clear-versus-append race
  it looks like it closes. A drop recorded while another process runs
  `ceal session logout` or an `--force` replacement can recreate the file, and
  `ceal observe` then reports that byte against the incoming identity. The fix is
  structural rather than a lock: give the counter an identity discriminator, so a
  resurrected byte cannot be attributed to a session that did not produce it.
  That changes the on-disk shape of `receipt-spool-drops`, which is why it is its
  own slice and not a rider on the gate that found it. Found by
  `npm run lint:store-lock` on 2026-08-09; the same check reports it again the
  moment the tag comes off.
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
- **The worker lock's unclaimed-directory replacement is unresolved.** The
  destructive-cleanup half is fixed and pinned by a named test; what remains is
  recorded at the site in `packages/ceal-worker-cli/src/local-store-lock.ts`,
  which owns the detail and why an `ino` comparison cannot settle it.
- **The v5 notification channel would hang the worker on shutdown.**
  `openLeasedConsumerNotificationChannel` returns `undefined` today — the shipped
  `leased-consumer-control-session-contract.json` declares no
  `notification_channel`, confirmed by parsing
  `LEASED_CONSUMER_CONTROL_SESSION_CONTRACT_JSON` — so this is latent, not live.
  When v5 ships it becomes a blocker: `closeReadable`, now in
  `packages/ceal-worker-cli/src/private-worker-transport.ts`, destroys an `fs.ReadStream`
  over an inherited blocking socket, and neither `close` nor `error` fires, so
  the shutdown await never settles and the process never exits. Reproduce with a
  child holding a socketpair end on the contract's fd, a parked `for await`, and
  a `destroy()`. The suite cannot express it: every fixture models the channel as
  a generator whose close is a graceful EOF, which differs in kind from
  `destroy()`.
  **This is no longer "not before".** The Gateway lane needs a worker release
  that actually carries the v5 contract, so the v5 path is the next release's
  content rather than a later one's. Fix it in that slice, ahead of the tag.
- **Two published acceptance records overstate guide registration, and one leaks
  identity refs.** `docs/acceptance/ceal-v0.69.0/` and `ceal-v0.67.1/` were
  emitted while `registered_host_count` counted resolved host directories rather
  than registrations, and `ceal-v0.69.0/linux-amd64.yaml` carries
  `membership_ref` and `subject_ref` from the pre-`.v2` emitter. Both emitters are
  fixed; the records are historical artifacts and were left as written rather
  than rewritten after the fact. Anyone re-publishing them owes a re-emit, not an
  edit.
- **Incremental TypeScript builds are measured but not taken.** The gate compiles
  the owned packages once and several test processes compile them again; measure
  it with `tsc -p tsconfig.build.json --incremental --tsBuildInfoFile <tmp>`
  twice. Declined here for two reasons: `packages/ceal-protocol` is the frozen
  path and may not be edited, which removes a third of the win, and build
  staleness semantics in a release-proof repo deserve their own slice rather than
  a rider.
- **Nothing structural stops a new direct session writer.** The identity
  transition contract lives in `session-replacement.ts`, but a future command
  that calls `runtime.saveSession` itself bypasses it, which is exactly how issue
  10 happened. A regex sweep over worker source was rejected as the instrument:
  it cannot see aliasing or destructuring, so it buys allowlist maintenance and a
  false sense of enforcement. The structural version — making the raw save
  unreachable from the session commands — is its own slice.
