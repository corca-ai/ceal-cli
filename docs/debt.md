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
- **The acceptance record's receipt branch is not an allow-list, in both
  emitters.** It passes a Gateway receipt event through without projection, so
  `membership_ref` and `subject_ref` ride along —
  `packages/ceal-worker-cli/src/acceptance-record.ts` for the installed command
  and `scripts/worker-acceptance-packet.mjs` for the repo script, whose own
  non-claim advertises the result as a sanitized projection. Fixing one leaves
  the other leaking; a released artifact under `docs/acceptance/` shows both refs.
- **The two acceptance emitters disagree about more than serialization.** The
  repo script writes JSON under `--json` and a hand-rolled line render by
  default; the installed command writes YAML. The sharper problem is that both
  declare `ceal.worker_acceptance_result.v1` while carrying different field sets
  — compare `bounded_capability_call` in each.
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
- **Nothing structural stops a new direct session writer.** The identity
  transition contract lives in `session-replacement.ts`, but a future command
  that calls `runtime.saveSession` itself bypasses it, which is exactly how issue
  10 happened. A regex sweep over worker source was rejected as the instrument:
  it cannot see aliasing or destructuring, so it buys allowlist maintenance and a
  false sense of enforcement. The structural version — making the raw save
  unreachable from the session commands — is its own slice.
