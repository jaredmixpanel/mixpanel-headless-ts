// Assertions over the built documentation site (docs/.vitepress/dist/):
// no third-party loads on the docs origin, a Content Security Policy on
// every page whose script hashes match that page's inline scripts, and the
// playground's JavaScript neither loaded by any other page nor over budget.
// Skipped without a build; `.github/workflows/docs.yml` runs it after one.

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(REPO_ROOT, "docs/.vitepress/dist");
const hasBuild = existsSync(join(DIST, "index.html"));

const DEMO_PAGES = new Set(["demo/index.html", "demo/callback.html"]);
// Budgets for everything only the playground loads (the browser package,
// the fixtures — needed at first paint, `topEvents` runs on mount — and the
// UI): minified bytes, and gzip bytes because the transfer size is what a
// visitor pays. Measured at 623 KB / 176 KB when the budgets were set.
const DEMO_BUDGET_BYTES = 700 * 1024;
const DEMO_GZIP_BUDGET_BYTES = 190 * 1024;
// A string that survives minification and lives only in the browser
// package (its Export API refusal), so the chunk holding the library can
// be found without knowing Rollup's file names. Pages that quote the code
// (the browser guide, its reference page) carry it too, so only shared
// chunks (`assets/chunks/`, VitePress's `chunkFileNames`) count — page
// modules live directly under `assets/`.
const LIBRARY_MARKER = "BROWSER_EXPORT_UNSUPPORTED";
const CHUNK_DIR = "assets/chunks/";

const INLINE_SCRIPT = /<script(?![^>]*\ssrc\s*=)[^>]*>([\s\S]*?)<\/script>/giu;
const CSP_META =
  /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/u;
const TAG = /<(script|link|iframe)\b([^>]*)>/giu;
const ATTRIBUTE = /([\w-]+)\s*=\s*"([^"]*)"/gu;
const THIRD_PARTY = /^(?:[a-z][a-z0-9+.-]*:)?\/\//iu;
const IMPORT_SPECIFIER =
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)|\bfrom\s*["']([^"']+)["']|\bimport\s*["']([^"']+)["']/gu;
const STATIC_IMPORT_SPECIFIER =
  /\bfrom\s*["']([^"']+)["']|\bimport\s*["']([^"']+)["']/gu;

/**
 * Every file with the extension under a directory, relative to `DIST`.
 *
 * @param dir - Directory to walk.
 * @param extension - Including the dot.
 * @returns Sorted dist-relative paths with forward slashes.
 */
function distFiles(dir: string, extension: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      out.push(...distFiles(path, extension));
    } else if (entry.endsWith(extension)) {
      out.push(relative(DIST, path).replaceAll("\\", "/"));
    }
  }
  return out.sort();
}

/**
 * Attributes of one tag.
 *
 * @param attributeText - Everything between the tag name and `>`.
 * @returns Lower-cased attribute names to values.
 */
function attributes(attributeText: string): Map<string, string> {
  return new Map(
    [...attributeText.matchAll(ATTRIBUTE)].map((match) => [
      (match[1] ?? "").toLowerCase(),
      match[2] ?? "",
    ]),
  );
}

/**
 * The URL a `<script>` or `<link>` loads, when it is a script, a stylesheet
 * or a preload (the loads a policy on third-party origins is about).
 *
 * @param tag - Tag name.
 * @param attrs - Its attributes.
 * @returns The URL, or `null` when the tag loads nothing of interest.
 */
function loadedUrl(tag: string, attrs: Map<string, string>): string | null {
  if (tag === "script") {
    return attrs.get("src") ?? null;
  }
  const rel = (attrs.get("rel") ?? "").toLowerCase().split(/\s+/u);
  const loads = rel.some((token) =>
    ["stylesheet", "preload", "modulepreload"].includes(token),
  );
  return loads ? (attrs.get("href") ?? null) : null;
}

/**
 * The dist-relative path of an asset URL a page references.
 *
 * @param url - `/<base>/assets/x.js` or `./assets/x.js`.
 * @returns `assets/x.js`, or `null` when the URL is not under `assets/`.
 */
function assetPath(url: string): string | null {
  const index = url.indexOf("assets/");
  return index === -1 ? null : url.slice(index);
}

/**
 * Resolve an import specifier against the importing chunk.
 *
 * @param from - Dist-relative path of the importer.
 * @param specifier - The specifier as written (`./chunks/x.js`).
 * @returns The dist-relative path of the imported module, or `null` for
 *   bare or absolute specifiers.
 */
