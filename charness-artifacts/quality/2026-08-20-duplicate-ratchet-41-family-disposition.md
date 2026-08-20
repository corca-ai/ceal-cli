# Worker duplicate-ratchet 41-family disposition

Date: 2026-08-20

## Decision

The Worker branch at `f589a8f91e330eacb97c5cd162acfba25d06ce77` produced 41
code families in the blocking duplicate ratchet. A bounded fresh-eye review
read every member span. No family in this push had one extractable semantic
policy owner that could be moved safely without coupling independent gates,
protocol refusals, release trust boundaries, or test proofs.

Each exact fingerprint is therefore recorded as `intentional` in
`charness-artifacts/quality/dup-review.json`. This is a disposition of the
detector finding, not a claim that the repeated text disappeared. The notes
name the boundary and reopen condition; the bounded neutral-helper candidates
are carried as explicit Worker quality debt.

## Evidence

- Current command: `npm run check:duplication -- --detail`
- Before disposition: 41 code families, 0 doc families, `fixable_ceiling=0`,
  hard block.
- After disposition: 0 new code families, 0 doc families,
  `fixable_ceiling=0`, `hard_block=false`, `status=clean`.
- Positive-control comparison: the same front door on a clean
  `git archive origin/main` produced 27 families. Twenty-three current
  families were already present on `origin/main`; the branch added
  eighteen re-keyed families. Four historical fingerprints
  (`043a7aa8647589e6`, `513fdc0e7a147b1f`, `e9238e6bc4966c5b`,
  `ec966dd659d1e935`) regrouped rather than disappearing.
- The existing 146-family ratchet baseline was not rewritten. No
  `--no-verify` path was used.

## Partition

The 23 carried families already present on `origin/main` are:

```
007f09c8c0fc0190 02553dc38ac38483 1a8c130b18b4e257
1d33ba7f710da737 1f29b1148d0564aa 2d10c6676b8641b3
4dffc52fb9b4cb69 5054b074c0e82827 5ad4e7847d42ce0c
6d2d9a9b188ab6d2 720bedbc3a438dc1 7e9706278546ddd3
7eb04442069dc782 804cbcffc649620f 89914c0b83947508
9143da30182dc6b5 9373cf1468a5c2f7 94b9e7cf5e15a214
aa360ef0445b8065 ccbf9b6adbe69ff4 cdf27be039c92821
d0f62eb2b580ad3 fe7fa8f3ea66dc09
```

These remain visible debt owned by the Worker quality lane. The review found
no safe single owner in this push; `1d33ba7f710da737`,
`1f29b1148d0564aa`, and `720bedbc3a438dc1` are the bounded neutral-helper
follow-up candidates.

The 18 branch re-keys are:

```
13b27bfef91f4db8 31d97f7dd9fa9382 41201a9e385b253c
44f0bf5173906acf 4b6549e329c9a7bf 63b0be7483d74aab
6d29c5a5ffe6237b 779a97feabd4d358 78ca08b2e7876624
930949cb98fc60f8 9698828aee3f2bf7 a265ad79bec08de9
aae03930380d2a95 c45c8ef848f548e4 ea49d47b0019804e
f24263ebb1629342 f4c7eccaecb75555 febe108216ed1c2c
```

They are import/header re-layout re-keys, independent lock/race proofs, or
distinct release package and trust-boundary checks. Their per-family notes in
the overlay preserve the exact reason rather than using a count-only
exception.

## Reopen triggers

Reopen a family when a future slice proves a neutral helper with one policy
owner, changes the security/allow-list boundary, or adds a third member that
the current reason does not cover. Until then, the detector remains blocking
for any new fingerprint not in the reviewed overlay.

## Claims and non-claims

Verified by reading: current and clean-origin ratchet outputs, the overlay
schema, the pre-push wiring, and all reviewed member spans. This artifact does
not claim the Worker is duplicate-free, that the old debt is resolved, or that
any GitHub issue was closed. It also does not claim a release, publish, CI, or
runtime apply.
