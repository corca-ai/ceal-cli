# Gate Details

`AGENTS.md` holds the rules — mostly in `## Gates`, with the probe rule under
`## Boundaries` because a probe is a boundary act before it is a gate. This file
holds the reasons behind them: the things a rule cannot carry without becoming a
paragraph, and that a future session will otherwise re-derive or undo.

## Lint Rules That Are Off On Purpose

`npm run lint` is `biome check .`: lint, format, and import order in one gate. It
is `check` rather than `lint` deliberately, so an unformatted commit fails rather
than merely drifting. `npm run lint:fix` applies every safe fix.

`npm run lint:types` is the terminating source-only TypeScript gate. It runs the
explicit package-source owner (`lint:types:packages`) and the strict tools owner
(`lint:types:tools`). The package NodeNext program covers every tracked
`packages/*/src/**/*.ts` file and maps workspace package names to their editable
source entrypoints, so it does not need checkout `dist` or invoke
`test/repo-build.mjs`. The tools program covers tracked `scripts/**/*.ts` and
`test/**/*.ts`, allows exact `.ts` imports under NodeNext, and uses a dedicated
incremental cache. `lint:types:watch` watches package sources and
`lint:types:tools:watch` watches tools; they are intentionally separate watchers,
each with its own `node_modules/.cache` build-info path.

`npm run lint:no-legacy-mjs` is an exact-list ratchet over tracked and staged
`.mjs` paths. Its policy is `config/no-legacy-mjs.json`; regenerate it only
intentionally with `npm run write:no-legacy-mjs-baseline`, then review the full
list. Both `check:unit` and `check` run the ratchet before slower gates, so a
new or removed legacy file fails without rebuilding or running a suite twice.
The inventory observes tracked files and staged additions; an untracked or
unstaged new `.mjs` is not part of the checked state until it is staged or
tracked, while staged additions are already included by the tracked index
query.

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

The signed Gateway Protocol source materializer is an explicit operator entry:
`npm run materialize:gateway-protocol-source -- <tag> <commit> <protocol-tree> <output-directory>`.
Declaring it in the root manifest keeps production reachability honest; a
test-only import is not evidence that an operator path can reach the command.

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

### Source-authoritative behavior and isolated package artifacts

Protocol, client, and Worker behavior tests execute `src/**/*.ts` through
`test/source-loader.mjs`.
The loader owns both direct workspace paths and bare workspace package names;
it redirects either form to the editable TypeScript source and refuses a
workspace `dist` resolution that has no source authority. `test/run-source-tests.mjs`
also installs that loader through `NODE_OPTIONS`, so Worker CLI subprocesses
inherit the same authority instead of silently returning to checkout `dist`.
The client and Worker `test` and `coverage` scripts therefore have no build
lifecycle hook: a targeted behavior test observes current source or fails
closed, never succeeds against a previous checkout build.

That no-build source feedback is distinct from the root contract gate. The
public `npm run test:contract` entry builds once, then delegates to
`test:contract:built`, whose explicit source/artifact-delimited inventory runs
against the emitted checkout surfaces. `npm run check:unit` already owns one
build for its unit lane and calls `test:contract:built` directly, so it does not
pay for a second build. A green contract lane is local emitted-surface proof;
it is not installed-worker, release, or live-serving proof.

Emitted declarations, package exports, and executable JavaScript are a
different proof purpose. `test/client-artifact.test.mjs` asks
`test/artifact-workspace.mjs` to copy only source/config/manifest inputs into a
fresh temporary workspace, emit Protocol, client, and Worker packages there,
and load their exact public exports and Worker executable against those
temporary dependencies. The proof binds source and artifact digests and
fingerprints checkout `dist` across the build; the artifact build neither
consumes nor changes checkout `dist`.

Release package fixtures and the explicit root build still use the shared
checkout-dist owner described below. They are the remaining migration scope;
package behavior tests no longer enter that owner.

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

The same owner still serves the root build and release fixtures. The root
coverage command suppresses package lifecycle hooks after `build:worker` has
produced all three workspace trees, while standalone behavior coverage needs no
checkout build at all. The owner
passes an incremental build-info path under `node_modules/.cache` to each
package's existing build command; it removes that record when `dist` is absent,
so a clean cannot turn a stale compiler record into a missing release tree.
`prepack` remains an independent clean build.

