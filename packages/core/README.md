# @mixpanel-headless/core

The isomorphic core of Mixpanel Headless: the `Workspace` facade, the five
query engines (Insights, Funnels, Retention, Flows, User profiles), the query
vocabulary (`Filter`, `Metric`, `GroupBy`, …), entity models, result types and
the coded error hierarchy. Zero Node dependencies — it runs anywhere `fetch`
and WebCrypto exist. A behavior-for-behavior port of the Python
[`mixpanel_headless`](https://github.com/mixpanel/mixpanel-headless) library,
verified against a corpus of vectors extracted from it (see the repository's
[`PORTING.md`](../../PORTING.md)).

Most applications want a platform package instead, which wires the
credential sources for you: **[`@mixpanel-headless/node`](../node/README.md)**
(config files, env vars, OAuth login) or
**[`@mixpanel-headless/browser`](../browser/README.md)** (bearer tokens,
redirect PKCE, injected storage). Use `core` directly when you already hold a
resolved credential or are building your own platform layer.

## Install

```bash
npm i @mixpanel-headless/core
```

ESM only. Node ≥ 22.12 or any evergreen browser; TypeScript types ship in the
package (`strict`-clean).

## Usage

```ts
import { Filter, parseAccount, Workspace } from "@mixpanel-headless/core";

const ws = new Workspace({
  session: {
    account: parseAccount({
      type: "service_account",
      name: "ci",
      region: "us",
      username: "sa.demo",
      secret: "…",
    }),
    project: { id: "12345" },
    headers: new Map(),
  },
});

const result = await ws.query("Login", {
  math: "dau",
  last: 30,
  where: Filter.equals("plan", "pro"),
});
console.log(result.toRows());
```

A `Workspace` takes either a pre-resolved `session` (as above) or the resolver
axes `account` / `project` / `workspace` / `target` plus injected `sources`
(env reader, config reader, bridge) — which is what the platform packages
supply. OAuth accounts additionally need `clientOptions.tokenResolver`;
`@mixpanel-headless/node` provides the on-disk one.

Query options mirror the Python keyword arguments with **`snake_case` keys**
(`{ math: "dau", last: 90 }`), methods and static builders are `camelCase`
(`ws.queryFunnel`, `Filter.startsWith`), and results expose `toRows()` /
`rowColumns()` in place of a DataFrame. See the repository README for the
full tour of the query engines, report links, session replay and entity
management.

## Entry points

| Specifier                          | Contents                                                                                                                                      |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `@mixpanel-headless/core`          | The public API: an explicit, curated named-export list (`Workspace`, the query vocabulary, entity and result models, errors and error codes). |
| `@mixpanel-headless/core/internal` | Plumbing the platform packages and the verification rig need beyond the public list. **Not semver-stable** — it may change in any release.    |

## Platform notes

- No Node built-ins, no `process`, no `undici`: every platform concern
  (`fetch`, clocks, randomness, storage, environment) is injected or defaults
  to the global. The browser bundle smoke in the repository gate keeps it
  that way.
- Python-parity semantics that matter for byte-identical output (`str()`
  rendering, float formatting, CPython whitespace and printability tables)
  live under `compat/` and are pinned to CPython 3.14.6 / Unicode 16.0, so
  results do not depend on the host engine's Unicode version.
- Integers are contract up to ±(2^53 − 1); values beyond that are rejected
  with `PY_INT_UNSAFE_INTEGER` rather than silently rounded.

## Status

Carries `"private": true` until the owner flips it; versions and release notes
are managed by Changesets and published through `release.yml` (see the
repository's `CONTRIBUTING.md`, "Releasing"). License: MIT.
