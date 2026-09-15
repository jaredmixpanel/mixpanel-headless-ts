---
title: Business context
description: Read and write the markdown documentation that grounds AI assistants in your organization's structure and goals.
---

# Business context

Read and write the markdown documentation that grounds AI assistants in your organization's structure and goals.

::: info What is Business Context?
Business Context is plain markdown text (up to **50,000 characters per scope**) that you attach to a Mixpanel organization or project. AI assistants read it before answering questions, so they know _what your product does_, _what your events mean_, _which dashboards are canonical_, and _how your team defines key metrics_. See the [official Mixpanel Business Context docs](https://docs.mixpanel.com/docs/business-context) for the broader product picture.
:::

::: info Prerequisites
Business Context requires **authentication**. Project-level reads work with any account that has project access; project-level writes additionally require `edit_project_info` permission. Org-level operations require org membership (read) plus `edit_project_info` at the org level (write). Service accounts can read/write at the project level for projects they're attached to; for org-level operations or for org-id auto-resolution, an OAuth account (`oauth_browser` or `oauth_token`) is the cleanest path.
:::

## Two scopes

| Scope          | Lives at                  | Shared by                |
| -------------- | ------------------------- | ------------------------ |
| `organization` | The Mixpanel organization | Every project in the org |
| `project`      | A single project          | That project only        |

Both scopes go through the same four methods, gated by a `level: "organization" | "project"` option (the [`BusinessContextLevel`](/reference/core/type-aliases/BusinessContextLevel) type). `level` defaults to `"project"`.

## Quick reference

Reference: [`Workspace.getBusinessContext`](/reference/core/classes/Workspace#getbusinesscontext), [`Workspace.setBusinessContext`](/reference/core/classes/Workspace#setbusinesscontext), [`Workspace.clearBusinessContext`](/reference/core/classes/Workspace#clearbusinesscontext), [`Workspace.getBusinessContextChain`](/reference/core/classes/Workspace#getbusinesscontextchain), [`BusinessContextScopeOptions`](/reference/core/interfaces/BusinessContextScopeOptions).

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();

// Read
const projectCtx = await ws.getBusinessContext({ level: "project" });
const orgCtx = await ws.getBusinessContext({ level: "organization" });

// Read both at once (single round-trip via /business-context/chain)
const chain = await ws.getBusinessContextChain();

// Write
await ws.setBusinessContext("# About Acme\n…", { level: "project" });
await ws.setBusinessContext("# Org-wide context", { level: "organization" });

// Clear (equivalent to setBusinessContext(""))
await ws.clearBusinessContext({ level: "project" });

console.log(projectCtx.content, orgCtx.content, chain.project.content);
```

## Reading context

### Project scope

Project-scope reads use the active session's project ID. If no context has been set, the API returns the empty string — there is no "not found" error to handle.

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();

const ctx = await ws.getBusinessContext({ level: "project" });
console.log(`${String(ctx.character_count)} chars`);
if (ctx.is_empty) {
  console.log("No project context configured.");
} else {
  console.log(ctx.content);
}
```

### Organization scope

Organization-scope reads default to the org that owns the active session's project. The org ID is auto-resolved from the cached `/me` response (24-hour TTL). To read context from a different org without switching projects, pass `organization_id` explicitly.

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();

// Auto-resolve the org from the active project's organization
const orgCtx = await ws.getBusinessContext({ level: "organization" });
console.log(
  `org=${String(orgCtx.organization_id)}: ${String(orgCtx.character_count)} chars`,
);

// Explicit override (skips the /me lookup)
const other = await ws.getBusinessContext({
  level: "organization",
  organization_id: 42,
});
console.log(other.content);
```

If auto-resolution can't determine the org (e.g. the active project isn't in the cached `/me` and the user belongs to multiple orgs), the call throws `WorkspaceScopeError` with `code === "ORGANIZATION_AMBIGUOUS"` and lists the accessible org IDs in `details`.

### Both scopes in one call

The server exposes a `/business-context/chain` endpoint that returns both org and project context together, scoped to the active project. Use `getBusinessContextChain()` to avoid two round-trips.

`organization.organization_id` on the returned chain is populated **best-effort** from the cached `/me` response (in-memory or on disk). When the cache is cold the field is left as `null` — the chain endpoint deliberately does _not_ trigger an extra `/me` fetch, preserving its single-network-round-trip property. Callers that need a guaranteed org ID should call `getBusinessContext({ level: "organization" })`, which performs full resolution.

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();

const chain = await ws.getBusinessContextChain();
console.log("ORG:    ", chain.organization.content);
console.log("PROJECT:", chain.project.content);
```

## Writing context

`setBusinessContext` has **full-replace** semantics — what you pass becomes the entire stored content for that scope. There is no append, no patch, no diff. Pass the empty string to clear, or use `clearBusinessContext` for clarity.

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();

const newContent = `# Acme Analytics

## Product overview

Acme is a SaaS dashboard for SMBs.

## Event taxonomy

- \`signup_completed\` — user creates an account
- \`subscription_started\` — paid plan begins
- \`feature_X_used\` — pattern for feature engagement

## Definitions

- **Active user**: any user with ≥1 event in the last 28 days
`;

await ws.setBusinessContext(newContent, { level: "project" });
await ws.setBusinessContext("# Org-wide standards…", { level: "organization" });
await ws.setBusinessContext("", { level: "project" }); // clear
await ws.clearBusinessContext({ level: "project" }); // same thing, more explicit
```

### Validation

`setBusinessContext` checks `content.length <= 50_000` (counted in Unicode code points, as Python's `len` does) **client-side, before** making any HTTP call. Oversize input throws `BusinessContextValidationError` (`code: "BUSINESS_CONTEXT_TOO_LONG"`) with `details: { length: N, max: 50_000 }`, so you fail fast and don't waste a round-trip. The server enforces the same cap and would otherwise return HTTP 400.

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import {
  BUSINESS_CONTEXT_MAX_CHARS,
  BusinessContextValidationError,
} from "@mixpanel-headless/core";

const ws = createNodeWorkspace();

console.log(BUSINESS_CONTEXT_MAX_CHARS); // 50000

try {
  await ws.setBusinessContext("x".repeat(60_000));
} catch (e) {
  if (e instanceof BusinessContextValidationError) {
    console.log(
      `Too long: ${String(e.details["length"])} > ${String(e.details["max"])}`,
    );
  } else {
    throw e;
  }
}
```

### Clearing

`clearBusinessContext()` is a thin convenience over `setBusinessContext("")`. Use whichever reads better at the call site.

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();

await ws.clearBusinessContext({ level: "project" });
await ws.clearBusinessContext({ level: "organization" });
```

## Common workflows

### Version-control project context as a file

Treat `context.md` like any other source file in your repo, and re-apply it as part of deploy:

```ts twoslash
import { readFile } from "node:fs/promises";
import { createNodeWorkspace } from "@mixpanel-headless/node";

// In CI or a deploy hook
const ws = createNodeWorkspace();
const content = await readFile("./context.md", "utf8");
await ws.setBusinessContext(content, { level: "project" });
```

### Bootstrap a new project from the org default

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();
const chain = await ws.getBusinessContextChain();

// Seed the project with the org content (e.g. for a new project that should
// inherit org standards as a starting point)
if (chain.project.is_empty && !chain.organization.is_empty) {
  await ws.setBusinessContext(chain.organization.content, { level: "project" });
}
```

### Audit context across many projects

`ws.projects()` lists every project the credentials can see (via `/me`); `ws.use({ project })` switches the active project in place.

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();
for (const project of await ws.projects()) {
  await ws.use({ project: project.id });
  const ctx = await ws.getBusinessContext({ level: "project" });
  const label = `${project.id} (${project.name ?? "unnamed"})`;
  if (ctx.is_empty) {
    console.log(`⚠️  ${label} has no project context`);
  } else {
    console.log(`✅ ${label} — ${String(ctx.character_count)} chars`);
  }
}
```

## Result types

`getBusinessContext`, `setBusinessContext` and `clearBusinessContext` return [`BusinessContext`](/reference/core/classes/BusinessContext) — a read-only model with the markdown content plus the scope-appropriate identifier:

| Field             | Project scope           | Org scope               |
| ----------------- | ----------------------- | ----------------------- |
| `level`           | `"project"`             | `"organization"`        |
| `content`         | markdown body (or `""`) | markdown body (or `""`) |
| `project_id`      | active project ID       | `null`                  |
| `organization_id` | `null`                  | resolved org ID         |

Two computed getters are also exposed and **appear in `modelDumpExcludeNone()` / `toJSON()`**:

- `is_empty: boolean` — `true` when `content === ""`
- `character_count: number` — the code-point length of `content`; compare against `BUSINESS_CONTEXT_MAX_CHARS`

```ts twoslash
import { BusinessContext } from "@mixpanel-headless/core";

const ctx = new BusinessContext({ level: "project", content: "" });
console.log(ctx.modelDumpExcludeNone());
// { level: "project", content: "", is_empty: true, character_count: 0 }
```

`getBusinessContextChain()` returns [`BusinessContextChain`](/reference/core/classes/BusinessContextChain), which is just `{ organization: BusinessContext, project: BusinessContext }`.

## Error handling

| Error class                                                                                | Thrown when                                                                                                              |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| [`BusinessContextValidationError`](/reference/core/classes/BusinessContextValidationError) | Client-side: content > 50,000 chars (no HTTP call made); `code: "BUSINESS_CONTEXT_TOO_LONG"`                             |
| [`QueryError`](/reference/core/classes/QueryError)                                         | Server-side 400 (malformed body, server-side oversize), 403 (missing `edit_project_info`), 404 (org/project not visible) |
| [`AuthenticationError`](/reference/core/classes/AuthenticationError)                       | 401 — credentials are invalid                                                                                            |
| [`WorkspaceScopeError`](/reference/core/classes/WorkspaceScopeError)                       | `level: "organization"` and the org ID could not be auto-resolved (`code: "ORGANIZATION_AMBIGUOUS"`)                     |
| [`ServerError`](/reference/core/classes/ServerError)                                       | 5xx                                                                                                                      |

Every error carries a stable `code` and a `details` record; API errors add `statusCode`. See [Error handling](/guide/error-handling) for the full hierarchy.

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import {
  BusinessContextValidationError,
  QueryError,
  WorkspaceScopeError,
} from "@mixpanel-headless/core";

const ws = createNodeWorkspace();
try {
  await ws.setBusinessContext("…", { level: "organization" });
} catch (e) {
  if (e instanceof BusinessContextValidationError) {
    console.log(
      `Too long (${String(e.details["length"])} chars), max ${String(e.details["max"])}`,
    );
  } else if (e instanceof WorkspaceScopeError) {
    console.log(`Cannot resolve org: ${e.message}`);
  } else if (e instanceof QueryError) {
    console.log(`API rejected the write: ${String(e.statusCode)} ${e.message}`);
  } else {
    throw e;
  }
}
```

## Permissions summary

| Operation           | Required permission                                   |
| ------------------- | ----------------------------------------------------- |
| Project-level read  | Project access (read)                                 |
| Project-level write | Project access + `edit_project_info`                  |
| Org-level read      | Org membership                                        |
| Org-level write     | Org membership + `edit_project_info` at the org level |

Service accounts attached to a project can read and write that project's context. Org-level writes typically require an OAuth account (`oauth_browser` or `oauth_token`) whose principal has org-level edit permissions. The 50,000-character cap is enforced both client-side (before any HTTP call) and server-side.

## Next steps

- [Accounts, sessions and targets](/guide/accounts-sessions-targets) — how the active project and org are resolved, `ws.use()`, `ws.projects()`
- [Error handling](/guide/error-handling) — the error hierarchy and stable `code` values
- Product docs: the [Mixpanel Business Context product page](https://docs.mixpanel.com/docs/business-context) for organization-level rollout guidance
