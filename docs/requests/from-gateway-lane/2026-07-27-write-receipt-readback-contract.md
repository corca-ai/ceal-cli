# Gateway → Narnia: Redacted Write-Receipt Readback Contract

From: `vinc` Gateway lane  
To: `narnia` `ceal-cli` source lane  
Status: request for next private source/artifact sync; no release or live proof request.

## Gateway Change

Gateway canonical Protocol/Core now accepts this authenticated client request:

```json
{
  "operation": "readback",
  "body": { "write_request_ref": "gateway-write-request:<uuid>" }
}
```

It returns only:

```text
ceal.gateway_write_receipt_readback.v1
  receipt: ceal.gateway_write_request_receipt.v1
```

The response does **not** echo `write_request_ref`. Its receipt has only
hashes/closed labels: request hash, source-kind/evidence hash, optional
purpose/admission hashes, idempotency/mutation commitments, provider
unknown/verified state, and optional provider-result hash.

## Client Work Requested

1. Consume the next Gateway Protocol/Client artifact pair together; do not
   hand-copy types into `ceal-cli`.
2. Add one explicit receipt-readback command/API path using the existing
   authenticated `readback` transport. It must accept a result-provided opaque
   write request ref and render the redacted receipt, never persist/print it as
   an audit payload beyond the immediate local command need.
3. Keep legacy audit readback (`body.request_id`) unchanged.
4. Treat `write_receipt_not_found` as a non-disclosing absence: it covers an
   unknown ref, legacy write record, or a different binding/source evidence.
5. Do not turn this into an approval UX, a write retry, or a provider-readback
   claim. It is local Gateway receipt evidence only.

## Compatibility / Non-Claims

- Current Gateway projection covers only migrated Google Sheets, GitHub issue
  create/comment, and Notion page-comment intent namespaces. It does **not**
  cover legacy Slack writes or any unreviewed write family.
- Current source kind is `authenticated_registered_client`, not a human event
  or approval. No announcement write row may be enabled from this feature.
- No Gateway apply/restart, client package publication, fresh install, or
  provider operation has occurred for this change.

## Gateway Evidence

- Protocol wire test: exact request/response schema, raw-reference rejection,
  raw-reference response-leak rejection, and request-hash correlation.
- Core loopback test: Gateway derives authority/source commitments from the
  authenticated binding rather than caller body.
- Registry test: only matching migrated provider-intent state projects a
  receipt; mismatched source evidence returns absent.

Please return the resulting source commit, packed artifact identity, and a
local command transcript. Do not publish, install, apply, or perform provider
writes as part of this request.
