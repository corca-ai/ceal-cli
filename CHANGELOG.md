# Changelog

## 0.75.0 (`ceal-v0.75.0`)

**The `effect` field now names a change that does not happen on this machine.**
Its vocabulary stopped at the local filesystem, so `ceal call` — the one route
that executes a governed provider capability — declared the same effect as `ceal
version`, and `ceal session logout` declared the same effect as linking a guide
symlink. That field is what an operator or an agent is told to read before typing
a route, and `npm run probe` derives its refusal from it, so the sanctioned probe
path admitted the route that can write to a provider.

- `remote_write` is the new term. `call` and every `session` route carry it:
  enrolling and adopting consume a one-time approval at the Gateway, and logging
  out revokes a live session. None is undone by deleting a local file.
- It classifies what a route MAY do. `call` stays `remote_write` even for a
  capability whose own effect is `read`, because the field is read before the
  route is typed.
- `ceal <route> --help` and `ceal commands` report the new value.
- `npm run probe --allow-effect remote_write` is refused: that hatch's safety
  argument is its throwaway `HOME`, which cannot take back a revoked session, a
  consumed enrollment code, or a posted message.

The release lane gained two proofs and lost a blind spot. The `linux-arm64` leg
now runs `test:release`, so the packed-Gateway-consumer proof finally covers the
one signed binary that had never been asked whether npm's resolver bound the
packed tarball rather than a workspace symlink. The asset merge re-asserts the
protocol pin before anything is signed, instead of catching a disagreement only
against an already-published release. Both were first executed by a dispatch dry
run rather than by a tag, which is now possible because `assemble` is reachable
without one.

## 0.72.9 (`ceal-v0.72.9`)

`ceal-v0.72.8` is burned: its tagged composer refused the v4 control
conformance schema (`invalid_control_conformance`) before signing anything;
this release adds the v4 schema to the accepted identity envelope.

Turns the private Agent-control carrier into the v4 capability carrier so a
Gateway serving the RunnerSession v4 path has a signed worker to select.

- **Speaks only the v4 capability control grammar.** The private carrier's
  Agent IPC advertises `ceal.leased_consumer_capability_control_request.v4` /
  `response.v4` over the same stdin/stdout NDJSON, 32 KiB, serial contract,
  and its Gateway routes are exactly the five canonical operations (`acquire`,
  `projection`, `recheck`, `call`, `complete`). The v3 terminal-reply grammar
  and its `reply` route are rejected, not silently narrowed.
- **Consumes the signed protocol-only handoff v0.72.6.** Lock, frozen Protocol
  source (`@corca-ai/ceal-protocol@0.72.6`, Gateway commit `851a9d7c`),
  vendor pin, embedded control contract, generated source, and the release
  workflow literals name one identity.
- **Keeps the runtime boundary closed.** This release does not register a
  Gateway socket, launch or cut over an Agent service, receive Slack ingress,
  or prove a provider capability call.

## 0.72.7 (`ceal-v0.72.7`)

Consumes the signed Gateway Protocol handoff needed to remove the last
machine-specific UDS assumption from the private Agent-control carrier.

- **Binds one verified Protocol input.** The lock, frozen Protocol source,
  worker dependency declarations, embedded control contract, and worker-release
  workflow all name `gateway-protocol-handoff-v0.72.4` and
  `@corca-ai/ceal-protocol@0.72.4` from Gateway commit `c3f2df48`.
- **Lets the Gateway select its own safe private socket.** The Agent-facing
  carrier obtains the UDS path only from the protected FD-4 session after the
  Protocol decoder validates it; no static host path or Agent-selected path is
  accepted.
- **Keeps the runtime boundary closed.** This release does not register a
  Gateway socket, launch or cut over ceal-agent, receive Slack ingress, or
  prove a provider call.

## 0.72.6 (`ceal-v0.72.6`)

Makes the signed worker release ready for the private Agent's reply-control
handover and for a second employee device awaiting operator approval.

- **Carries the signed Gateway reply-control v3 contract.** The private carrier
  accepts only its six fixed UDS operations, including a bounded terminal
  reply; it does not start, register, or cut over an Agent service.
- **Makes additional-device waiting an actual negotiated flow.** `session
  adopt` advertises the bounded approval-wait feature, follows the Gateway's
  interval, and prints one operator-wait transition rather than a poll stream.
- **Separates worker dependency installation from frozen operator history.**
  Worker CI and release installation resolve only the protocol/client/worker
  workspaces, so the archived cealctl protocol pin cannot block a worker update.
