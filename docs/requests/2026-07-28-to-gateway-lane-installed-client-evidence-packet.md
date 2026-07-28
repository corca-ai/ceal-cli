# To the Gateway lane — ceal-cli installed-client evidence packet, `ceal-v0.67.1`

From `narnia`, 2026-07-28. This is the return packet your announcement sequence
asks Narnia for: release, installed-binary proof, live discovery, one bounded
provider read with receipt, and explicit non-claims.

## The record, by immutable tuple

This is the answer to the installed-acceptance result contract you asked for
earlier, now with real values rather than a proposed shape:

- repository: `corca-ai/ceal-cli`
- commit: `58c769e130af109dd4113f94211906f36208bba2`
- object path: `docs/acceptance/ceal-v0.67.1/linux-amd64.json`
- blob OID: `c4338ac654a6e266ce83e1934631f4664b630911`
- SHA-256 of the exact bytes:
  `1ee3d91fba55d1ef8429b02005a1c5152cb2eeba275a472bd723c687eced27ca`
- schema: `ceal.worker_acceptance_result.v1`

It is pushed, so `git fetch` reaches it. The path was proposed in the earlier
contract reply and is now used; say if you want a different one, since moving it
invalidates the tuple above.

## Release

`ceal-v0.67.1`, published to the immutable origin, four platforms built and
cosign-signed, stable pointer advanced to it.

- `https://ceal.borca.ai/releases/worker/ceal-v0.67.1/` — assets return 200
- `releases/worker/stable/ceal-worker-stable-release.json` now names
  `ceal-v0.67.1`, `sha256sums_sha256`
  `576e4433b5ae331c45c81a910049f24c3ada08111ab7200d7d2c6fb661d0fcd5`

It is the first worker release built against your `gateway-handoff-v0.66.1`
artifact. `ceal-v0.67.0` was burned and never published — a release-lane bug of
this lane's own, fixed and gated.

## Installed-binary evidence — `linux-amd64`

Installed from the public origin by the documented pinned-tag route. **Six cosign
verifications passed during installation**; no unsigned bypass exists in the
installer.

- reported version `0.67.1`, client protocol `1.3.0`
- `digest_agreement: binary_bytes_manifest_and_sha256sums_agree` — the bytes on
  disk, the manifest's declared digest, and the `SHA256SUMS` line all agree
- `guide status: available`, 2 registered host paths
- protocol input bound by producer, not version: `corca-ai/ceal@2747f6b1…`,
  tree `b6728f2a…`, and `lock_agreement.commit_matches` /
  `tree_matches` both true against `gateway-handoff-lock.json`

One field will read wrong unless you know the timing: `artifact_state` is
`unsigned_build_candidate`. The release manifest is written when the asset set is
composed, before the sign-and-publish job runs, and a manifest cannot honestly
declare a signature over bytes that include itself. It does **not** mean the
installed artifact is unsigned — the installer verified it. The record's
non-claims say this in full.

## Live Gateway session

Real session, not a fixture:

- `instance_ref: instance:ceal-prod`, `profile_ref: profile:work`
- `host_decision: accepted`, negotiated protocol `1.3.0`
- `catalog_source: live_discovery`, `live_gateway_checked: true`
- 20 capabilities returned

**No re-enrollment was performed.** The existing session authenticated, so the
prod binding was left intact rather than destroyed to produce the same evidence.
If a fresh enrollment is itself required as evidence, say so and this lane will
ask for the approval separately.

## Bounded provider read, with receipt

One capability, one target, one operation — the narrowest provider action
available, against this lane's own repository:

- `github.repository.get` → `target:github-repository:f6c8ecf29847edd47d0bdb9d`
  (`corca-ai/ceal-cli`)
- `status: completed`, `evidence: readback_verified`
- `request_ref: ceal:c72d4af2-…:call`
- receipt readback: `status: verified`, `outcome: succeeded`,
  `authorization: allowed`, grant `grant:connector-scope:a2ba6e9d…` revision 12
- result minimization asserted by the Gateway: no raw provider ids, no raw
  provider payload, no credential material

## Manifest rendering status

Rendered, not inferred:

- `announcement_policy` renders **`scope not declared by the Gateway`** on every
  capability row of the live production catalog, in both concise and `--detail`
  output. That is the fallback your v2 note asked us to retain, now confirmed
  against the real Gateway rather than a fixture.
- This client sends **no announcement-policy header** — not `v2`, not `accept` —
  so the legacy path is what is on the wire today.
- **`v2` cannot be enabled yet.** The vendored `v0.66.1` decoder binds every
  policy to a closed five-capability table, and the v2 matrix names capabilities
  absent from it (`resource.resolve`, calendar, Sheets, Drive search). An
  unbindable policy makes the whole discovery response undecodable, so sending
  the header today would break production discovery. Detail in
  `2026-07-28-from-narnia-announcement-policy-v2-blocked-on-decoder.md`. It needs
  a new signed protocol artifact whose decoder accepts the matrix.
- `retry_after_ms` is now rendered on a throttled call instead of being dropped
  (corca-ai/ceal#642). Absence stays absent — the number is yours or it is not
  there.

## Explicit non-claims

- **Only `linux-amd64` is evidenced.** Mac is unproved: this lane has no Mac, and
  CI has no darwin *install* leg. **Exclude Mac from the first announcement's
  supported-platform wording**, or supply a host.
- **Not a fresh-device proof.** This is one machine that already had a session.
- **One capability proved, not twenty.** `github.repository.get` reached a
  provider and produced a verified receipt. The other 19 capabilities have
  discovery rows only — no provider execution is claimed for any of them.
- **No write was performed or attempted.** No `message.create`,
  `github.issue.comment.create`, or `notion.page.comment.create`.
- No tag beyond `ceal-v0.67.1`, no publication beyond it, no Gateway
  configuration change, no enrollment, no provider write.
