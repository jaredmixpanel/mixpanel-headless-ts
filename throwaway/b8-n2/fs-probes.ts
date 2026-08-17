// B8-N2 R10.9 harness — §3.6 rows 2, 4, 5, 6 and the FS half of row 7
// (b8-packets.md). Run: npx vite-node throwaway/b8-n2/fs-probes.ts
//
// Row 2: 0600 + symlink + atomicity on EVERY N2 write path
// (save_tokens, save_client_info, per-account tokens.json rewrite,
// bridge export, me.json) and refusal on every read path (file
// symlinked, parent symlinked, dangling).
// Row 4: OnDiskTokenResolver sweep — static (inline / env set / env
// empty / env unset), browser (missing, malformed, model-invalid,
// fresh, expired→refresh→rotation-keep→persisted-bytes, concurrent
// refreshers over the atomic scheme).
// Row 5: bridge v2 round-trip incl. revealed secrets for all three
// account types; oauth_browser without on-disk tokens; v1 / unknown
// version / extra key / naive datetime refusals; MP_AUTH_FILE
// precedence; remove default-chain vs explicit.
// Row 6: MeCache TTL boundary (cached_at+ttl±1), corrupt file,
// chmod-failure raise, ordered-organizations re-hydration.
// Row 7 (FS half): sentinel secrets — on-disk appearances ONLY at the
// designated reveal sites (tokens.json, client info, bridge, me.json
// holds no secrets); no `**********` mask ever persisted.

import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

import { MeResponse } from "../../packages/core/src/client/me.js";
import { OAuthTokens } from "../../packages/core/src/auth/token.js";
import { ConfigError, OAuthError } from "../../packages/core/src/errors.js";
import { Secret } from "../../packages/core/src/secret.js";
import {
  exportBridge,
  loadBridge,
  materializeBridgeTokens,
  parseBridgeFile,
  removeBridge,
} from "../../packages/node/src/auth/bridge.js";
import { pythonUtcIsoformat } from "../../packages/node/src/auth/flow.js";
import { OAuthStorage } from "../../packages/node/src/auth/storage.js";
import { OnDiskTokenResolver } from "../../packages/node/src/auth/token-resolver.js";
import { createNodeTokenStore } from "../../packages/node/src/auth/token-store.js";
import { MeCache } from "../../packages/node/src/me-cache.js";

const NOW_MS = Date.parse("2026-01-15T12:00:00Z");
const SENTINEL = "S3NT1NEL-fs-secret-XYZZY";

let failures = 0;
let checks = 0;

/**
 * Record one assertion row.
 *
 * @param name - Row label.
 * @param ok - Whether the probe held.
 * @param detail - Extra context on failure.
 */
function check(name: string, ok: boolean, detail = ""): void {
  checks += 1;
  if (!ok) {
    failures += 1;
    console.log(`FAIL ${name} ${detail}`);
  }
}

/** Guard: never under the real home dir. */
function guard(path: string): string {
  const home = resolve(homedir());
  if (resolve(path).startsWith(home + sep)) {
    throw new Error(`harness guard: ${path} is under the real home`);
  }
  return path;
}

const savedEnv = { ...process.env };

/**
 * Restore `process.env` IN PLACE (never reassign it — replacing the
 * magic object severs the libuv environ binding `os.homedir()` reads).
 */
function restoreEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) {
      delete process.env[key];
    }
  }
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value !== undefined) {
      process.env[key] = value;
    }
  }
}

/** Fresh isolated HOME + storage root. */
function isolate(): string {
  const home = guard(mkdtempSync(join(tmpdir(), "mp-b8n2-fs-")));
  process.env["HOME"] = home;
  process.env["MP_OAUTH_STORAGE_DIR"] = join(home, ".mp");
  delete process.env["MP_AUTH_FILE"];
  return home;
}

/** Restore env and drop a tree. */
function restore(home: string): void {
  rmSync(home, { recursive: true, force: true });
  restoreEnv();
}

