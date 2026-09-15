// VitePress configuration for the documentation site (`npm run docs:*`;
// CONTRIBUTING.md "Documentation").
//
// Three things are decided here rather than in the pages: `base` comes from
// `DOCS_BASE` so one config serves the GitHub project page
// (`/mixpanel-headless-ts/`) and a custom domain (`/`) without an edit; every
// ```ts twoslash block is compiled against the packages' built declarations
// (the workspace symlinks in node_modules point at `packages/*/dist`, so a
// snippet sees exactly what a consumer sees); and the API reference sidebar
// is the JSON typedoc-vitepress-theme writes next to the generated pages.

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import githubDark from "@shikijs/themes/github-dark";
import githubLight from "@shikijs/themes/github-light";
import { rendererRich } from "@shikijs/twoslash";
import { transformerTwoslash } from "@shikijs/vitepress-twoslash";
import { createFileSystemTypesCache } from "@shikijs/vitepress-twoslash/cache-fs";
import ts from "typescript";
import {
  type DefaultTheme,
  defineConfig,
  type MarkdownOptions,
  type MarkdownRenderer,
  type UserConfig,
} from "vitepress";
import llmstxt from "vitepress-plugin-llms";
import { tabsMarkdownPlugin } from "vitepress-plugin-tabs";

const REPO_URL = "https://github.com/jaredmixpanel/mixpanel-headless-ts";

// `/` locally; `.github/workflows/docs.yml` derives `/<repo>/` from
// GITHUB_REPOSITORY. A custom domain later means unsetting the variable.
const base = process.env["DOCS_BASE"] ?? "/";

// Absolute URLs in llms.txt when the origin is known (CI sets it); relative
// otherwise, which the llms plugin still resolves against `base`.
const origin = process.env["DOCS_ORIGIN"];

// VitePress 1.x pins Vite 5, shiki 2 and its own markdown-it, while the
// root hoists newer copies for vitest, twoslash and the tabs plugin. The
// plugins therefore declare their types against different — but runtime
// compatible — declaration files of the same interfaces; these aliases name
// VitePress's side so the three `as unknown as` casts below bridge the
// declarations only.
type CodeTransformer = NonNullable<MarkdownOptions["codeTransformers"]>[number];
type MarkdownPlugin = Parameters<MarkdownRenderer["use"]>[0];
type VitePlugin = NonNullable<
  NonNullable<UserConfig["vite"]>["plugins"]
>[number];

const SIDEBAR_FILE = fileURLToPath(
  new URL("../reference/typedoc-sidebar.json", import.meta.url),
);

// --- Code themes ---------------------------------------------------------

/** The brand-relevant part of a Shiki theme (theme/shiki-mixpanel-*.json). */
interface ShikiOverrides {
  name: string;
  displayName: string;
  type: "light" | "dark";
  colors: Record<string, string>;
  tokenColors: Array<{
    scope: string[];
    settings: { foreground: string; fontStyle?: string };
  }>;
}

/**
 * Build a code theme from a GitHub base plus the Mixpanel token colours.
 *
 * The overrides come last in `tokenColors`, so for equal-specificity scopes
 * they win over the base rules; everything the palette does not name keeps
 * the GitHub colour.
 *
 * @param github - The GitHub theme to extend.
 * @param file - The override file name under `theme/`.
 * @returns The merged theme registration.
 */
function mixpanelTheme(
  github: typeof githubLight,
  file: string,
): typeof githubLight {
  const overrides = JSON.parse(
    readFileSync(
      fileURLToPath(new URL(`theme/${file}`, import.meta.url)),
      "utf8",
    ),
  ) as ShikiOverrides;
  return {
    ...github,
    name: overrides.name,
    displayName: overrides.displayName,
    type: overrides.type,
    colors: { ...github.colors, ...overrides.colors },
    tokenColors: [...(github.tokenColors ?? []), ...overrides.tokenColors],
  };
}

// --- Sidebar -------------------------------------------------------------

/**
 * Read the sidebar typedoc-vitepress-theme generated with the reference pages.
 *
 * Read at config-load time rather than imported so the config type-checks
 * and lints on a fresh clone, where `docs/reference/` does not exist yet.
 *
 * @returns The reference tree, one collapsed group per package.
 * @throws Error - When the reference has not been generated.
 */
