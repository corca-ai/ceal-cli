# Release Test Readiness Isolation Premortem
Date: 2026-08-13

## Decision Under Review

Run release package/native downstream tests against the existing converged
Protocol scratch-repository primitive instead of the intentionally divergent
maintainer checkout, while leaving the production pin chokepoint unchanged.

## Failure Angles

- Problem/guard ownership: a test-only pin bypass would make the four tests
  green without exercising the production development-input chokepoint or real
  staging boundary.
- Operational fixture integrity: changing only `repoRoot` would mix a
  converged pin with Protocol bytes packed from the ambient checkout and would
  omit package source, generated handoff inputs, notices, and build dependencies
  the builders actually read.
- Proof timing: Protocol `dist` must be built and copied while the existing
  workspace build lock is held; otherwise the isolated fixture can snapshot a
  concurrently replaced generated tree.

## Counterweight Pass

- Act before ship: make the fixture opt-in; pack Protocol from that fixture;
  derive packet producer identity from its converged lock; copy an explicit
  builder-read whitelist; pass the same root to all four downstream tests; keep
  dedicated ambient-divergence/chokepoint tests unchanged.
- Bundle anyway: one cleanup owner for both temporary roots and one fixture
  assertion that required release-build inputs exist.
- Over-worry: copying all `node_modules`, removing the deterministic Darwin
  order stub, or requiring real macOS signing in this Linux-local slice.
- Valid but defer: signed archive, publication, installed candidate, and live
  release-readiness proof.

## Structured Findings

- F1 | bin: act-before-ship | evidence: strong | ref: test/worker-release-package-fixture.mjs:12-28,89-101 | action: fix | note: build the packet from the converged fixture root and derive producer identity from its lock
- F2 | bin: act-before-ship | evidence: strong | ref: scripts/build-worker-release-package.mjs:96-153 | action: fix | note: opt-in fixture must carry the exact package source, guide/notices, and four regular-tree build dependencies the builder reads
- F3 | bin: act-before-ship | evidence: strong | ref: scripts/build-worker-native-artifact.mjs:81-119 | action: fix | note: include generated carrier/control/handoff source and lock/vendor inputs required before native assertions
- F4 | bin: act-before-ship | evidence: strong | ref: test/repo-build.mjs:12-23,47-51 | action: fix | note: create the fixture and copy Protocol dist inside the held workspace build lock
- F5 | bin: act-before-ship | evidence: strong | ref: test/worker-release-package.test.mjs:20-93; test/worker-native-artifact.test.mjs:28-190 | action: fix | note: pass fixture repoRoot to all four post-guard tests while keeping production/archive negatives on ROOT
- F6 | bin: bundle-anyway | evidence: strong | ref: test/converged-protocol-repo-fixture.mjs:17-70 | action: fix | note: keep releaseBuild opt-in and centralize temporary-root cleanup
- F7 | bin: over-worry | evidence: strong | ref: scripts/build-worker-release-package.mjs:146-153 | action: document | note: exact dependency trees are sufficient; full node_modules and real macOS signing do not belong in this fixture
- F8 | bin: valid-but-defer | evidence: strong | ref: charness-artifacts/spec/2026-08-13-release-test-readiness-isolation.md | action: defer | note: signed release, publish, install, and live proof remain outside this local gate repair

## Reviewer Tier Evidence

- Requested tier: high-leverage
- Requested spawn fields: reasoning effort medium from the repository-required existing reviewer configuration
- Host exposure state: requested_fields_sent
- Application state: host did not expose an application confirmation
- Delivery state: findings-received

## Fresh-Eye Satisfaction

parent-delegated

## Reviewed Input Identity

- Packet consumed: `charness-artifacts/critique/2026-08-13-release-test-readiness-isolation-preimpl-packet.json`
- Packet path: `charness-artifacts/critique/2026-08-13-release-test-readiness-isolation-preimpl-packet.json`
- Packet SHA256: `510853be9c9978ab998bcd786b6494abf29031bb9b6f717f17c71084ab8ae710`
- Identity SHA256: `d84caa905f9cd26167576d3e26f4a31e7e900eee326fe5064100592335131d5b`
- Shared-tree boundary: three reviewer returns verified `clean` against window
  `release-test-preimpl`; no worktree, index, or HEAD drift occurred.

## Boundary Ownership

- Producer: the converged scratch repository produces deterministic post-pin
  release-build inputs; the real checkout pin guard produces readiness refusal.
- Consumer: package/native downstream tests and the dedicated divergence tests,
  respectively.
- Owning surface: ceal-cli release test fixtures and contract gates.
- Verdict: owned-correctly

## Deliberately Not Doing

No production bypass flag, injected no-op guard, real pin/lock rewrite, or
release action is introduced. The full local gate should be green because each
test owns its fixture state, not because the release guard is weakened.

## Next Move

Implement the opt-in fixture whitelist under the workspace build lock, run the
two release test files plus dedicated guard contracts, then require a green
`npm run check`.
