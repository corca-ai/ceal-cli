# Session Handoff
Date: 2026-07-25

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
- Guide registration knows one agent host: `agent-guide.ts` fixes
  `agent: "codex"` and writes `<CODEX_HOME>/skills/ceal-guide`. Operator
  decision: **adoption includes Claude Code**, implement and release now.
- This host is enrolled against **`ceal-dev`** while adoption targets
  **`ceal-prod`**, and dev's Slack connector reports `scope_unavailable`, so no
  `ceal call` works: item 3 is blocked on the Gateway host, not here.

## Next Session

1. Add `ceal guide register claude` beside `register codex`: a `CEAL_SUBCOMMANDS`
   entry, host resolution in `packages/ceal-worker-cli/src/agent-guide.ts`
   (`~/.claude/skills/ceal-guide`, honoring `CLAUDE_CONFIG_DIR` the way
   `CODEX_HOME` is honored), and `guide status` reporting both hosts without
   breaking `ceal.guide.v1` for a Codex-only reader. Gate with the existing
   per-route four-field and derivation tests.
2. Release it as `0.65.6` by the recorded lane: bump the seven version sites the
   `0.65.5` prep commit touched, add the CHANGELOG entry, `npm run check`, push,
   tag `ceal-v0.65.6`, watch the run, then `ceal update` here and read back
   `ceal guide status`.
3. When the Gateway host restores Slack scope, re-run the two `#633` probes this
   host owes: the `offset=1001` typed-recovery classification, and a full
   `message.enumerate` + opaque-cursor round-trip. Post the readback to
   `corca-ai/ceal#633`.

## Discuss

- Should this host also enroll a `ceal-prod` client now? Adoption runs on prod,
  prod has `grants: []`, and proving the write path end to end needs a prod
  session here.
- Client-device naming for email onboarding: operator-named `client_ref` or
  derived? This host is the first device that would follow the convention.
- `Subcommands:` grammar has no spec while three test parsers and two sha-pinned
  guides read it. Deliberately not done — revisit only if a consumer appears
  outside this repo.

## References

- [Gateway-side baton (on the Gateway host)](../../ceal/handoff-from-narnia-2026-07-25.md)
- [Issue #1 resolution critique](../charness-artifacts/critique/2026-07-25-issue-1-leaf-help-resolution.md)
- [Session retro: waste and the fixes that landed](../charness-artifacts/retro/2026-07-25-session-retro.md)
