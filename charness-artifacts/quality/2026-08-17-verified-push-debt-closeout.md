# Verified-push debt closeout

## Scope

This record closes the local verification debt that surfaced when the TypeScript
quality branch returned to the ordinary Worker pre-push hook. It does not claim a
Worker release, package publication, Gateway handoff, or live readback.

## Structural repairs

- Worker coverage now measures the 50 remapped production `src/**/*.ts` files,
  not converted `test/**/*.ts`. The existing floors were not lowered. The full
  package run passed 381 tests (379 pass, 2 skip) at 96.08% statements/lines,
  87.21% branches, and 95.65% functions.
- The new acceptance projection and private-entrypoint cases prove retained
  behavior. A redundant guide composition test that changed global process state
  was not retained.
- The hook exit-propagation fixture now executes a copy of the checked-in hook in
  a throwaway Git repository. It no longer collides with the real outer
  `.git/ceal-pre-push.lock`; the separate concurrency suite still proves refusal
  and signal cleanup.
- `nose_inventory_paths` now names the same four owned roots as `dup_ratchet`, so
  the advisory and blocking inventories are machine-portable and cannot silently
  scan different corpora.

## Duplicate-ratchet reconciliation

The first ordinary hook reached 83 previously accumulated new fingerprints and
one membership reduction. The scan log marked every member outside the current
diff. Three bounded reviews covered the complete prefix partition:

- `0-5`: 30 families — 13 independent/intentional, 17 known re-keys, 0 extract-now.
- `6-a`: 24 families — 24 independent/intentional, 0 known exact re-keys, 0 extract-now.
- `b-f`: 29 families — 24 independent/intentional, 5 known re-keys, 0 extract-now.

The two entries omitted from the first `6-a` reviewer table (`61c98543` and
`64d86972`) were reconciled by the primary review as, respectively, adjacent
archive record validation and independent native/package artifact tests. Neither
creates a second production fact owner.

This was therefore handled as the quality skill's explicit reviewed-batch
re-baseline case. The blocking baseline moved from 132 to 146 live families
(`+119/-105` identities after the TypeScript conversion and accumulated member
changes), and the advisory baseline was created from the same 146-family scan.
The hard arm remains enabled with `fixable_ceiling=0` and `floor_F=0`; a future
unaccepted family still blocks.

## Evidence

- Worker package coverage:
  `/tmp/ceal-proof-jobs/worker-production-coverage/result.20260817-worker-production-coverage-1.json`
- Initial type-ratchet failure:
  `/tmp/ceal-proof-jobs/worker-verified-push-gate/result.20260817-worker-prepush-3.json`
- Nested-hook failure:
  `/tmp/ceal-proof-jobs/worker-verified-push-gate/result.20260817-worker-prepush-4.json`
- Historical duplicate-ratchet failure and frozen family list:
  `/tmp/ceal-proof-jobs/worker-verified-push-gate/result.20260817-worker-prepush-5.json`
  and its `output.log`
- Focused hook proof: exit propagation 1/1; concurrency and signal cleanup 4/4.
- Current advisory: exact owned roots, `status: clean`, no new family.
- Current blocking gate: `OK: no new fixable-eligible families;
  fixable_ceiling=0 <= floor_F=0`.

## Remaining proof

The final ordinary pre-push, normal `git push`, remote SHA readback, and CI result
must be recorded after this artifact and the refreshed baselines are committed.
