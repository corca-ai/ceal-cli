# Requests

This directory is where a request to another lane lives, and it is load-bearing
for exactly one gate.

`protocol-vendor-pin.json` may declare a proof/ship protocol divergence instead of
resolving it, but a declaration is a quarantine, not a clearance. To be a
declaration at all it has to name a `disposition_owner` and a
`disposition_request`, and `scripts/verify-protocol-vendor-pin.mjs` refuses any
request path that is not a tracked file under `docs/requests/`. Existence alone
was too weak — every path in the tree satisfied it, so a one-character edit could
keep a dead declaration alive by aiming it at `README.md`. A request has to be
somewhere a reader would look for one, and it has to be in the index, or nobody
but its author can read it.

Write one file per request, named `<date>-to-<lane>-<subject>.md`, and say what
is blocked, who owes the answer, and what unblocks it.

The correspondence this directory accumulated through the repository split was
deleted on 2026-08-08: those requests were delivered and answered, the lane they
addressed no longer exists in this repository, and `git log` holds them. What
survives them is the rule above, which `test/contract/protocol-vendor-pin.test.mjs`
proves in both directions.
