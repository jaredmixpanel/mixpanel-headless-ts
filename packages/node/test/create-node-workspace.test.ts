// QA follow-up (2026-08-17, post-Phase-3 live QA report): Python's
// `Workspace()` wires the on-disk token resolver, `/me` cache, and file
// reader automatically (`workspace.py:424-513`); the TS node package
// shipped only the pieces (`createNodeWorkspaceSources`,
// `createNodeAuthEffects`, `MeCache`, `nodeReadFile`) with no composed
// constructor — so the README's OAuth quick start failed on first query
// with `TokenResolver is required`. `createNodeWorkspace()` is the
// parity twin of Python's zero-config `Workspace()` construction.
//
// Fixture pattern per `workspace-bridge-materialization.test.ts`:
// isolated `$HOME` tmp dir, `MP_*` env scrub, 0o600/0o700 modes on
// POSIX.

import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Workspace } from "@mixpanel-headless/core";

import {
  createNodeWorkspace,
  createNodeWorkspaceSources,
} from "../src/index.js";
import { makeTempDir, scrubMpEnv } from "./helpers.js";

const POSIX = process.platform !== "win32";

const cleanups: Array<() => void> = [];
let restoreEnv: () => void = () => undefined;
let savedHome: string | undefined;
let home = "";

beforeEach(() => {
  restoreEnv = scrubMpEnv();
  savedHome = process.env["HOME"];
  home = makeTempDir(cleanups);
  process.env["HOME"] = home;
});

afterEach(() => {
  if (savedHome === undefined) {
    delete process.env["HOME"];
  } else {
    process.env["HOME"] = savedHome;
  }
  restoreEnv();
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

/** ISO instant `hours` out, `+00:00`-suffixed (Python isoformat). */
function isoIn(hours: number): string {
  return new Date(Date.now() + hours * 3_600_000)
    .toISOString()
    .replace(/\.\d{3}Z$/, "+00:00");
}

/** Seed `~/.mp` with an active oauth_browser account + fresh tokens. */
function seedOAuthAccount(): void {
  const mpDir = join(home, ".mp");
  mkdirSync(mpDir, { recursive: true, mode: 0o700 });
  const configPath = join(mpDir, "config.toml");
  writeFileSync(
    configPath,
    [
      "[accounts.qa]",
      'type = "oauth_browser"',
      'region = "us"',
      'default_project = "12345"',
      "",
      "[active]",
      'account = "qa"',
      "",
    ].join("\n"),
    "utf8",
  );
  const accountDir = join(mpDir, "accounts", "qa");
  mkdirSync(accountDir, { recursive: true, mode: 0o700 });
  const tokensPath = join(accountDir, "tokens.json");
  writeFileSync(
    tokensPath,
    JSON.stringify({
      access_token: "FRESH-QA-TOKEN",
      refresh_token: "FRESH-QA-REFRESH",
      expires_at: isoIn(1),
      scope: "read",
      token_type: "Bearer",
    }),
    "utf8",
  );
  if (POSIX) {
    chmodSync(configPath, 0o600);
    chmodSync(tokensPath, 0o600);
  }
}

/** Capturing 204 fetch — the `delete_cohort` wire shape (status-only). */
function capturingFetch(): {
  fetchImpl: typeof fetch;
  seen: Array<{ url: string; auth: string | null }>;
} {
  const seen: Array<{ url: string; auth: string | null }> = [];
  const fetchImpl = ((
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const headers = new Headers(init?.headers);
    seen.push({
      url: input instanceof Request ? input.url : String(input),
      auth: headers.get("authorization"),
    });
    return Promise.resolve(new Response(null, { status: 204 }));
  }) as typeof fetch;
  return { fetchImpl, seen };
}

describe("createNodeWorkspace (Python Workspace() zero-config twin)", () => {
  it("wires the on-disk token resolver: OAuth query carries the disk bearer", async () => {
    seedOAuthAccount();
    const { fetchImpl, seen } = capturingFetch();

    const ws = createNodeWorkspace({ clientOptions: { fetch: fetchImpl } });
    expect(ws).toBeInstanceOf(Workspace);
    expect(ws.account.name).toBe("qa");

    // The QA repro: any first wire call. `deleteCohort` has the
    // simplest contract (DELETE → 204 → undefined).
    await ws.deleteCohort(1);

    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toContain("/api/app/projects/12345/cohorts/1");
    expect(seen[0]?.auth).toBe("Bearer FRESH-QA-TOKEN");
  });

  it("anti-vacuity contrast: bare sources (the old README recipe) fail the same call", async () => {
    seedOAuthAccount();
    const { fetchImpl } = capturingFetch();

    // The exact pre-fix README construction — no tokenResolver wired.
    const ws = new Workspace({
      sources: createNodeWorkspaceSources(),
      clientOptions: { fetch: fetchImpl },
    });
    await expect(ws.deleteCohort(1)).rejects.toThrow(
      /TokenResolver is required/,
    );
  });

  it("passes resolver-axis overrides through (project)", async () => {
    seedOAuthAccount();
    const { fetchImpl, seen } = capturingFetch();

    const ws = createNodeWorkspace({
      project: "67890",
      clientOptions: { fetch: fetchImpl },
    });
    await ws.deleteCohort(2);

    expect(seen[0]?.url).toContain("/api/app/projects/67890/cohorts/2");
  });
});