function resolveImport(from: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) {
    return null;
  }
  const segments = dirname(from)
    .split("/")
    .filter((s) => s !== ".");
  for (const part of specifier.split("/")) {
    if (part === "..") {
      segments.pop();
    } else if (part !== "." && part !== "") {
      segments.push(part);
    }
  }
  return segments.join("/");
}

interface Page {
  readonly path: string;
  readonly html: string;
}

interface Graph {
  /** Byte size per dist-relative JS path. */
  readonly sizes: Map<string, number>;
  /** Static (`import x from`) edges. */
  readonly staticEdges: Map<string, Set<string>>;
  /** Static plus dynamic (`import()`) edges. */
  readonly allEdges: Map<string, Set<string>>;
  /** Chunks containing the browser package. */
  readonly libraryChunks: Set<string>;
}

/**
 * The import graph over every JavaScript file the build emitted.
 *
 * @returns Sizes, edges and the chunks that hold the browser package.
 */
function readGraph(): Graph {
  const sizes = new Map<string, number>();
  const staticEdges = new Map<string, Set<string>>();
  const allEdges = new Map<string, Set<string>>();
  const libraryChunks = new Set<string>();
  // Called while the skipped suite is being collected, so an absent build
  // yields an empty graph rather than a scandir error.
  const assets = join(DIST, "assets");
  const files = existsSync(assets) ? distFiles(assets, ".js") : [];
  for (const path of files) {
    const code = readFileSync(join(DIST, path), "utf8");
    sizes.set(path, Buffer.byteLength(code));
    if (path.startsWith(CHUNK_DIR) && code.includes(LIBRARY_MARKER)) {
      libraryChunks.add(path);
    }
    const edges = (pattern: RegExp): Set<string> =>
      new Set(
        [...code.matchAll(pattern)]
          .map((match) =>
            resolveImport(path, match[1] ?? match[2] ?? match[3] ?? ""),
          )
          .filter((target): target is string => target !== null),
      );
    staticEdges.set(path, edges(STATIC_IMPORT_SPECIFIER));
    allEdges.set(path, edges(IMPORT_SPECIFIER));
  }
  return { sizes, staticEdges, allEdges, libraryChunks };
}

/**
 * Everything reachable from a set of entry modules.
 *
 * @param entries - Dist-relative paths.
 * @param edges - The edge map to follow.
 * @returns The closure, entries included.
 */
function reachable(
  entries: Iterable<string>,
  edges: Map<string, Set<string>>,
): Set<string> {
  const seen = new Set<string>();
  const queue = [...entries];
  for (let next = queue.pop(); next !== undefined; next = queue.pop()) {
    if (seen.has(next)) {
      continue;
    }
    seen.add(next);
    queue.push(...(edges.get(next) ?? []));
  }
  return seen;
}

/**
 * The JavaScript a page loads before any user interaction: its module
 * script plus every `modulepreload`.
 *
 * @param page - The page.
 * @returns Dist-relative asset paths.
 */
function pageEntries(page: Page): string[] {
  const out: string[] = [];
  for (const match of page.html.matchAll(TAG)) {
    const tag = (match[1] ?? "").toLowerCase();
    const attrs = attributes(match[2] ?? "");
    const url = loadedUrl(tag, attrs);
    if (url?.endsWith(".js") === true) {
      const path = assetPath(url);
      if (path !== null) {
        out.push(path);
      }
    }
  }
  return out;
}

/**
 * Loads a page makes from another origin, and frames — what the docs
 * origin must never contain.
 *
 * @param page - The page.
 * @returns One line per offending element.
 */
function foreignLoads(page: Page): string[] {
  const offenders: string[] = [];
  for (const match of page.html.matchAll(TAG)) {
    const tag = (match[1] ?? "").toLowerCase();
    if (tag === "iframe") {
      offenders.push(`${page.path}: <iframe>`);
      continue;
    }
    const url = loadedUrl(tag, attributes(match[2] ?? ""));
    const foreign = url !== null && THIRD_PARTY.test(url);
    if (foreign) {
      offenders.push(`${page.path}: ${url}`);
    }
  }
  return offenders;
}

/**
 * Where a page's Content Security Policy departs from what `config.mts`
 * promises: present, `script-src` exactly `'self'` plus one hash per inline
 * script of that page (recomputed here, so a VitePress upgrade that changes
 * an inline script fails this test rather than the site).
 *
 * @param page - The page.
 * @returns One line per problem.
 */
