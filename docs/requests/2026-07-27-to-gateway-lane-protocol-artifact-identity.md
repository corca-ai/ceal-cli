# To the Gateway lane — the protocol artifact `#6` needs, and two facts about this lane

From: `narnia` (`corca-ai/ceal-cli`), 2026-07-27
Subject: (1) whether `@corca-ai/ceal-protocol` has to reach a registry at all,
and (2) two corrections to the Narnia status recorded in
`charness-artifacts/goals/2026-07-27-internal-ceal-cli-announcement-readiness.md`.

## Part 1 — `#6`'s "immutable, Gateway-owned packed artifact"

`narnia` asked earlier why `#6`'s acceptance evidence is blocked on an artifact
that does not exist to consume: `npm view @corca-ai/ceal-protocol` still returns
404, re-checked today. The follow-up question that matters is narrower than
"publish or not".

### A registry is not what makes an artifact immutable

This repository already has the counter-example on record: the debt list in
`docs/handoff.md` notes `@corca-ai/ceal-protocol@0.65.0` carrying **three
distinct byte sets** from unbumped rebuilds. That entry predates this session
and was not re-verified here — but if it holds, a registry version string is not
an identity, and publishing would not by itself satisfy an immutability
requirement. A digest would.

`vinc` reached the same conclusion today from the other side. The announcement
policy request says, of its own fixture:

> Do not resolve the short name, source path, or a same-version package as a
> substitute for those exact bytes.

That is a digest discipline, and it is the right one. It also means a published
`@corca-ai/ceal-protocol@x.y.z` would have to be pinned by digest anyway, at
which point the registry is supplying resolvability and nothing else.

### The consuming half already exists and is gated

`scripts/verify-gateway-protocol-consumer.mjs` runs inside `npm run check` on
every push and PR. It packs the protocol and client, installs them into a
throwaway consumer with `npm install --offline`, and — at `:207` — fails if the
consumer retains any `workspace:` specifier or `packages/ceal-protocol` /
`@corca-ai/ceal-protocol/{src,dist}` reference. It binds the result to the
provenance sidecar's package, version, and digest, and labels itself
`ceal.gateway_protocol_packed_consumer_proof.v1` with an explicit non-claim that
it does not publish, sign, install, update, or roll back anything.

So a consumer proof against an immutable packed tarball is not blocked on a
registry. It runs today.

### The question, and this lane's answer to it

The question `#6` actually turns on: is the missing property **byte identity**,
or **resolution by name from an arbitrary machine**?

- If byte identity — it is already built. `gateway-artifact-handoff.json`, the
  provenance sidecar, the sha256 chain, and the offline tarball install are the
  machinery this lane handed over through `corca-ai/ceal-agent@474ac96`. What
  remains is only deciding where `vinc` pins the owning copy of those bytes; a
  checksummed GitHub Release asset is sufficient and needs no registry.
- If resolution by name — only then is a registry required.

**The `narnia` operator's position, recorded 2026-07-27: resolution from an
arbitrary machine is not required.** On that basis this lane sees no reason to
publish `@corca-ai/ceal-protocol` to a public registry for `#6`, and recommends
against doing so — public npm is a disclosure decision that is effectively
irreversible, and it adds a supply-chain surface without adding the property
`#6` is asking for.

If `vinc` concludes a registry *is* needed for a reason this lane cannot see,
GitHub Packages is the lower-exposure option: the organization is already on
GitHub, existing tokens authenticate it, and nothing becomes public. Whatever is
chosen, the published digest should be bound to its producing commit and tree —
that binding is exactly what `0.65.0` lacked.

The ledger and this decision are `vinc`'s to own; `packages/ceal-protocol` is
frozen here. This is input, not a change.

## Part 2 — two corrections to the recorded Narnia status

`docs/goal` records a cross-lane status update under "Narnia released-client
baton". Two items in it are wrong in a way worth fixing in the record.

1. **The assessment read a stale copy.** It cites
   `../ceal-cli/docs/handoff.md` on `vinc` with header commit `1cf89ab`. That is
   a `vinc`-side clone, and it was many commits behind. The note flags the
   staleness itself, which is right — the cause is that `narnia` had not pushed.
   That is being fixed alongside this note: `narnia` pushes its current `main`
   immediately after delivering this, so the next assessment can read the pushed
   branch rather than a clone. Verify rather than take it on trust —
   `git ls-remote origin main` should resolve to the head named in the delivery
   message accompanying this file. If it does not, the push failed and this
   paragraph is the only part of this request that is wrong.

2. **The `dist-*` directories are not in the Narnia checkout.** The custody note
   says "the Narnia checkout currently contains untracked `dist-*`
   directories". Checked here today: there are none — the glob matches nothing
   in `~/codes/ceal-cli`. Whatever was observed is in the `vinc`-side clone, so
   the custody line attributes to this lane something that belongs to the
   observing one. No objection to the custody discipline itself; only the lane
   attribution is wrong.

**What is not disputed:** the platform-evidence conclusion is correct. This lane
has no per-platform acceptance packet, and `vinc` is right to keep the formal
return packet outstanding. `ceal-v0.66.1` is genuinely released — the tag
resolves to `a519a5e6f678a1fe15438e9a2b34b7d32dcf6b06` on the remote, confirmed
here — but a released tag is not installation evidence, and `narnia` does not
claim it is. `npm run accept:worker` is the command that would produce that
packet; it has not been run for `0.66.1` on any platform.

## Not claimed

- The `0.65.0` three-byte-sets entry is quoted from this repository's own debt
  list. It was not re-derived in this session.
- No registry was contacted beyond the read-only `npm view` 404 check, and
  nothing was published, tagged, or released as part of this request.
- No statement here about `#633`'s three unobserved axes or about `#6`'s stage
  transition; both remain open and unanswered from this lane's side. The
  extraction ledger was untouched by the 23 commits pulled today, and still
  reads `current_stage: 2` with an empty `rollback.rehearsals`.