Three things keep this honest, and none of them is the tier passing, because a
race that loses is silent:

- `test/contract/repo-build.test.mjs` proves the mutex by running six *concurrent*
  holders and asserting their enter/exit journal never interleaves. Spawn them
  synchronously and the assertion goes vacuous — that is how it was first
  written, and removing the mutex did not turn it red.
- The same file forbids any other fixture under `test/` from invoking
  `npm run build` itself, because a new one that did would reintroduce exactly
  this race and pass its own tests.
- `repo-gates.test.mjs` binds the root build and coverage routes, while
  `repo-build.test.mjs` proves standalone package behavior tests have no
  checkout-dist hooks. Keeping those assertions at both consumer boundaries
  prevents a behavior lane from silently reacquiring artifact authority.
- The stale-lock break exists so a process killed while holding the lock costs
  the next run a warning rather than a hang.

Do not re-add `--test-concurrency=1` to buy safety for a new fixture. Give the
shared thing an owner, as `dist` has one.

The release-process bounds and supervisor helpers are source-backed test
infrastructure. `test/release-process-bounds.ts` imports the editable
`packages/ceal-worker-cli/src/bounded-process.ts`, and its supervisor invokes
that same source module; these tests therefore provide fresh source feedback,
not direct proof of an emitted `dist/bounded-process.js`. Emitted/package proof
lives in `test/client-artifact.test.mjs` and the release package/native suites
(`test/worker-release-package.test.mjs`, `test/worker-native-artifact.test.mjs`)
through their isolated build and artifact checks. On Darwin, platform-gated
Linux-only checks report their unproved Linux scope; a green Darwin release run
does not claim that the Linux executable lane was exercised.

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

The frozen package suite is part of `test:contract`. One owner test imports
`scripts/test-support/base64url.mjs`, which sits outside the pinned package
subtree in the Gateway repository. This repository copies that test-only helper
at the same path; `protocol-vendor-pin.json` records its owner blob and
`protocol-vendor-pin.test.mjs` hashes the local file against it. The helper is
not production or release input, but leaving it unbound would make the exact
frozen suite silently depend on a second freehand implementation.

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
reason, its disposition owner, and the tracked `docs/protocol-quarantine.md`
record — but
a declaration is now a **quarantine, not a clearance**. It records why the state
exists; it does not let anything ship. Plain existence was too weak a check for
the request: every path in the tree satisfied it, so a one-character edit could
keep a dead declaration alive by aiming it at `README.md`.

Development motion survives in two scopes. `npm run check:unit` remains the
ordinary iteration gate: contract behavior that must reach past the ship guard
runs against one shared scratch Git repository whose vendored tree, pin, and
lock are genuinely converged. Separate guard-reachability tests prove the
release-input chokepoint fails on a pin error before inspecting arguments and
acceptance fails on an exact divergent fixture before resolving an installed
binary. This keeps downstream contract branches observable without adding a
production bypass or claiming that the live checkout is shippable.

`npm run check:protocol-dev` is the narrower Protocol/client path. It runs the
client suite plus `verify-protocol-vendor-pin.mjs --development`, which reports
the live pin without the shippability assertion and stamps its own output
`proof_level: development_only` with the non-claim spelled out. Neither
development command is release or installed-worker proof, and no release,
acceptance, or announcement path calls the development verifier. The full gate
still reaches the release tier, whose live-checkout positives remain red until
the pin and shipment lock converge.

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
same input walks past it and fails on the next argument check instead. The
acceptance suite has the sibling proof: its deliberately divergent scratch pin
must fail before an absent binary is resolved. Two distinguishable outcomes are
all a falsification needs. The divergence verdicts stay in
`protocol-vendor-pin.test.mjs`, which owns them properly, while the shared
converged fixture owns the repeated contract setup.

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

**The floors come from measurement, and the measurement is a command, not a
figure quoted here.** Run `npm run test:unit` and read the two package reports;
the floor in each `.c8rc.json` sits just under what its package measures. Those
files are the only place the numbers live.

