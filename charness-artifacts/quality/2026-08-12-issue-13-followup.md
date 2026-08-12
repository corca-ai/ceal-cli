# Quality Review
Date: 2026-08-12
Title: Issue 13 Target-Selection Follow-up

## Scope

Target boundary: the Worker-owned issue #13 target-selection projection,
recovery, CLI/help contract, checkout ceal-guide, and adjacent test economics.

Ambient repo findings: the existing Protocol proof/shipment divergence remains
the release boundary; this review does not clear it.

## Surface Contract Review

- semantic coverage: `partial` — checkout behavior, result YAML, help, skill
  prose, installed-guide state, and local gates were observed.
- surface: `ceal capabilities targets`, `ceal.capabilities.v1` output,
  target-selection recovery, and the guide an agent reads.
- owner: Worker owns parsed request provenance and local recovery; Gateway and
  Protocol own selector semantics; the release lane owns installed guide bytes.
- projections: argv, Gateway request, decoded target catalog, YAML, leaf help,
  README/handoff, checkout guide, and installed registered guide.
- state scope: one discovery request under one selected Profile.
- transitions: match, cursor, unfiltered, continuation, selection-required,
  complete empty result, and unavailable selector guidance.
- proof boundary: loopback Gateway tests, guide contract, iteration gate,
  installed filesystem readback, and delegated review.
- unexamined axes: final Gateway selector contract, signed candidate, installed
  successor, live Gateway/provider behavior, and agent execution of that release.

## Current Gates

- `npm run check:unit`, focused CLI/guide tests, duplication ratchet, shell lint,
  skill validation, dependency audit, and frozen-subtree checks passed.
- `node scripts/verify-protocol-vendor-pin.mjs` refused shipment with the existing
  `proof_shipment_protocol_divergence`; the full release gate was not claimed.
- The planner-routed `./scripts/run-quality.sh --read-only` is unreachable in
  this repository and exited 127.

## Runtime Signals

- runtime source: repo-declared `.charness/quality/command-timing.jsonl`, rendered
  by `render_runtime_summary.py`; profile `local-linux-aarch64-2cpu`.
- runtime hot spots: the latest recorded iteration and full-tag samples remain
  within their configured budgets; rerun the renderer for current values.
- coverage gate: owned-package coverage ran inside the green iteration gate.
- evaluator depth: deterministic gates plus two bounded fresh-eye rounds; no LLM
  evaluator was needed for deterministic CLI behavior.

## Healthy

- `target_selection` carries only capability and request kind; selector and
  cursor operands are absent from result YAML.
- Cursor recovery wins over empty-page advice and preserves an explicit Profile.
- A matched complete zero-count response gives a runnable bounded unfiltered
  query without claiming that authorization is empty.
- Selection-required output no longer fabricates `--match <selector>` as an
  executable command when no selector grammar was declared.
- The checkout guide remains progressively disclosed and separates call input
  contracts from capability-specific target selectors.

## Weak

- Charness planning still routes an absent generic quality runner, reports the
  adapter-resolved ceal-guide outside public-skill scope, and its dogfood helper
  cannot resolve this repo-owned skill id.
- The CLI registry is TypeScript-owned, so the generic CLI ergonomics inventory
  is unconfigured; repo-owned command/dispatch gates remain the actual proof.

## Missing

- The installed `0.76.1` registration still points at the single-file legacy
  guide that instructs `--match <text-or-url>`; only checkout/next-release source
  is repaired.
- Regenerable-fact ownership is not configured for the wider docs tree.
- No signed successor or live Gateway/provider readback exists for issue #13.

## Deferred

- Selector grammar and selector-miss provenance wait for the Gateway-owned final
  Protocol handoff; the Worker must not invent either.
- Installed-guide dogfood waits for a signed successor and explicit release/install
  approval.

## Advisory

- structural review result (command: `npm run check:duplication`): no new fixable
  duplication family or dual implementation was found by the source
  hygiene inventories.
- prose review result: artifact: `skills/ceal-guide/SKILL.md` delegates target
  details to one reference; installed drift is release state, not a second owner.
- security review result (command: `npm audit --omit=dev --audit-level=high`):
  next-action refs are safe and raw selectors are not rendered.
- performance review result (command: focused `node --test --test-name-pattern`):
  the loopback wire proof is not the standing critical path.

## Delegated Review

- Delegated Review: `executed` — behavior/security, test-economics, and
  skill/operability reviewers returned findings for `issue13-quality-r1`;
  reviewer-boundary verification was `verdict: clean`.
- A repaired-tree counterweight reviewed `issue13-quality-r2`; its boundary was
  also clean and its one truth-artifact finding was repaired.
- Reviewer tier: `high-leverage`; model/effort/service fields were sent,
  application metadata was not exposed, and findings delivery was received.
- Slow-gate lenses: fixture-economics and duplicated-proof found no justified #13
  optimization; parallel-critical-path remains the broader Worker coverage run.

## Commands Run

- quality adapter bootstrap, planner, artifact resolver, and scaffold commands
- `npm run probe -- ceal commands`
- `npm audit --omit=dev --audit-level=high`
- runtime, skill, docs, regeneration, CLI, source-hygiene, duplication, and
  standing-test-economics inventories
- `npm run build && node --test packages/ceal-worker-cli/test/cli.test.mjs test/contract/worker-guide-contract.test.mjs`
- `npm run check:unit`
- `npm run check:duplication && npm run lint:shell`
- `python3 /home/ubuntu/.codex/skills/.system/skill-creator/scripts/quick_validate.py skills/ceal-guide`
- `node scripts/verify-protocol-vendor-pin.mjs`

## Recommended Next Quality Moves

- active consume and review the final Gateway handoff, then repeat issue #13 on
  the installed candidate — capability_needed=Gateway packet and release approval;
  next_center=Protocol pin/release; proof_boundary=installed live sequence;
  enforcement_posture=existing shipment quarantine.
- active fix Charness planner/dogfood discovery for adapter-resolved repo-owned
  skills — capability_needed=upstream Charness change; next_center=quality planner;
  proof_boundary=plan reports skill in scope and emits a dogfood case;
  enforcement_posture=advisory upstream gap.
- passive because no local critical-path regression was measured, revisit #13
  test extraction only if gate timing identifies it as a hot spot —
  capability_needed=new timing evidence; next_center=CLI test seam;
  proof_boundary=equal wire assertions with lower standing cost;
  enforcement_posture=no new gate.

## History

- [Prior quality baseline](history/2026-07-27-quality-review-second-pass.md)
