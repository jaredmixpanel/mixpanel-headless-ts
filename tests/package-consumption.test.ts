// Consumption gate: `npm pack` each workspace, install the tarballs into a
// scratch project, then import `@mixpanel-headless/node` through the package
// `exports` and bundle `@mixpanel-headless/browser` with esbuild into an
// IIFE evaluated with no Node globals. ~10 s; `MP_SKIP_PACK_TEST=1` skips it
// locally, and it needs `npm run build` to have emitted `dist/`.

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGES = ["core", "node", "browser"] as const;
const SKIP = process.env["MP_SKIP_PACK_TEST"] === "1";

function npm(args: readonly string[], cwd: string): string {
  return execFileSync("npm", [...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, npm_config_update_notifier: "false" },
  });
}

describe.skipIf(SKIP)(
  "packed packages install and import like a consumer",
  () => {
    let scratch = "";

    beforeAll(() => {
      for (const name of PACKAGES) {
        const dist = join(REPO_ROOT, "packages", name, "dist", "index.js");
        if (!existsSync(dist))
          throw new Error(`${dist} missing — run \`npm run build\` first`);
      }
      scratch = mkdtempSync(join(tmpdir(), "mp-headless-consume-"));
      writeFileSync(
        join(scratch, "package.json"),
        JSON.stringify({ name: "consumer", private: true, type: "module" }),
      );
      const tarballs = PACKAGES.map((name) => {
        const out = npm(
          ["pack", "--silent", "--pack-destination", scratch],
          join(REPO_ROOT, "packages", name),
        ).trim();
        return join(scratch, out.split("\n").at(-1) ?? "");
      });
      // All three at once so node/browser's `@mixpanel-headless/core@^0.1.0`
      // dependency is satisfied by the packed core, not the registry.
      npm(
        [
          "install",
          "--ignore-scripts",
          "--no-audit",
          "--no-fund",
          "--no-package-lock",
          "--prefer-offline",
          ...tarballs,
        ],
        scratch,
      );
    }, 120_000);

    afterAll(() => {
      if (scratch !== "") rmSync(scratch, { recursive: true, force: true });
    });

    it("installs the three packages under @mixpanel-headless", () => {
      const installed = readdirSync(
        join(scratch, "node_modules", "@mixpanel-headless"),
      ).sort();
      expect(installed).toStrictEqual(["browser", "core", "node"]);
    });

    it("Node: imports Workspace through @mixpanel-headless/node's exports", () => {
      const script = [
        'import { Workspace, createNodeWorkspace, ConfigManager } from "@mixpanel-headless/node";',
        'import { Workspace as CoreWorkspace, Filter } from "@mixpanel-headless/core";',
        'import { EntityModel } from "@mixpanel-headless/core/internal";',
        "console.log(JSON.stringify({",
        "  workspace: typeof Workspace,",
        "  same: Workspace === CoreWorkspace,",
        "  factory: typeof createNodeWorkspace,",
        "  config: typeof ConfigManager,",
        "  filter: Filter.equals('country', 'US') instanceof Filter,",
        "  entityModel: typeof EntityModel,",
        "}));",
      ].join("\n");
      writeFileSync(join(scratch, "probe.mjs"), script);
      const out = execFileSync(process.execPath, [join(scratch, "probe.mjs")], {
        cwd: scratch,
        encoding: "utf8",
      });
      expect(JSON.parse(out)).toStrictEqual({
        workspace: "function",
        same: true,
        factory: "function",
        config: "function",
        filter: true,
        entityModel: "function",
      });
    });

    it("bundler + browser: esbuild resolves the packed browser package into a Node-free IIFE", async () => {
      writeFileSync(
        join(scratch, "entry.js"),
        'export * from "@mixpanel-headless/browser";',
      );
      const result = await build({
        entryPoints: [join(scratch, "entry.js")],
        absWorkingDir: scratch,
        bundle: true,
        platform: "browser",
        format: "iife",
        globalName: "MixpanelHeadless",
        write: false,
        logLevel: "silent",
      });
      const [file] = result.outputFiles;
      if (file === undefined) throw new Error("esbuild produced no output");
      const iife = file.text;
      expect(iife).not.toMatch(/["'`]node:/);
      expect(iife).not.toContain("require(");

      // No Node globals at all: the bundle must install the global and
      // build a browser Workspace from a bearer token.
      const context: Record<string, unknown> = {};
      runInNewContext(iife, context);
      const api = context["MixpanelHeadless"] as Record<string, unknown>;
      expect(typeof api["createBrowserWorkspace"]).toBe("function");
      const factory = api["createBrowserWorkspace"] as (options: unknown) => {
        session: { account: { type: string } };
      };
      const workspace = factory({ token: "t", projectId: "1", region: "us" });
      expect(workspace.session.account.type).toBe("oauth_token");
    });
  },
);
