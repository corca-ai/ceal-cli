# Gate Details

`AGENTS.md` holds the rules — mostly in `## Gates`, with the probe rule under
`## Boundaries` because a probe is a boundary act before it is a gate. This file
holds the reasons behind them: the things a rule cannot carry without becoming a
paragraph, and that a future session will otherwise re-derive or undo.

## Lint Rules That Are Off On Purpose

`npm run lint` is `biome check .`: lint, format, and import order in one gate. It
is `check` rather than `lint` deliberately, so an unformatted commit fails rather
than merely drifting. `npm run lint:fix` applies every safe fix.

`biome.json` excludes the frozen `packages/ceal-protocol` deliberately. Do not
widen its `includes` to lint code this lane may not edit.

The `check:unit` and `check` gates run only client/worker package tests and the
explicit worker contract/release lists. The root npm workspace names exactly the
protocol, client, and worker packages. The frozen protocol is built only as the
exact local input needed to type-check the client; its unit suite remains
Gateway-owned.

There is no third suite any more. `test:legacy-compatibility` audited the frozen
`cealctl` and dual-release material, and that material was deleted once
`corca-ai/ceal` had moved past the copies kept here — so every test file now
belongs to `test:contract` or `test:release`, and `repo-gates.test.mjs` fails if
one belongs to neither.

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

A rule with no findings does not belong in that list. Enable it instead —
`useBiomeIgnoreFolder` sat in it undocumented while the list said "three", and
its four findings were a fixable preference for `!**/dist` over `!**/dist/**`.
The exclusion syntax moved and the rule is on; the count above is now true.

`noRestrictedGlobals` is on for `**/*.mjs` only, denying `Response`, `Request`,
`Headers`, `ReadableStream`, `WritableStream`, and `TransformStream`.

Read the reason it was added before deciding what to do with it, because that
reason is gone. The Gateway lane used to mirror this source into a harness whose
lint did not know those names, so a bare reference passed here and failed there —
which is exactly what happened: four references in new client tests broke that
lane's gate after it had already consumed the commit. That mirror no longer
exists. `corca-ai/ceal` consumes only packed `.tgz` artifacts under
`vendor/ceal-cli/`, and its own lint ignores `packages/ceal-client/**` outright,
so nothing outside this repository lints these files.

What is left is a local convention, and a weaker claim: `globalThis.Response` is
the more explicit form, and a file that mixes both spellings is drift a reader
notices before a tool does. That is enough to keep a rule that costs nothing, and
not enough to defend it if someone wants it gone. It is no longer true that the
list "grows when the other lane's gate names another global" — there is no other
lane's gate.

It is scoped to `.mjs` deliberately. In TypeScript, `Response` is usually a
*type* annotation rather than a runtime global read, and `globalThis.Response`
is not a substitute there — denying it repo-wide flags four correct type
positions in `ceal-client`.

Formatting-only commits belong in `.git-blame-ignore-revs`, which
`npm run hooks:install` wires into the clone.

## The Release Tier Runs In Parallel, And What Pays For That

`test:release` was pinned to `--test-concurrency=1` from the commit that first
needed it, with no recorded reason. The reason was real but undeclared: the
release fixtures shell out to `npm run build`, which emits into the checked-out
`packages/<name>/dist`, and their `npm pack` reads it back. Two test processes
building there at once can let a third pack a half-written `dist`. Serializing
the whole tier hid that race behind a 74s wall clock.

The pin is gone and the race is closed at its source instead. `dist` now has one
writer: `ensurePackageBuilt` in `test/repo-build.mjs`, an inter-process mutex —
`mkdir` as the atomic test-and-set — plus an in-process memo. A fixture that
needs a current `dist` asks for it there rather than building its own.

Three things keep this honest, and none of them is the tier passing, because a
race that loses is silent:

- `test/contract/repo-build.test.mjs` proves the mutex by running six *concurrent*
  holders and asserting their enter/exit journal never interleaves. Spawn them
  synchronously and the assertion goes vacuous — that is how it was first
  written, and removing the mutex did not turn it red.
- The same file forbids any other fixture under `test/` from invoking
  `npm run build` itself, because a new one that did would reintroduce exactly
  this race and pass its own tests.