Each ratio is declared rather than left to c8, because c8's defaults are not one
uniform safe number: three of the four default to a floor that can never fail and
one defaults above what parts of this repository measure. Check the installed
tool rather than a copy of its defaults —
`rg -n "option\('(branches|functions|lines|statements)'" -A 2
node_modules/c8/lib/parse-args.js`. This paragraph used to state a single
"portable default of 80%", which is not what c8 does; a number in prose is wrong
the moment nobody can re-derive it.

`check-coverage: true` is what makes a breach an exit code rather than a printed
number, and `repo-gates.test.mjs` asserts the properties — that each floor is
declared, plus `all` and `check-coverage` — so the gate cannot be quietly
softened into a report. It asserts the floors are *present*, not what they equal:
a test holding a second copy of the numbers cannot tell a right floor from a
wrong one, because it has no measurement either, and the copy going stale
reports as a coverage collapse rather than as the stale copy it is.

Raise a floor after real improvement lands. Do not lower one to make a red gate
green; the branch ratios are the ones with room, and `acceptance-record.ts` at
55% branch and `bin.ts` at 50% are where to start.

## The Third Target: `scripts/`

The two packages above are the code the worker ships. `scripts/` is the code that
*releases* it — about 4.9k lines of guards, composers and verifiers — and until
2026-08-08 none of it was measured. That is what made the reachability audit a
hand-grep: a guard nothing calls and a guard everything calls looked identical.
Now the first reads as `0` on every run.

`npm run coverage:scripts` is the front door and `.c8rc.scripts.json` the config.
The three properties that carry the other two targets carry this one — `all`, the
floor, and `check-coverage` — and `repo-gates.test.mjs` asserts each, plus the
`include`/`src`/`extension` scoping and the single named exclusion.

**It needs both tiers, so it belongs to `npm run check` and not to
`check:unit`.** The contract tier alone reaches about 55%; the release tier is
where the composers and native-artifact paths actually run.

**Why a runner script rather than a `c8` prefix in the npm script.** Two reasons,
and the first is the load-bearing one. A floor only holds against the proof set
it was measured on. `platformProofSkip` decides from `process.platform` and
`process.arch` alone (`test/platform-proof.ts:16-17`), so the macOS leg of
`check.yml` skips the installed-binary and installer proofs whatever
`CEAL_REQUIRE_PLATFORM_PROOFS` is set to — that variable turns an
already-decided skip into a failure, it does not cause one. The scripts those
proofs reach therefore report lower on macOS through nobody's defect, and a flat
floor would fail that leg for skipping what it is right to skip, which is the
shape that burned `ceal-v0.67.0`. So macOS runs the tiers plainly and prints the
measurement it is not carrying. The second reason is mechanical: `test:contract`
and `test:release` must keep starting with `node --test` because
`repo-gates.test.mjs` reads their file inventories, so the wrapper cannot sit in
front of them.

The pre-push hook admits only one gate per repository at a time. Build output,
raw V8 profiles, and coverage reports are checkout-wide mutable state; two hooks
cannot prove them independently. A second hook exits before spawning `npm` and
names the recorded owner PID when its owner record is already published,
instructing the caller to wait for the original push. Remote-ref absence while
the first hook runs is expected because Git updates the remote only after the
hook succeeds; it never authorizes a retry.

**The floor alone cannot tell a pass from an empty measurement, so the runner
also checks the inventory.** `c8` exits 0 when its file set is empty — verified,
not assumed: point `include` at a glob matching nothing and it prints
`All files | 0 | 0 | 0 | 0` and passes, because istanbul computes those ratios
from 0/0 totals and never compares them to a threshold. A rename, a `src` typo or
a changed cwd would therefore leave this gate green while measuring nothing, and
the printed report would not look wrong — the exact failure the `src`/`dist`
remap notes above call the worst of them. After a passing measured run the runner
reads `coverage/scripts/coverage-summary.json` and fails unless it names every
`.mjs` the config claims. `repo-gates.test.mjs` asserts that check is both
declared and called.

