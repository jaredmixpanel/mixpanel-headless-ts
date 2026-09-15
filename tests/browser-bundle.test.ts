// Browser-bundle recipe gate: `scripts/build-browser-bundle.mjs` produces a
// pinned, reproducible, Node-free artifact pair plus a provenance manifest.
// The desktop app vendors the built bundle and re-verifies it against the
// manifest; this repo owns the recipe. Everything goes through the CLI so
// the contract under test is the shipped one.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(REPO_ROOT, "scripts", "build-browser-bundle.mjs");

const IIFE_NAME = "mixpanel-headless.js";
const ESM_NAME = "mixpanel-headless.mjs";
const MANIFEST_NAME = "manifest.json";
const ARTIFACT_NAMES = [IIFE_NAME, ESM_NAME] as const;

/**
 * The surface the desktop artifact lane depends on (spec 04 §3.3). A
 * rename upstream must break this gate, not a page in production.
 */
const REQUIRED_EXPORTS = [
  "InMemoryCredentialStore",
  "LocalStorageCredentialStore",
  "MixpanelHeadlessError",
  "beginLogin",
  "completeLogin",
  "createBrowserWorkspace",
  "createBrowserWorkspaceFromStore",
  // Spec 02 §3.3: a page cannot compute or cite a QueryRef hash without
  // the canonicalizer the hash is defined over. Reported-not-required
  // while it was still landing; required now that it is on the barrel.
  "pythonJsonDumpsCanonical",
] as const;

/**
 * Spec 02 §3.3's other half — the report type a params object describes.
 * Same lane, same reason: a page that names what it built needs it on
 * the global.
 */
const CANONICAL_IDENTITY_EXPORT = "inferBookmarkType";

/**
 * Purity needles. `node:` on its own is NOT usable: the minified bundle
 * legitimately contains `_selector_node:` (a report-selector key) and
 * `packages/node:` (an error-message hint), so the scan anchors on the
 * quote that would open an import specifier.
 */
const IMPURITY_NEEDLES = [
  "process.",
  "require(",
  '"node:',
  "'node:",
  "`node:",
] as const;

interface ManifestFileEntry {
  readonly sha256: string;
  readonly bytes: number;
}

