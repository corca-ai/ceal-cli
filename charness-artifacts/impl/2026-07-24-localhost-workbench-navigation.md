# Localhost Workbench first navigation over the observer page

Status: current implementation contract, 2026-07-24.
Upstream frame: the ceal masterplan's client-UI boundary ("The client UI is an
agent workbench, not merely a Ceal receipt viewer. Its first navigation has two
deliberately separate views: **My agent work** … and **Ceal** …. A
privacy/retention view makes the local data boundary and forwarding state
inspectable.") and the Narnia handoff item "Next is the localhost Workbench"
after the completed session-inventory/event-depth and static-origin slices.

## Capability Contract

A worker user running `ceal observe` opens a localhost Workbench, not a flat
state dump: one view shows their cross-runtime agent activity (My agent work),
a second shows their Ceal governance state (session, capabilities, install,
guide, receipts), and a third makes the privacy boundary inspectable — which
local paths this client reads, what it retains and for how long, and that
nothing is forwarded to the Gateway or any provider from this page.

## Fixed Decisions

- The command stays `ceal observe`; the served page becomes the Workbench
  shell. Same single embedded HTML document, loopback/Host guard, CSP,
  read-only GET surface, zero build step, zero new runtime dependencies.
- First navigation is exactly three views, rendered client-side from the one
  existing JSON state endpoint: `My agent work` (agent_activity),
  `Ceal` (session, discovery cache, install, guide, receipts), and
  `Privacy & retention`. No merged productivity/audit view.
- The state document stays `ceal.observer_state.v1` and gains one additive
  optional section `privacy` (owner-local observer projection, no external
  consumer): declared local read sources (`~/.ceal` client state files, the
  managed install layout, `~/.claude/projects`, `~/.codex/sessions`), the
  receipt-spool retention bounds echoed from the spool, and fixed forwarding
  state `gateway_forwarding: "none"` / `provider_contact: "none"` for this
  page. Values are fixed vocabulary and integers only; no new file reads.
- The privacy view renders that section plus the existing boundary and
  non-claims; it states that raw transcripts are read bounded-and-locally for
  metadata only and never stored or forwarded by this client.
- View switching is plain in-page navigation (no router library, no URL beyond
  a hash); the default view is `My agent work` per the masterplan's
  workbench-first framing.
- Local deterministic suggestions, token/latency columns, transcript-open
  links, and any Gateway forwarding remain out of this slice.

## Probe Questions

- Does the three-view shell stay legible with the existing row-renderer, or
  does it force a premature shared-design package? (Expect: legible; defer
  `ceal-design` regardless.)

## Deferred Decisions

- Evidence-linked local suggestions (stale collector, repeated failures,
  cache opportunity); per-session drill-down command surface; opening the
  owner's original transcript from the page; SSE/live refresh; TUI.

## Acceptance Checks

- Unit: `privacy` section shape (sources, retention echo, forwarding fixed to
  none) with and without a loaded spool; no token material in state or page.
- Unit: page shell contains the three view labels and the Workbench title;
  loopback/Host/forwarded-header guards and read-only behavior unchanged.
- `npm run check` clean; README observer paragraph synced to the Workbench
  navigation.
