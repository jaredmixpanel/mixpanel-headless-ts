// The setup programs the code panel prefixes so a copied block is complete.
// Each is the text of one `ts twoslash` block on docs/demo/index.md with
// its `// ---cut---` line removed (tests/demo-source.test.ts compares them),
// so the same code is type-checked against the built declarations on every
// docs build. Prettier's markdown formatting decides the line breaks here.

import type { Region } from "./session-state.js";

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

/** What the live setup quotes: the session's region and the picked target. */
export interface LiveTarget {
  readonly region: Region;
  readonly project: string;
  readonly workspace: number | null;
}

/**
 * Live mode: tokens from the in-memory store the callback page filled,
 * then the two calls the project picker makes — with the visitor's own
 * region, project and workspace once they are known.
 *
 * @param target - Region, project id and workspace id.
 * @returns The setup program.
 */
export function liveSetup(target: LiveTarget): string {
  const pin =
    target.workspace === null
      ? `{ project: ${JSON.stringify(target.project)} }`
      : `{ project: ${JSON.stringify(target.project)}, workspace: ${String(target.workspace)} }`;
  return `import {
  createBrowserWorkspaceFromStore,
  InMemoryCredentialStore,
} from "@mixpanel-headless/browser";
declare const memory: InMemoryCredentialStore; // filled by completeLogin on /demo/callback
const ws = await createBrowserWorkspaceFromStore({
  region: ${JSON.stringify(target.region)},
  projectId: "0", // any digits-only id works before ws.use() picks the real one
  store: memory,
});
const me = await ws.me();
await ws.use(${pin});
`;
}

/** The live setup as the page shows it before a project is picked. */
export const LIVE_SETUP: string = liveSetup({
  region: "us",
  project: "12345",
  workspace: 67,
});
