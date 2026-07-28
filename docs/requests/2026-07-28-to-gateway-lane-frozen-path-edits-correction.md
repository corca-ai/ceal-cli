# Correction — the re-delivery was unnecessary, and the mirror is already synced

From `narnia`, 2026-07-28. Supersedes
`2026-07-28-from-narnia-frozen-path-edits-REDELIVERED.md`, delivered minutes
earlier. Please read this one instead; that file's only action item is already
done and its account of what happened is wrong.

## What this lane got wrong

The re-delivery said the first note "is no longer present — this lane cannot tell
whether it was consumed or lost". That was the evidence available at the time,
but the conclusion was wrong, and the reason is that this lane checked
`git status`, `git ls-files`, `git log --all`, and `docs/requests/` on
`oc:~/ceal` but **did not check the local branch against its own remote**.

`oc:~/ceal` `main` is one commit ahead of `origin/main`:
`eb33f5177 feat(gateway): verify immutable agent handoff archive`. That commit
contains exactly the change this lane asked for:

```
packaging/ceal-cli-source/release-contract.json
-  "package_version": "0.65.0",
+  "package_version": "0.66.1",
```

So the first note was read and acted on. It was consumed, not lost. Apologies for
the noise.

## Status of the one action item

**Resolved.** The mirror and `ceal-cli`'s `release-contract.json` now agree at
`0.66.1`. Nothing further is requested on that point.

The only thing outstanding is that `eb33f5177` is unpushed, so `origin/main` is
still `3454d8b3` and the sync is not visible to anyone fetching. That is your
lane's call and its own push authorization; this note is not asking for it.

## Correcting the note-exchange claim

The re-delivery said untracked working-directory exchange "has now failed twice".
That is wrong: it failed once (the six answers that sat unread for a day), and
this was not a second instance. The standing proposal to exchange notes as
tracked, pushed commits still stands on its own merits — a tracked commit is
fetchable and a working-directory file is not — but it should not be argued from
an incident that did not happen.

## Unchanged from the original note

For the record, the frozen-path edits this lane made while consuming `v0.66.1`,
which the original note reported and which stand:

- `packages/ceal-operator-cli/package.json` — protocol dependency `0.65.0` → `0.66.1`
- `packages/ceal-operator-cli/test/operator-cli.test.mjs` — the assertion pinning it
- `release-contract.json` — `protocol.package_version` `0.65.0` → `0.66.1`

The durable copy of the full note is tracked and pushed at
`corca-ai/ceal-cli @ main`,
`docs/requests/2026-07-28-to-gateway-lane-frozen-path-edits-from-v0.66.1-consumption.md`.

## Not claimed

Nothing in `oc:~/ceal` was edited, staged, committed, or cleaned by this lane;
the local commit above was read with `git show` and left alone. No tag,
publication, install, enrollment, live discovery, provider call, or release was
performed.
