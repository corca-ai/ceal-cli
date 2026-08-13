# Capability Selector Navigation Closeout

## Implemented

- URL-shaped `ceal capabilities targets --match` requests now fail closed with
  the canonical `ceal.error.v1` envelope, exit 2, and
  `error.kind: selector_not_supported`.
- The error omits the rejected URL and gives one executable sequence: select the
  original opaque target without `--match`, select a `resource.resolve` target,
  resolve `<URL>`, and use only the returned opaque ref as a declared call input.
- When future decoded catalog navigation carries the current Protocol-owned
  `opaque_catalog_target` / `unsupported` shape and names `resource.resolve`,
  the recovery also renders its validated argument and handle kind. Malformed,
  unrelated, or absent metadata uses the generic fail-closed recovery.
- Leaf help, README, embedded-guide source, and the handoff no longer describe
  `--match` as a universal text-or-URL selector.

## Capability Delivered

An agent cannot mistake a URL call input for a target selector and interpret the
result as an empty authorized catalog. The Worker returns a typed navigation
error with one non-echoing resolver workflow instead.

## Contract Source

The producer shape was re-derived from Gateway Protocol commit `7a6f26239`:
`CealLeasedConsumerCapabilityNavigation` declares
`target_selector: opaque_catalog_target`, `url_target_selector: unsupported`,
and a required opaque argument source issued by `resource.resolve` and a search
capability. The Worker consumes those provider-neutral nouns and does not branch
on `notion.page.get`.

The Worker owns fail-closed CLI rendering. Gateway/Protocol own navigation
production, exact wire validation, and the signed handoff. Frozen
`packages/ceal-protocol` remains unchanged.

## Verification

- `node test/repo-build.mjs packages/ceal-worker-cli` passed. This was the
  minimum compilation required because the tests import `dist`; no `npm build`
  or generated/release boundary ran.
- `node --test --test-name-pattern='target selection help states|URL target
  match without declared support|catalog navigation refuses a URL
  selector|target recovery preserves'
  packages/ceal-worker-cli/test/cli.test.mjs` passed 4 tests. The real CLI route
  passed through the pinned Protocol decoder and proved exact YAML schema, error
  kind, exit 2, full fallback `next_action`, absent `targets`, and URL
  non-reflection. The structural test proved rich navigation and malformed
  metadata fallback.
- `node --test --test-name-pattern='worker guide teaches help-driven|worker
  guide teaches detailed' test/contract/worker-guide-contract.test.mjs` passed 2
  tests.
- `npm exec --no -- tsc -p packages/ceal-worker-cli/tsconfig.build.json
  --noEmit` passed.
- `npm exec --no -- biome check packages/ceal-worker-cli/src/index.ts
  packages/ceal-worker-cli/src/command-surface.ts
  packages/ceal-worker-cli/src/subcommands.ts
  packages/ceal-worker-cli/test/cli.test.mjs` passed.
- `npm run lint:reachability` passed with the test-only selector classifier
  reached by the worker CLI suite.
- `npm run lint:duplicate-literal` first identified an unclassified coincidental
  safe-identifier grammar, then passed after the site was explicitly classified
  as a separate Protocol-navigation grammar.
- `git diff --check && git diff --exit-code -- packages/ceal-protocol` passed.

Proof level: local checkout runtime through the CLI/Gateway fixture. No signed
binary, live Gateway metadata, or provider roundtrip was exercised.

## Lint Gate

`skipped user requested targeted tests/lint/typecheck only`; the targeted Biome
gate, `lint:reachability`, `lint:duplicate-literal`, and TypeScript no-emit check
passed. The broad pre-push gate was not run. Targeted lint disposition:
`ran-fail-fixed npm run lint:duplicate-literal`.

## Truth Surface Sync

`README.md`, `docs/handoff.md`, target-selection leaf help, and
`skills/ceal-guide/references/capability-workflow.md` now describe the typed
refusal, canonical fallback, richer metadata condition, and signed-Protocol
non-claim.

## Boundary Ownership

`owned-correctly`

- Producer: Gateway/Protocol capability-navigation contract.
- Consumer: Worker CLI `ceal capabilities targets`.
- Owning surface: Protocol owns navigation shape and retention; Worker owns the
  generic fail-closed error and recovery rendering.
- Disposition: absent/unrecognized producer metadata cannot authorize a URL
  selector, while no provider-specific selector rule is encoded in the Worker.

## Critique

`Critique: full parent-delegated bounded fresh-eye runtime/boundary review`

- Reviewer tier: medium; `reasoning_effort: medium` sent;
  `requested_fields_sent`; application not host-confirmed.
- Delivery: `findings-received` in both rounds.
- Boundary fingerprints: both review windows returned `verdict: clean` with no
  drift.
- Round 1 found the pinned decoder removed `navigation`, making the initial
  metadata-only branch unreachable. Repair: URL matches now fail closed even
  without metadata and an actual CLI-route test proves the pinned path.
- Round 2 found an invented `supported` enum, incomplete resolver validation,
  and a partial rather than exact fallback assertion. Repair: removed the enum,
  require `resource.resolve` before rich rendering, degrade malformed metadata
  to generic recovery, and assert the complete fallback `next_action`.
- Round-2 repairs are accepted-unreviewed under the bounded two-round stopping
  rule; deterministic tests cover each repair.

Fresh-eye satisfaction: parent-delegated.

## Contract Updates

No compatibility alias, dual output, Protocol edit, release pin, or generated
contract was added. `selector_not_supported` extends the existing canonical
error kind vocabulary only for this clean unreleased Worker cutover.

## Claim Ledger

| Claim | Source | Re-check |
| --- | --- | --- |
| Current pinned Protocol strips undeclared capability navigation | `packages/ceal-protocol/src/index.ts` and `gateway-validation-primitives.ts` | `rg -n 'retainDeclaredResponseKeys\\(capability|navigation' packages/ceal-protocol/src packages/ceal-worker-cli/src/index.ts` |
| The real CLI route returns a typed error rather than a successful empty list | `packages/ceal-worker-cli/test/cli.test.mjs` | Run the focused 4-test command under Verification |
| Frozen Protocol source is unchanged | Git diff | `git diff --exit-code -- packages/ceal-protocol` |

## Residual Risks

- `unverified-future`: the pinned `0.72.17` Protocol strips `navigation`, so
  rich argument/handle rendering is structurally tested but cannot be proven
  through the current wire decoder.
- `unverified-future`: no signed Worker, installed guide, live Gateway, or live
  provider roundtrip was exercised.

## Completion Categories

- `durable`: Worker behavior, help, guide source, docs, tests, and this closeout.
- `external-writes`: none.
- `test-only`: Gateway fixture inputs for URL refusal and structural navigation.
- `verification`: local CLI fixture runtime; no external proof level claimed.
- `unverified-future`: signed Protocol metadata retention and installed/live
  roundtrip.

## Next Slice

Consume the signed Gateway Protocol handoff that retains the navigation field,
then replace the structural bridge with the exported type and prove the rich
argument/handle recovery through the real wire decoder. Release, install, and
live provider proof remain separate approved boundaries.
