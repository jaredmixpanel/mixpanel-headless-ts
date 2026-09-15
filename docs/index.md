---
layout: home
title: Mixpanel Headless for TypeScript
description: "A complete programmable interface to Mixpanel for Node.js and browsers — typed analytics queries, schema discovery, entity management, streaming extraction, and session replay analysis."

hero:
  name: Mixpanel Headless
  text: for TypeScript
  tagline: A complete programmable interface to Mixpanel — typed queries, discovery, entity management, streaming, and session replay, verified against the Python library it ports.
  actions:
    - theme: brand
      text: Get started
      link: /getting-started/installation
    - theme: alt
      text: Quick start
      link: /getting-started/quickstart
    - theme: alt
      text: GitHub
      link: https://github.com/jaredmixpanel/mixpanel-headless-ts

features:
  - title: Five composable query engines
    details: Insights (query), funnels (queryFunnel), retention (queryRetention), flows (queryFlow), and user profiles (queryUser) share one Filter vocabulary, inline cohort definitions, and uniform tabular results.
    link: /guide/unified-query-system
    linkText: The unified query system
  - title: Discoverable schema
    details: List your events, properties, property values, funnels, cohorts, and saved reports before you query — no guessing at names.
    link: /guide/discovery
    linkText: Data discovery
  - title: Full entity lifecycle
    details: Create, read, update, and delete dashboards, reports, cohorts, feature flags, experiments, alerts, annotations, webhooks, Lexicon definitions, and more.
    link: /guide/entity-management
    linkText: Entity management
  - title: Streaming extraction
    details: Memory-efficient async iterators over raw events and profiles for ETL pipelines (Node.js).
    link: /guide/streaming
    linkText: Streaming data
  - title: Session replay analysis
    details: Discover a user's rrweb recordings and project them into session-level rows, click heatmap data, and an LLM-friendly markdown action timeline.
    link: /guide/session-replay
    linkText: Session replay
  - title: Built for humans and agents
    details: Every return value is a typed object, every error carries a stable machine-readable code, and results serialize cleanly. Agents can drive the whole surface without external docs.
    link: /guide/error-handling
    linkText: Error handling
  - title: Isomorphic
    details: One Workspace API for Node.js and the browser. The core has zero Node dependencies; the platform packages supply config files, environment, OAuth, and credential storage.
    link: /guide/browser
    linkText: In the browser
  - title: Verified against Python
    details: A conformance corpus extracted from the Python mixpanel_headless library replays against the port on every change — thousands of vectors, zero divergence.
    link: /architecture/porting
    linkText: How the port is verified
---

## Thirty seconds to your first query

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace(); // env vars, ~/.mp/config.toml, or bridge file

const result = await ws.query("Purchase", {
  math: "unique",
  group_by: "country",
  last: 30,
});

console.table(result.toRows());
```

```
┌─────────┬──────────────┬────────────┬─────────┬───────┐
│ (index) │ date         │ event      │ segment │ count │
├─────────┼──────────────┼────────────┼─────────┼───────┤
│ 0       │ '2026-08-01' │ 'Purchase' │ 'US'    │ 1042  │
│ 1       │ '2026-08-01' │ 'Purchase' │ 'DE'    │ 311   │
│ …       │              │            │         │       │
```

Every code block marked `twoslash` on this site is compiled against the
published type declarations when the site is built, so what you read is what
type-checks.

## Why Mixpanel Headless?

Mixpanel's web UI is powerful for interactive exploration, but programmatic
access means juggling multiple REST endpoints with different conventions, auth
schemes, and response shapes. Mixpanel Headless wraps all of it in one
consistent, typed surface — the same surface the Python
[`mixpanel_headless`](https://github.com/mixpanel/mixpanel-headless) library
exposes, ported method for method and verified against it.

## Which package do I need?

| Package                      | Runtime         | What's inside                                                                                                                                                                                          |
| ---------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@mixpanel-headless/node`    | Node.js ≥ 22.12 | Everything for servers, scripts, and CI: config-file accounts (`~/.mp/config.toml`), env-var auth, programmatic OAuth login, and ready-made `accounts` / `session` / `targets` management. Start here. |
| `@mixpanel-headless/browser` | Browsers        | Bearer-token and redirect-PKCE auth, injectable credential storage, and a `Workspace` factory gated to browser-safe capabilities.                                                                      |
| `@mixpanel-headless/core`    | Both            | The isomorphic engine: the `Workspace` facade, query builders, result types, and the error hierarchy. Zero Node dependencies — the platform packages wire it up for you.                               |

All packages are ESM, ship TypeScript types, and share the same `Workspace`
API — code written against core runs in either environment.

```bash
npm install @mixpanel-headless/node    # servers, scripts, CI
npm install @mixpanel-headless/browser # web apps
```

::: warning Pre-release software
These packages are not yet published to npm and APIs may change before 1.0.
Import specifiers on this site use the names they will publish under.
:::

## Where to next

- [Installation](/getting-started/installation) — npm, pnpm, or yarn; Node.js ≥ 22.12; ESM only.
- [Quick start](/getting-started/quickstart) — authenticate, explore, and run your first queries.
- [Configuration](/getting-started/configuration) — environment variables, `~/.mp/config.toml`, and how credentials resolve.
- [Insights queries](/guide/query) — DAU, formulas, filters, and breakdowns.
- [Funnels](/guide/query-funnels), [retention](/guide/query-retention), [flows](/guide/query-flows), and [user profiles](/guide/query-users) — the other four engines.
- [Session replay](/guide/session-replay) — discover, fetch, and analyze rrweb recordings.
- [Entity management](/guide/entity-management) and [data governance](/guide/data-governance) — dashboards, reports, cohorts, flags, Lexicon, and more.
- [Coming from Python?](/guide/coming-from-python) — the naming rules and the known differences.
- [API reference](/api/) — every exported class, function, and type, generated from the source.
