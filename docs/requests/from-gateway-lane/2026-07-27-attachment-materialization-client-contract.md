# Attachment Materialization Client Contract — Vinc to Narnia

Status: coordination handoff, 2026-07-27. This is not a request to invent a
serving HTTP path or to ship an attachment-capable client before Gateway owns
the matching durable adapter.

## New Agent Consumer Seam

`vinc` committed private `ceal-agent` `3cf0feb
feat(agent): gate image inputs on attachment leases`.

The Agent's first media consumer is image-only. Its future released-client
bridge must implement one injected `recheck_active_lease()` port that returns
exactly one of:

```text
{ status: "active", binding, attachments }
{ status: "lease_lost" }
{ status: "lease_expired" }
```

For `active`, `binding` is the complete exact materialization binding and
`attachments` is the complete exact `{ attachment_ref, slot }` authorization
set. The binding includes `consumer_ref` and `consumer_generation`. The Agent
fails closed if any field, slot, ref, event revision, requester, lease fence,
consumer ref, or consumer generation differs from the manifest. It reopens every imported materialized file under its anchored
run root and checks no-follow regular-file identity, byte count, and SHA-256
before dispatch. It passes only PNG/JPEG/GIF/WebP inputs to its model callback;
PDF and office media remain explicit withheld records.

Neither this port nor its evidence may contain a provider URL/id/token,
Gateway filesystem path, Gateway `source_ref`, or an arbitrary Agent `local_path`.

## Client Requirement When Gateway Ships The Operation

The released `ceal` client owns the generic leased-consumer transport. For one
active exact lease it must call the Gateway's provider-neutral
`attachment.materialize` operation without a caller-selected slot, filename,
URL, provider identifier, or destination path. It must:

1. verify the complete manifest preamble, every byte frame, and the terminal
   frame using the canonical Gateway schema;
2. reject missing, extra, duplicated, reordered, tampered, or incomplete
   frames before making a handoff usable;
3. reject any frame or manifest carrying `source_ref`, write the verified materialized bytes into a create-only client handoff
   root and construct the Agent manifest with only `attachments/<slot>.bin`
   relative paths; and
4. expose the exact current-lease recheck result above through the same
   released client boundary.

The client is not an Agent bridge: it must not write an Agent workspace, import
`ceal-agent`, hold provider credentials, or infer attachment support from
message metadata. Its handoff, recheck result, and evidence must never retain
a Gateway `source_ref`.

## Current Gateway Dependency

Gateway now has a durable owner-only lease/catalog/reservation/object-bundle
path, a private canonical framer, plus unintegrated Agent-service credential
verification and `attachment.materialize` NDJSON route modules. The route
derives runner/consumer identity from an active Gateway credential and accepts
only exact lease identity; its byte carrier is `bytes_base64` NDJSON and
contains no `source_ref`. This is still **not** a released serving operation:
credential issuance/rotation, per-instance lease-store registry, Admin-Gateway
dispatch wiring, provider downloader policy, and a released protocol/client
decoder artifact remain absent. Do not implement a CLI transport against this
unintegrated route. Consume only the exact released Gateway protocol artifact
and return its commit, tests, artifact identity, and honest non-claim.

## Non-Claims

- No current `ceal-prod` attachment parity or live attachment proof.
- No PDF/DOCX/PPTX/XLSX parsing support.
- No Gateway apply, client release, install, provider call, or service action
  is requested by this handoff.