**Where the floor applies.** It is enforced on `linux-arm64` and `linux-x64`.
arm64 is there because it is the maintainer host, and a gate no maintainer can
run before pushing is one CI discovers for them; x64 is there because it carries
every platform proof, and `repo-gates.test.mjs` asserts `PLATFORM_PROOF_PLATFORM`
stays in that list. The floor is the lower reading of the two, and it lives in
`.c8rc.scripts.json` alone — `npm run coverage:scripts` on each is how to move
it.

**The extrapolation that used to be here was wrong in sign, which is why both
are measured.** The floor began as an arm64 measurement applied to x64 on the
argument that x64 runs strictly more proofs and so must measure at or above: the
arm64 run skips proofs that only *add* coverage there, and the whole
arch-conditional surface under `scripts/` is one ternary at
`build-worker-native-artifact.mjs:372` whose covered and uncovered branch counts
are symmetric. Measuring x64 (run `31263490521`) gave the same figures on three
ratios and a *lower* branch ratio than arm64. The floor held because it sat
under, not because the reasoning was right. Re-measure both before moving it;
do not re-derive one from the other.

**What the report already says, and one thing it does not.** `lint-shell.mjs` at
0% is honest — it runs from `.githooks/pre-push`, which `npm run check` does not
invoke. `check-dup-ratchet.mjs` is hook-only in the same way and yet reads about
49%, because `repo-gates.test.mjs:730` runs the hook itself; hook-only does not
imply zero here. And `install-git-hooks.mjs` at 0% is not a reachability finding
at all: `repo-gates.test.mjs` runs it, but against a throwaway clone, so the
coverage lands under a temp path that remaps to nothing. A zero is therefore a
question, not a verdict — the reachability claim needs the same positive control
any absence claim needs.

**The cost is real, it is on `npm run check` only, and it is mostly
irreducible.** Timed on the maintainer host: both tiers plain about 1m11s, under
`c8` about 1m54s. `check:unit` is unchanged.

The obvious lever was tried and mostly failed, which is the useful part. The
overhead is `NODE_V8_COVERAGE` inherited by every process the tiers touch, and
the four slowest release proofs — which spawn `npm`, `tsc` and the SEA tooling,
none of which can contribute `scripts/` coverage — accounted for about 75s of it
by per-test timing. Clearing the variable at
`verify-gateway-protocol-consumer.mjs`'s `run()` helper, the single largest of
those, recovered **about 9 seconds of 52** on the tiers alone and cost no
coverage (that file went 82.20% to 82.59%, from the added comment; nothing else
moved). On the full gate it does not surface at all: three timed runs gave
2m33s, 2m36s and 2m33s, the last of them with the change in. So the cost is not
concentrated in the spawned tooling after all: most of it is V8 collecting
coverage in the test processes themselves, which is the measurement, not waste.
Chasing the remaining spawn sites is not worth the production edits — the
per-test timings say where the time went, and they were misleading about why.

What is left to trade is structural, not incidental: measuring only the contract
tier would be nearly free and would put the floor at about 55%.

The run also writes about 100MB of raw profiles; the runner deletes that temp
directory after a passing run and keeps it after a failing one, where it is the
only way to re-report without paying for the tiers again.

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

## The Docs Graph Gate, And Why It Is Standalone

`npm run lint:docs-graph` runs the repo-owned TypeScript wrapper around
`awiki lint -root docs`. Its graph verdict fails on two things:
a doc no resolved link reaches (orphan), a cluster of docs that link only to
each other (island). A line holding nothing but a link is reported separately
as a style finding because it gives an `rg` hit no local context; it does not
override a connected graph. The `-root docs` scope is deliberate — `charness-artifacts/`
is session evidence, not a wiki, and its records are reached from these docs
rather than from each other.

It is neither in `npm run check` nor in the hook. `awiki` is a `cargo`-installed
binary that GitHub runners do not have, which is the same reason `lint:shell`
and the duplicate ratchet stay out of `check`; unlike those two it has no
loud-skip wrapper, so putting it in the hook would fail a push on a machine that
simply never installed it. A maintainer runs it after editing `docs/`. The
wrapper fails closed when the binary or summary is missing, and reports the
exact pinned bootstrap command:
`cargo install --git https://github.com/corca-ai/awiki --rev
f65f8c43dbf0300609bdfdf823c09cba370222c6 --locked awiki`. A non-zero `awiki`
status is accepted only when it is awiki's documented lint-finding status, the
parsed graph is connected, and link-only style findings remain; fatal, signaled,
or contradictory subprocess results fail closed.

