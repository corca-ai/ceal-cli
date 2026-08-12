# Update and Embedded Guide Independence Closeout

## Implemented

- The current installer updates only the signed worker generation. It does not
  download, stage, or register the guide compatibility asset, and a missing
  compatibility asset cannot change a successful current-installer result.
- A successful `ceal update` reports that guide registration was not attempted
  and names the exact follow-up command for the detected host:
  `ceal guide register codex` or `ceal guide register claude`.
- The signed worker embeds the complete deterministic guide directory. Explicit
  registration verifies and materializes that directory in content-addressed
  worker state, then creates only an empty requested-host registration path.
  An earlier Ceal-managed link is preserved with exact cleanup-and-retry advice;
  portable filesystems do not offer the conditional atomic replacement needed
  to overwrite it without a foreign-occupant race.
- Read-only guide status distinguishes an embedded carrier from a materialized
  registration and refuses content, inventory, symlink, ordinary-mode, or
  special-mode drift.
- A self-contained compatibility projection remains in the release inventory
  for the immutable `0.76.1` installer. The current installer accepts only that
  exact signed historical guide entry when reusing a generation created by the
  old installer.

## Contract Source

The operator required binary update success to be independent from full guide
materialization and host registration, with an actionable registration command
instead of reinstall advice. `docs/release-and-enrollment.md` owns the resulting
release and update procedure. `worker-release-inputs.json` owns the canonical
guide directory, compatibility projection, and embedded asset names.

The immutable `0.76.1` binary is a compatibility limit: its installer requires
the legacy signed guide projection and its command writer cannot emit the new
advisory. This slice therefore proves the exact old installer can cross the new
asset shape without reinstall, while the new binary owns subsequent advisory
and failure separation. It does not claim an old installed binary emitted new
output.

## Verification

- `npm run check:unit` passed on the repaired tree.
- Focused worker guide, update, CLI, release-input, release-asset, and installer
  tests passed, including tag-resolved `ceal-v0.76.1` installer compatibility and an
  unchanged rerun through the newly staged installer.
- Installer mutation proofs refuse each execute bit and each setuid, setgid, or
  sticky bit independently for the historical compatibility entry.
- Runtime mutation proofs refuse guide content, file mode, directory mode,
  symlink, and ownership-marker drift.
- `npm run lint:shell` passed after the installer predicate repair.
- `npm run check:duplication` passed after shared registration-target,
  failed-state, sidecar, and mutation-runner seams were extracted. Surviving
  detector families are classified against their distinct trust boundaries in
  `charness-artifacts/quality/dup-review.json`.
- `npm run check` reached the live package/native release positives and failed
  with `proof_shipment_protocol_divergence`. Those refusals prevent the release
  paths from reaching the scripts coverage floor; they are the existing signed
  handoff quarantine, not released-worker proof.
- Verification level: local checkout, tag-resolved historical-installer fixture, and
  development artifact behavior. No signed successor, installed successor, or
  live Gateway/provider proof was produced.

## Lint Gate

ran-pass `npm run check:unit`

ran-pass `npm run lint:shell`

ran-pass `npm run check:duplication`

ran-pass `bash .githooks/pre-push`

ran-fail-deferred `npm run check` — release package/native positives are refused
by the existing Protocol proof/shipment divergence, after which scripts
coverage is intentionally incomplete.

## Truth Surface Sync

`README.md`, `docs/handoff.md`, `docs/release-and-enrollment.md`,
`docs/operator-acceptance.md`, and `docs/macos-worker-runbook.md` distinguish
binary update, embedded guide availability, explicit per-host registration, and
the immutable first-hop compatibility projection. The release workflow,
installer, release-input record, builders, and manifests derive the two guide
representations from their named owners.

## Boundary Ownership

`owned-correctly` — the canonical guide producer is `skills/ceal-guide`; the
deterministic directory bundle is consumed by the signed worker and runtime
verifier. The compatibility producer is the self-contained bridge under
`scripts/assets/`, consumed only by the immutable installer contract and legacy
manifest field. Binary installation, guide materialization, and host
registration remain separate consumer boundaries. Frozen
`packages/ceal-protocol` is unchanged.

## Critique

Parent-delegated fresh-eye review found and drove repairs for four substantive
classes: the old-installer generation could not be revalidated by the new
installer, status trusted a materialized directory without exact verification,
shell `find -perm` predicates confused all-bit and any-bit semantics, and the
runtime verifier masked special permission bits. The repaired-tree review then
found no remaining ship blocker for this slice and confirmed the frozen
Protocol boundary remained untouched.

The duplication review separately rejected four repeated implementation seams
before accepting the remaining detector families as trust-boundary or
scaffolding overlap. This keeps the duplicate ratchet at its existing floor
rather than rebaselining the new code.

## Residual Risks

- The first hop executed by an immutable `0.76.1` binary still depends on its
  signed compatibility projection and cannot print the new guide advisory.
- Signed successor and installed-update proofs remain unavailable until the
  final Gateway Protocol handoff converges the release lock and vendored pin.
- Network, signature, checksum, and worker-binary installation failures remain
  real update failures. Only guide materialization and host registration are
  deliberately non-gating.

## Next Slice

Consume and review the final signed Gateway Protocol handoff, converge the
frozen tree and release identity in one commit, rerun the full release gate,
then ask the operator before choosing a version, pushing, tagging, publishing,
or installing the successor.

## Completion Categories

- durable: update/guide separation, embedded directory carrier, explicit
  per-host registration, historical bridge compatibility, exact integrity
  verification, release-manifest ownership, and operator documentation.
- external-writes: none.
- test-only: historical-installer fixture, filesystem mutation probes, and
  disposable artifact workspaces.
- verification: iteration gate, focused behavior tests, shell lint, duplication
  ratchet, expected full-gate quarantine, and fresh-eye critique.
- unverified-future: final signed Protocol handoff, signed Worker successor,
  installed update, Gateway selection/apply, and live provider readback.
