// The two thin node wirings: `createNodeEnv` (process.env read at call time)
// and `nodeReadFile` (the plain `Path(...).read_bytes()` twin — a
// user-supplied CSV, not a credential file, so no hardening).

import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createNodeEnv } from "../src/env.js";
import { nodeReadFile } from "../src/fs-seams.js";
import { makeTempDir, scrubMpEnv } from "./helpers.js";

const cleanups: Array<() => void> = [];
beforeEach(() => {
  scrubMpEnv();
});
afterEach(() => {
  vi.unstubAllEnvs();
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

describe("createNodeEnv", () => {
  it("reads MP_* fields at CALL time, not at bag construction", () => {
    const env = createNodeEnv();
    expect(env.MP_USERNAME).toBeUndefined();
    vi.stubEnv("MP_USERNAME", "late-set");
    expect(env.MP_USERNAME).toBe("late-set");
    vi.stubEnv("MP_USERNAME", undefined);
    expect(env.MP_USERNAME).toBeUndefined();
  });

  it("covers all six resolver MP_* members plus generic get()", () => {
    const env = createNodeEnv();
    vi.stubEnv("MP_USERNAME", "u");
    vi.stubEnv("MP_SECRET", "s");
    vi.stubEnv("MP_PROJECT_ID", "123");
    vi.stubEnv("MP_REGION", "eu");
    vi.stubEnv("MP_OAUTH_TOKEN", "tok");
    vi.stubEnv("MP_WORKSPACE_ID", "42");
    vi.stubEnv("MP_CUSTOM", "generic");
    expect(env.MP_USERNAME).toBe("u");
    expect(env.MP_SECRET).toBe("s");
    expect(env.MP_PROJECT_ID).toBe("123");
    expect(env.MP_REGION).toBe("eu");
    expect(env.MP_OAUTH_TOKEN).toBe("tok");
    expect(env.MP_WORKSPACE_ID).toBe("42");
    expect(env.get("MP_CUSTOM")).toBe("generic");
    expect(env.get("MP_ABSENT")).toBeUndefined();
  });

  it("returns raw values — empty string stays the CALLER's problem", () => {
    // Falsiness is owned by the resolver core (resolver.ts); the bag
    // never coerces (packet §2.1 env-wiring row).
    const env = createNodeEnv();
    vi.stubEnv("MP_REGION", "");
    expect(env.MP_REGION).toBe("");
    expect(env.get("MP_REGION")).toBe("");
  });
});

describe("nodeReadFile", () => {
  it("reads bytes from a user-supplied path", async () => {
    const dir = makeTempDir(cleanups);
    const path = join(dir, "table.csv");
    writeFileSync(path, "id,name\n1,a\n");
    const bytes = await nodeReadFile(path);
    expect(new TextDecoder().decode(bytes)).toBe("id,name\n1,a\n");
  });

  it("propagates ENOENT for a missing path (FileNotFoundError twin)", async () => {
    const dir = makeTempDir(cleanups);
    let error: unknown;
    try {
      await nodeReadFile(join(dir, "missing.csv"));
    } catch (error_) {
      error = error_;
    }
    expect((error as NodeJS.ErrnoException).code).toBe("ENOENT");
  });
});
