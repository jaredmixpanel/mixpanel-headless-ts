---
title: Playground
description: "Run @mixpanel-headless/browser in your browser against a synthetic demo project, or sign in with PKCE and query your own — with the exact TypeScript call beside every result."
aside: false
outline: false
sidebar: false
pageClass: mp-playground
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

Pick an event, flip the controls, and the code on the right is the call that produced the result — copy it into your own page. The last two tabs are reports Mixpanel does not have, because each is a loop of queries plus a computation over them — and the loop is the code shown: "Aha moments" ranks which early behaviour predicts retention (one retention query per candidate event), and "Conversion matrix" runs one two-step funnel per ordered pair of events, shades the results as a heatmap and chains the strongest pairs into a funnel you can open. A value chip under a breakdown becomes a `where` filter, built with the same `Filter` the library exports:

```ts twoslash
import { createBrowserWorkspace, Filter } from "@mixpanel-headless/browser";
declare const demoFetch: typeof fetch; // recorded responses; drop this line to talk to Mixpanel
const ws = createBrowserWorkspace({
  token: "demo",
  projectId: "3141592",
  region: "us",
  workspaceId: 1,
  fetch: demoFetch,
});
// ---cut---
const result = await ws.query("Note Saved", {
  math: "total",
  last: 30,
  where: Filter.equals("platform", "iOS"),
});
```

<div class="mp-demo-skeleton">Loading the library (about 140 KB)…</div>
<DemoPlayground />
