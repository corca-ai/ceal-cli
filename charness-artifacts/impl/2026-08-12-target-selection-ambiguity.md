# Capability Target Selection Ambiguity Closeout

## Implemented

- `ceal capabilities targets` now calls `--match` a capability-specific target
  selector instead of promising that every capability accepts text or a source
  URL.
- Every successful target-selection result carries a non-sensitive
  `target_selection` projection with the selected capability and request kind:
  `match`, `cursor`, or `unfiltered`. That Worker-local projection and its
  recovery do not copy the selector value.
- A completed match request with total count zero says only that the request
  included `--match` and the Gateway response contained no current targets. It
  refuses to infer an empty authorized catalog and names an executable bounded
  unfiltered query that preserves an explicit Profile selection.
- The checkout/next embedded guide separates target selection from the capability
  `input_contract`. Call inputs, source URLs, and opaque resource refs are not
  target selectors unless current Gateway guidance explicitly declares them.

## Contract Source

[ceal-cli issue #13](https://github.com/corca-ai/ceal-cli/issues/13) records the
installed `0.76.1` failure: a Notion URL and the `resource.resolve` result ref
both produced an indistinguishable empty `notion.page.get` target page, while an
unfiltered page exposed an authorized target and the call succeeded.

The Worker owns safe request projection, recovery, leaf help, and the guide
source embedded in its next release. The Gateway owns capability-specific
selector behavior; its Protocol artifact owns any future wire declaration or
query provenance. This slice does not add a field to frozen
`packages/ceal-protocol` or hard-code a provider route into the Worker or skill.

## Verification

- `npm run build` passed.
- `node --test packages/ceal-worker-cli/test/cli.test.mjs
  test/contract/worker-guide-contract.test.mjs` passed. The focused proof sends
  real match, cursor, and unfiltered requests, checks the request-kind
  projection, and verifies that neither the supplied URL nor cursor is copied
  into result YAML.
- `npm run check:unit` passed on the repaired tree.
- `npm run check:duplication` passed with no new fixable family.
- `python3
  /home/ubuntu/.codex/skills/.system/skill-creator/scripts/quick_validate.py
  skills/ceal-guide` passed.
- `git diff --exit-code -- packages/ceal-protocol` passed; the frozen subtree is
  unchanged.
- `node scripts/verify-protocol-vendor-pin.mjs` refused release proof with the
  pre-existing `proof_shipment_protocol_divergence`. No installed or releasable
  claim is made from this development-only slice.
- A follow-up quality sweep replaced the remaining non-runnable
  `--match <selector>` recovery with an honest help/stop path and proved the
  Protocol-valid complete-zero plus `selection_required` combination takes the
  bounded unfiltered recovery. The repaired tree passed `npm run check:unit`.

## Lint Gate

`npm run lint:shell`, the lint/static checks inside `npm run check:unit`,
`git diff --check`, and the final maintainer-local `bash .githooks/pre-push`
gate passed.

## Critique

Packet Consumed: `n/a` — the critique adapter produced no review sections, so
the delegated reviewers inspected the current diff and repository owners
directly.

Two problem/interface angles and a separate counterweight pass were executed
under parent-verified clean reviewer-boundary fingerprints. Their dispositions
were:

- **Act Before Ship:** narrow the empty-match claim to observed request and
  response facts; require a complete total-empty catalog; let cursor recovery
  win; preserve capability and explicit Profile; use a runnable `--limit 64`;
  and prove the `cursor` request-kind branch. All were repaired and re-run.
- **Bundle Anyway:** prove the projection is target-selection-only and that
  selector/cursor operands are absent from output. Bundled in the focused CLI
  proof.
- **Over-Worry:** a Worker-local request-kind projection does not widen frozen
  Protocol or invent provider-specific behavior because it derives only from
  already parsed argv and carries no operand.
- **Valid but Defer:** capability-specific selector semantics, wire provenance,
  and live URL/resolved-ref behavior remain Gateway/Protocol and installed-live
  proof.

Fresh-Eye Satisfaction: satisfied — parent-delegated.

## Truth Surface Sync

`README.md`, target-selection leaf help, `skills/ceal-guide`, and
`docs/handoff.md` now distinguish target selectors from call inputs and retain
the Gateway/Protocol non-claim.

## Boundary Ownership

`owned-correctly` — the Worker projects only facts already present in its parsed
request and the decoded target catalog. Gateway-specific selector support and
wire provenance remain in the sibling Gateway handoff. Frozen Protocol source
is unchanged.

## Residual Risks

- The local projection distinguishes which request was made, not which selector
  forms the Gateway supports or whether another authorized target exists.
- Full resolution still requires the Gateway to declare or implement the
  capability-specific selector behavior, issue the matching Protocol handoff,
  and pass an installed Worker plus live Gateway/provider reproduction.
- The signed `0.76.1` worker retains the reported ambiguity.

## Completion Categories

- **Completed locally:** truthful selector help, request-kind projection,
  bounded recovery, checkout/next embedded-guide correction, regression tests,
  and local truth-surface sync.
- **Deferred to an external owner:** Gateway selector behavior and its final
  signed Protocol handoff.
- **Blocked by external state:** installed candidate and live provider readback
  cannot be claimed until that handoff is consumed and a Worker release exists.
- **Unresolved:** none inside the current ceal-cli source slice.

## Contract Updates

No Protocol contract was changed locally. The only new result field is the
Worker-owned `target_selection` projection; command help and the skill source
embedded in the next release now derive their advice from that same Worker
behavior rather than restating a provider selector grammar.

## Next Slice

Consume the final signed Gateway Protocol handoff once it contains the agreed
target-selector contract, re-pin it without editing frozen source locally, and
repeat issue #13's URL, resolved-ref, empty-match, unfiltered-target, and call
sequence through the installed candidate.
