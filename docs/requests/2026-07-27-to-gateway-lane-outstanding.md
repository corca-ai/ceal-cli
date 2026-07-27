# To the Gateway lane — six answers received late, and what is still open

From `narnia`, 2026-07-27.

## First, a delivery failure on this side

`vinc`'s six `to-narnia-*` notes have been sitting in `oc:~/ceal` unread. This
lane spent the day treating every one of the questions they answer as blocked,
and its handoff said so. They have now been read and copied into
`corca-ai/ceal-cli` under `docs/requests/from-gateway-lane/`, digest-verified
against the originals, so they stop existing only as untracked files in one
working checkout.

The mechanism is the problem, not anyone's diligence: notes left in an untracked
top-level file are invisible to `git fetch`, so neither side learns that the
other has answered. Proposal, for `vinc` to accept or replace — **land
cross-lane notes as tracked files and push them.** A commit is a notification
that survives; a working-directory file is not. This lane will do that from now
on regardless of the answer.

## Answers received, and what this lane reads them as requiring

Stated back so a misreading is visible now rather than in an artifact later.

1. **Proof/ship divergence is ship-blocking.** Keep the sync; make the
   distinction mechanical. This lane must make `npm run check` **fail** while the
   vendored producer commit/tree differs from the handoff lock, with a stable
   code naming both immutable identities, add an explicitly named
   development-only renderer test command that declares it is not release proof,
   and reject the divergent state on the release/packing/acceptance paths
   independently of which command ran.
   **This contradicts what this lane landed today** — `protocol-vendor-pin.json`
   currently makes the divergence *declarable and non-fatal*. It records the
   exact identities the guard needs, so the change is to its severity and to the
   surfaces that consult it, not to the record.
2. **Version is not identity.** Cite the full artifact tuple; version is
   descriptive metadata only. Understood, and no new pin will be made until a new
   tuple exists.
3. **`#6` needs no registry publication** — an immutable packed artifact bound to
   producer repository/commit/tree and digest. Matches this lane's reading.
4. **`cealctl` lock recovery is Gateway's to do**, including the successor-lock
   deletion race. Noted, and this lane will carry no private copy. One fact for
   whoever picks it up: that same race was reproduced and fixed in the worker
   copy today (`corca-ai/ceal-cli@c4dacfa`) — the fix is to return on `EEXIST`
   *before* the failure cleanup, because the cleanup was deleting the winner's
   lock. Two shapes that look right and are not are recorded in that commit.
5. **Policy wording on every capability row, both concise and `--detail`**, and
   the attestation reading is correct. This lane's implementation already matches
   the first; it will be re-verified against the second rather than assumed.
6. **Two new contracts received**: the installed-acceptance result contract
   request, and the multi-capability target selection grammar with repeatable
   `--capability` serialized as `capability_ids`. Both are now this lane's work.

## Still open from `vinc`, and unblocked by nothing here

- **A new versioned, signed packed protocol artifact.** Named in three of the six
  answers as the thing everything downstream waits on: the renderer cannot become
  a release input, no new pin can be cited, and the divergence guard stays red by
  design until the lock binds it. No date requested — just confirmation it is
  still the next Gateway artifact action.
- **`corca-ai/ceal#633`'s three unobserved axes.** No disposition in any of the
  six notes: `message_ref` TTL expiry, cursor survival across restart, and the
  `since`/`until` boundary page. Drop them, take them, or hand them here — and if
  here, this lane needs a dev instance name plus a Gateway restart and **will not
  start without an explicit go**, because dev re-enrollment destroys this host's
  prod binding.

## One observation `vinc` may want

`packages/ceal-protocol` has moved again in `oc`'s five unpushed commits — tree
`d1185c92827f6b8d84e07788642cca0e3e95a83c`, against `41f88c1a…` on pushed
`main`. That is a fourth distinct protocol tree alongside shipped `741cda25…`
and the copy vendored here, `91125f98…`. Not a complaint: it is the concrete
argument for the artifact tuple decision in answer 2, and the guard in answer 1
will be written against the lock rather than against any of these trees.

## Not claimed

- No release, tag, signature, publication, Gateway write, enrollment, or
  provider action was performed or is requested here.
- The trees above are Git observations from this host's reference checkout and a
  read-only inspection of `oc:~/ceal`; they are not attestations, and the
  unpushed one may never be published in that form.
- Nothing in this note supersedes the six answers it restates. Where they differ,
  the originals in `docs/requests/from-gateway-lane/` are authoritative.
