# Gate Details

`AGENTS.md ## Gates` holds the rules. This file holds the reasons behind them —
the things a rule cannot carry without becoming a paragraph, and that a future
session will otherwise re-derive or undo.

## Lint Rules That Are Off On Purpose

`npm run lint` is `biome check .`: lint, format, and import order in one gate. It
is `check` rather than `lint` deliberately, so an unformatted commit fails rather
than merely drifting. `npm run lint:fix` applies every safe fix.

`biome.json` excludes the frozen packages deliberately. Do not widen its
`includes` to lint code this lane may not edit.

`lineWidth` is 140 with tabs. That is this tree's existing shape, not a new house
style being introduced.

Three rules are disabled for reasons JSON cannot carry. Check here before
re-enabling one:

- `noNonNullAssertion` — `options[index]!` after an explicit bounds check is the
  idiom throughout this tree.
- `useTemplate` — every hit is `.join("\n") + "\n"`, which a template literal
  makes worse, not better.
- `noTemplateCurlyInString` — every hit is `${...}` inside a *shell* script
  string, where it is the shell's own syntax and not a JS template.

A rule with no findings does not belong in that list. Enable it instead.

Formatting-only commits belong in `.git-blame-ignore-revs`, which
`npm run hooks:install` wires into the clone.

## Probing An Installed Surface

`npm run probe -- <binary> <command> [route/options]` is the only sanctioned way
to poke an installed binary. It refuses any route whose declared effect is not
`read_only`, and it runs under a throwaway `HOME`.

The one exception: a `--help`/`-h` token anywhere in the tail bypasses the effect
check, because a help token makes the invocation read-only help regardless of
what the route would otherwise do. That bypass is proven for `ceal` only — do not
lean on it for `cealctl`.

A live readback against the real session is a different act from a probe. Read
the declared effect before typing the route, and never batch a state change into
a list of checks.

## Routes And Dispatch Derive From One Table

Route *acceptance* and leaf help derive from a declaration table:
`CEAL_SUBCOMMANDS` in `packages/ceal-worker-cli/src/subcommands.ts`, and
`CEALCTL_SUBCOMMANDS` in `packages/ceal-operator-cli/src/index.ts` — a frozen
package, so a `cealctl` route is not an edit this lane originates.

Worker *dispatch* derives from the same table. Each runner reads a
`CealSubcommandHandlers<parent, …>` table keyed by the declared route joined with
spaces (`register codex`). That `Record` over a literal key union is total, so a
row added to `CEAL_SUBCOMMANDS` without a handler fails `tsc` — inside
`npm run build`, inside both gates. A worker route still needs its table entry
*and* its handler; what changed is that forgetting the handler is now a build
failure naming the route rather than a misroute in the shipped binary.

This replaced a fallthrough. Runners branched on one token and fell through, so
`runSession` sent every non-`logout` session route to enrollment and `runGuide`
sent every non-`register` guide route to status. Do not reintroduce a fallthrough
`else`: dispatch on the route key and let the missing case be a type error.

Two constraints keep that gate real:

- The type gate holds only while the table keeps `as const satisfies`, because
  the keys are read off *literal* route tuples. A row written
  `route: ["x"] as string[]` contributes no key, demands no handler, and
  compiles. `dispatchedRouteKeys()` plus its `cli.test.mjs` gate is what catches
  that, so the two are a pair — do not remove either as redundant.
- Route-dependent behaviour belongs in the handler table too, not in a `boolean`
  beside it. `capabilities` kept its refusal label and option sets on a `targets`
  flag meaning "some route matched", which is the same fallthrough in the one
  place `tsc` is blind.

`cealctl` dispatch still falls through this way (`CEALCTL_SUBCOMMANDS`, frozen),
so none of this covers it. That is a request to `corca-ai/ceal`, not an edit this
lane originates.
