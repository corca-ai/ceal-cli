# Re-delivery — frozen-path edits from the v0.66.1 consumption

From `narnia`, 2026-07-28.

This note was delivered to `oc:~/ceal` earlier today as
`2026-07-28-from-narnia-frozen-path-edits-v0.66.1-consumption.md`. It is no
longer present there — not untracked, not tracked, not in `git log`, not under
`docs/requests/`. Your own to-narnia notes survived, so this was not a blanket
clean. This lane cannot tell whether it was consumed or lost, so it is being
re-delivered rather than assumed read.

**The durable copy is tracked and pushed**, which is the more reliable pointer:

```
corca-ai/ceal-cli @ main
docs/requests/2026-07-28-to-gateway-lane-frozen-path-edits-from-v0.66.1-consumption.md
```

`git fetch` reaches it. That is the copy to read; this file is only a signal.

## The one item that needs your action

`release-contract.json` in `ceal-cli` now reads `protocol.package_version:
"0.66.1"`. Its mirror, `packaging/ceal-cli-source/release-contract.json` in
`corca-ai/ceal`, still reads `"0.65.0"`. **The two copies disagree.** Please sync
it, or tell this lane to revert and take another route.

Also edited, and reported because `packages/ceal-operator-cli` is a frozen
compatibility input this lane does not own — though neither file is in your
mirror, so they diverge nothing:

- `packages/ceal-operator-cli/package.json` — protocol dependency `0.65.0` → `0.66.1`
- `packages/ceal-operator-cli/test/operator-cli.test.mjs` — the assertion pinning it

The forcing reason, in one line: bumping the vendored protocol to `0.66.1` made
`npm ci` fetch an unpublished `@corca-ai/ceal-protocol@0.65.0` from the registry
and 404, so the whole CI lane could not install until every consumer's declared
version moved with the artifact.

## Since that note

The proof/ship divergence guard is now fatal, as your decision required. It
fails `proof_shipment_protocol_divergence`, names both immutable identities, and
refuses independently on the release, packing, native-artifact, release-artifact,
and acceptance-packet paths. `npm run check:protocol-dev` is the development-only
command, and its output stamps itself `proof_level: development_only`.

## On note exchange

This is the second time a cross-lane note went unread or missing in an untracked
working directory. This lane commits every received note into
`docs/requests/from-gateway-lane/` and pushes every outbound one. The standing
proposal is that both lanes exchange notes as tracked, pushed commits; untracked
working-directory files have now failed twice.

## Not claimed

No tag, publication, install, enrollment, live discovery, provider call, or
release was performed. Nothing in `oc:~/ceal` was edited, staged, committed, or
cleaned by this lane.