- **Shows stable update progress on a terminal.** Interactive `ceal update`
  writes bounded stages to stderr while preserving its one YAML document on
  stdout for agents.
- **Consumes the signed Gateway v3 control conformance.** Release composition
  retains byte and producer-identity binding while accepting the v3 reply
  control envelope; unknown schemas remain fail-closed.

## 0.72.4 (`ceal-v0.72.4`)

Fixes false first-device-adoption expiry on a machine whose wall clock differs
from the Gateway's.

- **Makes Gateway expiry authoritative.** The worker no longer compares a
  Gateway challenge timestamp to its own wall clock; it waits for the
  Gateway's terminal `expired` result instead.
- **Keeps liveness bounded without relabeling it as expiry.** A repeatedly
  pending Gateway reaches a 35-minute monotonic local safety limit and reports
  `wait_timeout`, not a fabricated mailbox-verification expiry.

## 0.72.3 (`ceal-v0.72.3`)

Fixes the employee-visible adoption waiting surface.

- **Keeps terminal progress quiet and accurate.** After the initial browser
  instruction, `ceal session adopt` emits one waiting message and silently
  follows the Gateway-provided polling interval until the terminal result.
- **Does not weaken browser pairing.** The browser still requires the employee
  to compare the device fingerprints before explicitly confirming the mailbox.
  A mailbox-link fetch alone cannot seal a session to a device.

## 0.72.2 (`ceal-v0.72.2`)

Carries the exact v2 private result-control frame required by the reviewed
Gateway result-delivery fence.

- **Adds a separate result-bearing control grammar.** The worker accepts only
  `ceal.leased_consumer_result_control_{request,response}.v2` for its private
  `call` operation; it keeps the v1 status-only control session distinct.
- **Rejects a stale or invented carrier before socket I/O.** Valid-looking v1
  and unknown-version result frames are refused without any UDS request.
- **Does not cut over service delivery.** This artifact neither registers the
  Gateway socket nor launches an Agent, invokes a provider, transfers Slack
  ingress, or makes a provider-derived result user-visible.

## 0.72.1 (`ceal-v0.72.1`)

Consumes the signed `gateway-protocol-handoff-v0.71.8` packet.

- **Pins the result-carrier grammar to the reviewed Gateway artifact.** The
  vendored `@corca-ai/ceal-protocol@0.71.8` tree, its compiled `dist/` bytes,
  the handoff lock, the worker's embedded control-session contract, and the
  release workflow all bind the same immutable Gateway producer identity.
- **Keeps the service boundary closed.** The worker retains the v1 private
  control-session frame. This release does not register a Gateway result writer,
  issue a credential, launch an Agent, route Slack ingress, or claim a
  successful provider call.

## 0.72.0 (`ceal-v0.72.0`)

Introduces the signed-worker contract needed for the Gateway-owned Agent
control-session handover.

- **Carries a private five-operation control session.** The hidden carrier can
  only receive its one-shot Gateway session through protected FD 4, gives it a
  fixed two-second deadline, and accepts serial newline-framed canonical
  requests for `acquire`, `projection`, `recheck`, `call`, and `complete`.
  The Agent receives only those framed requests and responses; it never receives
  the Gateway credential, socket path, or a caller-selectable route.
- **Binds the control session to the reviewed protocol-only handoff.** Its
  release contract names `gateway-protocol-handoff-v0.71.6`, Gateway commit,
  protocol subtree, and archive digest. The generated source, every native
  worker artifact, and every platform release manifest must carry byte-identical
  contract bytes; composition and merge refuse drift.
- **Does not cut over a service.** This release does not register the Gateway
  socket, issue a protected session, launch `ceal-agent`, accept provider
  ingress, or prove any capability call. Those are separately applied and
  observed Gateway/Agent operations.

## 0.71.0 (`ceal-v0.71.0`)

The first worker release candidate that consumes the Gateway **protocol-only**
handoff, `gateway-protocol-handoff-v0.71.6`.

- **Consumes `@corca-ai/ceal-protocol@0.71.6`** from the signed, publicly
  published `ceal-gateway-protocol-handoff-0.71.6.tar.gz`. The archive, its
  `SHA256SUMS`, and its Sigstore certificate/signature were verified against the
  Gateway release workflow identity for that tag before anything was consumed.
- **Replaces `gateway-handoff-lock.json` with
  `gateway-protocol-handoff-lock.json`.** The new lock binds the Gateway
  commit/tree/protocol-subtree, the tag, the Actions run, the release origin, the
  Protocol package digest, the archive digest, the embedded manifest digest, and
  the Sigstore identity the archive was reviewed against. The release workflow's
  origin literal is now derived from the lock in the gate rather than asserted as
  its own string, which is the literal a handoff-origin move used to leave stale.