## `knip`, And What Its Zero Means

`npm run lint:unused` is `knip`, configured by `knip.json`, and it runs inside
both `npm run check` and `npm run check:unit` — about 2s. It reports nothing
today, which is worth only as much as the config below is honest, so each entry
earns its place:

- `entry` names `src/bin.ts` alongside `src/index.ts` in the worker package. The
  manifest's `bin` field points at `dist/bin.js`, not at the source `knip` reads,
  so without the entry it calls the whole SEA graph dead — 7 unused files
  including `bin.ts` itself and both leased-consumer modules. Drop the line and
  re-run to see it.
- `entry` also names the narrow `src/acceptance-receipt.ts`. The checkout
  acceptance emitter imports that module's compiled `dist` form so it can share
  the installed emitter's receipt keys and projection. `knip` cannot map that
  compiled import back to TypeScript source; keeping this entry narrow avoids
  exempting the rest of the acceptance-record implementation.
- `ignoreDependencies` carries `postject`, which the native build reaches through
  `require.resolve` rather than an import.
- `ignoreBinaries` carries `nose` and `shellcheck`. Both are real dependencies of
  the two hook-local gates above and both are deliberately undeclared — they are
  maintainer-local tools that stand aside on a host without them, so a manifest
  entry would claim an install this repository does not require.
  It also carries `mkfifo`, which is POSIX coreutils rather than an install: the
  FD5 descriptor-kind test needs a real named FIFO, and Node cannot make one. The
  test asks the predicate about real descriptors instead of a stubbed `fstatSync`
  because the defect it pins was an assumption about what a child-stdio `pipe`
  is — a faked stat would have agreed with the wrong assumption.
  `cosign` and `openssl` are explicit release-maintainer tools used only by the
  public Gateway handoff bootstrap: Cosign verifies the keyless signature and
  OpenSSL reads the signed Actions run identity from its certificate. They are
  not package runtime dependencies, and the bootstrap fails closed when either
  executable is absent.
- `ignoreWorkspaces` carries `packages/ceal-protocol` for the same reason `biome`
  excludes it: it is a frozen vendored copy, and a finding there is one no agent
  may act on.

The findings it started with were 21, and reading them is what the tool is worth.
`knip` reports a surplus `export` *modifier*, not unreachable code: suites import
`dist/`, so a test reference never counts as a consumer of `src/`. Fifteen of the
21 were live production code used inside their own file, so the whole list read
as a delete-list would have deleted working code. What closed them:

- **Seven had no consumer at all.** The `export` came off; the declarations stay.
- **Eleven exist for the suites.** They carry `@testOnly`, which `knip.json`'s
  `tags` entry reads. The exception belongs at the declaration, where its reason
  already was, not in a config allowlist a reader has to correlate.
- **One was deleted and two were wired into production paths.**
  [release-guard-reachability.md](release-guard-reachability.md) records those
  three, because two of them were live defects rather than tidiness.

`@testOnly` is a claim the tool obeys, so it is checked: `repo-gates.test.mjs`
fails when a tagged export is reached by no suite. Without that, tagging a symbol
nothing uses silences `knip` exactly as well as tagging one a suite needs.

The reachability blind spot survives all of this and is why the zero is not the
audit. `knip` reports nothing under `scripts/`, and two separate mechanisms
produce that silence — both checked with a planted export:

- The 20 top-level `scripts/*.mjs` are declared `entry`, and `knip` does not
  report exports in an entry file. A planted export in
  `scripts/worker-release-inputs.mjs` goes unreported.
- Under `scripts/lib/`, which is not entry, an export *is* reported — until a
  test imports it, which every one of them does. Those suites import
  `scripts/*.mjs` directly rather than a built copy, so unlike the TypeScript
  packages there is no compile step separating a test consumer from a production
  one.

Either mechanism alone would have hidden both guards slice 2 deleted by hand.


## Production Reachability Under `scripts/`

