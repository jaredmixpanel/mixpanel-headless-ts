// The real node auth-effects bag (`createNodeAuthEffects`): a seam-closure
// sweep over every name in core's `UNPORTED_AUTH_SEAMS`, the
// test_workspace_use.py::TestPersist twins over the real bag, and a
// representative accounts/session/targets namespace subset. The
// `oauthFlow.login` run drives the real OAuthFlow over injected seams.

import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CallbackResult,
  createAccountsNamespace,
  createSessionNamespace,
  createTargetsNamespace,
  MeResponse,
  type OAuthTokenAccount,
  OAuthTokens,
  Secret,
  type Session,
  UNPORTED_AUTH_SEAMS,
  Workspace,
} from "@mixpanel-headless/core";
import { resolverSeamsFromEffects } from "@mixpanel-headless/core/internal";

import {
  type CannedResponse,
  createMockClient,
  makeSession,
} from "../../core/test-support/client-test-helpers.js";
import { createNodeAuthEffects } from "../src/auth-effects.js";
import { ConfigManager } from "../src/config.js";
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

/**
 * Point every on-disk world at tmp dirs (never the real home directory)
 * and build the real bag.
 *
 * @param extra - Additional bag options (seams).
 * @returns The bag plus the tmp config path.
 */
function tmpBag(
  extra: Omit<
    NonNullable<Parameters<typeof createNodeAuthEffects>[0]>,
    "configPath"
  > = {},
): {
  effects: ReturnType<typeof createNodeAuthEffects>;
  configPath: string;
} {
  const storageDir = makeTempDir(cleanups);
  const configDir = makeTempDir(cleanups);
  const bridgeDir = makeTempDir(cleanups);
  const configPath = join(configDir, "config.toml");
  vi.stubEnv("MP_OAUTH_STORAGE_DIR", storageDir);
  vi.stubEnv("MP_AUTH_FILE", join(bridgeDir, "auth.json"));
  vi.stubEnv("MP_CONFIG_PATH", configPath);
  return {
    effects: createNodeAuthEffects({ configPath, ...extra }),
    configPath,
  };
}

/** Fresh valid tokens for store/bridge writes. */
function sampleTokens(): OAuthTokens {
  return new OAuthTokens({
    access_token: new Secret("sweep-access"),
    refresh_token: new Secret("sweep-refresh"),
    expires_at: "2027-01-15T12:00:00+00:00",
    scope: "projects",
    token_type: "Bearer",
  });
}