/** Tokens fixture. */
function tokensFixture(options?: {
  access?: string;
  refresh?: string | null;
  expiresMs?: number;
}): OAuthTokens {
  const refresh = options?.refresh;
  return new OAuthTokens({
    access_token: new Secret(options?.access ?? "acc"),
    refresh_token: refresh === null ? null : new Secret(refresh ?? "ref"),
    expires_at: pythonUtcIsoformat(options?.expiresMs ?? NOW_MS + 3_600_000),
    scope: "read",
    token_type: "Bearer",
  });
}

/** Row 2 — write-path discipline. */
function writePaths(): void {
  const home = isolate();
  const mode = (p: string): number => statSync(p).mode & 0o7777;

  // save_tokens / save_client_info (legacy v2 world).
  const storage = new OAuthStorage();
  storage.saveTokens(tokensFixture({ access: SENTINEL }), "us");
  storage.saveClientInfo({
    client_id: "cid",
    region: "us",
    redirect_uri: "http://localhost:19284/callback",
    scope: "read",
    created_at: pythonUtcIsoformat(NOW_MS),
  });
  const tokensPath = join(home, ".mp", "oauth", "tokens_us.json");
  const clientPath = join(home, ".mp", "oauth", "client_us.json");
  check("save_tokens 0600", mode(tokensPath) === 0o600);
  check("save_client_info 0600", mode(clientPath) === 0o600);
  check("oauth dir 0700", mode(join(home, ".mp", "oauth")) === 0o700);
  check(
    "save_tokens reveals (no mask)",
    readFileSync(tokensPath, "utf8").includes(SENTINEL) &&
      !readFileSync(tokensPath, "utf8").includes("**********"),
  );

  // TokenStore.writeTokens (per-account world).
  const store = createNodeTokenStore();
  const perAccount = store.writeTokens("acct", tokensFixture());
  check("writeTokens 0600", mode(perAccount) === 0o600);
  check(
    "account dir 0700",
    mode(join(home, ".mp", "accounts", "acct")) === 0o700,
  );

  // Bridge export.
  const bridgeOut = join(home, "bridge-out", "auth.json");
  exportBridge(
    {
      type: "service_account",
      name: "sa",
      region: "us",
      username: "u",
      secret: new Secret(SENTINEL),
    },
    { to: bridgeOut },
  );
  check("bridge export 0600", mode(bridgeOut) === 0o600);
  const bridgeText = readFileSync(bridgeOut, "utf8");
  check(
    "bridge reveals (no mask)",
    bridgeText.includes(SENTINEL) && !bridgeText.includes("**********"),
  );

  // me.json.
  const cacheDir = join(home, ".mp", "accounts", "acct");
  const cache = new MeCache({
    accountName: "acct",
    storageDir: cacheDir,
    now: () => NOW_MS / 1000,
  });
  cache.put(new MeResponse({ user_id: 1, user_email: "a@b.c" }));
  check("me.json 0600", mode(join(cacheDir, "me.json")) === 0o600);

  // Atomicity signal: no stray tmp files after any write.
  for (const dir of [join(home, ".mp", "oauth"), cacheDir]) {
    const strays = existsSync(dir)
      ? readdirNames(dir).filter((n) => n.includes(".tmp."))
      : [];
    check(`no tmp strays in ${dir}`, strays.length === 0, strays.join(","));
  }

  // Read-path refusals: file symlinked / dangling / parent symlinked.
  const attacker = join(home, "attacker.json");
  writeFileSync(attacker, "{}", "utf8");
  chmodSync(attacker, 0o600);
  rmSync(tokensPath);
  symlinkSync(attacker, tokensPath);
  check("read refuses symlinked tokens", storage.loadTokens("us") === null);
  rmSync(tokensPath);
  symlinkSync(join(home, "gone.json"), tokensPath);
  check("read refuses dangling tokens", storage.loadTokens("us") === null);
  const linkedRootHome = guard(mkdtempSync(join(tmpdir(), "mp-b8n2-ln-")));
  const realDir = join(linkedRootHome, "real");
  mkdirSync(realDir, { recursive: true });
  chmodSync(realDir, 0o755); // deliberately lax — must NOT be repaired
  writeFileSync(join(realDir, "tokens_us.json"), "{}", "utf8");
  chmodSync(join(realDir, "tokens_us.json"), 0o600);
  const linkDir = join(linkedRootHome, "link");
  symlinkSync(realDir, linkDir);
  const viaLink = new OAuthStorage({ storageDir: linkDir });
  // Parent symlinked: the storage-dir lstat sees a symlink and refuses
  // to chmod THROUGH it (Python's dir branch — warn, no side effect).
  viaLink.checkAndFixPermissions(join(linkDir, "tokens_us.json"));
  check(
    "parent symlink not chmodded through",
    (statSync(realDir).mode & 0o7777) === 0o755,
  );
  rmSync(linkedRootHome, { recursive: true, force: true });

  restore(home);
}

