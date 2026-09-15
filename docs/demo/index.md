---
title: Playground
description: "Run @mixpanel-headless/browser in your browser against a synthetic demo project, or sign in with PKCE and query your own — with the exact TypeScript call beside every result."
aside: false
outline: false
---

# Playground

Everything below runs the published `@mixpanel-headless/browser` package in your browser. In the default demo mode the library talks to a synthetic project ("Northwind Notes", 30 days of recorded responses) through its injected `fetch` seam — no account, no token, no request leaves the page:

```ts twoslash
import { createBrowserWorkspace } from "@mixpanel-headless/browser";
declare const demoFetch: typeof fetch; // recorded responses; drop this line to talk to Mixpanel
// ---cut---
const ws = createBrowserWorkspace({
  token: "demo",
  projectId: "3141592",
  region: "us",
  workspaceId: 1,
  fetch: demoFetch,
});
```

"Use my own project" swaps that for a redirect PKCE login and the same facade over your own project, read-only:

```ts twoslash
import {
  createBrowserWorkspaceFromStore,
  InMemoryCredentialStore,
} from "@mixpanel-headless/browser";
declare const memory: InMemoryCredentialStore; // filled by completeLogin on /demo/callback
// ---cut---
const ws = await createBrowserWorkspaceFromStore({
  region: "us",
  projectId: "0", // any digits-only id works before ws.use() picks the real one
  store: memory,
});
const me = await ws.me();
await ws.use({ project: "12345", workspace: 67 });
```

Pick an event, flip the controls, and the code on the right is the call that produced the result — copy it into your own page.

<div class="mp-demo-skeleton">Loading the library (about 140 KB)…</div>
<DemoPlayground />