`npm run lint:reachability` answers the question the section above ends on, and
runs in both gates. `scripts/lib/production-reachability.mjs` walks the
production graph and nothing else: entries are the `node scripts/*.mjs`
invocations the manifest, the lanes, and the hook declare; edges are static
relative imports; a release lane's inline `node --input-type=module` step is a
caller. Suites are not in the graph, which is the entire mechanism — a guard only
its own test calls is the defect.

It reports a module no entry reaches, and an export no production path reaches
that its own module never calls either. That second condition is deliberate:
without it every surplus `export` modifier would land here, which is `knip`'s
question and would bury this one.

The export verdict is deliberately limited to `scripts/`, the surface this gate
owns. The graph may traverse a script's relative import into a package artifact,
but package exports belong to the isolated emitted-ABI lane above; judging them
here would make a script-wiring gate depend on whichever checkout `dist` another
process last produced.

Traversal is source-authoritative for those checkout package edges. An import
spelled as `packages/<workspace>/dist/*.js` is mapped to its current
`src/*.ts` owner, and source-local `.js` specifiers follow the same rule. A
missing owner is a refusal, never a fallback to mutable compiled output. This
keeps `lint:reachability` valid before `build` in a clean checkout; immutable
artifact tests remain the only lane that treats emitted package bytes as
authority.

Three properties are worth keeping when this is edited:

- **It is parsed, not matched.** A regex that quietly stops matching leaves a
  gate green while claiming to have walked the tree. The one regex that remains
  locates an inline workflow *script*; its imports are then parsed. The first
  version spanned from one `import` to a later `from`, read two adjacent
  statements as one, and attributed the wrong symbol.
- **A dynamic `import()` is not an edge.** It cannot be resolved without running
  the program, and treating an unresolvable specifier as an edge widens the graph
  until nothing can be unreachable.
- **`@testOnly` exempts, and the exemption is checked.** `repo-gates.test.mjs`
  fails when a tagged export is reached by no suite, in `scripts/` and in the
  packages alike.

The suite proves it on fixtures whose answer is known before it runs, and then on
the real thing: it reconstructs `0cce9f9^` with `git archive` and requires the
analyzer to name both guards slice 2 deleted by hand. On a clone without that
commit it skips and says so rather than passing.

## The Two Checks That Arm `One Fact, One Home`

`AGENTS.md` `## One Fact, One Home` states a law that, until 2026-08-09, no gate
could see. Every gate here is a graph walk over *symbols* — `tsc` following
`CEAL_SUBCOMMANDS` from route to dispatch, `knip` and `lint:reachability`
walking the import graph, `check:duplication` walking token blocks — so the law
was enforced exactly where the fact had already been made a symbol with an edge,
and nowhere else. Every survivor of every sweep in that range lived in the
complement of that set. These two checks read the complement. Both run in
`npm run check` and `npm run check:unit`, and
`test/contract/one-fact-one-home.test.mjs` proves each on fixtures whose answer
is known before it runs.

### `lint:store-lock` — enumerate a resource's writers

`scripts/check-store-lock-census.mjs` reports every writer that reaches a
lock-guarded local store without the module's lock. The rule is narrow on
purpose: it says nothing about whether a module *should* own a lock, only that
inside a module which has already declared one by calling a `with…Lock` helper,
every writer is under it or carries `@lockFree` with a reason at the
declaration.

It exists because of a measurement rather than a theory, and the measurement is
re-runnable: extract the release baseline (`git archive ceal-v0.75.0`) and point
the analyzer at it. It reports two writers in `receipt-spool.ts`. One is the
defect a sweep found by hand a day later; the other is the writer that sweep's
own fix left outside the lock it introduced. Neither was visible to any gate,
because a reviewer is handed one site and its named sibling and never an
enumerated population. That is the whole query.

`@lockFree` is a claim at the declaration, echoed in the check's own output so
the exemption is visible on every run rather than only in a diff. What it cannot
see is stated rather than glossed: only top-level `function` declarations, and
no cross-module caller — a mutator exported and called unguarded from another
file is missed. The census line naming which modules own a lock is the
protection against the worse failure, a lock helper renamed out of the shape and
the whole check silently reporting zero over nothing.

