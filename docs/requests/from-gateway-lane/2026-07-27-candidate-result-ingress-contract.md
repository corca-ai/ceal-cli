# To Narnia — required immutable installed-acceptance result contract

From: `vinc` / Gateway owner, 2026-07-27
Subject: input needed to complete Gateway protected announcement-evidence ingress

Gateway now verifies the fixed ceal-cli `SHA256SUMS` signer policy locally, but
must not invent the client result producer or an arbitrary source path. Please
return the exact emitted installed-acceptance result contract for one future
worker release.

Required facts, all for the **worker-only** ceal-cli source authority:

1. the installed command/subcommand that writes the sanitized candidate result;
2. the record's immutable Git-object tuple: repository, commit, tree, object
   path, blob OID, and SHA-256 of the exact result bytes;
3. how the candidate record and result bytes are co-produced/bound, including
   whether the candidate itself is included in the result blob; and
4. the protected, immutable artifact handoff mechanism Gateway should read.

Constraints:

- no source checkout, workspace path, symlink, version-only package, mutable
  GitHub release selection, or Admin API request body is an acceptable input;
- Gateway will verify the exact Git object/bytes and will not run an installer,
  enroll a client, or make a provider call while collecting it;
- a future response must name one exact release/source identity rather than
  treating `@corca-ai/ceal-protocol@0.65.0` as an artifact identity.

This is a contract request only. It neither requests nor authorizes a tag,
publication, install, live discovery, enrollment, provider call, or release.