/**
 * Directory listing helper.
 *
 * @param dir - Directory.
 * @returns Names.
 */
function readdirNames(dir: string): string[] {
  return readdirSync(dir);
}

/** Row 4 — resolver sweep. */
async function resolverSweep(): Promise<void> {
  const home = isolate();

  /**
   * Expect an OAuthError from a promise.
   *
   * @param promise - The failing call.
   * @returns The error or null.
   */
  const catchErr = async (
    promise: Promise<unknown>,
  ): Promise<OAuthError | null> => {
    try {
      await promise;
      return null;
    } catch (exc) {
      return exc instanceof OAuthError ? exc : null;
    }
  };

  // Static rows.
  const resolver = new OnDiskTokenResolver({ now: () => NOW_MS });
  const inline = {
    type: "oauth_token" as const,
    name: "ci",
    region: "us" as const,
    token: new Secret("inline-1"),
    token_env: null,
  };
  check(
    "static inline",
    (await resolver.getStaticToken(inline)) === "inline-1",
  );
  process.env["B8_HARNESS_TOK"] = "env-1";
  const viaEnv = { ...inline, token: null, token_env: "B8_HARNESS_TOK" };
  check("static env set", (await resolver.getStaticToken(viaEnv)) === "env-1");
  process.env["B8_HARNESS_TOK"] = "";
  check(
    "static env empty",
    (await catchErr(resolver.getStaticToken(viaEnv))) !== null,
  );
  delete process.env["B8_HARNESS_TOK"];
  check(
    "static env unset",
    (await catchErr(resolver.getStaticToken(viaEnv))) !== null,
  );

  // Browser rows.
  const accountsDir = join(home, ".mp", "accounts", "me");
  mkdirSync(accountsDir, { recursive: true, mode: 0o700 });
  const path = join(accountsDir, "tokens.json");
  check(
    "browser missing file",
    (await catchErr(resolver.getBrowserToken("me", "us")))?.code ===
      "OAUTH_TOKEN_ERROR",
  );
  writeFileSync(path, "{nope", "utf8");
  chmodSync(path, 0o600);
  check(
    "browser malformed JSON",
    (await catchErr(resolver.getBrowserToken("me", "us")))?.code ===
      "OAUTH_TOKEN_ERROR",
  );
  writeFileSync(
    path,
    JSON.stringify({
      access_token: "a",
      expires_at: "not-a-date",
      scope: "",
      token_type: "b",
    }),
    "utf8",
  );
  chmodSync(path, 0o600);
  check(
    "browser model-invalid",
    (await catchErr(resolver.getBrowserToken("me", "us")))?.code ===
      "OAUTH_TOKEN_ERROR",
  );
  writeFileSync(
    path,
    JSON.stringify({
      access_token: "fresh-1",
      expires_at: pythonUtcIsoformat(NOW_MS + 3_600_000),
      scope: "read",
      token_type: "Bearer",
    }),
    "utf8",
  );
  chmodSync(path, 0o600);
  check(
    "browser fresh",
    (await resolver.getBrowserToken("me", "us")) === "fresh-1",
  );

  // Expired → refresh → rotation-keep → persisted bytes.
  writeFileSync(
    path,
    JSON.stringify({
      access_token: "old",
      refresh_token: "keep-me",
      expires_at: pythonUtcIsoformat(NOW_MS - 3_600_000),
      scope: "read",
      token_type: "Bearer",
    }),
    "utf8",
  );
  chmodSync(path, 0o600);
  let refreshCalls = 0;
  const refreshing = new OnDiskTokenResolver({
    now: () => NOW_MS,
    loadClientInfo: (region) => ({
      client_id: "cid",
      region,
      redirect_uri: "http://localhost:19284/callback",
      scope: "read",
      created_at: pythonUtcIsoformat(NOW_MS),
    }),
    refresh: () => {
      refreshCalls += 1;
      return Promise.resolve(
        new OAuthTokens({
          access_token: new Secret(`rotated-${refreshCalls}`),
          refresh_token: null, // IdP did not rotate
          expires_at: pythonUtcIsoformat(NOW_MS + 3_600_000),
          scope: "read",
          token_type: "Bearer",
        }),
      );
    },
  });
  // Concurrent refreshers over the atomic scheme.
  const [tokA, tokB] = await Promise.all([
    refreshing.getBrowserToken("me", "us"),
    refreshing.getBrowserToken("me", "us"),
  ]);
  check(
    "concurrent refresh both resolve",
    tokA.startsWith("rotated-") && tokB.startsWith("rotated-"),
  );
  check("concurrent refresh once per caller", refreshCalls === 2);
  const persisted = JSON.parse(readFileSync(path, "utf8")) as Record<
    string,
    unknown
  >;
  check("rotation keep persisted", persisted["refresh_token"] === "keep-me");
  check("persisted mode 0600", (statSync(path).mode & 0o7777) === 0o600);

  restore(home);
}

