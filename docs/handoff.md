# Ceal CLI Roadmap Handoff

## Workflow Trigger

Continue only the worker lane in the sibling repository's release execution
plan: [`corca-ai/ceal-cli` — worker lane](../../ceal/docs/next-release-execution-plan.md#corca-aiceal-cli--worker-lane).
The older roadmap ledger is stale against the 2026-08-12 reframe. Do not redo
the Worker shutdown, conditional PATH, read-only discovery, or invariant guide-method
repairs. Push, tag, release, publication, Gateway selection, and apply remain
separately approved boundaries.

## Current State

- Signed `ceal-v0.76.1` is installed on Linux ARM64. The binary digest is
  `5c893c8ab10575eab9da378c85d2ba300d2eb469bd6ed57d5207aae9569cfe04`;
  release run `31346152389` and the public checksum/signature readback are
  recorded in the [release record](../charness-artifacts/release/2026-08-10-ceal-v0-76-1.md).
- That signed worker authoritatively embeds
  `@corca-ai/ceal-protocol@0.72.13`. The release record owns the exact tarball
  and Gateway producer tuple and the commands that re-check the installed
  manifest/build-input chain. The `1.3.0` printed by `ceal version` is the wire
  negotiation version, not the npm Protocol package version.
- Source after `0.76.1` contains the #707 D2 conditional PATH guidance and the
  bounded D3 invariant guide method. The guide is a progressive directory
  carrier and names no fixed capability sequence. Installed-guide dogfood is
  still unproved, but the current cross-repo plan does not schedule it as a
  separate worker slice.
- `ceal capabilities` and target selection use `session_effect: refresh_if_needed`:
  an expired stored session is renewed once before the Gateway read, while a
  locally current or rejected token does not trigger a second refresh. Their
  result reports `session_refresh`. Receipt readback and acceptance remain
  observation-only and point to the explicit `ceal session refresh` route after
  authentication failure. This is enforced by the renewal-mode and CLI tests.
- The Worker-side half of `ceal-cli#13` is prepared but remains signed-handoff
  dependent. Target-selection
  results identify match, cursor, and unfiltered requests without copying the
  selector. When signed navigation declares URL selection unsupported, a
  URL-shaped `--match` fails closed as `selector_not_supported`; its exact
  non-echoing recovery selects the capability's opaque target and resolves the
  URL through `resource.resolve`. When navigation declares the
  required opaque argument source, the Worker renders that argument and handle
  kind without a provider-specific branch. Help and the checkout/next embedded
  guide no longer present URLs, call inputs, or opaque resource refs as
  universal target selectors. The installed `0.76.1` guide still carries the reported wording
  until a successor is released and registered. The current pinned Protocol
  strips the new `navigation` field, so both the typed URL refusal and its
  richer argument/handle recovery remain gated on the signed handoff. Without
  navigation the Worker preserves the Gateway result instead of guessing that
  every absolute URL is unsupported or hiding `resource.resolve`.
- The source renderer for the next target-navigation handoff now requires each
  target's public `connector_kind` and `target_kind`, and joins each served
  `capability_access` row to its catalog descriptor for `effect`, `readiness`,
  and derived `writable` (retaining an optional `rate_limit`). It never guesses
  a kind or widens access to the catalog. The currently pinned Protocol still
  strips those two additive target keys before the Worker sees them, so the
  renderer is covered only by an exact extended-shape unit fixture until the
  signed handoff is consumed; no live `ceal capabilities` target rendering is
  claimed from this checkout yet.
- The Worker-owned part of `ceal-cli#14` is locally repaired without widening
  the vendored Protocol. Call, receipt, and acceptance YAML now distinguish Gateway
  audit readback from provider-state readback while retaining legacy tokens;
  unknown writes retain their exact request reference, while the guide tells
  agents to preserve their inputs and required idempotency key. They remain
  unresolved for the operator because this Worker exposes no retry authorization
  for the write. The generated purpose and public command description no longer
  claim pre-approval. Gateway-owned replay, purpose provenance, terminal receipt,
  input-contract, and provider-evidence semantics remain outside this local
  projection.
- The current source also contains the client deadline/status/media-type and
  adoption-request boundary repairs, generic HTTP timeout classification, one
  all-or-none session lifecycle capability with the compatibility-only raw
  hooks, projected command context, and unlocked mutation fallbacks deleted,
  explicit guide-register provenance,
  bounded subprocess and Unix-socket settlement, monotonic local-store waits,
  managed-install integrity, dependency-closure package hooks, bounded native
  and installer process probes, reduced guide-contract spawning, and the
  directory skill carrier. Ship-facing asset merge re-asserts the vendored
  Protocol archive against the handoff lock before reading composed inputs.
  These are local source/test results, not installed worker claims.
- The next binary embeds the complete deterministic guide directory. Binary
  update is separate from explicit per-host `ceal guide register codex|claude`:
  guide materialization failure cannot reverse update success. A permanent
  self-contained compatibility asset keeps the immutable `0.76.1` installer
  able to cross directly without reinstall; that old binary cannot emit the new
  guide advisory, so read it from the updated command afterwards.
- The Protocol is no longer a vendored source tree. It arrives as the signed
  archive `vendor/ceal-protocol/corca-ai-ceal-protocol-0.73.0.tgz` that
  `gateway-protocol-handoff-lock.json` binds to
  `gateway-protocol-handoff-v0.73.0`, and both packages consume it as a `file:`
  dependency, so npm holds its bytes through the lockfile's `integrity` field.
  `packages/ceal-protocol` and `protocol-vendor-pin.json` are deleted and the
  quarantine they needed is discharged: proof/ship divergence has no constructor
  any more, because what the gates test is the archive a release ships.
  `npm run lint:protocol-artifact` is the whole check and runs in both gates.
  `.github/workflows/ceal-release.yml` names the same tag and archive.
- The release workflows now keep checkout/source proof outside privileged jobs
  and use the `ceal-cli-release` Environment only for release-origin credentials
  before worker publish or rollback activation. Same-run `github.sha` artifact
  names and assemble/verify digests bind the privileged handoff automatically;
  no per-release identity variables are required. Distinct `CEAL_ENV_*`
  credential names prevent fallback to legacy repository-level values. GitHub
  configuration is still a release blocker until that Environment has its
  deployment rules and owns those credentials; a maintainer's canonical tag push
  selects the release.
- The local Worker release candidate is `0.78.1` (`ceal-v0.78.1`), a patch
  version for the release-boundary repair. The old `ceal-v0.78.0` tag is not
  reused. The live Environment still carries the old approval variables until
  the workflow change is pushed and a one-time GitHub configuration cleanup is
  explicitly authorized; no release-time variable entry is part of the new
  procedure.
- `npm run check:unit` is the aggregate development iteration gate. Its one
  checkout build is followed by the internal `test:contract:built` lane, while
  package behavior tests and `npm run check:protocol-dev` provide no-build
  source feedback. The live Protocol artifact assertions belong to the root
  `test:release` tier, not `check:unit`; separate reachability tests prove the
  production ship guards refuse a mismatched or absent archive before reading
  release inputs or an installed binary. None of these local source/emitted
  checks is installed-worker, release, or live-serving proof.
- Final-gate quality work made audit deadlines deterministic in tests without
  changing the production bound, removed discarded V8 coverage from receipt
  process-gate children, separated their exact exclusion oracle from production
  best-effort lock timing, and watchdog-bounded both production contention
  outcomes. Only the actual first-write race remains concurrent.
  The packed Protocol consumer now derives its guide digest from the same
  canonical directory bundle as both release builders; its focused release test
  passes. The live package/native release positives assert the vendored archive
  against the lock before they build.
- A post-`e695ac9` residual sweep closed four more local sibling gaps: acceptance
  now rejects unsafe request refs before release/session work, both acceptance
  emitters keep the declared receipt key set total with explicit nulls, the
  workspace dist-lock deadline is monotonic, and a bounded npm/tsc process-group
  supervisor settles timed-out builds before the lock is released. These remain
  checkout tests, not installed or release proof.
- Client and Worker CLI behavior tests no longer consume checkout `dist`: they
  execute current TypeScript through one fail-closed direct/bare workspace
  resolver, and Worker CLI subprocesses inherit the same resolver. The Protocol
  is outside that resolver because it has no source here; it resolves to the
  vendored archive's `dist` like any other dependency.
  Emitted declarations, package exports, and the Worker executable are compiled
  and inspected together in an isolated temp client+Worker artifact
  workspace. Poisoned `dist`, immediate source mutation, orphan compiled-module
  mutations, and an unchanged checkout-dist fingerprint prove the authority
  boundary. Existing release package fixtures and the explicit root build still
  use the shared checkout-dist builder and mutex; migrate those before deleting
  that owner, without confusing this local test cleanup with the signed Protocol
  handoff.

## Next Action

1. The signed `gateway-protocol-handoff-v0.73.0` cut is consumed: the lock, the
   vendored archive, both `file:` dependencies, the generated contracts, and the
   release workflow all name it. A successor is acquired with
   `npm run bootstrap:gateway-handoff -- --tag <tag>` and landed as one coherent
   slice per [release and enrollment](release-and-enrollment.md). There is no
   vendored tree to converge and no pin to restamp.
2. Run the ordinary release gates and tag-resolved `0.78.1` installer crossing
   plus explicit guide-register proof. Push, tag, publish, and install remain
   separately approved external boundaries. Do not enter per-release digest or
   commit variables; after the workflow change lands, remove the legacy
   approval variables once as GitHub configuration maintenance.
3. Finish the worker-side D2 release named by the cross-repo plan. Installed-guide
   dogfood remains a proof opportunity after serving, not a separately scheduled
   worker slice. Do not invent future Protocol or Gateway-owned fields in this repo.

## Non-Claims

- Consuming the signed `0.73.0` archive is artifact-identity proof and nothing
  more. `npm run lint:protocol-artifact` binds local bytes to a local lock; it
  does not re-verify the signature or prove anything about the live
  `corca-ai/ceal` remote.
- No current source change is signed, released, installed, selected by a
  Gateway, or proved against a live provider.
- No signed Gateway capability-navigation handoff has been received or pinned;
  current source proves the generic fail-closed URL refusal and a structural
  consumer for the future metadata, not live metadata consumption.
- D2 and bounded D3 are locally complete but remain unreleased.
- Response-latency and concurrent notification/channel-loss proofs remain
  downstream of coherent signed selection and apply.

## References

- See the [update and embedded-guide independence closeout](../charness-artifacts/impl/2026-08-12-update-guide-independence.md)
  for why `ceal update` moves only the signed worker generation and leaves guide
  registration to an explicit follow-up command.
- See the [target-selection ambiguity closeout](../charness-artifacts/impl/2026-08-12-target-selection-ambiguity.md)
  for why `capabilities targets --match` is a capability-specific selector, and
  what a zero-count match may not conclude.
- See the [pre-handoff Worker contract](../charness-artifacts/spec/2026-08-11-pre-handoff-worker-closeout.md)
  for the scope of every `ceal-cli`-owned task that does not need the Gateway's
  final signed Protocol handoff.
- See [gate details](gates.md) for why the vendored Protocol is a signed archive
  rather than an editable copy, and what the one remaining artifact check does
  and does not prove.
- See the [cross-repo release execution plan](../../ceal/docs/next-release-execution-plan.md)
  for who does what, in which repository, and in what order.
- See [release and enrollment](release-and-enrollment.md) for the standing
  procedures this baton deliberately does not restate each session.