- The stale-lock break exists so a process killed while holding the lock costs
  the next run a warning rather than a hang.

Do not re-add `--test-concurrency=1` to buy safety for a new fixture. Give the
shared thing an owner, as `dist` has one.

## The Vendored Protocol Copy Has A Recorded Source

`packages/ceal-protocol` is a frozen copy of a tree `corca-ai/ceal` owns. Its
only correctness claim is "identical to somewhere else", and for most of this
repository's life nothing recorded where that somewhere else was. A green gate
therefore said nothing about it, and in one day the copy cost three separate
sessions: it blocked the announcement-policy renderer, it split what the gate
tests from what a release ships, and a re-pull hours after a sync found it stale
again over a single sentence this client would print verbatim.

One of those three is what this gate addresses, and it is worth being exact
about which: the copy drifting from *its own record*. The copy falling behind the
*owner* is a different failure, and nothing here can see it — that needs the
remote, and this check never reaches one.

`protocol-vendor-pin.json` names three identities and
`scripts/verify-protocol-vendor-pin.mjs` binds them offline, reading local files,
the Git index, and the working tree:

- **source** — the Gateway commit and `packages/ceal-protocol` subtree this copy
  was taken from;
- **vendored** — what `packages/ceal-protocol` hashes to right now;
- **shipped** — the protocol subtree inside the locked handoff archive that
  `gateway-protocol-handoff-lock.json` binds a release to consume.

*source* against *vendored* is the drift check, and it fails on a committed edit
(the recorded tree stops matching `HEAD:packages/ceal-protocol`) and on an
uncommitted one (a committed tree hash cannot see a mid-sync working tree). Both
are real failures, not shape checks: re-sync the copy and update the pin in the
same commit, or the gate is correct to be red.

*source* against *shipped* is the proof/ship divergence, and it is **fatal**. The
Gateway owner ruled it ship-blocking for every worker release, installed-acceptance
packet, and claim that a green protocol test proves shipped worker behavior, so
`assertShippableProtocolVendorPin` fails `proof_shipment_protocol_divergence` and
names both immutable identities. The verdict compares `source.commit` against the
lock's `gateway.commit` — deliberately not the pin's two tree fields, which are
both author-written and would make the verdict a statement about the pin rather
than a check of anything. The residual limit is worth stating plainly:
`source.commit` is itself self-recorded, so this makes divergence *detectable*
without making convergence *observable*.

A divergence is still declarable, and the declaration still has to name its
reason, its disposition owner, and a tracked request under `docs/requests/` — but
a declaration is now a **quarantine, not a clearance**. It records why the state
exists; it does not let anything ship. Plain existence was too weak a check for
the request: every path in the tree satisfied it, so a one-character edit could
keep a dead declaration alive by aiming it at `README.md`.

Development motion survives that: `npm run check:protocol-dev` runs the client
suite plus `verify-protocol-vendor-pin.mjs --development`, which reports the pin
without the shippability assertion and stamps its own output
`proof_level: development_only` with the non-claim spelled out. It is not release
proof and not installed-worker proof, and no release, acceptance, or announcement
path calls it.

The refusal does not depend on which test command ran. `worker-release-inputs.mjs`
asserts shippability inside `resolveWorkerReleaseDevelopmentInputs`, the single
chokepoint every release, packing, and native-artifact path funnels through, and
`worker-acceptance-packet.mjs` asserts it before it resolves the installed binary
— a packet describing a real install is the most convincing possible evidence for
bytes the lock does not bind, so the refusal comes before anything is measured.

That chokepoint is one call, and for a while nothing could tell whether it was
still there. This section used to say the call sites were pinned by source shape
because a converged live pin cannot falsify them behaviourally. That was right
about the *verdict* and wrong about the *call*, and the gap was exploitable:
deleting the single invocation in `resolveWorkerReleaseDevelopmentInputs` — which
disarms release-input resolution, packing, the native build, and the workflow's
own compose step — left every gate green, because the regex still matched the
call inside `assertShippableProtocolVendorPinFor`, the error-translating wrapper
that nothing then called. Reproduced on 2026-08-08.

