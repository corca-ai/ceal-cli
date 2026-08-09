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

- **CI runs macOS but proves no install there.** `check.yml`'s `check-native` leg
  and the release lane's `darwin-arm64` build both set
  `require_platform_proofs: "0"`, and `test/platform-proof.mjs` grants a non-skip
  only on `linux`/`x64`, so every installed-binary and installer proof self-skips
  on macOS. Do not "fix" this by flipping the flag — requiring it across all of
  `linux-*` is what burned `ceal-v0.67.0`.
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
