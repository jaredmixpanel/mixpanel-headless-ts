// B8-N1 seam locks for the two thin node wirings (b8-packets.md §2.1
// rows 3-4): `createNodeEnv` (call-time `process.env` reads — packet §7
// caution 16) and `nodeReadFile` (the W7-D1 `Path(...).read_bytes()`
// twin, `workspace.py` — plain read, NO credential hardening: a
// user-supplied CSV, not a credential file).

import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createNodeEnv } from "../src/env.js";
import { nodeReadFile } from "../src/fs-seams.js";
import { makeTempDir, scrubMpEnv } from "./helpers.js";

const cleanups: Array<() => void> = [];
let restoreEnv: () => void = () => {};
beforeEach(() => {
  restoreEnv = scrubMpEnv();
});
afterEach(() => {
  restoreEnv();
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

describe("createNodeEnv", () => {
  it("reads MP_* fields at CALL time, not at bag construction", () => {
    const env = createNodeEnv();
    expect(env.MP_USERNAME).toBeUndefined();
    process.env["MP_USERNAME"] = "late-set";
    expect(env.MP_USERNAME).toBe("late-set");
    delete process.env["MP_USERNAME"];
    expect(env.MP_USERNAME).toBeUndefined();
  });

  it("covers all six resolver MP_* members plus generic get()", () => {
    const env = createNodeEnv();
    process.env["MP_USERNAME"] = "u";
    process.env["MP_SECRET"] = "s";
    process.env["MP_PROJECT_ID"] = "123";
    process.env["MP_REGION"] = "eu";
    process.env["MP_OAUTH_TOKEN"] = "tok";
    process.env["MP_WORKSPACE_ID"] = "42";
    process.env["MP_CUSTOM"] = "generic";
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
    process.env["MP_REGION"] = "";
    expect(env.MP_REGION).toBe("");
    expect(env.get("MP_REGION")).toBe("");
  });
});

describe("nodeReadFile (W7-D1)", () => {
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
