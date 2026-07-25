# Resolution critique — corca-ai/ceal-cli#1 (leaf help / cursor wording)

- Execution: bounded fresh-eye subagents (3 angles + 1 separate counterweight)
- Fresh-Eye Satisfaction: parent-delegated
- Packet Consumed: n/a (no adapter sections)
- Reviewed Input Identity: commits `2f454b0`, `557746d` in this repo; angle pass
  read the tree at `2f454b0`, counterweight at `557746d`
- Target: `references/code-critique.md`
- Reviewer tier requested: high-leverage; host exposed model override only
  (`requested_fields_sent`), reasoning-effort application not confirmed
- Reviewer boundary rail 1: snapshot before each spawn, verify after each return;
  final verify clean except the fingerprint tool's own snapshot file

## Change

Give every subcommand the installed help advertises its own four-field leaf help
in both CLIs, resolve a help token anywhere in the tail as read-only help, and
narrow the worker guide's opaque-cursor rule to the target page that emits
`next_cursor`. Lock-in event: publishing `ceal-v0.65.5` and closing #1.

## Capability at Stake

An agent following the signed guide can complete the mandated descent — read a
leaf's `Effect` / `Evidence` / `Result schema` / `Recovery/readback` and know
whether its call was in contract — without guessing, and without a help probe
performing work.

## Angles

1. Michael Jackson — problem framing (is the named problem the one being solved?)
2. Gerald Weinberg — diagnostic + boundary ownership (cause layer vs symptom)
3. Jef Raskin — humane interface, read as the agent-facing CLI surface
4. Counterweight — separate skeptical triage pass

## Findings acted on before publication

- `ceal session enroll --gateway --help` passed `--help` as the gateway value and
  reached the enrollment runner, which prompts for a device-enrollment code
  before it can fail; `cealctl` had the same shape on its value options. Fixed by
  resolving any help token in the tail against the nearest declared leaf, with a
  parent fallback. Gated with hard failures on credential/stdin/network reads.
- `cealctl enrollments create` advertised `cealctl.enrollments.v1`, which only
  the bare route emits; the route emits `cealctl.enrollment_created.v1`. Fixed,
  plus a per-package gate that every declared schema exists in the emitter.
- `ceal commands` / `cealctl commands` were left at depth 1, so the
  machine-readable inventory advertised fewer routes than prose help. Fixed
  additively.
- `receipt` still listed `show` as an option row; the parent/child sync gate was
  unbounded and compared only a prefix of the advertised list. Both fixed.
- The target-selection notes named `--fresh`, a flag that route rejects, and did
  not state that a Gateway requiring a narrower selection answers
  `selection_required` with no targets and no cursor. Rewritten.
- `--token-stdin`'s help row was one column out of alignment. Fixed.

## Counterweight Triage

- Act Before Ship: empty after the above landed.
- Bundle Anyway: `--token-stdin` alignment (done).
- Over-Worry: a spec/version for the `Subcommands:` block (this repo is its only
  consumer, and `Commands:` has been a parsed prose interface since before this
  slice); a schema bump for the additive `subcommands` key; a gate asserting the
  prose accuracy of destructive-route text; the cross-binary "four contiguous
  `Key: value` lines" parser that no consumer has; `session logout` / `session
  enroll` failure paths emitting the repo's uniform error envelopes rather than
  the declared success schema.
- Valid but Defer: route *acceptance* is still per-command literals rather than
  derived from the subcommand tables, so a newly added sub-route could reproduce
  this class with every gate green. Recorded in the #1 close comment.

## Deliberately Not Doing

- Spec/version for the `Subcommands:` grammar, a schema bump for `subcommands`,
  a prose-accuracy gate, and converting option rows from strings to data. Each
  costs more code than the agent-visible behavior it changes.
- `--match -h` now prints help instead of matching the literal `-h`. Intentional:
  a read-only help answer is the safe collision outcome.
- Making a Gateway capability's `next_offset` opaque. That is a Gateway-side
  contract decision, outside this repo's ownership.

## Next Move

Published `ceal-v0.65.5`, updated the installed worker, re-ran the reporter's
command against the signed release, and closed #1 with the deferred
dispatcher-derivation risk written into the close comment.
