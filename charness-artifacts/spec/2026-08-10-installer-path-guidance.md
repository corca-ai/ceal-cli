# Worker Installer PATH Guidance

## Problem

The signed worker installer can succeed while a first-time user's current shell
cannot resolve `ceal`. Naming the install directory is not actionable enough,
especially on a stock Apple Silicon macOS shell where `~/.local/bin` may not be
present in PATH.

## Capability Contract

Installer success leaves the user with one honest next action. If the exact
install directory is already a complete PATH entry, no warning is printed. If
it is absent, stdout prints a POSIX-shell command that prepends that exact
directory to PATH for the current shell, followed by an instruction to persist
the change in the user's shell startup configuration if desired.

## Current Slice

Change only `install-ceal.sh`, its worker release installer tests, and the README
install contract. Do not mutate a shell startup file, choose one zsh startup
file for the user, release a worker, or change the install location.

## Fixed Decisions

- PATH membership uses whole-entry matching, not substring matching.
- Guidance is derived from the actual `INSTALL_DIR`, including a custom
  `CEAL_INSTALL_DIR`.
- Custom install directories must be absolute and cannot contain `:`. Relative
  PATH entries change meaning with the working directory, and POSIX PATH uses
  `:` as its entry separator.
- The installer does not attempt to modify its parent shell or user dotfiles.
- The copyable command must remain valid when the install path contains spaces
  or single quotes.
- An already reachable install directory does not produce a false warning.

## Probe Questions

- Which smallest POSIX-shell quoting helper keeps the generated command safe
  without introducing a new runtime dependency?

## Deferred Decisions

- A real macOS terminal proof belongs to a later released-candidate acceptance
  run; local Linux fixtures prove only the shell/output contract.

## Non-Goals

- Changing `$HOME/.zprofile`, `$HOME/.zshrc`, or any other startup file.
- Claiming every shell or package manager uses the same persistent PATH setup.
- Publishing or applying a worker release.

## Deliberately Not Doing

Always printing `export PATH="$INSTALL_DIR:$PATH"` is rejected because it
misdiagnoses already-configured environments. Printing an unquoted custom path
is rejected because a supported environment override may contain shell-active
characters.

## Constraints

- POSIX `sh`; no Python, Node, or new tool prerequisite.
- Preserve the existing signed asset, generation, rollback, and success exit
  behavior.
- Success output remains stdout and contains no credential or private state.

## Success Criteria

- A successful install with `INSTALL_DIR` absent from PATH prints one safe,
  copyable current-shell command derived from that directory.
- A successful install with `INSTALL_DIR` already present as a whole PATH entry
  omits the warning.
- A path with spaces and a single quote is rendered as valid POSIX shell.
- Relative and colon-containing install paths are rejected before downloads or
  filesystem mutation.
- Existing install/update integrity tests remain green.

## Acceptance Checks

- Verification type: `unit` — installer fixture PATH omits the custom install
  directory and stdout contains the exact guidance command.
- Verification type: `unit` — fixture PATH includes the directory and stdout
  omits the warning.
- Verification type: `unit` — adversarial install path guidance parses and
  prepends the exact directory in `/bin/sh`.
- Verification type: `unit` — relative and colon-containing paths fail before
  install output or external work.
- Verification type: `integration` — existing worker installer suite remains
  green with its signed-release fixture.

## Boundary Ownership

The worker installer owns the exact installed path and conditional guidance.
The user's parent shell owns whether and where the change is persisted. The
Gateway invitation may pin an absolute onboarding path but does not replace the
worker installer's standalone contract.

## Critique

- Interrupt Source: `worker-installer-parent-shell-path`
- Seam Summary: a successful child installer cannot mutate the current parent
  shell, and host defaults disproved the assumption that the default install
  directory is always searchable.
- Chosen Next Step: emit conditional, safely quoted current-shell guidance and
  bind it at installer stdout.
- Impl Status: ready
- Impl Status Reason: source and fixture already expose the exact install path
  and PATH environment; only output logic and acceptance assertions are needed.
- What Disproving Observation Is Resolved: the installer already verifies the
  absolute executable, so the failure is command lookup guidance rather than
  failed installation.

## Canonical Artifact

`charness-artifacts/spec/2026-08-10-installer-path-guidance.md`

## First Implementation Slice

Add one POSIX-safe quoting helper and one conditional success-output helper to
`install-ceal.sh`; exercise absent, present, and adversarial PATH cases in
`test/worker-release-installer.test.mjs`; reject paths that cannot be stable PATH
entries; update the README install paragraph.
