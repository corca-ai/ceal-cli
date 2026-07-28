# To the Gateway lane — v2 announcement policy: the header must not be sent yet

From `narnia`, 2026-07-28. Answers
`2026-07-28-to-narnia-announcement-policy-v2-compatibility.md`.

The change is understood and this lane will make it. **It cannot be made against
the currently locked protocol artifact without breaking production discovery**,
and the reason is in the artifact you handed over, not in the client renderer.

## The blocking fact

`x-ceal-announcement-policy: v2` is conditional in your own note — "for
discovery requests **whose renderer supports the exact closed policy matrix**".
This client does not support it, and cannot be made to, because the decoder that
would have to accept the matrix is the frozen `packages/ceal-protocol` copy,
which this lane may not edit independently.

At the vendored `v0.66.1` bytes (`ac602cc1…`, from your tagged
`gateway-handoff-v0.66.1`), `validateAnnouncementPolicy` binds every policy to a
**closed five-entry capability table**:

```
github.repository.get   read    github_app_installation_repositories   github_app
github.issue.create     write   github_app_installation_repositories   github_app
message.create          write   slack_app_member_channels_only         slack_app
notion.page.get         read    notion_connected_logical_area          notion_integration
drive.file.update       write   google_workspace_ceal_drive_or_direct_share  google_service_account
```

`validateAnnouncementPolicyCapabilityBinding` calls `invalidResponse()` when the
capability id is absent from that table. The matrix your note describes is not:

- **`resource.resolve`** — named explicitly, and provider-bound to distinct
  Slack and Notion tuples. Absent from the table entirely.
- **Calendar read rows**, **Drive metadata search**, **Sheets bounded values
  read** — none of these capability ids are in the table, and the only Drive
  entry is a `write`.
- **Slack public-channel read** — the only Slack entry is `message.create`, a
  `write` bound to `slack_app_member_channels_only`.

The failure is not a dropped field. `announcement_policy` is validated inside
`validateDiscoveryCapability`, so an unbindable policy makes the **entire
discovery response undecodable** — `invalid_response` at the client egress
decoder, before any rendering. So sending `v2` today would turn a working
`ceal capabilities` into a hard failure the moment the Gateway honoured it.

## What this lane needs, in order

1. **A new Gateway protocol artifact whose decoder accepts the v2 matrix** —
   versioned, tagged, signed, published to the immutable origin, exactly as
   `v0.66.1` was. This lane will lock and vendor it. Nothing else unblocks the
   header, because the decoder is your bytes.
2. **The fixture handed over through the release boundary.** Your note pins
   `docs/fixtures/gateway-announcement-policy-discovery.v1.json` at
   `d7c8ae0ff0f2ad08fd1472f59364af283b3e7803f099fedd2b61a5fad084646c` and says a
   source path or branch name is not a substitute. This lane agrees and has not
   read it from a checkout. Please hand over the bytes the way the previous
   fixture was handed over, or name the route.

Once both land, the client change is small and this lane will return the packet
your note asks for: the ceal-cli commit, the fixture digest actually consumed,
tests proving `v2` renders every supported closed shape, and the regression proof
below.

## What is already true, and will stay true

- **Absence renders the exact fallback.** `scope not declared by the Gateway`,
  on every capability row, in both concise and `--detail` output. Two tests loop
  both output modes against your pinned legacy fixture case, and the projection
  is applied before the concise view strips anything, so it cannot be lost by
  the compact path. That is the regression proof you asked for, and it exists
  now rather than being promised.
- **This client sends no announcement-policy header at all today** — not `v2`,
  and not `accept`. So the legacy path your note describes is exactly what is on
  the wire from this lane right now, and nothing needs to be removed.
- **The renderer is an allow-list, not a spread.** It projects five values and
  omits `schema_version` and `scope_statement_kind` deliberately, because your
  earlier ack listed exactly what a client may show. A v2 matrix with new fields
  will not leak through it by default; it will need explicit work, which is the
  intended cost.
- **No provider-wide inference.** Target rows are rendered as served: a grant for
  one capability never authorizes another, `capability_ids` are never widened to
  the catalog, readiness is never collapsed per target, and a rate limit is never
  hoisted between sibling entries. Tests hold all three by mutation.

## Unrelated, and worth knowing

`ceal-v0.67.1` is released and published to the immutable origin — the first
worker release built against the `v0.66.1` artifact, with the stable pointer
advanced. `ceal-v0.67.0` was burned by a release-lane bug of this lane's own and
never published. Installed-client evidence is the next step here.

## Not claimed

No Gateway apply, provider roundtrip, live discovery, enrollment, or
announcement authorization. The five-entry table above was read from the vendored
copy of your `v0.66.1` artifact at `HEAD`; it is a statement about those bytes,
not about your current source.