function referenceSidebar(): DefaultTheme.SidebarItem[] {
  if (!existsSync(SIDEBAR_FILE)) {
    throw new Error(
      "docs/reference/typedoc-sidebar.json is missing; run `npm run docs:api` first (`docs:dev` and `docs:build` do).",
    );
  }
  return JSON.parse(
    readFileSync(SIDEBAR_FILE, "utf8"),
  ) as DefaultTheme.SidebarItem[];
}

const gettingStarted: DefaultTheme.SidebarItem = {
  text: "Getting started",
  items: [
    { text: "Installation", link: "/getting-started/installation" },
    { text: "Quick start", link: "/getting-started/quickstart" },
    { text: "Configuration", link: "/getting-started/configuration" },
  ],
};

const guide: DefaultTheme.SidebarItem = {
  text: "Guide",
  items: [
    { text: "The unified query system", link: "/guide/unified-query-system" },
    { text: "Data discovery", link: "/guide/discovery" },
    { text: "Insights queries", link: "/guide/query" },
    { text: "Funnel queries", link: "/guide/query-funnels" },
    { text: "Retention queries", link: "/guide/query-retention" },
    { text: "Flow queries", link: "/guide/query-flows" },
    { text: "User profile queries", link: "/guide/query-users" },
    { text: "Live analytics", link: "/guide/live-analytics" },
    { text: "Streaming data", link: "/guide/streaming" },
    { text: "Session replay", link: "/guide/session-replay" },
    { text: "Report links", link: "/guide/report-links" },
    { text: "Entity management", link: "/guide/entity-management" },
    { text: "Data governance", link: "/guide/data-governance" },
    { text: "Business context", link: "/guide/business-context" },
    { text: "In the browser", link: "/guide/browser" },
    {
      text: "Accounts, sessions, and targets",
      link: "/guide/accounts-sessions-targets",
    },
    { text: "Error handling", link: "/guide/error-handling" },
    { text: "Coming from Python", link: "/guide/coming-from-python" },
  ],
};

const architecture: DefaultTheme.SidebarItem = {
  text: "Architecture",
  items: [
    { text: "Design", link: "/architecture/design" },
    { text: "The port", link: "/architecture/porting" },
  ],
};

const apiOverview: DefaultTheme.SidebarItem = {
  text: "Overview",
  link: "/api/",
};

// The reference sidebar is split per package: VitePress renders the whole
// sidebar tree into every page's HTML (collapsed groups included), and the
// 850-item tree cost ~450 KB per page across 800+ reference pages and every
// prose page. Prose pages and the reference index carry package links only;
// each package's pages carry that package's tree.
const referenceTree = referenceSidebar();
const packageLinks: DefaultTheme.SidebarItem[] = referenceTree.map((pkg) => ({
  text: pkg.text ?? "",
  ...(pkg.link === undefined ? {} : { link: pkg.link }),
}));
const reference: DefaultTheme.SidebarItem = {
  text: "API reference",
  items: [apiOverview, ...packageLinks],
};
const packageSidebars: DefaultTheme.SidebarMulti = Object.fromEntries(
  referenceTree.flatMap((pkg) =>
    pkg.link === undefined
      ? []
      : [[pkg.link, [reference, { ...pkg, collapsed: false }]]],
  ),
);