`worker-release-inputs.test.mjs` now falsifies it behaviourally. A scratch
`repoRoot` reaches the guard and fails for a pin reason; with the call removed the
same input walks past it and fails on the next argument check instead. Two
distinguishable outcomes are all a falsification needs, and it does not need a
genuinely diverged pin — the guard refusing at all is the claim. The divergence
verdicts stay in `protocol-vendor-pin.test.mjs`, which owns them properly.

The source-shape gate in `repo-gates.test.mjs` stays, because it still catches the
easy case in `worker-acceptance-packet.mjs`. Do not treat it as the guard's
protection: it reads text, and text cannot tell a live call from a dead one.

Two things then expire the declaration, and it is worth naming them exactly
rather than saying "its own facts". **Re-sync the vendored copy** and the drift
check fails until the pin moves with it. **Bump `gateway-protocol-handoff-lock.json`** and
`shipped_lock_mismatch` fails, because the declaration was made about a shipped
state that no longer exists. Deleting or untracking the request also fails it.
That expiry is the point — a note in a document has no such property, and this is
the third time a note failed to hold this line.

What does *not* expire it: the archive's protocol bytes converging with the
vendored copy produces no signal by itself. The gate still cannot notice a real
divergence that nobody wrote down — `source.commit` is compared to the lock, but
nothing confirms that `source.commit` is where the bytes actually came from.

A `diverged` pin is not clearance to release, and since the guard became fatal it
cannot be mistaken for one: it fails the gate rather than annotating it.

Be precise about which of the three the gate can actually check. Only
`source.tree` is verified locally, against `HEAD:packages/ceal-protocol`. The
lock supplies `shipped.gateway_commit`, so that one is cross-checked.
`shipped.protocol_tree` used to be unconfirmable here as well; it is not any
more. The protocol-only handoff declares the producer's protocol subtree,
`gateway-protocol-handoff-lock.json` records it, and the gate fails
`shipped_lock_mismatch` when the pin names a different one. That closes the
two-field forgery this document used to list as a known bypass: forging
`source.tree` alone already failed against `HEAD:`, and forging
`shipped.protocol_tree` to agree with it now contradicts the lock.

Be exact about what that is. It is a comparison of two local files, one of which
a maintainer wrote after verifying a signed archive. The gate still reaches no
remote and still opens no tarball, so it cannot tell you the lock itself is
honest — only that the pin does not disagree with it.

`source.commit` remains a **recorded observation no local check can confirm** — a
wrong value there passes the gate. Confirming it needs the owner checkout
(`git rev-parse <commit>:packages/ceal-protocol`), which is a separate act from
running the gate.

The drift check reads the index flags as well as `git status`, and that is not
belt-and-braces. `git update-index --assume-unchanged` (and `--skip-worktree`)
tells Git to stop looking at a file: `git status` then calls an edited frozen
copy clean while `HEAD:` still hashes to the pinned tree, so *both* other checks
pass over a modified copy. `git ls-files -v` still reports the bit — a lowercase
marker for assume-unchanged, `S` for skip-worktree — so the gate fails on the
flag itself rather than on the edit it hides. Setting that bit is a deliberate
act, but the gate has to describe the tree on disk, not the tree Git was told to
pretend it sees.

Nothing here consults the live `corca-ai/ceal` remote.

## Coverage

`npm run coverage` is `c8` over both owned packages, and `test:unit` *is* that
run — not a second pass beside it. It is inside `npm run check` and
`npm run check:unit`, so CI and the pre-push hook both enforce it. It costs about
five seconds.

What took the work was the target, and three of the four ways to get it wrong
produce a number that looks better than the truth.

**It measures `src/**/*.ts`, not `dist/**/*.js`.** The suites exercise compiled
output, so `c8` reads V8 coverage of `dist/` and remaps it through the emitted
source maps. `--src=dist --extension=.js` is what makes that work; the report
then names the TypeScript a maintainer actually edits. Node's own
`--experimental-test-coverage` cannot do this — `--test-coverage-include='src/**'`
matches nothing after the include filter runs on pre-remap paths, and reports
`100.00 | 100.00 | 100.00` over an empty set. A vacuous perfect score is the
worst of the failure modes, because nothing about it looks wrong.