- **The Gateway packet no longer carries this repository's client tarball.** The
  builders already packed the client from `packages/ceal-client`; the packet's
  client copy was a verification witness only. The consumer now accepts exactly
  five members — marker, Protocol tarball, handoff manifest, Protocol provenance,
  and the Gateway's leased-consumer control conformance — and refuses a packet
  that still ships a client tarball.
- **Binds the leased-consumer control conformance without interpreting it.** Its
  bytes must match the signed manifest and it must name the same Gateway commit
  and protocol subtree as the rest of the packet. This repository implements no
  control surface, and this claims none.

Released and published, with a clean-machine `linux-amd64` proof: the signed
binary was fetched from the public origin, verified against the tag's cosign
identity, and run. This is not an installation-script proof, not a Gateway
apply, not an email-delivery proof, and not a device acceptance record.

## 0.70.0 (`ceal-v0.70.0`)

The first worker release candidate that consumes the published
`gateway-handoff-v0.68.0` archive and carries verified-email first-device
adoption.

- **Adds `ceal session adopt`.** A consenting employee starts with the
  published Gateway URL and their mailbox; the device creates its own proof and
  recipient keys, the browser completes mailbox verification, and only an
  authenticated HPKE-sealed session bound to those keys can be stored. It never
  automates the browser, exposes a raw credential, or falls back to copied code
  enrollment.
- **Carries the private Agent leased-consumer carrier.** It accepts only the
  SHA-locked Gateway conformance input, accepts the protected service credential
  only from its one-shot private channel, and cannot turn into a public `ceal
  call` fallback or caller-supplied provenance channel. Every native platform
  now rejects a stale generated handoff before bundling, records its exact
  identity in the release manifest, and refuses a cross-platform identity split
  during merge.
- **Uses the Gateway v0.68.0 origin.** The release workflow downloads the
  immutable public handoff archive before composing every platform asset. This
  candidate is not a release, installation proof, Gateway apply, email-delivery
  proof, or device acceptance record.

## 0.69.0 (`ceal-v0.69.0`)

The first worker release built against `gateway-handoff-v0.67.0`, and the first
that ships the Protocol/Client pair as a pair.

- **Consumes the signed `v0.67.0` pair.** Protocol `0.67.0` and Client `0.69.0`,
  producer `corca-ai/ceal@0261f0a4…`, archive `94093501…`. Every digest was
  recomputed locally before the lock moved, and the lock rebind, vendored
  re-sync to protocol subtree `58d7d639…`, re-pin, and version declarations
  landed in one commit so `main` never carried a proof/ship divergence.
- **The handoff lock now declares the package pair.** It previously derived both
  tarball names from the handoff tag, which assumed the tag version, the
  Protocol version, and the Client version were one number. They are not: this
  artifact carries Protocol `0.67.0` beside Client `0.69.0`, and the old
  consumer looked for a Client tarball named after the tag and failed the
  inventory check. Every fixture used one version for both packages, so the
  fixtures agreed with the bug; the regression test now gives the fixture a
  Client version deliberately different from the tag.
- **The vendored decoder binds the full announcement-policy matrix** — twenty
  capabilities, including `resource.resolve` with distinct provider-bound
  entries, Calendar, Drive search, and Sheets. The previous copy bound five,
  which made any policy outside that set fail `validateDiscoveryCapability` and
  take the whole discovery response down with it. The `x-ceal-announcement-policy`
  header is still not sent; enabling it is a separate, evidenced step.
- Client refusal paths are covered: unusable transport, out-of-range timeout,
  unparseable endpoint, embedded credentials, query or fragment, plaintext to a
  non-loopback host, non-HTTP scheme, malformed enrollment code, non-JSON
  content type, malformed JSON, well-formed JSON of the wrong shape, unparseable
  or oversized `content-length`, an undeclared oversized body refused mid-stream
  and cancelled rather than buffered, and timeout told apart from transport
  failure — the last set run against both session routes.
- `biome` now refuses bare web globals in `.mjs`. The idiom was already
  `globalThis.Response` throughout these tests, and nothing local caught the
  drift because `biome` knows those globals; another lane's stricter harness
  found it after consuming the commit.

## 0.68.0 (`ceal-v0.68.0`)

Adds `ceal acceptance emit`, so an installed release can produce its own
acceptance evidence.

