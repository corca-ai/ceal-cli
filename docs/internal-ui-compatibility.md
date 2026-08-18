# Internal UI Compatibility Layer

The embedded Workbench does not import `@corca-ai/ceal-ui` yet. It owns a
small, dependency-free compatibility layer because the observer serves one
HTML document without a frontend build or React runtime.

The compatibility layer follows the public package's neutral contracts:

| Local surface | Future public primitive |
| --- | --- |
| `.ceal-shell`, `.ceal-shell__header`, navigation and actions | `AppShell` |
| observer navigation buttons | `NavigationList` and `NavigationItem` |
| `.card` / `.ceal-card` | `Card` |
| metric strips and metric selectors | `MetricCard` |
| `.boundary` / `.unsupported` | `Notice` |
| badges and evidence-state labels | `StatusBadge` |

Token names under `--ceal-*` and the navigation/card class markers establish a
semantic migration target. They do not claim DOM/API compatibility with the
unreleased React package. Workbench-only concepts
such as activity cells, session cards, capability rows, receipt rows, evidence
semantics, and local observer composition remain owned here.

This is not a claim that the package is installed or consumed. After an
official package release, replace the compatibility primitives at the render
boundary and keep the Workbench domain components and evidence rules intact.
