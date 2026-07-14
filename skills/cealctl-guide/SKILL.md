---
name: cealctl-guide
description: Use when an operator or agent needs to discover, inspect, plan, or verify Ceal control-plane work through the installed cealctl CLI.
---

# Cealctl Guide

Use the installed binary as the source of truth. This guide is only for an
existing Gateway/control-plane operator, never a personal `ceal` client host.
It owns safe operator sequencing; it does not own a command registry, instance
inventory, deployment route, or release catalog.

## Bootstrap

1. Run `cealctl --help` locally. Treat only the displayed families as
   available.
2. Select the family whose description matches the operator task.
3. Run `cealctl <command> --help` before supplying operands or authorizing any
   effect.
4. Read the leaf's `Effect`, `Evidence`, `Result schema`, and
   `Recovery/readback` fields. If any is absent, stop instead of guessing.

Help is conventional text and must be read-only. Every non-help result is one
YAML document; do not add an output-format flag and do not scrape prose.

## Workflow

1. Start with a read-only status, discovery, or doctor route learned from help.
   Command discovery is navigation only. For a readiness question, select a
   diagnostic leaf whose purpose and result schema report binary, setup,
   runtime, effect, and proof state; do not infer readiness from the command
   registry.
2. Resolve the exact instance, principal, profile, request, or release ref from
   command output. Do not rely on a remembered local checkout or deployment
   alias.
3. For a mutation, use the preview or plan path named by leaf help. Review the
   bounded effect, target, evidence requirement, and rollback/readback path.
4. Perform authorization only through the authenticated control-plane session.
   A notification link or messenger interaction may wake an operator but does
   not itself authorize a change.
5. Parse the complete stdout YAML document. Keep progress on stderr separate,
   and follow structured recovery rather than retrying a guessed command.
6. Report completion only after the authoritative state/readback named by the
   result confirms the change.

## Boundaries

- Never ask a user to paste secrets. An operator activation code is only for
  this operator approval flow; it is never worker enrollment material. Use the
  operator credential store and the setup/import flow discovered from installed
  help.
- Do not read or reuse worker turn/provider credentials from this surface.
- If the task requires worker capability execution, use `ceal-guide` and its
  matching binary only when both are installed. Otherwise stop and report that
  the worker surface is unavailable.
- Do not treat a successful plan, queued request, process exit, or notification
  as applied state.
- Do not copy command, instance, profile, or release catalogs into this guide.
- If only binary-surface proof is available, state that setup, runtime, and
  external effects were not checked.
- If `cealctl --help` cannot run or the required leaf help fields are missing,
  stop and request installation or update of the matching binary. Do not fall
  back to another guide, another binary, or a guessed command.

## Warm Start

Reuse stable refs only after checking that the binary version and target
identity still match. Re-open leaf help whenever an effect or approval boundary
changes; installed help remains authoritative over memory.
