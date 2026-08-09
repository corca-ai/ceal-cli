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
  `destroy()`. Fix alongside the rest of the v5 path, not before.
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
