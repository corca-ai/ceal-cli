# Quality Review
Date: 2026-08-11
Title: Codebase Quality Sweep

## Scope

Target boundary: repository-wide quality inventory followed by repairs only for
reproduced defects in owned `ceal-cli` surfaces. The implementation slice is the
`@corca-ai/ceal` HTTP request/response boundary plus repo-owned quality adapters.

Ambient repo findings: no speculative worker or script runtime change was made;
the frozen Protocol package and sibling Gateway repository remain out of scope.

## Surface Contract Review

- semantic coverage: `partial` — source, deterministic tests, gates, and a
  read-only CLI probe ran; no signed package or live Gateway ran.
- surface: adoption, enrollment, refresh, revoke, and generic Gateway HTTP.
- owner: frozen Protocol decoders own wire DTO validity; owned client modules
  own transport deadlines, media-type framing, and HTTP/body agreement.
- projections: caller requests become canonical wire bodies; responses become
  decoded Protocol values or caller-specific typed errors.
- state scope: one outbound exchange; no persisted session writer changed.
- transitions: valid success, typed failure, malformed request/response,
  non-success status disagreement, timeout, and transport failure.
- proof boundary: package tests, full repo gate, local duplicate/shell gates,
  probe-surface, and bounded fresh-eye review.
- unexamined axes: signed packages, macOS installed proof, live Gateway/provider
  behavior, and the future B1 signed handoff.

## Current Gates

`npm run check:unit` remains the iteration gate and `npm run check` the final
gate. The maintainer-local hook additionally runs duplication and shell checks.
The adapter probe now names the complete read-only command it can execute.

## Runtime Signals

- runtime source: `.charness/quality/command-timing.jsonl`, rendered with
  `render_runtime_summary.py --repo-root . --detail`. <!-- reproduction-source -->
- runtime hot spots: recorded iteration and full gates remain within the
  adapter-owned budgets; rerun the renderer for current values.
- coverage gate: `npm run check` passed package and script coverage enforcement.
- evaluator depth: deterministic gates and fresh-eye reviewers only; Cautilus
  was not warranted because no log-backed behavior-proof request was supplied.

## Healthy

- Lifecycle deadlines now bound caller wait across fetch and body reads even if
  injected code ignores abort, while late rejection and typed error
  classification stay safe.
- Non-success HTTP status cannot carry a decoded success, while exact typed
  Protocol failures remain caller-visible.
- One media-type grammar owns exact JSON and generic-only structured `+json`
  policy, including complete parameter validation.
- Adoption poll requests pass through the canonical exact Protocol decoder
  before fetch, so malformed and extra fields cannot reach the wire.
- The quality and implementation adapters now resolve their declared commands.

## Weak

The generic quality planner proposed a nonexistent
`./scripts/run-quality.sh --read-only` route. Repo-owned gates remained
reachable directly, so this is an upstream planner/adapter compatibility gap,
not evidence that the repository lacks quality checks.

## Missing

- Signed released-package execution and installed-worker proof.
- Live Gateway/provider roundtrip and macOS installed-binary coverage.
- Proven provenance for pre-existing dirty changes in sibling `../ceal`; this
  slice makes no sibling-clean claim.

## Deferred

Test parallelism and pruning remain deferred: current timing evidence did not
justify a proof-reducing speed change. B1, protocol re-pin, release, and live
Gateway work remain separate approval/ownership boundaries.

## Advisory

- artifact: the structural inventory found no stronger abstraction than the
  shared HTTP/deadline/media-type owners; import-header overlap is classified in
  `charness-artifacts/quality/dup-review.json` rather than extracted.
- artifact: prose review found `skills/ceal-guide/SKILL.md` keeps a usable trigger
  boundary and help-driven progressive disclosure; no helper asset move is due.
- command: `npm run probe -- ceal commands` proves the configured read-only CLI
  probe reaches the command registry in a throwaway home.

## Delegated Review

- Delegated Review: executed — two parent-delegated high-leverage reviewers
  reproduced timeout, status/body, content-type, poll-request, and adapter
  defects; repaired-tree review found no runtime blocker.
- The second proof-surface round found vacuous lifecycle media-type cases and an
  incomplete parameter grammar. Both were repaired; per the two-round cap those
  round-two repairs are accepted-unreviewed, with focused tests and full gate
  green.
- Reviewer fields were host-defaulted; provider application is not claimed.
  Both reviewer-boundary fingerprint verifications returned `verdict: clean`,
  and findings delivery was `findings-received`.
- A distinct closeout-claims reviewer returned PASS for local source/runtime
  completion; its fingerprint verification was also clean.
- Slow-gate lenses (`fixture-economics`, `parallel-critical-path`, `duplicated-proof`)
  were reviewed; no proof-preserving speed change was supported by evidence.

## Commands Run

- `npm --prefix packages/ceal-client test`
- `npm run lint`, `npm run check:duplication`, and `npm run check`
- `npm run probe -- ceal commands`
- `node scripts/install-git-hooks.mjs --check` and `bash .githooks/pre-push`
- adapter resolution/survey and reviewer-boundary fingerprint snapshot/verify

## Recommended Next Quality Moves

- active make raw session persistence structurally unreachable from commands —
  capability_needed=owned session transition API; next_center=`session-replacement.ts`;
  transformation=remove direct writer reachability; proof_boundary=worker tests
  plus static reachability; enforcement_posture=advisory pending a designed gate.
- passive macOS installed proof until a runner can execute the real install path —
  capability_needed=macOS installed-binary harness; next_center=platform proof;
  transformation=add honest non-skipped execution; proof_boundary=installed
  binary readback; enforcement_posture=no-gate because current lanes self-declare
  that platform gap.

## History

- [Prior quality baseline](history/2026-07-27-quality-review-second-pass.md)
- [Prior lifecycle HTTP review](2026-08-11-lifecycle-http-duplication.md)
