// The setup programs the code panel prefixes so a copied block is complete.
// Each is the text of one `ts twoslash` block on docs/demo/index.md with
// its `// ---cut---` line removed (tests/demo-source.test.ts compares them),
// so the same code is type-checked against the built declarations on every
// docs build. Prettier's markdown formatting decides the line breaks here.

/** Offline mode: the fetch seam fed with recorded responses. */
export const OFFLINE_SETUP = `import { createBrowserWorkspace } from "@mixpanel-headless/browser";
declare const demoFetch: typeof fetch; // recorded responses; drop this line to talk to Mixpanel
const ws = createBrowserWorkspace({
  token: "demo",
  projectId: "3141592",
  region: "us",
  workspaceId: 1,
  fetch: demoFetch,
});
`;

/** Live mode: tokens from the in-memory store the callback page filled. */
export const LIVE_SETUP = `import {
  createBrowserWorkspaceFromStore,
  InMemoryCredentialStore,
} from "@mixpanel-headless/browser";
declare const memory: InMemoryCredentialStore; // filled by completeLogin on /demo/callback
const ws = await createBrowserWorkspaceFromStore({
  region: "us",
  projectId: "0",
  store: memory,
});
const me = await ws.me();
await ws.use({ project: "12345", workspace: 67 });
`;
