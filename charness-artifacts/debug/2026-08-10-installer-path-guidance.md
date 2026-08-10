# Installer PATH Guidance Debug
Date: 2026-08-10

## Problem

A successful worker install can leave a first-time user with `ceal: command not
found` because the installer places `ceal` in an install directory that the
current shell does not search and prints no PATH guidance.

## Correct Behavior

Given any supported absolute install directory, when installation succeeds, then the
installer must either confirm that the directory is already on the current
PATH or print a copyable, shell-portable command that adds that exact directory
for the current shell before telling the user to run `ceal`.

## Observed Facts

- `install-ceal.sh` defaults `INSTALL_DIR` to `$HOME/.local/bin`.
- Its success output names the directory but never checks whether PATH contains
  it and never tells the user how to add it.
- Issue `corca-ai/ceal#707` records the user-visible macOS symptom after a real
  successful install.
- zsh reads PATH changes from startup files, but a piped child installer cannot
  mutate the already-running parent shell.

## Reproduction

- Run the existing installer fixture with `CEAL_INSTALL_DIR` absent from its
  PATH. Installation exits zero and creates `ceal`, while stdout contains no
  PATH instruction. The fixture already supplies exactly that environment in
  `test/worker-release-installer.test.mjs:520-535`.

## Candidate Causes

- The binary was not installed or the final symlink was broken.
- The shell cached an older missing command result after PATH changed.
- The install directory was not present in the parent shell's PATH.
- macOS and Linux sourced different startup files after installation.

## Hypothesis

- The missing installer success guidance is sufficient to produce the reported
  first-contact dead end whenever PATH omits `INSTALL_DIR`. If true, a fixture
  whose PATH omits the custom install directory will require exact guidance,
  while a fixture that already includes it will not print a false warning. |
  disconfirmer: the current installer already emits usable PATH guidance or the
  binary is unavailable even through its absolute installed path.

## Verification

- Confirmed before repair by source and the existing fixture environment: the
  binary was verified through its absolute target before success, but the only
  final lines were the install location and signed-guide location. After repair,
  the full installer suite passes with exact present/absent PATH, shell-active
  quoting, and invalid-entry regressions; the repository iteration gate passes.

## Root Cause

The installer treated creating a verified executable as the complete onboarding
contract. It did not carry the install directory through to the final consumer:
the user's current command lookup environment. A child shell cannot repair that
parent environment, so silence after a successful install becomes an apparent
installation failure.

## Invariant Proof

- Invariant: when the installer reports success, its final output must make the
  installed `ceal` executable reachable from the user's current shell.
- Producer Proof: the installer knows the exact `INSTALL_DIR` and verifies
  `$INSTALL_DIR/ceal` before setting `COMMITTED=1`.
- Final-Consumer Proof: the installer fixture asserts exact conditional PATH
  guidance for absent and already-present directory cases and rejects relative
  or colon-containing paths that cannot be stable whole PATH entries.
- Interface-Shape Sibling Scan: stable update invokes the same staged installer,
  so one installer-owned output contract covers install and update.
- Non-Claims: no released binary, real macOS terminal, or shell startup-file
  mutation is proven or attempted.

## Detection Gap

- Installer fixture | proved installed bytes and links but not command
  discoverability guidance | add conditional success-output assertions.

## Sibling Search

- Mental model: a verified executable at a conventional path is automatically
  callable from the current shell.
- same layer: default and custom install directories | decision: derive one
  exact command from `INSTALL_DIR` | proof: fixture variants.
- abstraction up: invitation mail | decision: it may use an absolute default
  path, but the worker installer must remain independently usable | proof:
  separate repository owner.
- specialization down: stable update | decision: retain the shared installer
  output; no second PATH implementation | proof: staged installer reuse.
- cross-file: README install section | decision: document the same conditional
  guidance behavior without duplicating shell-escaping logic | proof: source
  ownership citation.

## Seam Risk

- Interrupt ID: worker-installer-parent-shell-path
- Risk Class: external-seam, host-disproves-local
- Seam: POSIX child installer -> current interactive shell command lookup.
- Disproving Observation: a real supported macOS shell with a PATH missing the
  install directory can follow the printed command and invoke `ceal`.
- What Local Reasoning Cannot Prove: host startup-file defaults or a real user's
  shell configuration.
- Generalization Pressure: factor-now

## Interrupt Decision

- Resolution: resolved
- Critique Required: yes
- Next Step: spec
- Handoff Artifact: charness-artifacts/spec/2026-08-10-installer-path-guidance.md

## Prevention

Treat post-install command reachability as part of installer success. Keep the
guidance conditional, derived from the actual install directory, and tested at
the user-visible output boundary.
