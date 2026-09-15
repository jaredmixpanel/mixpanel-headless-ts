// The setup programs the code panel prefixes so a copied block is complete.
// Each is the text of one `ts twoslash` block on docs/demo/index.md with
// its `// ---cut---` line removed (tests/demo-source.test.ts compares them),
// so the same code is type-checked against the built declarations on every
// docs build. Prettier's markdown formatting decides the line breaks here,
// and `withImports` reproduces it when a call adds a name to the import
// line (the page's filtered-query block pins that output too).

import type { Region } from "./session-state.js";

/** The one import line every setup opens with. */
const BROWSER_IMPORT =
  /^import \{([^}]*)\} from "@mixpanel-headless\/browser";/u;
/** Prettier's print width for the site. */
const PRINT_WIDTH = 80;

/**
 * Add names to a setup's `@mixpanel-headless/browser` import line — the
 * names a call's `imports` declares — keeping Prettier's layout: one line
 * while it fits in the print width, otherwise one name per line. Names are
 * deduplicated and sorted case-insensitively, as the lint rule orders them.
 *
 * @param setup - A setup program (`OFFLINE_SETUP`, `liveSetup(…)`).
 * @param names - Names to import; may be empty or repeat.
 * @returns The setup with the merged import line.
 * @example
 * ```ts
 * withImports(OFFLINE_SETUP, ["Filter"]);
 * // import { createBrowserWorkspace, Filter } from "@mixpanel-headless/browser";
 * // …
 * ```
 */
export function withImports(setup: string, names: readonly string[]): string {
  if (names.length === 0) {
    return setup;
  }
  const match = BROWSER_IMPORT.exec(setup);
  if (match === null) {
    throw new Error("playground: setup has no browser import line");
  }
  const present = (match[1] ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "");
  const merged = [...new Set([...present, ...names])].sort((a, b) =>
    a.localeCompare(b, "en", { sensitivity: "base" }),
  );
  const inline = `import { ${merged.join(", ")} } from "@mixpanel-headless/browser";`;
  const line =
    inline.length <= PRINT_WIDTH
      ? inline
      : `import {\n${merged.map((name) => `  ${name},\n`).join("")}} from "@mixpanel-headless/browser";`;
  return setup.replace(BROWSER_IMPORT, () => line);
}

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