/** Row 5 — bridge round-trips + hostile payloads. */
function bridgeRows(): void {
  const home = isolate();

  // Round-trip all three account types, revealed secrets included.
  const sa = {
    type: "service_account" as const,
    name: "sa",
    region: "us" as const,
    default_project: "123",
    username: "u",
    secret: new Secret("sa-secret"),
  };
  const saOut = join(home, "sa.json");
  exportBridge(sa, {
    to: saOut,
    project: "3018488",
    workspace: 12,
    headers: { "X-H": "v" },
  });
  const saBack = loadBridge(saOut);
  check(
    "sa round-trip",
    saBack !== null &&
      saBack.account.type === "service_account" &&
      saBack.account.type === "service_account" &&
      (saBack.account as { secret: Secret }).secret.reveal() === "sa-secret" &&
      saBack.project === "3018488" &&
      saBack.workspace === 12 &&
      saBack.headers["X-H"] === "v",
  );

  const ot = {
    type: "oauth_token" as const,
    name: "ci",
    region: "eu" as const,
    token: new Secret("ot-secret"),
    token_env: null,
  };
  const otOut = join(home, "ot.json");
  exportBridge(ot, { to: otOut });
  const otBack = loadBridge(otOut);
  check(
    "ot round-trip",
    otBack !== null &&
      otBack.account.type === "oauth_token" &&
      ((otBack.account as { token: Secret | null }).token?.reveal() ?? "") ===
        "ot-secret",
  );

  // oauth_browser: seed per-account tokens, export embeds them.
  const brDir = join(home, ".mp", "accounts", "br");
  mkdirSync(brDir, { recursive: true, mode: 0o700 });
  writeFileSync(
    join(brDir, "tokens.json"),
    JSON.stringify({
      access_token: "br-acc",
      refresh_token: "br-ref",
      expires_at: pythonUtcIsoformat(NOW_MS + 3_600_000),
      scope: "read",
      token_type: "Bearer",
    }),
    "utf8",
  );
  chmodSync(join(brDir, "tokens.json"), 0o600);
  const brOut = join(home, "br.json");
  exportBridge(
    { type: "oauth_browser", name: "br", region: "us" },
    { to: brOut },
  );
  const brBack = loadBridge(brOut);
  check(
    "browser round-trip embeds tokens",
    brBack?.tokens?.access_token.reveal() === "br-acc" &&
      brBack?.tokens?.refresh_token?.reveal() === "br-ref",
  );

  // oauth_browser without on-disk tokens → coded error, no partial file.
  const ghostOut = join(home, "ghost.json");
  let ghostErr: unknown = null;
  try {
    exportBridge(
      { type: "oauth_browser", name: "ghost", region: "us" },
      { to: ghostOut },
    );
  } catch (exc) {
    ghostErr = exc;
  }
  check("ghost export raises OAuthError", ghostErr instanceof OAuthError);
  check("ghost export leaves nothing", !existsSync(ghostOut));

  // Hostile payloads.
  const base = {
    version: 2,
    account: {
      type: "service_account",
      name: "x",
      region: "us",
      username: "u",
      secret: "s",
    },
  };
  const hostile: Array<[string, unknown]> = [
    ["v1", { ...base, version: 1 }],
    ["v3", { ...base, version: 3 }],
    ["version-string", { ...base, version: "2" }],
    ["extra-key", { ...base, extra: 1 }],
    [
      "naive-datetime",
      {
        ...base,
        account: { type: "oauth_browser", name: "x", region: "us" },
        tokens: {
          access_token: "a",
          expires_at: "2026-01-15T12:00:00",
          scope: "",
          token_type: "Bearer",
        },
      },
    ],
    [
      "browser-no-tokens",
      {
        version: 2,
        account: { type: "oauth_browser", name: "x", region: "us" },
      },
    ],
  ];
  for (const [label, payload] of hostile) {
    let refused = false;
    try {
      parseBridgeFile(payload);
    } catch {
      refused = true;
    }
    check(`hostile refused [${label}]`, refused);
  }

  // MP_AUTH_FILE precedence + remove chains.
  const envBridge = join(home, "env-bridge.json");
  exportBridge(sa, { to: envBridge });
  process.env["MP_AUTH_FILE"] = envBridge;
  check("MP_AUTH_FILE wins", loadBridge()?.account.name === "sa");
  check("remove via env chain", removeBridge() === true);
  check("remove idempotent", removeBridge() === false);
  delete process.env["MP_AUTH_FILE"];
  const explicit = join(home, "explicit.json");
  exportBridge(sa, { to: explicit });
  check("remove explicit", removeBridge({ at: explicit }) === true);

  // Symlinked bridge refusal.
  const attacker = join(home, "attack.json");
  writeFileSync(attacker, "{}", "utf8");
  chmodSync(attacker, 0o600);
  const link = join(home, "link.json");
  symlinkSync(attacker, link);
  let linkRefused = false;
  try {
    loadBridge(link);
  } catch (exc) {
    linkRefused = exc instanceof ConfigError;
  }
  check("symlinked bridge refused", linkRefused);

  // Materialization overwrite + scope default.
  const stale = join(home, ".mp", "accounts", "mz");
  mkdirSync(stale, { recursive: true, mode: 0o700 });
  writeFileSync(
    join(stale, "tokens.json"),
    JSON.stringify({ access_token: "STALE" }),
    "utf8",
  );
  chmodSync(join(stale, "tokens.json"), 0o600);
  const mzBridge = parseBridgeFile({
    version: 2,
    account: { type: "oauth_browser", name: "mz", region: "us" },
    tokens: {
      access_token: "FRESH",
      refresh_token: "FR",
      expires_at: pythonUtcIsoformat(NOW_MS + 3_600_000),
      scope: "",
      token_type: "Bearer",
    },
  });
  const written = materializeBridgeTokens(mzBridge);
  const mzPayload = JSON.parse(readFileSync(written ?? "", "utf8")) as Record<
    string,
    unknown
  >;
  check("materialize overwrites", mzPayload["access_token"] === "FRESH");
  check("materialize scope default", mzPayload["scope"] === "read");

  restore(home);
}

