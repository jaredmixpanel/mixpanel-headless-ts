// VitePress configuration for the documentation site (`npm run docs:*`;
// CONTRIBUTING.md "Documentation").
//
// Four things are decided here rather than in the pages: `base` comes from
// `DOCS_BASE` so one config serves the GitHub project page
// (`/mixpanel-headless-ts/`) and a custom domain (`/`) without an edit; every
// ```ts twoslash block is compiled against the packages' built declarations
// (the workspace symlinks in node_modules point at `packages/*/dist`, so a
// snippet sees exactly what a consumer sees); the API reference sidebar
// is the JSON typedoc-vitepress-theme writes next to the generated pages; and
// the playground (`/demo/`, theme/demo/) gets its build-time constants from
// `vite.define` and a Content Security Policy stamped into every built page
// by `transformHtml`.

import { createHash } from "node:crypto";
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

// The playground's OAuth redirect URI is fixed at build time (never read
// from the page, so it cannot be injected): the Pages URL in CI, and the
// `docs:dev` port locally — `beginLogin` accepts `http:` only on loopback.
const demoOrigin = origin ?? "http://localhost:5173";
const DEMO_REDIRECT_URI = `${demoOrigin}${base}demo/callback`;
/** The playground page, which carries its own social image. */
const DEMO_PAGE = "demo/index.md";

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
 * Build a code theme from a GitHub base plus the Mixpanel token colors.
 *
 * The overrides come last in `tokenColors`, so for equal-specificity scopes
 * they win over the base rules; everything the palette does not name keeps
 * the GitHub color.
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
    { text: "Playground", link: "/demo/" },
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

// --- Content Security Policy ---------------------------------------------

// Inline `<script>` elements (no `src`), whose text is what a CSP hash
// covers. VitePress emits a few per page (the color-scheme and platform
// probes, the asset hash map); they are hashed from the page rather than
// listed, so a VitePress upgrade that changes one cannot silently break the
// site — tests/demo-dist.test.ts recomputes the hashes from the built HTML.
const INLINE_SCRIPT = /<script(?![^>]*\ssrc\s*=)[^>]*>([\s\S]*?)<\/script>/giu;

// The hosts live mode talks to: the query/app APIs and the OAuth endpoints
// share these three per region (core's `ENDPOINTS` and `OAUTH_BASE_URLS`).
// The export hosts (`data.mixpanel.com` and its regional twins) are absent
// on purpose: the browser package refuses the Export API before any fetch,
// and the policy is a second fence behind that guard.
const CONNECT_HOSTS = [
  "https://mixpanel.com",
  "https://eu.mixpanel.com",
  "https://in.mixpanel.com",
];

/**
 * Build the policy for one built page.
 *
 * `style-src` keeps `'unsafe-inline'`: Shiki writes the light/dark token
 * colors as `style` attributes on thousands of spans, which cannot be
 * hashed without `'unsafe-hashes'`. That is the accepted gap. Applied at
 * build time only, so the dev server's HMR (inline and eval) is untouched;
 * `frame-ancestors` is not settable from a meta element and is left out.
 *
 * @param html - The rendered page.
 * @returns The policy text for the meta element.
 */
function contentSecurityPolicy(html: string): string {
  const hashes = [...html.matchAll(INLINE_SCRIPT)].map(
    (match) =>
      `'sha256-${createHash("sha256")
        .update(match[1] ?? "")
        .digest("base64")}'`,
  );
  const scriptSrc = ["'self'", ...new Set(hashes)].join(" ");
  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self' ${CONNECT_HOSTS.join(" ")}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

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
  // GitHub Pages cannot send response headers, so the policy travels as a
  // meta element. Injected here rather than through `head` because its
  // script hashes depend on the rendered page.
  transformHtml(html) {
    const meta = `<meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy(html)}">`;
    return html.replace("<head>", () => `<head>\n    ${meta}`);
  },
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
    ["meta", { name: "twitter:card", content: "summary_large_image" }],
  ],
  // The social image needs the absolute origin, which a page's frontmatter
  // cannot see; the playground gets its screenshot, every other page the
  // brand card.
  transformHead({ pageData }) {
    const image =
      pageData.relativePath === DEMO_PAGE ? "playground.png" : "og.png";
    return [
      [
        "meta",
        { property: "og:image", content: `${origin ?? ""}${base}${image}` },
      ],
    ];
  },

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
            // Snippets are consumer code: modern Node, the strict family and
            // the DOM libs so browser examples compile in the same environment
            // — but not the repository's source-hygiene flags
            // (verbatimModuleSyntax, noPropertyAccessFromIndexSignature,
            // erasableSyntaxOnly), which shape how this code base is written,
            // not how it is used — and NodeNext resolution so the packages' `exports`
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
    define: {
      __DEMO_REDIRECT_URI__: JSON.stringify(DEMO_REDIRECT_URI),
      // The kill switch for live mode; `false` hides "Use my own project".
      __DEMO_LIVE_ENABLED__: JSON.stringify(true),
    },
    plugins: [
      llmstxt({
        ...(origin === undefined ? {} : { domain: origin }),
        title: "Mixpanel Headless for TypeScript",
        description:
          "A complete programmable interface to Mixpanel for Node.js and browsers: typed analytics queries, schema discovery, entity management, streaming extraction, and session replay analysis.",
        details:
          "TypeScript port of the Python mixpanel_headless library, verified against a conformance corpus extracted from it. Three packages: @mixpanel-headless/node (servers, scripts, CI), @mixpanel-headless/browser (web apps), @mixpanel-headless/core (the isomorphic engine both share).",
        // The OAuth callback page is a redirect target with no content.
        ignoreFiles: ["history/**", "demo/callback.md"],
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
    // The header shows the short name; the full name stays in `title` for
    // the browser tab, Open Graph and llms.txt.
    siteTitle: "Mixpanel Headless",
    nav: [
      { text: "Guide", link: "/getting-started/installation" },
      { text: "Reference", link: "/api/" },
      { text: "Playground", link: "/demo/" },
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