describe("seam-closure sweep over the real bag", () => {
  it("covers every UNPORTED_AUTH_SEAMS name against tmp-dir state", async () => {
    // Injected stdin reader: one canned secret then EOF (a REAL fd-0
    // read would block forever on the worker's quiet stdin pipe).
    const secretBytes = new TextEncoder().encode("sweep-secret\n");
    let stdinOffset = 0;
    const { effects } = tmpBag({
      stdinReadSync: (buffer: Uint8Array): number => {
        const chunk = secretBytes.subarray(stdinOffset);
        buffer.set(chunk.subarray(0, buffer.length));
        const read = Math.min(chunk.length, buffer.length);
        stdinOffset += read;
        return read;
      },
    });

    // config.* (owner N1) — reads + writes, one real transaction each.
    effects.config.addAccount("team", {
      type: "service_account",
      region: "us",
      username: "team.sa",
      secret: new Secret("team-secret"),
      default_project: "3713224",
    });
    expect(effects.config.getAccount("team").name).toBe("team");
    expect(effects.config.listAccounts()).toHaveLength(1);
    // Manager-layer addAccount does NOT promote (B-E2E-N1); promote
    // explicitly for the later members.
    effects.config.setActive({ account: "team" });
    expect(effects.config.getActive().account).toBe("team");
    effects.config.applySession({ project: "3018488" });
    effects.config.addTarget("ecom", { account: "team", project: "3018488" });
    expect(effects.config.getTarget("ecom").account).toBe("team");
    expect(effects.config.listTargets()).toHaveLength(1);
    effects.config.applyTarget("ecom");
    effects.config.removeTarget("ecom");
    effects.config.updateAccount("team", { default_project: "3713224" });
    expect(effects.config.getCustomHeader()).toBeNull();

    // env (owner N1) — call-time process.env reads.
    vi.stubEnv("MP_REGION", "eu");
    expect(effects.env.MP_REGION).toBe("eu");
    expect(effects.env.get("MP_REGION")).toBe("eu");
    vi.stubEnv("MP_REGION", undefined);

    // tokenStore.* (owner N2).
    expect(effects.tokenStore.readTokens("team")).toBeNull();
    expect(effects.tokenStore.accountDirExists("team")).toBe(false);
    const tokensPath = effects.tokenStore.writeTokens("team", sampleTokens());
    expect(tokensPath).toContain("team");
    expect(effects.tokenStore.accountDirExists("team")).toBe(true);
    expect(effects.tokenStore.readTokens("team")).not.toBeNull();
    expect(effects.tokenStore.clientInfoPath("us")).toContain("client_us.json");
    effects.tokenStore.removeTokens("team");
    effects.tokenStore.removeAccountDir("team");
    expect(effects.tokenStore.accountDirExists("team")).toBe(false);

    // tokenResolver (owner N2) — static inline-token path.
    const otAccount: OAuthTokenAccount = {
      type: "oauth_token",
      name: "ci",
      region: "us",
      token: new Secret("static-bearer"),
      token_env: null,
      default_project: null,
    };
    await expect(effects.tokenResolver.getStaticToken(otAccount)).resolves.toBe(
      "static-bearer",
    );

    // bridge.* (owner N2) — MP_AUTH_FILE points at tmp.
    expect(effects.bridge.load()).toBeNull();
    const bridgeTo = join(makeTempDir(cleanups), "auth.json");
    const written = await effects.bridge.export({
      account: effects.config.getAccount("team"),
      to: bridgeTo,
      project: "3713224",
      workspace: null,
      headers: null,
      tokenResolver: effects.tokenResolver,
    });
    expect(written).toBe(bridgeTo);
    expect(effects.bridge.remove(bridgeTo)).toBe(true);

    // meCache (owner N2) — on-disk put under the tmp storage root.
    await effects.meCache.put(
      "team",
      new MeResponse({ user_id: 1, user_email: "t@example.com" }),
    );

    // persistActive (owner N3 over N1's applySession) — the
    // UNPORTED_RESOLVER_SEAM residue closure.
    const persistSession: Session = {
      account: effects.config.getAccount("team"),
      project: { id: "3018488" },
      workspace: null,
      headers: new Map<string, string>(),
    };
    await effects.persistActive(persistSession);
    expect(effects.config.getActive().account).toBe("team");

    // readSecretStdin (owner N1) — the io-utils twin over the
    // injected reader (cap + pythonStrip semantics, never
    // UNPORTED_AUTH_SEAM).
    expect(effects.readSecretStdin()).toBe("sweep-secret");

    // narrate (owner N3; not in the constant — core default is a
    // silent no-op, the node bag writes one line to stderr). Capture
    // the write so the assertion is on the sink, not on the terminal.
    const stderrWrite = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    try {
      effects.narrate("sweep: narrate wired");
      expect(stderrWrite).toHaveBeenCalledTimes(1);
      expect(stderrWrite).toHaveBeenCalledWith("sweep: narrate wired\n");
    } finally {
      stderrWrite.mockRestore();
    }

    // Core seam-bag routing over the real bag (readFile is W7-D1 —
    // N1's nodeReadFile; not in the auth constant but same duty).
    const seams = resolverSeamsFromEffects(effects);
    // eslint-disable-next-line vitest/prefer-expect-resolves -- resolver seams are MaybePromise; `.resolves` would throw on a synchronous seam
    expect(await seams.envWorkspaceId()).toBeNull();

    // The constant itself stays committed in core — every name above
    // maps to a real member.
    expect([...UNPORTED_AUTH_SEAMS].sort()).toStrictEqual(
      [
        "persistActive",
        "config.*",
        "env",
        "tokenStore.*",
        "tokenResolver",
        "oauthFlow.login",
        "bridge.*",
        "meCache",
        "readSecretStdin",
      ].sort(),
    );
  });

  it("oauthFlow.login runs the REAL flow (injected flowSeams, fake DCR/exchange fetch)", async () => {
    tmpBag(); // points MP_OAUTH_STORAGE_DIR at a fresh tmp root
    const openedUrls: string[] = [];
    const fetchImpl = ((input: RequestInfo | URL): Promise<Response> => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.endsWith("/oauth/mcp/register/")) {
        return Promise.resolve(
          Response.json(
            { client_id: "sweep-client" },
            {
              status: 201,
              headers: { "content-type": "application/json" },
            },
          ),
        );
      }
      if (url.endsWith("/oauth/token/")) {
        return Promise.resolve(
          Response.json(
            {
              access_token: "sweep-tok",
              refresh_token: "sweep-refresh",
              expires_in: 3600,
              scope: "projects",
              token_type: "Bearer",
            },
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      }
      throw new Error(`unexpected URL in sweep: ${url}`);
    }) as typeof fetch;

    const effects = createNodeAuthEffects({
      fetchImpl,
      flowSeams: {
        openBrowser: (url: string): void => {
          openedUrls.push(url);
        },
        findAvailablePort: (): Promise<number | null> => Promise.resolve(19284),
        startCallbackServer: (options: {
          state: string;
        }): Promise<readonly [CallbackResult, number]> =>
          Promise.resolve([
            new CallbackResult({ code: "sweep-code", state: options.state }),
            19284,
          ] as const),
      },
    });

    const tokens = await effects.oauthFlow.login("us", { openBrowser: true });

    expect(tokens.access_token.reveal()).toBe("sweep-tok");
    expect(openedUrls).toHaveLength(1);
    expect(openedUrls[0] ?? "").toContain("code_challenge_method=S256");
  });
});

