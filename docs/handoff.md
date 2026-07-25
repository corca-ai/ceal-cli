# Session Handoff
Date: 2026-07-25 (`ceal-v0.65.6` published; guide registered for Claude Code here)

Narnia-owned work only (`@corca-ai/ceal`, the `ceal` worker, `skills/ceal-guide`).
Gateway/`cealctl`/protocol work has its own baton on the Gateway host — see
`References`.

## Workflow Trigger

- Mention this file with no other task: invoke `charness:impl` on **Next
  Session** item 1 and stop at its proof gate. Nothing in item 1 crosses an
  external boundary; ask before any push, tag, or Gateway write.

## Current State

- `ceal-v0.65.6` is released (run `30160381336`, all four platforms signed, stable
  activated), installed here (`ceal version` → `0.65.6`, linux-amd64), and the
  Claude Code guide host is proven **adopted**, not merely linked: after
  `ceal guide register claude`, a fresh `claude -p` session lists `ceal-guide`
  among its skills. `0.65.5`'s leaf-help work stays proven
  (`corca-ai/ceal-cli#1`, CLOSED).
- Route **acceptance** derives from `CEAL_SUBCOMMANDS` / `CEALCTL_SUBCOMMANDS`
  via `splitSubcommandRoute` (`packages/ceal-worker-cli/src/subcommands.ts`), so
  adding a route means adding a table entry, nothing else.
- `npm run check:unit` (~14s) is the iteration gate; `npm run check` (~95s) is
  the final one. `npm run probe -- <binary> <command> …` is the only sanctioned
  way to poke an installed surface: it refuses any route whose declared effect
  is not `read_only` and uses a throwaway `HOME`.
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

1. Make one binary honor one convention: `agent-audit.ts:20` hardcodes `~/.claude`
   and `~/.codex` for its transcript inventory and ignores
   `CLAUDE_CONFIG_DIR`/`CODEX_HOME`, which the guide surface now honors, while
   `observer.ts` declares those HOME-relative paths as fact in its privacy
   projection. A shared host-root resolver is the small version; the honest
   minimum is that the declared source and the read path agree. Local only until
   the next release, which should also carry `74ca61a`.
2. When the Gateway host restores Slack scope, re-run the two `#633` probes this
   host owes: the `offset=1001` typed-recovery classification, and a full
   `message.enumerate` + opaque-cursor round-trip. Post the readback to
   `corca-ai/ceal#633`.
3. The release lane, for the next cut: bump the eight version-bearing files the
   `0.65.6` prep commit (`4275b4a`) touched — `package-lock.json` included, because
   `npm run check` does not gate the lock but the tagged workflow's
   `npm ci --ignore-scripts` does, and a stale lock burns the tag before any build
   step. Then `npm ci` → `npm run check` → commit → push `main` → confirm
   `origin/main` is that commit → tag → watch → `ceal update` → readback.

## Discuss

- **Parallel session overlap, unresolved.** `~/ceal-cli` on the Gateway host has
  two unpushed commits from another session — `7f36a61 fix(worker): preserve
  invalid argument recovery` and `e5d466e test(worker): cover invalid argument
  recovery` — branched from `933d189`, so their `origin/main` predates the
  `0.65.6` release. They add the `invalid_arguments` entry this host's live probe
  proved missing. Do not reimplement it here; that file is also where
  `ceal-cli#2`'s items 2 and 3 must land, so one session should own
  `call-result-output.ts` at a time.
- A session reaches many **profiles** (`eligible_profiles` + `--profile`) but one
  **instance**: the endpoint path carries the instance and enrollment material is
  minted per instance. Cross-instance access from one session would be a design
  change, not a configuration fix. Worth deciding, since an operator working
  across dev and prod currently re-enrolls to switch.
- Client-device naming for email onboarding: operator-named `client_ref` or
  derived? This host is the first device that would follow the convention.
- `Subcommands:` grammar has no spec while three test parsers and two sha-pinned
  guides read it. Deliberately not done — revisit only if a consumer appears
  outside this repo.
- `ceal.guide.v1` now refuses a `CLAUDE_CONFIG_DIR` containing `:` as "not one
  absolute path". Unverified assumption: that Claude Code does not accept a
  colon-separated config-dir list. If it does, the honest refusal becomes an
  unnecessary one and the route should resolve the list's first entry instead.

## References

- [Gateway-side baton (on the Gateway host)](../../ceal/handoff-from-narnia-2026-07-25.md)
- [Issue #1 resolution critique](../charness-artifacts/critique/2026-07-25-issue-1-leaf-help-resolution.md)
- [Release critique: worker 0.65.6 (Claude guide host)](../charness-artifacts/critique/2026-07-25-release-0.65.6-claude-guide-host.md)
- [Session retro: waste and the fixes that landed](../charness-artifacts/retro/2026-07-25-session-retro.md)
