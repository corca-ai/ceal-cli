---
name: ceal-guide
description: Compatibility bridge for an installed Ceal worker whose full signed guide directory has not been explicitly registered yet.
---

# Ceal guide compatibility bridge

This file is not the complete Ceal guide. It exists only so older installed
updaters can cross to a release whose signed binary carries the complete guide
directory without requiring a reinstall.

Run `ceal guide status`. Then run exactly one command for the agent host you use:

- `ceal guide register codex`
- `ceal guide register claude`

Registration stages the guide directory embedded in the installed signed
binary. A registration failure does not undo or invalidate the binary update.
