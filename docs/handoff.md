# Session Handoff
Date: 2026-07-26 (`ceal-v0.65.10` is stable; unreleased work waiting; the prod
session degradation is now classified client-side, Gateway cause still open)

Narnia-owned work only (`@corca-ai/ceal`, the `ceal` worker, `skills/ceal-guide`).
Gateway/`cealctl`/protocol work has its own baton on the Gateway host — see
`References`.

## Workflow Trigger

- Mention this file with no other task: work **Next Session** top to bottom,
  invoking `charness:impl` per item and proving each before moving on. Items 1
  and 2 need the Gateway host's prod session fix first — if it has not landed,
  skip to 3 and come back. Commit locally as you go; ask before any push, tag,
  GitHub write, or Gateway write, and cut the release only when the operator
  approves publishing.

## Current State

- **`ceal-v0.65.10` is the current release**, cut from another checkout while
  this one held unpushed work, so it carries none of it. It preserves session
  recovery truth at the Gateway boundary: a transport or malformed refresh
  response is retryable and explicitly not evidence of an invalid enrollment,
  while a typed revoked/expired/replayed/binding-denied response directs a
  re-enrollment, and a failed remote logout keeps the local session for a retry.
  `ceal.client_session.v1` replaced `renewal_available` with
  `renewal_configured` plus `renewal_status`, because a stored refresh
  credential never proved a live renewal. It also shipped `d65bb1d`, which the
  previous baton still listed as unreleased.
- `ceal-v0.65.9` remains the last release proven live. It carries the
  resolutions for
  `corca-ai/ceal-cli#2`, `#3`, `#4`: one error key (`kind`) and one success
  predicate (`ok`, meaning "this command answered", agreeing with the exit code)
  on every surface, `gateway: {instance_ref, profile_ref}` on call and receipt
  results, the Gateway's own `invalid_arguments` and `audit_event_not_found`
  preserved, the replay caution gated on the capability's declared effect, and
  `guide status` naming the **detected** running host with `agent_source`.
- **`0.65.7` and `0.65.8` are burned.** `0.65.7` published but installed clients
  could not update to it: `ceal update` runs the *installed* generation's
  `install-ceal.sh`, which byte-compared the new binary's `ceal version`
  document, and `0.65.7` added a line to it. `ceal.version.v1` is now frozen —
  the predicate sweep skips it with that reason recorded — and the installer
  checks the fields it needs instead of the whole document. `0.65.8` lost its
  publish readback to a transient HTTP 500 and could not be retried, because
  cosign re-signs per run while published objects are create-or-identical.
- The Claude Code guide host stays proven **adopted**: a fresh `claude -p`
  session lists `ceal-guide`. `0.65.5`'s leaf-help work stays proven
  (`corca-ai/ceal-cli#1`, CLOSED).
- **prod sessions are currently degraded, Gateway-side.** A worker access token
  expires after ~15 minutes and renewal answers `invalid_response` — reproduced
  with the previously installed `0.65.6` binary, so it is not a release
  regression — and a replacement `enrollments create` answers `request_denied`
  while the access registry still lists the client and profile as active. Both
  paths worked at 14:45Z. Recorded for the Gateway host in
  `oc:~/ceal/handoff-from-narnia-2026-07-26.md` §8. `0.65.10` changes only how
  the worker *renders* that failure — retryable, enrollment not implicated — so
  it removes the misleading advice, not the outage. The Gateway cause is open.
- Route **acceptance** derives from the declaration tables, but dispatch does
  not — see `AGENTS.md` `## Gates`, which owns that rule and the gate timings.
  A table-only row passes `check:unit` and still misroutes.
- `npm run check:unit` is the iteration gate; `npm run check` is the final one.
  `npm run probe -- <binary> <command> …` is the only sanctioned way to poke an
  installed surface: it refuses any route whose declared effect is not
  `read_only` and uses a throwaway `HOME`.
- Guide registration is host-declared: `CEAL_AGENT_GUIDE_HOSTS` in
  `agent-guide.ts` carries one row per host (label, default root under HOME, env
  override), so a new host is one table row plus its `guide register <host>`
  route. `guide status` keeps its top-level fields as the Codex projection while
  an additive `hosts` list carries every advertised host; a non-absolute or
  colon-list host root is refused, not joined.
- This host's `~/.claude/skills` is a symlink to `~/.agents/skills`, which did not
  exist, so the first real `register claude` failed with `registration_failed`.
  `~/.agents/skills` was created at the operator's direction and the registration
  then succeeded. **Unreleased local commit `74ca61a`** makes that failure name
  the link's missing target instead of advising against replacing a skill
  directory that was never there — batch it into the next release, not its own.
- The Codex host is still **staged** here (`~/.codex/skills/ceal-guide` absent).
  Registering it is a one-command local write nobody has asked for yet.