Until now that record came from `scripts/worker-acceptance-packet.mjs`, which
means a source checkout — and the Gateway lane's ingress contract refuses a
source checkout as an input, while a colleague on a fresh machine has no
checkout to run it from. Producing evidence therefore required cloning the
repository first, which made "does the release work on this platform" and "can
an ordinary user run this" two different questions with only the first one
answerable. The new command measures the running binary, so there is no
`--binary` to substitute and no repository to clone.

- Requires the same three statements to agree before it says anything: the bytes
  on disk, the release manifest's declared artifact digest, and the `SHA256SUMS`
  line. A build tree has no release layout beside it and is refused rather than
  described as an installation.
- **Performs no provider call.** A verification command that takes a real
  provider action as a side effect is how an evidence run becomes an unlogged
  one. `--request-ref` reads back the receipt of a call `ceal call` already made,
  which is a read.
- Assembled by allow-list, so the emitting host's filesystem paths and local
  agent registration paths are never included — the record describes an
  installation without locating one. Registration paths become a count.
- States what it did not reach, including that an installed host carries no
  handoff lock, so the protocol producer tuple is the release manifest's own
  statement and is not cross-checked there.
- Failures speak the command's own result schema with `ok: false`, as
  `ceal capabilities` does, so a caller parses one shape.

The repository script keeps its role for maintainer runs, where the lock is
present and the producer tuple can be cross-checked.

## 0.67.1 (`ceal-v0.67.1`)

Carries everything `0.67.0` intended, plus the fix its burn taught.

`0.67.0` never published: the `linux-arm64` leg failed in `Build and test
source`, before `assemble` or `sign-and-publish` ran, so no object was uploaded
and no signature was issued. The release lane asked every `linux-*` leg for the
platform proofs, but those proofs build a SEA and run an installer for
`linux-x64` — on `linux-arm64` they cannot run, and the flag turned a correct
skip into a hard failure. The flag had landed after `ceal-v0.66.1`, so `0.67.0`
was the first release to execute it, and `check.yml` has no arm64 leg, so nothing
before the tag could have caught it. The demand is now `linux-amd64` exactly, and
a contract test fails on any prefix match over platforms. One clean run per tag
is the contract, so the tag was burned rather than re-pushed.

## 0.67.0 (`ceal-v0.67.0`, never published)

The first release built against the `gateway-handoff-v0.66.1` artifact, and the
first that can be installed to produce installed-client acceptance evidence for
it. Every release before this one is refused by `npm run accept:worker` now, by
design: the lock moved and their protocol producer did not.

- **Consumed the signed `v0.66.1` Gateway handoff.** The archive was fetched from
  the immutable release origin and all five digests recomputed locally — archive,
  the `gateway-artifact-handoff.json` inside it, both package tarballs, and the
  six-member inventory. `gateway-handoff-lock.json` now binds Gateway commit
  `2747f6b1…`, the frozen `packages/ceal-protocol` copy was re-synced to the
  tagged subtree `ac602cc1…`, and `protocol-vendor-pin.json` re-pinned — one
  commit, because the verifier fires `shipped_lock_mismatch` the moment the lock
  moves without the pin.
- **A proof/ship protocol divergence is now fatal.** It fails
  `proof_shipment_protocol_divergence`, names both immutable identities, and is
  refused independently by the release, packing, native-artifact,
  release-artifact, and acceptance-packet paths rather than only reddening a test
  command. The verdict compares the pin's `source.commit` against the lock's
  `gateway.commit` — not the pin's own two tree fields, which are both
  author-written. `npm run check:protocol-dev` is the development-only path while
  a divergence is open, and its output stamps itself `development_only`.
