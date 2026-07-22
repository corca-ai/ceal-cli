# Named Option Grammar — Closeout

## Implemented

`ceal call` and `ceal session enroll` now parse their named options from the
command tail instead of requiring one incidental ordering. The local scanner
keeps positional operands positional while accepting each declared named option
once wherever it appears.

## Capability Delivered

Agents and people can place `--target`, `--profile`, `--gateway`, and
`--code-stdin` in a valid order for their command without a local argument
validation failure caused solely by option placement.

## Contract Source

The public `ceal` command grammar, with capability id and command subverbs as
positionals and named options order-independent unless a command documents an
exception.

## Verification

- `npm --prefix packages/ceal-worker-cli test` → pass (77 tests).
- Direct scanner contract covers two representative placements plus duplicate,
  missing/option-looking value, unknown-option, and unsupported `--` rejection.
- Existing command integration tests cover the formerly rejected `ceal call`
  and enrollment orderings.

## Lint Gate

Not detected in this repository; the package test command performs its TypeScript build before tests.

## Truth Surface Sync

`ceal --help` and each command help now state the compact named-option rule.
The guide retains one canonical readable example without becoming a behavior
manual.

## Boundary Ownership

owned-correctly — parsing stays in the independently released `ceal-cli`
worker CLI. It does not move into the Gateway protocol package or share a
runtime parser with Gateway-owned `cealctl`.

## Critique

Gateway-host fresh-eye review record:
`ceal/charness-artifacts/critique/2026-07-23-critique-review.md`.

## Contract Updates

Opened [corca-ai/charness#452](https://github.com/corca-ai/charness/issues/452)
to add the concise portable named-option rule to `charness:create-cli`.

## Residual Risks

`--` remains deliberately unsupported. Future command grammars must opt into a
delimiter deliberately rather than receiving accidental support.

## Next Slice

Apply the same local parser contract when a newly added public `ceal` command
would otherwise impose a named-option order.
