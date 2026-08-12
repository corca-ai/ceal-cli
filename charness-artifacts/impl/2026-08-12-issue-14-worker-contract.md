# Issue 14 Worker Contract Closeout

## Implemented

- Call, receipt, and acceptance YAML retain their legacy evidence/status tokens
  and add exact Gateway-audit and provider-state verification projections.
  Those are separate facts; an unknown call outcome reports that audit readback
  did not occur rather than assigning the outcome state to the audit axis.
- Unknown writes retain the exact returned request reference. The recovery
  guidance tells agents to preserve the original call inputs and the original
  idempotency key when the discovered contract required one.
  `audit_event_not_found` is not retry permission; only an explicit terminal
  provider-not-started result may unlock Gateway-governed recovery.
- Generated call purpose and the public command description no longer call a
  capability approved before the Gateway decision.
- The two target-catalog failures reported in `ceal-cli#13` retain their exact
  codes and actionable messages through the real `capabilities targets` route.
- The workspace dist-lock runner now checks holder liveness once before
  applying its wait deadline, so host scheduling cannot shadow a ready stale
  generation reclamation in the contract proof.

## Capability Delivered

The next Worker and its two guide skills give an agent exact local evidence and
recovery vocabulary without claiming Gateway-owned provider outcome,
provenance, or replay semantics. This is an additive Worker projection, not a
wire-contract change.

## Contract Source

[ceal-cli issue #14](https://github.com/corca-ai/ceal-cli/issues/14) remains the
architecture umbrella. The
[Gateway reply](https://github.com/corca-ai/ceal-cli/issues/14#issuecomment-5262614495)
and the
[Worker follow-up](https://github.com/corca-ai/ceal-cli/issues/14#issuecomment-5262659726)
agree that replay lookup identity, mutation collision evidence, purpose
provenance, terminal receipts, and provider evidence remain
Gateway/Protocol-owned. This slice implements only the Worker-owned rendering
and guidance portion.

## Verification

- `npm run build && node --test packages/ceal-worker-cli/test/cli.test.mjs
  test/contract/worker-acceptance-packet.test.mjs
  test/contract/worker-guide-contract.test.mjs
  test/contract/script-lib.test.mjs test/contract/repo-build.test.mjs` passed.
  The route proof sends both target-catalog error codes through handshake and
  discovery before inspecting agent-facing YAML.
- `python3
  /home/ubuntu/.codex/skills/.system/skill-creator/scripts/quick_validate.py
  skills/ceal-guide` and the same validator for
  `skills/ceal-capability-audit` passed.
- `npm run check:unit` passed on the repaired tree.
- `bash .githooks/pre-push` passed on the repaired tree, including the
  iteration, duplication, and shell-lint gates.
- `git diff --exit-code -- packages/ceal-protocol` passed; the frozen Protocol
  subtree is unchanged.
- Verification level: local checkout and Worker HTTP fixture. No signed
  successor, installed successor, live Gateway, or provider roundtrip was
  exercised.

## Lint Gate

ran-fail-fixed `bash .githooks/pre-push` — the first run exposed a
deadline-before-liveness race in the isolated dist-lock proof; the second run
exposed newly keyed result-writer duplication after receipt fields were added.
The liveness order and shared receipt owner were repaired, the remaining
policy-distinct families were reviewed, and the final run passed.

ran-pass `bash .githooks/pre-push`

## Truth Surface Sync

`README.md` and `docs/handoff.md` now distinguish Gateway audit readback from
provider-state verification and retain the Gateway/Protocol non-claims. The
progressive `ceal-guide` reference owns detailed replay discipline; the audit
skill owns audit-ledger vocabulary. The core guide remains concise.

## Boundary Ownership

`owned-correctly` — the Worker produces agent-facing YAML and local recovery
guidance; the two skills consume that projection. Gateway and Protocol remain
the producers of replay identity, provider outcome, purpose provenance,
terminal receipt semantics, and input-contract meaning. Frozen
`packages/ceal-protocol` was not modified.

## Critique

Round 1 was parent-delegated under a clean reviewer-boundary fingerprint. It
found four blockers: mixed outcome/audit state, the wrong nested call-result
field path in the guide, a remaining `approved` sibling in command discovery,
and classifier-only target-error proof. All were repaired, and the real route
proof was added. Round 2 over the repaired proof-rendering surface found that
the external acceptance record flattened the two evidence axes back into one
legacy status. Both acceptance emitters, their declared key owner, the human
render, and help now carry the exact distinction. Under the two-round stopping
rule, this final round-2 repair is accepted-unreviewed. The parent recorded a
round-2 `verdict: parent-attributed` result for nine declared paths; the
closeout artifact changed afterward, so this is not presented as a current
clean-verdict claim. A separate claims-only review then ran under a clean
reviewer-boundary fingerprint and corrected the remaining proof wording.

Fresh-Eye Satisfaction: parent-delegated

## Contract Updates

No Protocol contract changed. `ceal.result.v2` and `ceal.receipt.v1` keep their
existing schema-version identifiers and legacy tokens while adding Worker-owned
verification objects. A future Gateway handoff may supply richer
terminal/provider evidence; this repository does not predict its fields.

## Residual Risks

- Existing `0.76.1` output and installed skills retain the old ambiguous
  vocabulary until a successor is released and registered.
- The Worker cannot independently prove provider state, terminal non-execution,
  replay identity, or purpose provenance.
- Full release, installation, Gateway selection/apply, and provider readback
  remain blocked on the final signed Protocol handoff and separate operator
  approvals.

## Next Slice

Consume and review the one final signed Gateway Protocol handoff, re-pin the
frozen subtree without originating edits, rerun the full release gate, and ask
before choosing a version, pushing, tagging, publishing, or installing.

## Completion Categories

- durable: Worker result projection, recovery classification, purpose wording,
  two skill contracts, truth surfaces, and dist-lock liveness ordering.
- external-writes: one authorized follow-up comment on `ceal-cli#14`, verified
  at the URL above.
- test-only: target-error HTTP fixtures and dist-lock race probes.
- verification: local build, focused runtime/contract tests, skill validators,
  iteration gate, pre-push gate, and fresh-eye review.
- unverified-future: signed/installed successor, final Gateway contract,
  Gateway selection/apply, provider outcome, and agent-choice behavior.
