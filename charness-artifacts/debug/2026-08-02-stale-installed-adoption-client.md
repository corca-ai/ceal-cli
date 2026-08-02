# Stale Installed Adoption Client Debug
Date: 2026-08-02

## Problem

On Narnia, `ceal session adopt --gateway <published-origin> --email <invited-mailbox>` returned `ceal.error.v1` with `Invalid session enrollment options.` before it contacted the Gateway.

## Correct Behavior

Given a signed worker release that declares `session adopt`, when the employee supplies its gateway URL and invited mailbox, then the CLI must enter the verified-email adoption handler, start the bound device challenge, and never parse those arguments as legacy code enrollment.

## Observed Facts

- The user supplied both required adoption options and received the exact legacy enrollment error text.
- `packages/ceal-worker-cli/src/client-session.ts` dispatches `adopt` to `adoptSession`.
- `packages/ceal-worker-cli/src/device-adoption.ts` emits `ceal.session_adoption.v1` and an adoption-specific usage error, never the observed text.
- The observed text is emitted only by `writeEnrollmentInvalidArgument` after the legacy enrollment parser refuses options other than `--gateway` and `--code-stdin`.
- `ceal-v0.70.0` and later contain the adoption route; current stable is `ceal-v0.72.2`.

## Reproduction

- Source-level reproduction: route `session adopt` reaches `adoptSession`; malformed adoption input produces the adoption schema, not the observed enrollment schema.
- Stronger host observation required: on Narnia, `command -v ceal`, `ceal version`, and `ceal session adopt --help` identify the executable and prove the installed route after update.

## Candidate Causes

- Narnia resolves an installed worker from before `ceal-v0.70.0`.
- Narnia `PATH` resolves a different, stale `ceal` executable.
- The Gateway rejected the URL or email before the adoption state machine started.

## Hypothesis

- The Narnia executable predates the `adopt` route (or is a stale executable with that behavior). | disconfirmer: a binary that reports a current version and renders `session adopt --help` still emits the exact enrollment-parser error for the same argv.

## Verification

- Confirmed by code-path exclusivity: current adoption parsing cannot produce the reported schema/message, while the old enrollment path produces that exact message. Gateway admission is not reached before the failure.

## Root Cause

The user invoked an old installed client whose session dispatcher has no verified-email adoption route. The operator issued a valid email-first-device invitation to a Gateway that is already serving the matching adoption API, but the physical client had not been updated to the release that consumes it.

## Invariant Proof

- Invariant: when Gateway advertises verified-email first-device onboarding, the employee-facing installed client must declare and dispatch `session adopt` before it can begin a compatible device transaction.
- Producer Proof: the signed `ceal-v0.72.2` source declares `session adopt` and dispatches it to `adoptSession`.
- Final-Consumer Proof: Narnia's observed executable emitted the legacy enrollment error before any Gateway call, proving it is not that consumer surface.
- Interface-Shape Sibling Scan: `session enroll` remains the distinct legacy code path and must not accept adoption options.
- Non-Claims: this does not prove the Narnia update, mailbox confirmation, or device activation until the physical host reruns the command.

## Detection Gap

- Installed-client acceptance | release/source tests prove the new route but did not require the named physical host to report the route before an operator issued the live invitation | add a pre-invite operator checklist requiring signed-client version and `session adopt --help` evidence for each named test host. follow-up: cli-installed-adoption-preflight

## Sibling Search

- Mental model: release publication implies each named host automatically consumed the release.
- installed-worker axis: stable update path | decision: use `ceal update` then inspect version/route | proof: source reading.
- compatibility axis: `session enroll` | decision: preserve strict option refusal | proof: exact observed error.
- cross-file: `docs/release-and-enrollment.md` | decision: add named-host preflight in follow-up | proof: current procedure lacks it.

## Seam Risk

- Interrupt ID: installed-worker-version-versus-live-gateway
- Risk Class: external-seam
- Seam: signed release selection on a physical client -> Gateway first-device state machine.
- Disproving Observation: a current signed Narnia binary with `session adopt --help` reproduces the enrollment-parser message.
- What Local Reasoning Cannot Prove: Narnia's selected executable and subsequent live adoption.
- Generalization Pressure: monitor

## Interrupt Decision

- Resolution: resolved
- Critique Required: no
- Next Step: update the signed Narnia worker, prove its route/version, then repeat the live adoption.
- Handoff Artifact: charness-artifacts/debug/2026-08-02-stale-installed-adoption-client.md

## Prevention

Treat named-machine installed-route proof as a precondition for a live invite. Do not infer it from a source release or another host's installation.
