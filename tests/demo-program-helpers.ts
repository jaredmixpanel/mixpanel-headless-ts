// What the playground's loop-report tests share (tests/demo-aha.test.ts,
// tests/demo-matrix.test.ts): a workspace over the demo fixtures, the
// re-parser that turns a printed literal back into the value it was
// printed from, and the reader that pins a helper's displayed source to
// its declaration in the module. Assertion-free, so each test states what
// it checks.

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createBrowserWorkspace } from "@mixpanel-headless/browser";

import { DEMO_FIXTURES } from "../docs/.vitepress/theme/demo/fixtures/demo-project.gen.js";
import { fixtureFetch } from "../docs/.vitepress/theme/demo/model/fixture-fetch.js";

/** The repository root. */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * A workspace over the demo fixtures, at a frozen clock.
 *
 * @param today - The transport's clock.
 * @returns The facade.
 */
export function fixtureWorkspace(
  today: () => Date,
): ReturnType<typeof createBrowserWorkspace> {
  return createBrowserWorkspace({
    token: "demo",
    projectId: DEMO_FIXTURES.project.id,
    region: "us",
    workspaceId: DEMO_FIXTURES.project.workspaceId,
    fetch: fixtureFetch(DEMO_FIXTURES, { today }),
  });
}

/**
 * Turn a printed literal back into JSON: quote identifier keys and drop
 * trailing commas.
 *
 * @param text - A literal as `printArg` printed it.
 * @returns The parsed value.
 */
export function reparse(text: string): unknown {
  return JSON.parse(
    text
      .replaceAll(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/gu, '$1"$2":')
      .replaceAll(/,(\s*[}\]])/gu, "$1"),
  ) as unknown;
}

/**
 * The declaration of an exported function as the module's text holds it,
 * from `function <name>(` to the closing brace at column 0, with the
 * `export` keyword dropped — what a `*_SOURCE` constant must equal.
 *
 * @param modulePath - Path of the module, relative to the repository root.
 * @param name - The function's name.
 * @returns The declaration text, trailing newline included.
 * @throws Error - When the module has no such export.
 */
export function declarationOf(modulePath: string, name: string): string {
  const source = readFileSync(join(REPO_ROOT, modulePath), "utf8");
  const start = source.indexOf(`export function ${name}(`);
  const end = start === -1 ? -1 : source.indexOf("\n}\n", start);
  if (start === -1 || end === -1) {
    throw new Error(`${modulePath}: no exported function ${name}`);
  }
  return source.slice(start, end + "\n}\n".length).replace(/^export /u, "");
}
