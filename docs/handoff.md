# Session Handoff
Date: 2026-07-25 (guide-host slice landed; release lane next)

Narnia-owned work only (`@corca-ai/ceal`, the `ceal` worker, `skills/ceal-guide`).
Gateway/`cealctl`/protocol work has its own baton on the Gateway host — see
`References`.

## Workflow Trigger

- Mention this file with no other task: invoke `charness:impl` on **Next
  Session** item 1 and stop at its proof gate. Push/tag/CI for that release are
  already operator-approved; nothing else crosses a boundary.

## Current State

- `ceal-v0.65.5` is released, installed here, and proven at runtime: every
  advertised subcommand renders its own four-field leaf help, and a help token
  anywhere in the tail is read-only help (`corca-ai/ceal-cli#1`, CLOSED).
- Route **acceptance** derives from `CEAL_SUBCOMMANDS` / `CEALCTL_SUBCOMMANDS`
  via `splitSubcommandRoute` (`packages/ceal-worker-cli/src/subcommands.ts`), so
  adding a route means adding a table entry, nothing else.
- `npm run check:unit` (~14s) is the iteration gate; `npm run check` (~95s) is
  the final one. `npm run probe -- <binary> <command> …` is the only sanctioned
  way to poke an installed surface: it refuses any route whose declared effect
  is not `read_only` and uses a throwaway `HOME`.
- Guide registration is now host-declared, committed but **unreleased**:
  `CEAL_AGENT_GUIDE_HOSTS` in `agent-guide.ts` carries one row per host (label,
  default root under HOME, env override), `ceal guide register claude` writes
  `<CLAUDE_CONFIG_DIR|~/.claude>/skills/ceal-guide`, and `guide status` keeps its
  top-level fields as the Codex projection while an additive `hosts` list carries
  every advertised host. A non-absolute or colon-list host root is refused, not
  joined. `npm run check` is green; no installed binary carries the route yet.
- This host is enrolled against **`ceal-dev`** while adoption targets
  **`ceal-prod`**, and dev's Slack connector reports `scope_unavailable`, so no
  `ceal call` works: item 3 is blocked on the Gateway host, not here.

## Next Session

1. Release the Claude host route as `0.65.6` by the recorded lane: bump the seven
   version sites the `0.65.5` prep commit touched, add the CHANGELOG entry (the
   route, the `hosts` projection, the refused non-absolute host root, the probe
   guard's new `CLAUDE_CONFIG_DIR`/`XDG_RUNTIME_DIR` pins), `npm run check`,
   push, tag `ceal-v0.65.6`, watch the run, then `ceal update` here and read back
   `ceal guide status` plus one real `ceal guide register claude`. That readback
   is the first proof of the route through a packaged binary: everything so far is
   unit-level filesystem proof plus `npm run probe` on the built entry, where the
   staged guide asset is absent by construction.
2. When the Gateway host restores Slack scope, re-run the two `#633` probes this
   host owes: the `offset=1001` typed-recovery classification, and a full
   `message.enumerate` + opaque-cursor round-trip. Post the readback to
   `corca-ai/ceal#633`.
3. Optional follow-up, out of the guide slice: `agent-audit.ts` still hardcodes
   `~/.claude` and `~/.codex` for its transcript inventory and ignores
   `CLAUDE_CONFIG_DIR`/`CODEX_HOME`, so one binary now honors the overrides in the
   guide surface and not in the audit surface.

## Discuss

- Should this host also enroll a `ceal-prod` client now? Adoption runs on prod,
  prod has `grants: []`, and proving the write path end to end needs a prod
  session here.
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
- [Session retro: waste and the fixes that landed](../charness-artifacts/retro/2026-07-25-session-retro.md)