/** Row 6 — MeCache rows. */
function meCacheRows(): void {
  const home = isolate();
  const dir = join(home, ".mp", "accounts", "mc");
  mkdirSync(dir, { recursive: true, mode: 0o700 });

  // TTL boundary: cached_at + ttl ± 1.
  let nowSeconds = 1_000_000;
  const cache = new MeCache({
    accountName: "mc",
    storageDir: dir,
    ttlSeconds: 100,
    now: () => nowSeconds,
  });
  cache.put(new MeResponse({ user_id: 5, user_email: "x@y.z" }));
  nowSeconds = 1_000_000 + 99;
  check("ttl-1 hit", cache.get() !== null);
  nowSeconds = 1_000_000 + 100;
  check("ttl exact hit (strictly-greater expiry)", cache.get() !== null);
  nowSeconds = 1_000_000 + 101;
  check("ttl+1 miss", cache.get() === null);

  // Corrupt file.
  writeFileSync(join(dir, "me.json"), "{{{", "utf8");
  chmodSync(join(dir, "me.json"), 0o600);
  check("corrupt me.json → null", cache.get() === null);

  // chmod-failure raise.
  const failing = new MeCache({
    accountName: "mc",
    storageDir: dir,
    now: () => nowSeconds,
    chmodSync: () => {
      throw Object.assign(new Error("nope"), { code: "EACCES" });
    },
  });
  let raised = false;
  try {
    failing.put(new MeResponse({ user_id: 5 }));
  } catch (exc) {
    raised = exc instanceof ConfigError;
  }
  check("chmod failure raises ConfigError", raised);

  // Ordered re-hydration (out-of-ascending org keys).
  const ordered = new MeCache({
    accountName: "mc",
    storageDir: dir,
    now: () => nowSeconds,
  });
  ordered.put(
    new MeResponse({
      user_id: 1,
      organizations: new Map([
        ["77", { id: 77, name: "first" }],
        ["3", { id: 3, name: "second" }],
      ]),
    }),
  );
  const back = ordered.get();
  check(
    "ordered orgs survive round-trip",
    JSON.stringify([...(back?.organizations.keys() ?? [])]) ===
      JSON.stringify(["77", "3"]),
  );

  restore(home);
}

