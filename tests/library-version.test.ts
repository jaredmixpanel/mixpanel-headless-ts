/**
 * Locks the User-Agent version literal in `packages/core/src/client/headers.ts`
 * to `packages/core/package.json`: core cannot read files at runtime and
 * Changesets does not rewrite TypeScript constants, so a release bump must
 * touch both. Reads the source text so this repo-level test needs no
 * dependency on the package itself.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const read = (path: string): string =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("LIBRARY_VERSION", () => {
  it("matches the core package.json version", () => {
    const manifest = JSON.parse(read("packages/core/package.json")) as {
      version: string;
    };
    const match = /^const LIBRARY_VERSION = "([^"]+)";$/m.exec(
      read("packages/core/src/client/headers.ts"),
    );
    expect(match?.[1]).toBe(manifest.version);
  });
});