That protection has a bound worth naming, because the fresh-eye review named it.
`test/contract/one-fact-one-home.test.mjs` pins `receipt-spool.ts` and
`profile-store.ts` into the has-a-lock set *by name*, so renaming either store's
real primitive goes red. A **third** store introduced later with a misnamed
wrapper from day one has no such pin and would be skipped in silence. Add its
name to that test when you add the store; the census output is where you would
notice, and only if you read it.

### `lint:duplicate-literal` — one grammar, one home

`scripts/check-duplicate-literal.mjs` reports every non-trivial regex literal
spelled in two or more owned modules. `check:duplication` cannot answer this and
it is worth being exact about why, because for a day a review file said the
opposite: that ratchet's unit is a repeated *block*, so it read the
`typeof value === "string" && REGEX.test(value)` predicate as one clone family
and `charness-artifacts/quality/dup-review.json` accepted it with the reason
"each site tests a different regex against a different domain". Six of those
regexes were byte-identical. A block-level detector cannot see inside the block,
so the reviewed note ratified the duplicate it was dismissing — which is the
failure `AGENTS.md` names, a claim in prose that no gate checks.

The unit is therefore the literal. The triviality floor lives in
`scripts/lib/duplicate-literal.mjs` as the single home for that number and was
measured rather than chosen: below it the population is language idiom, above it
every group is a grammar with a domain. Restricting it to regex literals was
also measured — extending the same walk to strings and numbers takes the report
from a handful of groups to well over a hundred error codes, import specifiers
and unit conversions, and a check that fires that often is off within a week.

Two escape hatches exist and they are deliberately not one, because they name
different things:

- **`@separateGrammar`**, an inline tag, is for two facts that coincide. A
  Gateway reason code and a CLI operand key are both lowercase-snake and merging
  them would be wrong. Every site in a group must carry it; tagging one member
  of a six-file group would otherwise silence the other five. It covers the
  statement it sits above and nothing else — the first version walked every
  ancestor, so a tag justifying one literal exempted an unrelated literal in the
  same function, which is a mute button with a reason attached.
- **The exemption table** is for one fact whose single home a boundary forbids.
  Today that is the refresh-token grammar: `packages/ceal-protocol` owns it and
  is frozen, and the client SDK ships standalone and may not import the worker.

Neither is a mute button, and the table only stopped being one under
falsification. Keyed by literal alone it exempted a *third* copy silently — the
entry said "this pattern may repeat" rather than "these two sites hold it". An
entry now pins its exact file set, a copy anywhere else is a finding, and an
entry whose literal has stopped being duplicated fails on its own.

The blind spot is worth stating because it is the inverse of the check's own
purpose: it matches literal text exactly, so it sees the duplication and not the
drift that follows. Edit one of two copies and the group disappears. That is why
the second homes are additionally bound by assertion in
`test/contract/one-fact-one-home.test.mjs`, reading three separate modules so
the binding cannot be vacuous the way a fixture compared against its own
producer was.

## Probing A Checkout-Built Surface

`npm run probe -- <binary> <command> [route/options]` is the only sanctioned way
to poke this checkout's built binary. It resolves both the declarations and the
executable from `packages/*/dist`, refuses any route whose declared effect is
not `read_only` or whose lifecycle is `until_interrupted`, and runs under a
throwaway `HOME`. It is source/runtime proof, not proof of the separately
installed signed worker.

**The guard is only ever as right as the field it reads.** It was exactly as
wrong as the declaration for as long as `call` said `read_only`: the vocabulary
stopped at this machine, so the one route that executes a governed provider
capability had no truthful value available to it and was admitted as a probe
(issue #11). `remote_write` is that missing term, and `--allow-effect` refuses
it — the hatch's entire safety argument is the throwaway `HOME`, which cannot
take back a revoked session, a consumed enrollment code, or a posted message.
Adding a route without thinking about its effect does not fail any gate; it
produces a guard that is confidently wrong, which is worse than an absent one.

Effect and settlement are separate facts. `observe` is read-only but serves
until interrupted, so admitting it through a synchronous probe wedges the probe
without changing state. Its `lifecycle` lives beside `effect` in
`CEAL_COMMANDS`, is rendered by help and command discovery, and is the probe's
refusal input. Omission means the command settles on its own; only the exceptional
long-running route needs another value.

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
