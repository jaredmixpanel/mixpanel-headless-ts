// The generated / vendored / local-only paths that neither ESLint nor
// Prettier may touch live in ONE list (scripts/lib/lint-ignores.mjs).
// eslint.config.js consumes it directly; .prettierignore cannot import it, so
// this test pins the two together in both directions.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  eslintIgnorePatterns,
  FROZEN_PATHS,
  LOCAL_PATHS,
} from "../scripts/lib/lint-ignores.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Entries .prettierignore carries that are not lint concerns.
const PRETTIER_ONLY = new Set(["package-lock.json"]);

function prettierIgnoreEntries(): string[] {
  return readFileSync(join(REPO_ROOT, ".prettierignore"), "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
}

describe("shared ignore list", () => {
  const shared = [...LOCAL_PATHS, ...FROZEN_PATHS].map((e) => e.path);

  it("every shared path is in .prettierignore", () => {
    const prettier = new Set(prettierIgnoreEntries());
    const missing = shared.filter((p) => !prettier.has(p));
    expect(missing).toStrictEqual([]);
  });

  it(".prettierignore adds nothing the shared list does not know", () => {
    const known = new Set([...shared, ...PRETTIER_ONLY]);
    const extra = prettierIgnoreEntries().filter((p) => !known.has(p));
    expect(extra).toStrictEqual([]);
  });

  it("every frozen path exists (no stale entries)", () => {
    const stale = FROZEN_PATHS.map((e) => e.path).filter(
      (p) => !existsSync(join(REPO_ROOT, p)),
    );
    expect(stale).toStrictEqual([]);
  });

  it("directories become **/dir/** for ESLint, files stay root-anchored", () => {
    const patterns = eslintIgnorePatterns();
    expect(patterns).toContain("**/vendor/**");
    expect(patterns).toContain("**/node_modules/**");
    expect(patterns).toContain("packages/core/src/compat/whitespace.gen.ts");
    expect(patterns).toHaveLength(shared.length);
  });
});
