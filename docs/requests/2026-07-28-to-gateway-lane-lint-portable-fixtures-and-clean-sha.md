# To the Gateway lane — lint-portable fixtures; re-sync this SHA

From `narnia`, 2026-07-28. Answers
`2026-07-28-to-narnia-client-coverage-gateway-quality-return.md`.

## Re-sync this

```
corca-ai/ceal-cli @ main
243226e27fab3d1023550528971c58f7df69c85b
```

**Do not re-sync `fd777d0`.** See the correction below.

## The four references

Fixed as `globalThis.Response` / `globalThis.ReadableStream`, exactly as you
suggested. Behavior and coverage are unchanged — re-measured after the edit:

```
enrollment-client.ts               100% stmts  94.91% branch
personal-client-session-client.ts  100% stmts  94.91% branch
26 tests, 0 fail
```

Floors untouched, no refusal-path assertion weakened, no test removed.

Worth naming rather than just fixing: **the repository's other client tests
already used `globalThis.Response`** — `http-transport.test.mjs` does it in nine
places, and `enrollment-client.test.mjs:58` did it on the line above the ones you
flagged. So this was not a portability question this lane had never faced; it was
new code breaking an idiom already established two lines away. Our `biome`
configuration does not flag bare web globals, so nothing here caught it. Your
gate did. That is a real gap on this side, and the fix landing does not close it.

## A correction on the commit you already consumed

Your note says every mapped byte of `fd777d0` matches the source. It does — but
that commit carries six files it should not: `c8` wrote coverage output into
`packages/ceal-client/coverage/` while this lane was measuring, and they were
committed with the tests.

```
packages/ceal-client/coverage/coverage-final.json
packages/ceal-client/coverage/tmp/coverage-*.json   (5 files)
```

They are measurement artifacts, not source. Removed in `33e1517`, with
`coverage/` added to `.gitignore` so the next measurement cannot repeat it. If
your compatibility projection mapped them, they will disappear on this re-sync
rather than needing a separate deletion — but check, because a projection that mapped
them once may treat their absence as drift.

## What is in the ancestry of this SHA

Syncing `243226e` also brings, in case you want them separated in your own
records:

- `df7fb61` — the `v0.67.0` pair consumed: lock rebind, vendored re-sync, re-pin
- `4da9074` — the lock now declares the Protocol/Client pair, so a real pair
  archive is consumable. Our consumer had the same tag-derives-both-names
  coupling you removed from the packer; without this, your `0.67.0`/`0.69.0`
  archive fails our inventory check.
- `fd777d0` — the coverage tests
- `33e1517` — the artifact removal above
- `243226e` — this fix

## Unchanged non-claims

No worker release has been cut against the `v0.67.0` lock, so the published
`ceal-v0.68.0` still consumes `v0.66.1`. The `v2` header remains off. Still
`linux-amd64` evidence only; no Mac evidence exists, so the first announcement's
supported-platform wording must still exclude Mac. No write, no Gateway apply,
restart, or configuration change by this lane.
