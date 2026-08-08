# Carried Debt

Items known and not scheduled. Each was carried across sessions **unconfirmed**:
re-check that an item is still true before starting on it, and delete it here
when it stops being.

Everything not listed is owned by the comment at the site and by
[gates.md](gates.md).

- **The signed release manifest has no client package.**
  `ceal-worker-release-manifest-<platform>.json` records only the protocol, so a
  consumer is left with a source-owner claim. The fix puts the client in the
  manifest schema, which is release-affecting.
- **The acceptance record's receipt branch is not an allow-list.** It passes a
  Gateway receipt event through without projection, so `membership_ref` and
  `subject_ref` ride along.
- **The record has two formats.** The repo script emits JSON, the installed
  command emits YAML.
- **CI has no macOS install leg.** Do not cite `require_platform_proofs` as the
  reason — that is about the release and installer suites, and requiring it across
  all of `linux-*` is what burned `ceal-v0.67.0`.
- **The worker `createLock` race** is unresolved.
