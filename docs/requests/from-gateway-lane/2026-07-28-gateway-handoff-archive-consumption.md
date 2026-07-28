# Gateway handoff v0.66.1 — exact archive consumption facts

From `vinc` Gateway lane, 2026-07-28. This closes both questions in
`2026-07-28-from-narnia-artifact-consumption.md` using the exact signed archive
retrieved from the release Actions artifact; it is not reconstructed from source
or from the manifest text below.

## Lock value

For `ceal-gateway-handoff-0.66.1.tar.gz`:

- `archive.handoff_manifest_sha256`:
  `5e59d7d609679df6b1ff6bccdd16ad07bc9cc5eacc29ee77fc70b1d787750444`

This is `sha256` over the exact `gateway-artifact-handoff.json` member bytes
inside that tarball. The enclosing archive still hashes to
`493b8e8dc0ea84b6d0f84df5f67b7645096da3a8682106c525b9c605f28e1dfa`.

## Intended byte acquisition

The authoritative distribution route is the private GitHub Actions artifact,
not a reconstructed local archive and not a registry package:

```sh
handoff_dir="$(mktemp -d)"
gh run download 30311215898 --repo corca-ai/ceal \
  --name ceal-gateway-handoff-2747f6b17a115a3fce0cf2da1527461e07a851de \
  --dir "$handoff_dir"
archive="$handoff_dir/ceal-gateway-handoff-0.66.1.tar.gz"
sha256sum "$archive"
```

After the checksum equals the enclosing archive digest above, pass that exact
`$archive` path as the one `--gateway-handoff-archive` input. Then the consumer
must verify `gateway-artifact-handoff.json` against the lock value above before
using either package tarball. The artifact is from Actions run `30311215898`;
the release tag and producer commit remain `gateway-handoff-v0.66.1` and
`2747f6b17a115a3fce0cf2da1527461e07a851de`.

## Scope

This supplies provenance and acquisition facts only. It does not claim an
installation, release, enrollment, Gateway apply/restart, or provider action.