describe("Workspace.use persistence over the real node bag", () => {
  // python: test_workspace_use.py::TestPersist
  /**
   * Two accounts in a REAL tmp config + a Workspace over the real
   * resolver seams (the `twoAccountsBundle` twin over disk).
   *
   * @returns The workspace, bag, and config path.
   */
  function realBagWorkspace(): {
    ws: Workspace;
    configPath: string;
    effects: ReturnType<typeof createNodeAuthEffects>;
  } {
    const { effects, configPath } = tmpBag();
    // Namespace-level add: FR-045 promotes the first account; the adds
    // below go through config to keep both in sync.
    createAccountsNamespace(effects);
    effects.config.addAccount("team", {
      type: "service_account",
      region: "us",
      username: "team.sa",
      secret: new Secret("team-secret"),
      default_project: "3713224",
    });
    effects.config.addAccount("other", {
      type: "service_account",
      region: "eu",
      username: "other.sa",
      secret: new Secret("other-secret"),
      default_project: "3713224",
    });
    effects.config.setActive({ account: "team" });

    const session = makeSession({
      name: "team",
      region: "us",
      projectId: "3713224",
      username: "team.sa",
      secret: "team-secret",
    });
    const canned: CannedResponse = { status: 200, json: [] };
    const { client } = createMockClient(session, () => canned);
    const ws = new Workspace({
      session,
      client,
      seams: resolverSeamsFromEffects(effects),
    });
    return { ws, configPath, effects };
  }

  it("use({account, persist: true}) writes to the on-disk [active]", async () => {
    const { ws, configPath } = realBagWorkspace();

    await ws.use({ account: "other", persist: true });

    const fresh = new ConfigManager({ configPath });
    expect(fresh.getActive().account).toBe("other");
  });

  it("persist with a cleared workspace drops the on-disk [active].workspace", async () => {
    const { ws, configPath, effects } = realBagWorkspace();
    effects.config.setActive({ workspace: 42 });
    expect(effects.config.getActive().workspace).toBe(42);

    // Account swap clears the in-session workspace per FR-033.
    await ws.use({ account: "other", persist: true });

    expect(ws.workspace).toBeNull();
    const fresh = new ConfigManager({ configPath });
    expect(fresh.getActive().workspace ?? null).toBeNull();
  });
});

describe("namespace swap-in over the real bag", () => {
  it("accounts add/list/use and first-account promotion over the real bag", async () => {
    const { effects } = tmpBag();
    const accounts = createAccountsNamespace(effects);

    await accounts.add("team", {
      type: "service_account",
      region: "us",
      username: "u",
      secret: "s",
    });

    // FR-045: the FIRST account promotes to [active] in the adapter
    // transaction (namespace layer), not in the manager twin.
    expect(effects.config.getActive().account).toBe("team");
    await accounts.add("other", {
      type: "service_account",
      region: "eu",
      username: "o",
      secret: "s2",
      default_project: "3713224",
    });
    expect(accounts.list().map((summary) => summary.name)).toStrictEqual([
      "other",
      "team",
    ]);
    accounts.use("other");
    expect(effects.config.getActive().account).toBe("other");
  });

  it("session.show / targets add-use-show over the real bag", async () => {
    const { effects } = tmpBag();
    const accounts = createAccountsNamespace(effects);
    const session = createSessionNamespace(effects);
    const targets = createTargetsNamespace(effects);

    await accounts.add("team", {
      type: "service_account",
      region: "us",
      username: "u",
      secret: "s",
      default_project: "3713224",
    });
    targets.add("ecom", { account: "team", project: "3018488", workspace: 7 });

    targets.use("ecom");

    expect(targets.show("ecom").project).toBe("3018488");
    const active = session.show();
    expect(active.account).toBe("team");
    expect(active.workspace).toBe(7);
  });
});
