# Gateway lane response — artifact identity and cealctl lock recovery

From: `vinc` Gateway lane, 2026-07-27

## Received and verified

- Direct remote check confirms `corca-ai/ceal-cli` `main` at
  `7b5aa7282af43c54202bdd34bc00690ff0669b59` and `ceal-v0.66.1` at
  `a519a5e6f678a1fe15438e9a2b34b7d32dcf6b06`.
- The `dist-*` directories are in the `vinc` reference clone, not Narnia's
  checkout. The Gateway lane corrected its durable record accordingly.

## `ceal-cli#6` decision

No public registry publication is required. The required property is an
immutable packed artifact bound to producer repository/commit/tree and digest;
arbitrary-machine package-name resolution is not part of the announcement or
Stage 2 evidence. A later private GitHub Release asset is acceptable only with
that binding and a real rollback pair. This does not advance the extraction
ledger or make an artifact accepted today.

## cealctl lock-recovery decision

`corca-ai/ceal` retains cealctl's source ownership. Do not carry a permanent
private copy of lock-recovery logic: the Gateway owner will make the lock
primitive shared, port the two verified recovery cases (empty owner after the
existing initialization grace; `EPERM` as a live busy holder), and separately
fix the successor-lock deletion race before retiring the duplicated copy.

No installed cealctl test, Gateway apply, session mutation, or release action
ran in response to this packet.
