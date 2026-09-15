// Workspace alias table — the one place that maps the published bare
// specifiers (`@mixpanel-headless/core`, `…/core/internal`, `…/node`,
// `…/browser`) back to their TypeScript sources.
//
// The packages' `exports` maps point at `dist/` (what consumers and
// `tsc -b` see). Everything that executes TypeScript straight from source
// — vitest, the two esbuild-bundled rig CLIs and the browser smoke/bundle
// recipe — must resolve the same specifiers to `src/` instead, or a stale
// `dist/` could shadow the code under test. Import this table rather than
// hand-writing the paths anywhere else.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * Specifier → absolute source path. Longer subpaths come first so a
 * prefix-matching consumer (esbuild `alias`) never swallows `/internal`.
 *
 * @type {ReadonlyArray<readonly [specifier: string, sourcePath: string]>}
 */
export const WORKSPACE_ALIASES = Object.freeze([
  [
    "@mixpanel-headless/core/internal",
    resolve(REPO_ROOT, "packages/core/src/internal.ts"),
  ],
  ["@mixpanel-headless/core", resolve(REPO_ROOT, "packages/core/src/index.ts")],
  ["@mixpanel-headless/node", resolve(REPO_ROOT, "packages/node/src/index.ts")],
  [
    "@mixpanel-headless/browser",
    resolve(REPO_ROOT, "packages/browser/src/index.ts"),
  ],
]);

/**
 * esbuild `alias` option. esbuild matches the longest alias key first and
 * accepts subpath keys, so the table order is informational here.
 *
 * @returns {Record<string, string>} Specifier to absolute source path.
 */
export function esbuildAliases() {
  return Object.fromEntries(WORKSPACE_ALIASES);
}

/**
 * Vite/vitest `resolve.alias` entries. Regex finds anchored with `$` so
 * `@mixpanel-headless/core` cannot match `@mixpanel-headless/core/internal`
 * (vite tries entries in order and would otherwise rewrite the prefix).
 *
 * @returns {Array<{ find: RegExp, replacement: string }>} One anchored entry per specifier, in table order.
 */
export function vitestAliases() {
  return WORKSPACE_ALIASES.map(([specifier, sourcePath]) => ({
    find: new RegExp(`^${specifier.replaceAll("/", String.raw`\/`)}$`),
    replacement: sourcePath,
  }));
}
