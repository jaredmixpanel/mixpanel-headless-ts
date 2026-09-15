# @mixpanel-headless/core

## 0.1.0

Initial release (not yet published; the manifests carry `"private": true`
until the owner flips them — `CONTRIBUTING.md`, "Releasing").

- The isomorphic port of the Python `mixpanel_headless` library: the
  `Workspace` facade, the five query engines (Insights, Funnels, Retention,
  Flows, User profiles), the query vocabulary (`Filter`, `Metric`, `GroupBy`,
  …), inline cohorts, report links, session-replay analysis, entity models and
  the coded error hierarchy.
- Zero Node dependencies; `fetch`, clocks, randomness and storage are
  injected.
- Behaviour verified against a corpus of vectors extracted from the Python
  implementation and a cross-language differential oracle (`PORTING.md`).