function policyProblems(page: Page): string[] {
  const policy = CSP_META.exec(page.html)?.[1];
  if (policy === undefined) {
    return [`${page.path}: no CSP meta`];
  }
  const scriptSrc = policy
    .split(";")
    .map((directive) => directive.trim())
    .find((directive) => directive.startsWith("script-src "));
  if (scriptSrc === undefined) {
    return [`${page.path}: no script-src`];
  }
  const problems: string[] = [];
  const sources = scriptSrc.split(/\s+/u).slice(1);
  const expected = new Set(
    [...page.html.matchAll(INLINE_SCRIPT)].map(
      (match) =>
        `'sha256-${createHash("sha256")
          .update(match[1] ?? "")
          .digest("base64")}'`,
    ),
  );
  const actual = new Set(
    sources.filter((source) => source.startsWith("'sha256-")),
  );
  const others = sources.filter((source) => !source.startsWith("'sha256-"));
  if (others.join(" ") !== "'self'") {
    problems.push(`${page.path}: script-src allows ${others.join(" ")}`);
  }
  if (
    actual.size !== expected.size ||
    [...expected].some((hash) => !actual.has(hash))
  ) {
    problems.push(`${page.path}: script hashes do not match the page`);
  }
  return problems;
}

describe.skipIf(!hasBuild)(
  "built docs site (skipped without docs/.vitepress/dist; run `npx vitepress build docs`)",
  () => {
    // The factory still runs when the suite is skipped (vitest registers
    // the skipped tests by calling it), so the read has to be conditional
    // rather than relying on the skip.
    const pages: Page[] = hasBuild
      ? distFiles(DIST, ".html").map((path) => ({
          path,
          html: readFileSync(join(DIST, path), "utf8"),
        }))
      : [];

    it("has the playground pages", () => {
      const paths = new Set(pages.map((page) => page.path));
      for (const demo of DEMO_PAGES) {
        expect(paths.has(demo), demo).toBe(true);
      }
    });

    it("loads no script, stylesheet, preload or frame from another origin", () => {
      const offenders = pages.flatMap((page) => foreignLoads(page));
      expect(offenders).toStrictEqual([]);
    });

    it("carries a Content Security Policy whose script hashes match the page", () => {
      const problems = pages.flatMap((page) => policyProblems(page));
      expect(problems).toStrictEqual([]);
    });

    describe("playground chunk", () => {
      const graph = readGraph();
      const demoPages = pages.filter((page) => DEMO_PAGES.has(page.path));
      const otherPages = pages.filter((page) => !DEMO_PAGES.has(page.path));
      // What every other page already downloads (static graph from its
      // entries); the playground's own set is measured on top of that.
      const common = reachable(
        otherPages.flatMap((page) => pageEntries(page)),
        graph.staticEdges,
      );
      // Every chunk that statically pulls in the browser package, with
      // what those chunks import — minus what the rest of the site shares.
      const demoOnly = new Set<string>();
      for (const path of graph.sizes.keys()) {
        const closure = reachable([path], graph.staticEdges);
        if ([...graph.libraryChunks].some((chunk) => closure.has(chunk))) {
          for (const member of closure) {
            if (!common.has(member)) {
              demoOnly.add(member);
            }
          }
        }
      }

      it("exists (a chunk holds the browser package)", () => {
        expect(graph.libraryChunks.size).toBeGreaterThan(0);
      });

      it("is reachable from the playground pages", () => {
        const fromDemo = reachable(
          demoPages.flatMap((page) => pageEntries(page)),
          graph.allEdges,
        );
        for (const chunk of graph.libraryChunks) {
          expect(fromDemo.has(chunk), chunk).toBe(true);
        }
      });

      it("is not loaded by any other page", () => {
        const leaked = [...graph.libraryChunks].filter((chunk) =>
          common.has(chunk),
        );
        expect(leaked).toStrictEqual([]);
      });

      it(`stays within ${DEMO_BUDGET_BYTES / 1024} KB minified`, () => {
        const total = [...demoOnly].reduce(
          (sum, path) => sum + (graph.sizes.get(path) ?? 0),
          0,
        );
        const breakdown = [...demoOnly]
          .map((path) => `${path}: ${graph.sizes.get(path) ?? 0}`)
          .join("\n");
        expect(total, `demo-only chunks:\n${breakdown}`).toBeLessThanOrEqual(
          DEMO_BUDGET_BYTES,
        );
      });

      it(`stays within ${DEMO_GZIP_BUDGET_BYTES / 1024} KB gzipped`, () => {
        const total = [...demoOnly].reduce(
          (sum, path) =>
            sum + gzipSync(readFileSync(join(DIST, path))).byteLength,
          0,
        );
        expect(total).toBeLessThanOrEqual(DEMO_GZIP_BUDGET_BYTES);
      });
    });
  },
);