interface BundleManifest {
  readonly schema: number;
  readonly package: string;
  readonly sourceRepo: string;
  readonly sourceCommit: string;
  readonly dirty?: boolean;
  readonly entry: string;
  readonly build: {
    readonly tool: string;
    readonly version: string;
    readonly args: readonly string[];
  };
  readonly files: Readonly<Record<string, ManifestFileEntry>>;
  readonly exports: readonly string[];
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function runBuild(outDir: string, extraArgs: readonly string[] = []): string {
  return execFileSync(
    process.execPath,
    [SCRIPT, "--out", outDir, ...extraArgs],
    { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

function readManifest(outDir: string): BundleManifest {
  const text = readFileSync(join(outDir, MANIFEST_NAME), "utf8");
  return JSON.parse(text) as BundleManifest;
}

/**
 * Evaluate the IIFE the way a browser would and read the keys off the
 * global it installs. `new Function` is not used (and would be a lint
 * violation); a fresh `vm` context with a bare `globalThis` is both safer
 * and closer to "did this actually define a global".
 */
function globalKeysOf(iifeText: string): string[] {
  const context: Record<string, unknown> = {};
  runInNewContext(iifeText, context);
  const installed = context["MixpanelHeadless"];
  expect(typeof installed).toBe("object");
  return Object.keys(installed as object).sort();
}

const tempDirs: string[] = [];

function makeTempOutDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "mxh-browser-bundle-"));
  tempDirs.push(dir);
  return dir;
}

let outA: string;
let outB: string;

describe("browser bundle recipe", () => {
  beforeAll(() => {
    outA = makeTempOutDir();
    outB = makeTempOutDir();
    runBuild(outA, ["--allow-dirty"]);
    runBuild(outB, ["--allow-dirty"]);
  }, 120_000);

  afterAll(() => {
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  });

  it("emits both artifacts and a manifest", () => {
    for (const name of [...ARTIFACT_NAMES, MANIFEST_NAME]) {
      expect(existsSync(join(outA, name))).toBe(true);
    }
  });

  it("pins provenance in the manifest", () => {
    const manifest = readManifest(outA);
    expect(manifest.schema).toBe(1);
    expect(manifest.package).toBe("@mixpanel-headless/browser");
    expect(manifest.entry).toBe("packages/browser/src/index.ts");
    expect(manifest.sourceCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(manifest.build.tool).toBe("esbuild");
    expect(manifest.build.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(manifest.build.args).toContain("--target=chrome148");
    expect(manifest.build.args).toContain("--minify");
  });

  it("records the real sha256 and byte count of every artifact", () => {
    const manifest = readManifest(outA);
    expect(Object.keys(manifest.files).sort()).toStrictEqual(
      [...ARTIFACT_NAMES].sort(),
    );
    for (const name of ARTIFACT_NAMES) {
      const bytes = readFileSync(join(outA, name));
      const entry = manifest.files[name];
      expect(entry).toBeDefined();
      expect(entry?.bytes).toBe(bytes.length);
      expect(entry?.sha256).toBe(sha256(bytes));
    }
  });

  it("carries a fixed license banner and no build timestamp", () => {
    for (const name of ARTIFACT_NAMES) {
      const text = readFileSync(join(outA, name), "utf8");
      expect(text.startsWith("/*!")).toBe(true);
      expect(text).toContain("@mixpanel-headless/browser");
      // A date — or an epoch stamp — in the header would defeat
      // reproducibility. (The byte-identity test below is the real guard;
      // this one names the failure mode.)
      const header = text.slice(0, 400);
      expect(header).not.toMatch(/\b(19|20)\d{2}-\d{2}-\d{2}\b/);
      expect(header).not.toMatch(/\d{10,}/);
    }
  });

  it("keeps both artifacts free of Node references", () => {
    for (const name of ARTIFACT_NAMES) {
      const text = readFileSync(join(outA, name), "utf8");
      for (const needle of IMPURITY_NEEDLES) {
        expect({
          name,
          needle,
          count: text.split(needle).length - 1,
        }).toStrictEqual({
          name,
          needle,
          count: 0,
        });
      }
    }
  });

  it("installs the MixpanelHeadless global with the exports the artifact lane needs", () => {
    const keys = globalKeysOf(readFileSync(join(outA, IIFE_NAME), "utf8"));
    for (const name of REQUIRED_EXPORTS) {
      expect(keys).toContain(name);
    }
  });

  it("lists exactly the global's keys, sorted, in manifest.exports", () => {
    const keys = globalKeysOf(readFileSync(join(outA, IIFE_NAME), "utf8"));
    expect(readManifest(outA).exports).toStrictEqual(keys);
  });

  it("carries the spec-02 identity helpers on the global and in the manifest", () => {
    const keys = globalKeysOf(readFileSync(join(outA, IIFE_NAME), "utf8"));
    const manifestExports = readManifest(outA).exports;
    for (const name of [
      "pythonJsonDumpsCanonical",
      CANONICAL_IDENTITY_EXPORT,
    ]) {
      expect(keys).toContain(name);
      expect(manifestExports).toContain(name);
    }
  });

  it("is byte-for-byte reproducible across runs", () => {
    for (const name of [...ARTIFACT_NAMES, MANIFEST_NAME]) {
      const a = sha256(readFileSync(join(outA, name)));
      const b = sha256(readFileSync(join(outB, name)));
      expect({ name, sha256: b }).toStrictEqual({ name, sha256: a });
    }
  });

  it("refuses a dirty tree unless --allow-dirty is passed", () => {
    const porcelain = execFileSync("git", ["status", "--porcelain"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    const treeIsDirty = porcelain.trim().length > 0;
    const out = makeTempOutDir();

    let failure: string | undefined;
    try {
      runBuild(out);
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }

    // A dirty tree fails before any manifest is written; a clean tree
    // succeeds with an honest (undirtied) manifest.
    expect(failure !== undefined, failure ?? "build succeeded").toBe(
      treeIsDirty,
    );
    const manifest = existsSync(join(out, MANIFEST_NAME))
      ? readManifest(out)
      : null;
    expect(manifest === null).toBe(treeIsDirty);
    expect(manifest?.dirty).toBeUndefined();
  }, 120_000);

  it("marks a dirty build in the manifest so provenance never lies", () => {
    const porcelain = execFileSync("git", ["status", "--porcelain"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    const treeIsDirty = porcelain.trim().length > 0;
    expect(readManifest(outA).dirty).toBe(treeIsDirty ? true : undefined);
  });
});