export default defineConfig({
  title: "Mixpanel Headless for TypeScript",
  description:
    "Typed Mixpanel analytics queries, schema discovery, entity management, streaming extraction, and session replay analysis for Node.js and browsers.",
  lang: "en-US",
  base,
  srcExclude: ["history/**"],
  cleanUrls: true,
  lastUpdated: true,
  // Only when the origin is known (CI): a sitemap needs absolute URLs.
  ...(origin === undefined
    ? {}
    : { sitemap: { hostname: `${origin}${base}` } }),
  head: [
    ["meta", { property: "og:type", content: "website" }],
    [
      "meta",
      { property: "og:title", content: "Mixpanel Headless for TypeScript" },
    ],
    [
      "meta",
      {
        property: "og:description",
        content:
          "Typed Mixpanel analytics queries, schema discovery, entity management, streaming extraction, and session replay analysis for Node.js and browsers.",
      },
    ],
    ["meta", { property: "og:image", content: `${origin ?? ""}${base}og.png` }],
    ["meta", { name: "twitter:card", content: "summary_large_image" }],
  ],

  markdown: {
    theme: {
      light: mixpanelTheme(githubLight, "shiki-mixpanel-light.json"),
      dark: mixpanelTheme(githubDark, "shiki-mixpanel-dark.json"),
    },
    codeTransformers: [
      transformerTwoslash({
        // Static CSS hover popups instead of the package's floating-vue
        // renderer: floating-vue emits a Vue component per hover, and with
        // ~900 blocks that pushed the build past Node's default heap (see
        // CONTRIBUTING.md "Documentation" for the measurements); the static
        // markup is hoisted as strings and builds in the default heap.
        renderer: rendererRich(),
        // Twoslash results keyed by snippet hash, under the git-ignored Vite
        // cache: a rebuild re-compiles only the blocks that changed.
        typesCache: createFileSystemTypesCache({
          dir: "docs/.vitepress/cache/twoslash",
        }),
        twoslashOptions: {
          compilerOptions: {
            // Snippets are consumer code: modern Node, the repo's strict
            // flags, DOM libs so browser examples compile in the same
            // environment, and NodeNext resolution so the packages' `exports`
            // maps are honoured. Top-level `await` needs an ES module, which
            // the repo root's `"type": "module"` makes the virtual file.
            // `noUnusedLocals` / `noUnusedParameters` stay off on purpose:
            // examples assign a const purely to show its hover type.
            module: ts.ModuleKind.NodeNext,
            moduleResolution: ts.ModuleResolutionKind.NodeNext,
            target: ts.ScriptTarget.ES2022,
            strict: true,
            exactOptionalPropertyTypes: true,
            noUncheckedIndexedAccess: true,
            lib: [
              "lib.es2023.d.ts",
              "lib.dom.d.ts",
              "lib.dom.iterable.d.ts",
              "lib.dom.asynciterable.d.ts",
              "lib.esnext.disposable.d.ts",
            ],
            types: ["node"],
            skipLibCheck: true,
          },
        },
      }) as unknown as CodeTransformer,
    ],
    config(md) {
      md.use(tabsMarkdownPlugin as unknown as MarkdownPlugin);
    },
  },

  vite: {
    plugins: [
      llmstxt({
        ...(origin === undefined ? {} : { domain: origin }),
        title: "Mixpanel Headless for TypeScript",
        description:
          "A complete programmable interface to Mixpanel for Node.js and browsers: typed analytics queries, schema discovery, entity management, streaming extraction, and session replay analysis.",
        details:
          "TypeScript port of the Python mixpanel_headless library, verified against a conformance corpus extracted from it. Three packages: @mixpanel-headless/node (servers, scripts, CI), @mixpanel-headless/browser (web apps), @mixpanel-headless/core (the isomorphic engine both share).",
        ignoreFiles: ["history/**"],
        // The generated reference is ~800 pages: keep it out of the llms.txt
        // index (the API overview page links into it) but in the full bundle.
        // The plugin builds that index from the sidebar and warns for every
        // sidebar link whose page is excluded, so it gets a sidebar without
        // the reference tree.
        ignoreFilesPerOutput: { llmsTxt: ["reference/**"] },
        sidebar: [
          gettingStarted,
          guide,
          { text: "API reference", items: [apiOverview] },
          architecture,
        ],
      }) as unknown as VitePlugin,
    ],
  },

  themeConfig: {
    nav: [
      { text: "Guide", link: "/getting-started/installation" },
      { text: "Reference", link: "/api/" },
      {
        text: "Python library",
        link: "https://mixpanel.github.io/mixpanel-headless/",
      },
    ],
    sidebar: {
      ...packageSidebars,
      "/reference/": [reference],
      "/": [gettingStarted, guide, reference, architecture],
    },
    outline: [2, 3],
    search: {
      provider: "local",
      options: {
        // The 807 generated reference pages made the MiniSearch index 5.7 MB
        // (fetched on first search focus). The prose stays searchable; the
        // reference has its own sidebar tree and the API overview page.
        _render(src, env, md) {
          if (env.relativePath.startsWith("reference/")) {
            return "";
          }
          const html = md.render(src, env);
          return env.frontmatter?.["search"] === false ? "" : html;
        },
      },
    },
    socialLinks: [{ icon: "github", link: REPO_URL }],
    footer: {
      message: "Released under the Apache-2.0 License.",
      copyright: "Copyright © Mixpanel, Inc.",
    },
  },
});