- This host is now enrolled against **`instance:ceal-prod`**
  (`registration:130cda7e-…`, `client:narnia`, `profile:work`). Both stale claims
  in the previous baton are corrected: dev's Slack connector is **not**
  `scope_unavailable` (five channels `granted`, `#ceal-dev` included) and prod's
  `grants: []` does **not** mean an empty catalog.
- The two instances serve **different catalogs**, which is the fact that matters
  for planning: dev has five read capabilities including `message.enumerate`
  (the #633 route, applied on dev only); prod has nineteen including Calendar,
  Drive, Sheets, Notion, GitHub — and **writes** (`message.create`,
  `github.issue.comment.create`, `notion.page.comment.create`) — but **no
  `message.enumerate`**. Any #633 continuation work needs dev; any write-path
  work needs prod.
- Instance binding is per-session and the worker CLI stores one session, so
  switching is destructive locally: enrolling prod replaced the dev session.
  Reversible — a replacement dev code is mintable on the Gateway host from the
  `default` operator session.
- Enrollment lane, verified end to end on the Gateway host (`ssh oc`), no browser
  needed: `cealctl login <admin-origin> --session <name>` authorizes through the
  local owner socket `$XDG_RUNTIME_DIR/ceal/admin-gateway.sock`, then
  `cealctl enrollments create --client narnia --profile work --subject hwidong
  --instance <name> --operator-session <name>` mints a one-time code for
  `ceal session enroll --code-stdin`. Use `~/ceal/packages/ceal-operator-cli`
  (the owner copy); the installed `cealctl 0.65.3` there is the other lineage and
  has no `enrollments` route. A **web-shell activation code is not this code**:
  `ceal-ops admin-api invite` is hard-capped to `ceal.chat` +
  `ceal.connector.setup` and can never carry `ceal.client.enroll`.

## Next Session

Work all of it. Items 1–2 are gated on the Gateway host restoring prod client
sessions (`invalid_response` on renewal, `request_denied` on enrollment — see
Current State); 3–6 are local and can proceed today. There is **unreleased work
on `main` already** (see the bottom of this section), so a release is the natural
closing move once the operator approves it.

1. **Close `corca-ai/ceal-cli#2`, `#3`, `#4` with released-binary proof.** The
   code shipped in `0.65.9` and was verified live against prod from an identical
   build minutes before the tag, but the post-release re-run on the installed
   binary was cut off by the session outage, and only `#4` was confirmed on the
   released artifact. Re-run the matrix against the **`0.65.10`** artifact now
   installed, then close each issue citing what was observed rather than what was
   implemented:
   - `#2`: an out-of-contract argument renders `invalid_arguments` with a
     correction (not a retry); `receipt show` on an unaudited reference renders
     `audit_event_not_found`; a declared read's unknown outcome carries no write
     caution; `ok` and `error.kind` answer on capabilities, call, and receipt.
   - `#3`: `gateway: {instance_ref, profile_ref}` on a completed call, a rejected
     call, and a receipt — with a `--profile` override to prove the stamp follows
     the profile the call used, not the session default.
   - `#4`: already confirmed (`agent: claude`, `agent_source: detected`, a fresh
     `claude -p` lists `ceal-guide`); still worth one run of the unregistered
     advisory path, which no live run has exercised.
2. **Prove multi-profile on the client** once a second real Profile exists on one
   instance. `eligible_profiles` has had exactly one entry on every instance so
   far, so `--profile` selection has never been exercised live. This also
   exercises the discovery cache key, which the effect-gated replay caution now
   depends on: an entry for another profile must not be trusted.
3. **Make one binary honor one convention.** `agent-audit.ts:20` hardcodes
   `~/.claude` and `~/.codex` for its transcript inventory and ignores
   `CLAUDE_CONFIG_DIR`/`CODEX_HOME`, which the guide surface honors, while
   `observer.ts` declares those HOME-relative paths as fact in its privacy
   projection. `CEAL_AGENT_GUIDE_HOSTS` is now the host table with roots and
   overrides; sharing it is the small version. The honest minimum is that the
   declared source and the read path agree.
4. **Make this session's release break unrepeatable.** Two gaps stay open:
   - `ceal.version.v1` is frozen only by a comment and a skip in the predicate
     sweep. A test asserting that document's exact key set would fail loudly, with
     the reason, the moment someone extends it — which is what `0.65.7` did, and
     it broke every installed client's `ceal update`, because the *installed*
     generation's `install-ceal.sh` byte-compared that document. The shipped
     installer now field-checks instead, but the installed base carries the strict
     one for a long time. **Unlock condition to record with the guard**: once no
     supported client predates `0.65.9`, `ceal.version.v1` may carry `ok` like
     every other document.
   - The publish workflow burns a tag on a transient public-readback failure
     (`0.65.8`, HTTP 500 after a successful upload) and cannot be retried, because
     cosign re-signs per run while published objects are create-or-identical.
     Retrying the readback a few times before failing would have saved that tag.
5. **Finish the `#633` probes this host owes**, which need dev (the route exists
   there only): cursor survival across a Gateway restart — the surface itself
   declares `gateway_restart_stable: false` — `message_ref` TTL expiry behavior,
   and a `since`/`until` bounded page. The `offset=1001` classification and the
   opaque-cursor round-trip are already posted to `corca-ai/ceal#633`.
6. **Resolve the cross-repo drift `#4` created**, owner-first per the extraction
   ledger: the legacy compatibility copy of `agent-guide.ts` in `corca-ai/ceal`
   still types `agent` as the literal `"codex"`, and a recorded capability-matrix
   procedure there tells an agent to run `guide register codex` after reading
   `guide status`. Both need the owner change first, then a reviewed sync — not an
   independent edit in the copy.

### Unreleased on `main`, for whichever release ships next

Rebased onto `ceal-v0.65.10`; `npm run check` passes on the result (86/86 on the
release suite). `d65bb1d` is no longer listed here — it shipped in `0.65.10`.

- `a268e8e` (was `a51b002`) — `code` is gone from every error object; `kind` is
  the only error key, and the structural gate bans `code` outright. **Breaking**
  for a reader of `error.code` on `ceal.capabilities.v1` or a rejected
  enrollment; the operator chose no compatibility window over an alias with no
  closing date. The changelog entry still needs writing at release time, and it
  should say that plainly.
- `c5bc9b7` (was `aaccf65`) — `hosts` is the only per-host answer in
  `ceal.guide.v1`; the per-host projection and its `non_claims` sentence are
  gone. **Breaking** for a reader of the top-level per-host fields.

Both are document-shape breaks, and `0.65.10` already broke
`ceal.client_session.v1` in the same week. Whoever ships next should decide
whether they go out together in one announced break or separately.

The release lane: bump the eight version-bearing files the prep commit touches —
`package-lock.json` included, because `npm run check` does not gate the lock but
the tagged workflow's `npm ci --ignore-scripts` does — then `npm ci` →
`npm run check` → commit → push `main` → confirm `origin/main` is that commit →
tag → watch → `ceal update` → readback. Tags `ceal-v0.65.7` and `ceal-v0.65.8`
are burned; do not reuse them.

## Decided

Nothing here is open. Each line is a decision with its reason, so the next
session executes rather than re-litigates.

- **One error key, no alias.** `kind` only; `code` is gone from every error
  object, including `ceal.capabilities.v1` and a rejected enrollment. A
  deprecation window with no recorded closing date is worse than a clean break,
  and the structural gate now bans `code` outright.
- **`hosts` is the only per-host answer** in `ceal.guide.v1`. Top-level `status`
  describes the document (`available`/`unavailable`, agreeing with `ok`), and the
  per-host projection is gone along with the `non_claims` sentence that existed
  to explain which field to trust.
- **`ceal.version.v1` is frozen**, gated on its exact key set. Unlock condition,
  recorded on the gate: once no supported client predates `0.65.9` — whose
  installer field-checks instead of byte-comparing — that document may carry `ok`
  like every other one, and the gate can go.
- **A colon-separated `CLAUDE_CONFIG_DIR` stays refused.** No longer an
  assumption: Claude Code given `CLAUDE_CONFIG_DIR=a:b` finds neither directory's
  state, so joining it would write a skill tree nothing reads.
- **No `Subcommands:` grammar spec.** Every parser is in-repo and the gate derives
  from the declaration table, so a spec would be a second source of truth.
  Revisit only if a consumer appears outside this repo.
- **`client_ref` is operator-named, host- or role-shaped** (`client:narnia`,
  `client:vinc`), not derived. A derived name cannot survive re-enrollment or two
  devices for one subject, and the prod registry already runs on host-shaped
  names.
- **This host stays enrolled against `ceal-prod`.** Prod is where the write
  capabilities and the wider catalog live; dev is where `message.enumerate`
  currently lives, so a dev-only probe re-enrolls deliberately rather than the
  host straddling both.
- **`ok` means "this command answered what it was asked"**, not "the state is
  good", and it agrees with the exit code exactly. That is why
  `session: unconfigured` is `ok: true` while `capabilities` without a session is
  `ok: false` and exits 3.

## References

- [Gateway-side baton (on the Gateway host)](../../ceal/handoff-from-narnia-2026-07-25.md)
- [Issue #1 resolution critique](../charness-artifacts/critique/2026-07-25-issue-1-leaf-help-resolution.md)
- [Release critique: worker 0.65.6 (Claude guide host)](../charness-artifacts/critique/2026-07-25-release-0.65.6-claude-guide-host.md)
- [Session retro: waste and the fixes that landed](../charness-artifacts/retro/2026-07-25-session-retro.md)