**`all: true` is load-bearing.** Without it `c8` reports only modules some test
loaded, so an entirely untested module is invisible rather than zero, and the
average silently rises. `cli-runtime.ts` is the proof it works: it is the one
source file the report does not name, because it is type-only and compiles to
`export {};`. It is excluded deliberately, and the count is checked — 26 reported
files against 27 in `src/`.

**Two exclusions, both by name and both with a reason.** `**/generated/**` is
build output whose coverage says nothing about whether anything was proven, and
`**/cli-runtime.*` emits no executable code at all. Nothing is excluded by broad
pattern, so an exclusion that stops being true is visible in review.

**The floors come from measurement.** Measured on 2026-08-08: the worker at
93.86% statements / 83.92% branches / 92.73% functions, the client at
99.00 / 90.58 / 100.00. The floors in each `.c8rc.json` sit just under. The
portable default of 80% would have been cleared by every ratio in both packages
by ten to twenty points, which is a floor that can never fail and therefore never
says anything. `check-coverage: true` is what makes a breach an exit code rather
than a printed number, and `repo-gates.test.mjs` asserts all three of those
properties — the floor, `all`, and `check-coverage` — so the gate cannot be
quietly softened into a report.

Raise a floor after real improvement lands. Do not lower one to make a red gate
green; the branch ratios are the ones with room, and `acceptance-record.ts` at
55% branch and `bin.ts` at 50% are where to start.

## Two Gates That Live In The Hook

`npm run check` runs on GitHub runners that have neither `nose` nor the charness
quality skill, and an ARM macOS runner does not ship `shellcheck` either. Two
gates therefore run from `.githooks/pre-push` instead:

- `npm run check:duplication` arms the boy-scout duplicate ratchet. A NEW fixable
  clone family blocks the push; the reviewed ceiling nudges down over time. The
  accepted baseline and the reviewed overlay are tracked under
  `charness-artifacts/quality/` rather than gitignored `.charness/`, because the
  boy-scout arm measures stagnation from the commit that last touched the
  overlay — an untracked overlay has no anchor. `scripts/check-dup-ratchet.mjs`
  is the repo-owned front door: it resolves the skill rather than hardcoding one
  maintainer's home directory, and `CEAL_SKIP_DUP_RATCHET=1` bypasses it.
- `npm run lint:shell` runs `shellcheck -s sh --severity=warning` over
  `install-ceal.sh` and the hook. The info tier is dropped deliberately: every
  info hit in the installer is intentional idiom — `set -- $version` under
  `IFS=.` is the semver parse, and `[ -d "$x" ] && [ ! -L "$x" ] || fail` is a
  guard whose "C may run when A is true" note describes its purpose. Nine
  directives in a signed installer to silence style notes on correct code is a
  worse trade than one severity flag. The warning tier still fires, and it is
  what found a variable the installer had been assigning to nothing.

Both skip loudly rather than failing when their tool is absent. A gate that
no-ops silently while counted as part of the gate is the failure being avoided;
saying "skipped, and here is what went unchecked" is not.

## Probing An Installed Surface

`npm run probe -- <binary> <command> [route/options]` is the only sanctioned way
to poke an installed binary. It refuses any route whose declared effect is not
`read_only`, and it runs under a throwaway `HOME`.

The one exception: a `--help`/`-h` token anywhere in the tail bypasses the effect
check, because a help token makes the invocation read-only help regardless of
what the route would otherwise do. That bypass is proven for `ceal`, the only
binary this repository builds.

A live readback against the real session is a different act from a probe. Read
the declared effect before typing the route, and never batch a state change into
a list of checks.

## Routes And Dispatch Derive From One Table

Route *acceptance* and leaf help derive from one declaration table:
`CEAL_SUBCOMMANDS` in `packages/ceal-worker-cli/src/subcommands.ts`.

Worker *dispatch* derives from the same table. Each runner reads a
`CealSubcommandHandlers<parent, …>` table keyed by the declared route joined with
spaces (`register codex`). That `Record` over a literal key union is total, so a
row added to `CEAL_SUBCOMMANDS` without a handler fails `tsc` — inside
`npm run build:worker`, inside both gates. A worker route still needs its table entry
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

`cealctl` had the same fallthrough shape and none of this covered it. Its source
now lives only in `corca-ai/ceal`, so it is that repository's to fix, not a
request this lane files against a copy it holds.
