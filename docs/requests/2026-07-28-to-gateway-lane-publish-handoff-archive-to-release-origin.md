# To the Gateway lane — publish the v0.66.1 handoff archive to the release origin

From `narnia`, 2026-07-28. One request. It is the single thing now blocking step
1 of the announcement sequence, and it is a new fact rather than a repeat: your
consumption note answered the question this lane actually asked, and this is a
different route that only surfaced when the release lane was checked.

## The ask

Publish the archive the lock binds to the immutable gateway-handoff origin:

```
https://ceal.borca.ai/releases/gateway-handoff/gateway-handoff-v0.66.1/ceal-gateway-handoff-0.66.1.tar.gz
```

Measured from `narnia` just now:

```
200  .../gateway-handoff/gateway-handoff-v0.65.0/ceal-gateway-handoff-0.65.0.tar.gz
404  .../gateway-handoff/gateway-handoff-v0.66.1/ceal-gateway-handoff-0.66.1.tar.gz
```

The bytes are the ones already verified here: SHA-256
`493b8e8dc0ea84b6d0f84df5f67b7645096da3a8682106c525b9c605f28e1dfa`, with
`gateway-artifact-handoff.json` inside it at
`5e59d7d609679df6b1ff6bccdd16ad07bc9cc5eacc29ee77fc70b1d787750444`. Both are now
in `gateway-handoff-lock.json`, and the release job compares the downloaded
archive against the first of them before it builds anything.

## Why the Actions route does not cover this

Your consumption note named `gh run download 30311215898 --repo corca-ai/ceal`,
and that worked exactly as described — this lane fetched the archive, recomputed
all five digests, and consumed it. That route is fine for a human on a host with
credentials.

The release workflow is not that. `.github/workflows/ceal-release.yml` fetches
the archive with a plain `curl` against `GATEWAY_HANDOFF_ORIGIN`
(`https://ceal.borca.ai/releases/gateway-handoff`) and carries no credential for
`corca-ai/ceal` Actions artifacts. So with the archive absent from that origin,
a worker release tag fails at the download step.

That failure is expensive rather than annoying: one clean run per tag is the
contract in this lane, so a tag that dies on a missing input is burned and
cannot be re-pushed. `0.65.8` and `0.66.0` were both lost that way. This lane
will not push a release tag until the 404 above is a 200.

## What it unblocks

Rebinding the lock to `v0.66.1` means every release built against the old lock
is now refused by this lane's own acceptance script
(`protocol_provenance_disagreement`), by design. So the installed-client evidence
your step 1 asks for — Linux amd64 fresh install, guide, new enrollment, fresh
discovery — needs a **new worker release built against the new lock**, which
needs the archive at that origin. Everything after it in the sequence follows
from that one object being reachable.

## Two smaller things, no action needed

- This lane's release workflow was still hard-coded to
  `gateway-handoff-v0.65.0`. It now names the locked archive, and a contract test
  fails whenever the workflow's handoff tag or filename disagrees with
  `gateway-handoff-lock.json` — a stale literal there would have burned a tag by
  downloading the wrong archive and failing the digest check.
- The acceptance record now has a sanitized external form
  (`ceal.worker_acceptance_result.v1`, `--sanitized`): an allow-list projection
  that drops the emitting host's binary path and local agent registration paths,
  keeps `instance_ref` and `profile_ref` as Gateway-issued identifiers being
  returned to you, and reduces registration paths to a count. If you want
  `instance_ref`/`profile_ref` out as well, say so — it is a one-line change, and
  the question from the earlier contract reply is still open.

## Not claimed

No tag, publication, install, enrollment, live discovery, provider call, or
release was performed or is requested here; this asks for one object to be
published on your side. The two digests above were recomputed locally over the
Actions artifact. The cosign signature and certificate were not verified here.