- **A throttled call now carries the Gateway's own retry wait**
  (`error.retry_after_ms`) instead of dropping it. The protocol has validated
  `recovery.retry_after_ms` all along; this renderer discarded it, so an agent had
  to binary-search a safe pace against prose (corca-ai/ceal#642). Absence stays
  absent — the number is the Gateway's or it is not there, never a locally
  invented backoff. The quota axis itself rides on
  `targets[*].capability_access[*].rate_limit`, whose `counted_unit` says whether
  the quota counts calls or records.
- **The acceptance packet has a sanitized external form**
  (`ceal.worker_acceptance_result.v1`, `--sanitized`): an allow-list projection
  that omits the emitting host's binary path and local agent registration paths,
  reduces those paths to a count, and keeps `instance_ref`/`profile_ref` as
  Gateway-issued identifiers being returned to the Gateway that issued them.
- **A target's capability access is held to the multi-target selection contract.**
  A grant for one capability never authorizes another: `capability_ids` and the
  matching `capability_access` entries are rendered as served, never widened to
  the catalog, collapsed to one readiness per target, or hoisted between
  siblings.
- Every consumer now declares the locked protocol version exactly. A loose range
  would have satisfied `npm ci` by switching off the check that a shipped package
  declares the protocol the lock binds.
- The release workflow reads the archive the lock names, and a contract test
  fails whenever its handoff tag or filename disagrees with
  `gateway-handoff-lock.json` — a stale literal there downloads the wrong archive
  and burns a tag.

## 0.66.1 (`ceal-v0.66.1`)

Carries everything `0.66.0` intended — including both breaking changes below —
plus the two fixes that burn taught. `0.66.0` never published: it failed in
`Build and test source` on both macOS runners, before `assemble` or
`sign-and-publish` ran, so no object was uploaded and no signature was issued.
One clean run per tag is the contract, so the tag was burned rather than
re-pushed.

- `test/contract/safe-output-path.test.mjs` built its fixtures under `tmpdir()`,
  which on macOS is below `/var/folders/...` where `/var` is a link to
  `/private/var`. A guard whose entire job is to refuse symlink components
  therefore refused the fixture path itself, so the two accept-cases failed —
  and, worse, the refuse-cases had been passing for the wrong reason. The
  fixtures are `realpath`ed now.
- The check lane runs on macOS as well as Linux. The release lane builds four
  platforms; the gate built one, so a macOS-only break could not surface until a
  tagged run. Only the Linux runner is asked for the platform-gated proofs,
  since those build for linux-x64 and a macOS runner is correct to skip them. A
  repo gate now pins that the check lane covers every family the release lane
  builds on.

## 0.66.0 (`ceal-v0.66.0`, never published)

The minor names two clean breaks taken together. Both retire a compatibility
shim that made a reader consult a caveat to know which field was authoritative,
and neither ships an alias — a deprecation window with no recorded closing date
is how the ambiguity survives its own fix.

**Breaking: `error.code` is gone; `kind` is the only error key.** `0.65.9` made
`kind` canonical but kept `code` beside it on the surfaces that had published
`code` first, so a client still had to know which surface answered to know which
key to read. Anything reading `error.code` off `ceal.capabilities.v1` or a
rejected enrollment must read `error.kind`. The structural gate now bans `code`
outright rather than requiring `kind` next to it.

**Breaking: `hosts` is the only per-host answer in the guide document.**
`ceal guide status` no longer projects one host's registration into the
top-level `status`/`registration_path`/`registered` fields. Top-level `status`
is now about the document — `available` or `unavailable`, agreeing with `ok` and
the exit code — and per-host registration lives in `hosts` and nowhere else.
`agent` names the host the document is about: the detected one for `status`, the
one a route named for `register`. The `non_claims` caveat that told readers
which fields to distrust is gone because there is nothing left to mistake.

Also in this release:

- The transcript audit follows the same host roots guide registration does. It
  hardcoded `~/.claude` and `~/.codex` and never read `CLAUDE_CONFIG_DIR` or
  `CODEX_HOME`, so an operator who moved either root got a guide surface that
  followed the override and an audit that scanned the untouched default and
  reported it empty. Both resolve through one table now, and the audit renders
  the root it actually scanned.
- A rejected `capabilities` argv names the undeclared option instead of
  reporting a failed target selection (corca-ai/ceal-cli#5). The bare catalog
  route selects no target at all, so an agent reading the old error went looking
  for missing grants when the fault was a flag the route does not declare.
- One `client_session` failure-reason table instead of two hand-maintained
  lists. A reason known to the classifier but missing from the second list
  rendered correctly under `ceal session` while `ceal call` emitted an
  `outcome_unknown` receipt for a call the Gateway never issued. An unclassified
  non-token reason now reports `session_unusable` rather than echoing the raw
  string into the public `kind` field.
- A symlink guard that three of its five copies did not perform. They tested
  `existsSync(current) && lstatSync(current).isSymbolicLink()`, and `existsSync`
  *follows* the link, so a component symlinked to a nonexistent path was
  accepted and then created through — the redirection the guard exists to
  refuse. One `lstat`-only guard now serves the release scripts.
- The shipped version is read from each package's own manifest. Three source
  files retyped it, two of them inlined into request bodies with no gate, so a
  release that missed one would introduce the client to the Gateway under a
  version it is not. A release now bumps three manifests and regenerates the
  lock; a repo gate fails a commit that retypes the version or lets the
  manifests disagree.
- The release lane retries its public readbacks. `0.65.8` was burned by a single
  transient HTTP 500 after upload, and a burned tag is never reused. Transport
  failures, 429, and 5xx retry; a 404 still returns immediately because that is
  the signal the uploader acts on. **Unproven until this release runs** — this
  is the first tagged run to exercise it.
- Repository gates the release depends on: Biome as lint/format in both gates, a
  pre-push hook, CI that runs the full gate on every push and pull request to
  `main`, and an end to the release suite reporting green on hosts where the
  real-binary and installer proofs silently skip themselves.

## 0.65.10 (`ceal-v0.65.10`)

- Preserve session recovery truth at the Gateway boundary. A transport or
  malformed refresh response is now retryable and says it is not evidence that
  enrollment is invalid; a typed revoked, expired, replayed, or binding-denied
  refresh response directs the operator to enroll again. Failed remote logout
  also preserves the local session for a retry instead of silently destroying
  recovery material.

## 0.65.9 (`ceal-v0.65.9`)

Contents identical to `0.65.8`, which never published: its release run lost the
public readback to a transient HTTP 500 after uploading, and the retry could not
succeed because cosign issues a fresh certificate per run while published objects
are create-or-identical. One clean run per tag is the contract, so the tag was
burned rather than forced — the same disposition `0.65.2` received.

## 0.65.8 (`ceal-v0.65.8`, never published)

- Restore the upgrade path `0.65.7` broke. `ceal update` runs the **installed**
  generation's `install-ceal.sh`, and that script compared the new binary's
  `ceal version` document byte for byte. `0.65.7` added one line to it, so every
  already-installed client failed its own update with `update_failed` — the new
  release was fine, the upgrade to it was not. `ceal.version.v1` is unchanged
  again and is now treated as frozen, and the installer checks the fields it
  depends on instead of the whole document, so this class of break cannot repeat.
  A client that installed `0.65.7` fresh carries the strict comparison in its own
  installer and needs one `install-ceal.sh` reinstall to move on; a client on
  `0.65.6` or earlier updates normally.

## 0.65.7 (`ceal-v0.65.7`, superseded — do not install)

Four reports from a study that uses `ceal` as its only path to organizational
data. Each one is a case where the surface told an agent less, or worse, than it
knew.

- Answer with one error key and one success predicate on every surface
  (corca-ai/ceal-cli#2). A client that read `error.kind` saw discovery failures —
  which published `error.code` — as no error at all, so its retry path was
  skipped and a 36-call sweep lost 16 calls while reporting none of them. `kind`
  is now the one error key everywhere, with `code` retained beside it on the
  capabilities surface for one release, and every result document carries `ok`, a
  boolean that means the same thing whatever a surface calls its `status`. Status
  vocabularies themselves are unchanged.
- Preserve the Gateway's `invalid_arguments` rejection instead of flattening it
  into a generic failure that advised a retry. An out-of-contract argument is a
  deterministic caller error; the recovery now asks for a correction.
- Render `audit_event_not_found` and `invalid_readback_request`, and stop
  describing `ceal receipt show` as serving completed calls only. An unknown
  outcome used to point at a route the same surface documented as unusable for
  it; the Gateway had been answering precisely all along. A rejected call's
  reference does read back as `verified`, which this release documents.
- Gate the replay caution on the failing capability's declared effect. "Do not
  repeat a write" rode on every unknown outcome, including declared reads; it now
  consults the client's own discovery cache, and a cold cache keeps the caution.
- Name the issuing Gateway on `ceal call` and `ceal receipt show`
  (corca-ai/ceal-cli#3). Two instances answer with the same profile name, the
  same client, and cross-stable target refs, so archived responses could not be
  attributed — one study mixed 2,387 records from two instances and read it as a
  narrowed grant. Both documents now carry the `gateway:` block discovery already
  emitted, stamped with the profile the call actually used.
- Name the agent host that is running, and point an agent at the signed guide
  (corca-ai/ceal-cli#4). `ceal guide status` reported the first declared host, so
  a Claude Code session read `agent: codex` and `registered: false` while its own
  registration was live. The summary now names the detected host and says so in
  `agent_source`; the per-host `hosts` list and the previously projected fields
  are unchanged in place. `ceal capabilities` carries one advisory when the
  detected host has the guide staged but unregistered, and stays silent
  otherwise.
- Name the missing target when a skills directory is a link to nothing, instead
  of advising against replacing a skill directory that was never there.

## 0.65.6 (`ceal-v0.65.6`)

- Register the signed guide with Claude Code, not only Codex. `ceal guide
  register claude` links the same update-safe guide into
  `<CLAUDE_CONFIG_DIR|~/.claude>/skills/ceal-guide`, the way `register codex`
  honors `CODEX_HOME`. In the guide surface the agent host is now one declaration
  per host, so a route, its leaf help, and its registration path derive from the
  same table; `ceal observe`'s transcript inventory still reads `~/.claude` and
  `~/.codex` directly and ignores both overrides.
- Report every supported agent host from `ceal guide status` and `ceal guide
  register`. The top-level `agent`, `registration_path`, and `registered` fields
  of `ceal.guide.v1` still project one host — the Codex host, whether or not its
  directory resolved — and a new additive `hosts` list carries each advertised
  host, including one whose configuration directory could not be resolved. The
  document states that bound in `non_claims` instead of leaving a reader to infer
  it, and `ceal observe` now names both registration paths in its declared
  local data sources.
- Refuse a host configuration directory that is not one absolute path. A
  relative `CODEX_HOME` was previously joined, which would have built a skill
  tree under the current working directory and then reported it as a real
  registration; a colon-separated value would have built one under a literal
  `dir:`-named path. Both are now refused for either host. This is a behavior
  change for an existing relative `CODEX_HOME`: `ceal guide status` answers
  `registration_failed` and exits 3 where it previously exited 0.
- Keep a declared local write inside the verification probe's throwaway HOME:
  `npm run probe` now also pins `CLAUDE_CONFIG_DIR` and `XDG_RUNTIME_DIR`, the
  latter of which kept an operator-real admin Gateway socket reachable from a
  probe of an effectful operator route.

## 0.65.5 (`ceal-v0.65.5`)

- Give every subcommand the installed help advertises its own leaf help, so the
  signed guide's mandated descent can be completed. `ceal capabilities targets
  --help` answered `invalid_argument` (exit 2) instead of that leaf's
  `Effect` / `Evidence` / `Result schema` / `Recovery/readback`, which left an
  agent unable to tell whether an unfiltered target page was in contract
  (corca-ai/ceal-cli#1). Subcommands are now declared next to the command
  registry in both CLIs, parent help advertises a `Subcommands:` block, and the
  target-selection leaf states that an unfiltered page is permitted and bounded
  by `--limit <1-64>` with the Gateway still authoritative.
- Treat a help token anywhere in the tail as read-only help. `ceal session
  enroll --gateway --help` previously passed `--help` as the gateway value and
  reached the enrollment runner, prompting for a device-enrollment code before
  it could fail; `cealctl sessions use --help` reached the session runner the
  same way. A help probe now resolves to the nearest declared leaf — falling
  back to the parent, whose `Subcommands:` block names the real routes — with no
  credential read, stdin read, or network call reachable from it.
- Fix `cealctl enrollments create` advertising `cealctl.enrollments.v1`, the
  schema only the bare route emits; the route emits
  `cealctl.enrollment_created.v1`. A new per-package gate requires every
  declared result schema to exist in the emitting package.
- Carry the child routes in `ceal commands` and `cealctl commands`, so the
  machine-readable inventory is not shallower than the prose help surface.
- Narrow the worker guide's opaque-cursor rule to the target page that actually
  emits `next_cursor`. A capability's own result paging is a separate contract
  read from its discovered input contract, so an integer offset no longer reads
  as a guide violation; both guide hashes in `release-contract.json` are
  re-signed accordingly.

## 0.65.4 (`ceal-v0.65.4`)

- Build and sign `darwin-arm64` and `darwin-amd64` in the tagged worker lane,
  making a macOS install possible for the first time. `install-ceal.sh`
  verifies every asset against its tag-bound OIDC signing identity and has no
  unsigned bypass, so a manually built Mac artifact had no install path at all.
- Extend every release-lane site that names a platform, including the stable
  rollback workflow. Left at the linux set, a rollback to a four-platform tag
  would have failed its checksum pass — and, had it passed, would have advanced
  the stable pointer having verified only half the signed assets.
- Verify the Gateway handoff archive with node instead of `sha256sum` in the
  build job, which now also runs on macOS runners that do not ship it.
- Gate the frozen legacy dual-installer suite and the two simulated-darwin
  cases on the host tools they require rather than on the platform. Neither is
  macOS coverage: `install.sh` serves the linux-only legacy lane, and the
  simulation's host is the host it simulates.

## 0.65.3 (`ceal-v0.65.3`)

- Repair the amd64-only real-native release proof by deriving its requested
  version from the worker package manifest. The first `ceal-v0.65.2` attempt
  stopped at that proof before it assembled, signed, uploaded, or advanced any
  static release state; `0.65.3` is the replacement publication tag.

## 0.65.2 (`ceal-v0.65.2`, unpublished)

- Remove GitHub Releases from the worker delivery path. The tag workflow now
  publishes and reads back the signed worker asset set through the Ceal static
  release origin, then advances a digest-bound stable pointer. The installer
  and missing-cosign bootstrap fetch only that origin; GitHub remains the
  source and tag-bound OIDC signing identity.
- Add the explicit, re-verified stable rollback workflow. It can move only the
  stable pointer after it has re-downloaded the selected versioned inventory,
  checked its hashes, and verified every OIDC signature.

## 0.65.1 (`ceal-v0.65.1`)

- Version the worker independently of the pinned Gateway Protocol artifact:
  worker and client move together to 0.65.1 while both keep the exact
  `@corca-ai/ceal-protocol@0.65.0` pin from the signed
  `gateway-handoff-v0.65.0` archive; frozen compatibility packages and the
  legacy dual-lane contract stay at 0.65.0.
- Complete the receipt event-level timing contract: strict decode accepts the
  negotiated top-level `gateway_elapsed_ms`, denied/failed receipts render
  `error_code`, `non_claims`, and `timing` with the event envelope
  authoritative over call-detail timing, and missing negotiation omits timing
  rather than rendering zero.
- Shape `ceal observe` into the Workbench first navigation: separate
  "My agent work" and "Ceal" views plus a "Privacy & retention" view backed by
  a declared-source `privacy` state section (local sources, retention bounds,
  fixed no-forwarding boundary).

## 0.65.0 (worker-only release addendum, `ceal-v0.65.0`)

- Cut the first worker-only signed release route: `ceal-release.yml` builds
  per-platform asset sets from the locked Gateway handoff archive, signs them
  keyless, and publishes a `ceal-v*` prerelease that `install-ceal.sh`
  verifies fail-closed. This lane supersedes the legacy dual `v0.65.0`
  release for worker installs; the version number stays 0.65.0 because the
  supplied Gateway Protocol artifact and the frozen release contract pin it.
- Extend the worker lane to `darwin-arm64`/`darwin-amd64`: portable installer
  (shasum/mkdir-lock/BSD-mv fallbacks, darwin cosign pins), Mach-O SEA
  ad-hoc signing in the native builder, and darwin-aware `ceal update`.
  macOS artifacts are built manually from a Mac checkout for now
  (`docs/macos-worker-runbook.md`); darwin CI runners stay disabled.
- Add loopback-only `ceal observe`: a guarded 127.0.0.1 page over cached
  session (tokens structurally redacted), capability/target catalog, install
  generation, and guide status; receipts render as `unknown` and the server
  never contacts the Gateway or a provider.

## 0.65.0

- Add option-free, stable-only `ceal update` for a verified installed worker
  release. It reuses only the staged release-signed installer, preserves the
  operator command, reports version/digest/platform/elapsed readback as YAML,
  and rejects an older resolved stable release.
- Make `ceal capabilities` concise by default (omit each capability's
  `input_contract`/`write_contract`); add `--detail` to restore the full
  contracts, keeping the catalog small on every call.
- Cache the worker discovery catalog client-side so a warm `ceal capabilities`
  skips the ~4.3s Gateway probe; harden the cache directory to owner-only 0700.
- First signed public release cut from the reproducible dual-binary lane,
  superseding the unpublished 0.64.0 local candidate.

## 0.64.0 (local candidate)

- Add separate public source packages for `ceal` and `cealctl`.
- Add native unsigned `linux-amd64` dual-binary builds for independent worker
  client acceptance while keeping the first signed release lane on
  `linux-arm64`.
- Add stdin-token, outbound-only Gateway handshake and capability discovery to
  the worker `ceal` command without adding admin authority or inbound reachability.
- Add one protocol/client compatibility and release contract.
- Replace the inherited `cealctl`-only installer and signer with one
  source-built, OIDC-signed `linux-arm64` lane that installs both commands.
- Preserve immutable source baseline
  `f458a0bce291123644c84efdbeb48d5255a74c64` for a normal additive revert.
- Record `v0.1.1` only as the observed mutable legacy `cealctl`-only
  distribution pointer, not a dual-binary rollback release.

No public source push or release has occurred for this candidate.
