# Worker darwin install lane and local observer contract

Status: current implementation contract, 2026-07-24.
Operator decisions (recorded from the live session):

- push and `ceal-v*` tagging are approved for this session; macOS CI runners
  are explicitly excluded for cost — the operator builds darwin artifacts on
  their own Mac from a pulled checkout.
- distribution assumes the repository becomes public later; GitHub Releases is
  the channel (no brew tap, no ceal.borca.ai hosting for now); the canonical
  entry is `curl -fsSL .../releases/latest/download/install-ceal.sh | sh`-style
  once public.
- macOS signing level: ad-hoc `codesign --sign -` plus cosign keyless
  provenance; no Apple Developer ID/notarization yet.

## Slice A: worker release lane grows darwin and its first real release route

Capability contract: an agent or human on Linux or macOS can install the
worker `ceal` with one curl command against a signed GitHub release, and an
installed worker can run option-free `ceal update`; on macOS this session
proves the contract by fixture on Linux plus a manual Mac build runbook, not
by a signed darwin release.

Fixed decisions:

- Extend only the worker-only lane (`install-ceal.sh`, `release:worker:*`,
  `ceal-release.yml`); the dual `install.sh`/`cealctl-release.yml` lane stays
  frozen compatibility material.
- Platform set becomes `linux-amd64|linux-arm64|darwin-amd64|darwin-arm64`.
  SHA256SUMS validation becomes allowlist+per-platform-required instead of a
  hardcoded seven-line dual-linux inventory, and stays fail-closed.
- macOS portability inside `install-ceal.sh`: portable sha256 (`sha256sum` or
  `shasum -a 256`), portable atomic-ish current switch (GNU `mv -Tf` when
  available, locked rm+ln fallback), `flock` with an mkdir-lock fallback,
  darwin cosign bootstrap pins for cosign v2.6.4.
- Native builder accepts a darwin host: postject uses
  `--macho-segment-name NODE_SEA`, signature is removed before injection and
  ad-hoc re-signed after, linux behavior unchanged. Non-mac proof is via
  injected `dependencies` fixtures on this Linux host.
- `stable-update.ts` recognizes managed darwin binaries
  (`ceal-<platform>` for the four platforms).
- The first worker release stays 0.65.0 (`ceal-v0.65.0`): the frozen legacy
  release contract binds every package version to 0.65.0 and the supplied
  Gateway Protocol artifact is 0.65.0, so a bump would amend frozen
  compatibility material. Version independence (worker==client with a
  declared protocol pin instead of exact three-way match) is deferred to the
  next Gateway protocol handoff. The tag namespace is new, so no prior
  `ceal-v` release is contradicted; the release notes must state that this
  supersedes the legacy dual-lane `v0.65.0` for worker installs.
- New `ceal-release.yml`: on `ceal-v*` tags, linux-amd64/arm64 jobs build the
  release asset set from the locked gateway handoff archive, one release job
  merges SHA256SUMS, signs every asset with cosign keyless, and publishes the
  GitHub release. darwin jobs are declared but disabled behind an explicit
  dispatch input (operator decision: no macOS runners this session).
- CI obtains the handoff archive from a dedicated in-repo GitHub release
  asset whose sha256 must match `gateway-handoff-lock.json`; a mismatch fails
  the build.

Probe questions:

- Does the real tag run produce a linux release that this Linux host can
  install via the real `curl | sh` path and then `ceal update` to unchanged?
- Does the fixture-driven darwin path (uname/shasum/no-flock stubs) pass the
  full installer flow deterministically on Linux?

Deferred decisions:

- Enabling darwin CI runners; Apple Developer ID/notarization; Windows;
  Homebrew; public repository cutover mechanics; npm publication.

Acceptance checks: focused installer fixture tests (linux + simulated darwin),
native-builder unit tests for darwin injection order and naming, stable-update
tests for darwin layouts, `npm run check` clean; after tag: signed release
assets exist and real install/update readback succeeds on this Linux host.

## Slice B: `ceal observe` local client observer

Capability contract: a worker user can run `ceal observe`, open the printed
127.0.0.1 URL, and see the cached/local-safe state of their client — session
identity (secrets redacted), cached capability/target catalog with age,
installed generation, and guide status — without any Gateway or provider
contact.

Fixed decisions:

- Boundary: no admin surface, no provider credential, no live refresh; the
  server performs zero network requests and only reads
  `~/.ceal/client-session.json`, `~/.ceal/client-discovery-cache.json`, the
  managed install layout, and guide status. Receipts render as `unknown` with
  an explicit non-claim (no local receipt store exists).
- `access_token`/`refresh_token` never leave the process; redaction is
  structural (fields are never serialized), not string-masking.
- Server binds 127.0.0.1 only, validates the Host header against a loopback
  allowlist (agentsview DNS-rebinding guard pattern), serves one embedded
  HTML page plus a read-only JSON state endpoint, no build step, no new
  runtime dependency.
- Command surface: `ceal observe [--port <n>]`, effect read_only-plus-listen,
  prints a `ceal.observe.v1` YAML doc with the URL, serves until SIGINT.

Probe questions:

- Is the YAML-then-serve output shape compatible with the CLI's single-doc
  output contract for agents?

Deferred decisions: SSE/live file watching, Workbench expansion, TUI.

Acceptance checks: unit tests with fixture HOME for redaction, unknown
receipts, host-header rejection, port binding; `npm run check` clean.
