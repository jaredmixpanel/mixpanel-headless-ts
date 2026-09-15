---
title: Installation
description: "Install Mixpanel Headless for TypeScript, pick the package for your runtime, and verify the import."
---

# Installation

::: warning Pre-release software
These packages are not yet published to npm and APIs may change before 1.0. Import specifiers on this site use the names the packages will publish under.
:::

## Requirements

- **Node.js ≥ 22.12** to use `@mixpanel-headless/node` (the request-side float encoding relies on `JSON.rawJSON`). Any evergreen browser runs `@mixpanel-headless/browser`; the PKCE login needs WebCrypto, so serve the page from a secure context (`https:` or `localhost`).
- **ESM only.** Every package is a native ES module. There is no CommonJS build: use `import`, or a dynamic `import()` from CommonJS code.
- **TypeScript is optional.** Types ship inside the packages and are `strict`-clean; plain JavaScript works too. There is no peer dependency on `typescript`. If you do compile with TypeScript, use `"module": "nodenext"` (or `"moduleResolution": "bundler"`) so the compiler reads the packages' `exports` map.
- A Mixpanel **service account** (username, secret, project id) or a Mixpanel **user account** for OAuth login — see the [Quick start](/getting-started/quickstart).

## Which package do I need?

| Package                      | Runtime         | What's inside                                                                                                                                                                                          |
| ---------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@mixpanel-headless/node`    | Node.js ≥ 22.12 | Everything for servers, scripts, and CI: config-file accounts (`~/.mp/config.toml`), env-var auth, programmatic OAuth login, and ready-made `accounts` / `session` / `targets` management. Start here. |
| `@mixpanel-headless/browser` | Browsers        | Bearer-token and redirect-PKCE auth, injectable credential storage, and a `Workspace` factory gated to browser-safe capabilities.                                                                      |
| `@mixpanel-headless/core`    | Both            | The isomorphic engine: the `Workspace` facade, query builders, result types, and the error hierarchy. Zero Node dependencies — the platform packages wire it up for you.                               |

All three share the same `Workspace` API — code written against core runs in either environment. `@mixpanel-headless/core` is a dependency of both platform packages, so one install brings it along; you still import from both specifiers. `@mixpanel-headless/node` exports the Node wiring ([`createNodeWorkspace`](/reference/node/functions/createNodeWorkspace), [`loginUnified`](/reference/node/functions/loginUnified), `accounts` / `session` / `targets`, the config and OAuth classes) plus [`Workspace`](/reference/core/classes/Workspace); the query vocabulary (`Filter`, `Metric`, `FunnelStep`, …), the entity and result models and the error classes come from `@mixpanel-headless/core`. The browser entry re-exports the vocabulary and the errors itself, so a page needs one import. Construct `Workspace` through core directly only when you already hold a resolved credential or are building your own platform layer.

## Install

For servers, scripts and CI:

::: code-group

```bash [npm]
npm install @mixpanel-headless/node
```

```bash [pnpm]
pnpm add @mixpanel-headless/node
```

```bash [yarn]
yarn add @mixpanel-headless/node
```

:::

For web apps:

::: code-group

```bash [npm]
npm install @mixpanel-headless/browser
```

```bash [pnpm]
pnpm add @mixpanel-headless/browser
```

```bash [yarn]
yarn add @mixpanel-headless/browser
```

:::

For a custom platform layer or a shared isomorphic module:

::: code-group

```bash [npm]
npm install @mixpanel-headless/core
```

```bash [pnpm]
pnpm add @mixpanel-headless/core
```

```bash [yarn]
yarn add @mixpanel-headless/core
```

:::

## Verify the import

Import the entry points you plan to use; nothing here touches the network or the file system, so it runs without credentials:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import { Filter, MixpanelHeadlessError } from "@mixpanel-headless/core";

console.log(typeof createNodeWorkspace); // "function"
console.log(Filter.equals("plan", "pro") instanceof Filter); // true
console.log(new MixpanelHeadlessError("probe").code); // "UNKNOWN_ERROR"
```

If your editor resolves the types and `node script.mjs` prints the three lines, the install is complete.

## Next steps

- [Quick start](/getting-started/quickstart) — set up credentials and run your first query
- [Configuration](/getting-started/configuration) — environment variables, the config file and the resolution chain
- [Coming from the Python library?](/guide/coming-from-python) — the three naming rules
- [API reference](/api/) — every exported class, function and option bag, generated from the sources