/** Row 7 (FS half) — sentinel discipline on error surfaces + disk. */
async function sentinelFsRows(): Promise<void> {
  const home = isolate();
  const dir = join(home, ".mp", "accounts", "sn");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  // Malformed file CARRYING the sentinel: the resolver's malformed
  // error (message + details JSON) must not echo the value.
  writeFileSync(
    join(dir, "tokens.json"),
    JSON.stringify({
      access_token: SENTINEL,
      expires_at: "not-a-date",
      scope: "read",
      token_type: "Bearer",
    }),
    "utf8",
  );
  chmodSync(join(dir, "tokens.json"), 0o600);
  const resolver = new OnDiskTokenResolver({ now: () => NOW_MS });
  let surface = "";
  try {
    await resolver.getBrowserToken("sn", "us");
  } catch (exc) {
    const err = exc as OAuthError;
    surface = `${err.message} ${JSON.stringify(err.details)}`;
  }
  check("resolver error surface exists", surface.length > 0);
  check("sentinel absent from resolver error", !surface.includes(SENTINEL));

  // No `**********` mask persisted anywhere under the isolated root
  // (CRED-F3: a persisted mask is silent credential corruption).
  const store = createNodeTokenStore();
  store.writeTokens("sn2", tokensFixture({ access: SENTINEL }));
  const walk = (p: string): string[] =>
    statSync(p).isDirectory()
      ? readdirNames(p).flatMap((n) => walk(join(p, n)))
      : [p];
  const masked = walk(join(home, ".mp")).filter((f) =>
    readFileSync(f, "utf8").includes("**********"),
  );
  check("no mask persisted anywhere", masked.length === 0, masked.join(","));
  restore(home);
}

writePaths();
await resolverSweep();
bridgeRows();
meCacheRows();
await sentinelFsRows();

console.log(
  `fs-probes: ${checks} checks, ${failures} failures ` +
    `(${failures === 0 ? "ZERO-DIVERGENCE" : "DIVERGENT"})`,
);
if (failures > 0) {
  process.exitCode = 1;
}
