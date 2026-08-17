// B8-N2 R10.9 harness — §3.6 row 8 fast-check surfaces (≥500 examples
// each) vs independent mini-models, plus the randomized half of row 1
// (form-encoding agreement vs a Python-urlencode mini-model).
// Run: npx vite-node throwaway/b8-n2/fuzz.ts
//
// Surfaces:
//   A (500) refresh classifier — status × body × operation × account
//     name vs a hand-written mini-model of `flow.py:542-585`.
//   B (500) storage path layout — (root override?, region|account
//     name) → expected file path vs a string-template mini-model.
//   C (500) bridge resolution order — subsets of {explicit, env,
//     default₁, default₂} present → which candidate loads, vs the
//     `bridge.py:137-196` priority mini-model.
//   D (500) MeCache TTL — random (cached_at, ttl, now) triples vs the
//     `age > ttl` mini-model.
//   E (500) quote_plus agreement — random token strings through the
//     REAL refresh body vs a CPython `urllib.parse.urlencode`
//     mini-model (letters/digits/`_.-~` literal, space → `+`, all
//     else `%XX` uppercase UTF-8).

import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

import fc from "fast-check";

import { OAuthTokens } from "../../packages/core/src/auth/token.js";
import { OAuthError } from "../../packages/core/src/errors.js";
import { Secret } from "../../packages/core/src/secret.js";
import { loadBridge } from "../../packages/node/src/auth/bridge.js";
import {
  OAuthFlow,
  pythonUtcIsoformat,
} from "../../packages/node/src/auth/flow.js";
import {
  OAuthStorage,
  accountDir,
} from "../../packages/node/src/auth/storage.js";
import { MeCache } from "../../packages/node/src/me-cache.js";
import { MeResponse } from "../../packages/core/src/client/me.js";

const SEED = 20260816;
const NOW_MS = Date.parse("2026-01-15T12:00:00Z");
const NUM_RUNS = 500;

const savedEnv = { ...process.env };
let failures = 0;
const table: string[] = [];

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

/** Guard: never under the real home dir. */
function guard(path: string): string {
  const home = resolve(homedir());
  if (resolve(path).startsWith(home + sep)) {
    throw new Error(`harness guard: ${path} is under the real home`);
  }
  return path;
}

/**
 * Run one fast-check surface and record its zero-divergence row.
 *
 * @param name - Surface label.
 * @param prop - The (sync or async) property.
 */
async function surface(
  name: string,
  prop:
    fc.IAsyncPropertyWithHooks<unknown[]> | fc.IPropertyWithHooks<unknown[]>,
): Promise<void> {
  const out = await fc.check(prop as fc.IAsyncPropertyWithHooks<unknown[]>, {
    seed: SEED,
    numRuns: NUM_RUNS,
  });
  if (out.failed) {
    failures += 1;
    table.push(
      `${name}: seed=${SEED} runs=${NUM_RUNS} DIVERGENT ` +
        `${JSON.stringify(out.counterexample)}`,
    );
  } else {
    table.push(`${name}: seed=${SEED} runs=${NUM_RUNS} zero-divergence`);
  }
}

// ── Surface A: refresh classifier ───────────────────────────────────
const ROOT = guard(mkdtempSync(join(tmpdir(), "mp-b8n2-fuzz-")));

/** Classifier outcome mini-model of `flow.py:542-585`. */
function classifierModel(
  status: number,
  bodyIsInvalidGrant: boolean,
  named: boolean,
): { code: string; hasAccountName: boolean; accountNameNull: boolean } {
  const invalidGrant = (status === 400 || status === 401) && bodyIsInvalidGrant;
  if (invalidGrant) {
    return {
      code: "OAUTH_REFRESH_REVOKED",
      hasAccountName: true,
      accountNameNull: !named,
    };
  }
  return {
    code: "OAUTH_REFRESH_ERROR",
    hasAccountName: named,
    accountNameNull: false,
  };
}

/**
 * Drive the REAL classifier once.
 *
 * @param status - Response status.
 * @param body - Response body text.
 * @param named - Whether accountName is supplied.
 * @returns Observed code + details shape.
 */
async function classifierReal(
  status: number,
  body: string,
  named: boolean,
): Promise<{
  code: string;
  hasAccountName: boolean;
  accountNameNull: boolean;
}> {
  const fetchImpl = ((): Promise<Response> =>
    Promise.resolve(new Response(body, { status }))) as unknown as typeof fetch;
  const flow = new OAuthFlow({
    region: "us",
    storage: new OAuthStorage({ storageDir: join(ROOT, "unused") }),
    fetchImpl,
    now: () => NOW_MS,
  });
  const tokens = new OAuthTokens({
    access_token: new Secret("a"),
    refresh_token: new Secret("r"),
    expires_at: pythonUtcIsoformat(NOW_MS - 1000),
    scope: "s",
    token_type: "Bearer",
  });
  try {
    await flow.refreshTokens(tokens, "cid", named ? { accountName: "nm" } : {});
    throw new Error("classifier did not raise");
  } catch (exc) {
    const err = exc as OAuthError;
    return {
      code: err.code,
      hasAccountName: Object.hasOwn(err.details, "account_name"),
      accountNameNull: err.details["account_name"] === null,
    };
  }
}

await surface(
  "A refresh-classifier",
  fc.asyncProperty(
    fc.constantFrom(400, 401, 403, 404, 422, 500, 503),
    fc.constantFrom(
      '{"error":"invalid_grant"}',
      '{"error":"other"}',
      "not json",
      '["invalid_grant"]',
      '{"error": "invalid_grant", "detail": "x"}',
      "",
    ),
    fc.boolean(),
    async (status, body, named) => {
      const isInvalidGrant = ((): boolean => {
        try {
          const parsed: unknown = JSON.parse(body);
          return (
            typeof parsed === "object" &&
            parsed !== null &&
            !Array.isArray(parsed) &&
            (parsed as Record<string, unknown>)["error"] === "invalid_grant"
          );
        } catch {
          return false;
        }
      })();
      const expected = classifierModel(status, isInvalidGrant, named);
      const got = await classifierReal(status, body, named);
      return (
        got.code === expected.code &&
        got.hasAccountName === expected.hasAccountName &&
        (expected.code !== "OAUTH_REFRESH_REVOKED" ||
          got.accountNameNull === expected.accountNameNull)
      );
    },
  ) as never,
);

// ── Surface B: storage path layout ──────────────────────────────────
await surface(
  "B storage-path-layout",
  fc.property(
    fc.boolean(),
    fc.constantFrom("us", "eu", "in"),
    fc.stringMatching(/^[a-zA-Z0-9_-]{1,64}$/),
    (override, region, name) => {
      const root = join(ROOT, "layout");
      if (override) {
        process.env["MP_OAUTH_STORAGE_DIR"] = root;
      } else {
        delete process.env["MP_OAUTH_STORAGE_DIR"];
        process.env["HOME"] = root;
      }
      try {
        const expectedRoot = override ? root : join(root, ".mp");
        const storage = new OAuthStorage();
        const okTokens =
          storage.tokensPath(region) ===
          join(expectedRoot, "oauth", `tokens_${region}.json`);
        const okClient =
          storage.clientPath(region) ===
          join(expectedRoot, "oauth", `client_${region}.json`);
        const okAccount =
          accountDir(name) === join(expectedRoot, "accounts", name);
        return okTokens && okClient && okAccount;
      } finally {
        restoreEnv();
      }
    },
  ) as never,
);

// ── Surface C: bridge resolution order ──────────────────────────────
// Candidates: explicit path > MP_AUTH_FILE > default₁ (~/.claude/...)
// > default₂ (cwd). Each present/absent independently; the loader must
// pick the first PRESENT rung of {explicit, env} and otherwise the
// first EXISTING default.
{
  const savedCwd = process.cwd();
  await surface(
    "C bridge-resolution-order",
    fc.property(
      fc.boolean(),
      fc.boolean(),
      fc.boolean(),
      fc.boolean(),
      (explicit, env, dflt1, dflt2) => {
        const home = guard(mkdtempSync(join(ROOT, "brz-")));
        process.env["HOME"] = home;
        delete process.env["MP_AUTH_FILE"];
        const cwd = join(home, "cwd");
        mkdirSync(cwd, { recursive: true });
        process.chdir(cwd);
        const write = (path: string, marker: string): void => {
          mkdirSync(join(path, ".."), { recursive: true });
          writeFileSync(
            path,
            JSON.stringify({
              version: 2,
              account: {
                type: "service_account",
                name: marker,
                region: "us",
                username: "u",
                secret: "s",
              },
            }),
            "utf8",
          );
          chmodSync(path, 0o600);
        };
        const explicitPath = join(home, "explicit.json");
        const envPath = join(home, "env.json");
        const d1 = join(home, ".claude", "mixpanel", "auth.json");
        const d2 = join(cwd, "mixpanel_auth.json");
        if (explicit) {
          write(explicitPath, "explicit");
        }
        if (env) {
          write(envPath, "env");
          process.env["MP_AUTH_FILE"] = envPath;
        }
        if (dflt1) {
          write(d1, "d1");
        }
        if (dflt2) {
          write(d2, "d2");
        }
        // Mini-model of `bridge.py:158-194`.
        let expected: string | null;
        if (explicit) {
          expected = "explicit";
        } else if (env) {
          expected = "env";
        } else if (dflt1) {
          expected = "d1";
        } else if (dflt2) {
          expected = "d2";
        } else {
          expected = null;
        }
        try {
          const got = loadBridge(explicit ? explicitPath : null);
          return (got?.account.name ?? null) === expected;
        } finally {
          process.chdir(savedCwd);
          restoreEnv();
          rmSync(home, { recursive: true, force: true });
        }
      },
    ) as never,
  );
}

// ── Surface D: MeCache TTL ──────────────────────────────────────────
{
  const dir = join(ROOT, "ttl");
  mkdirSync(dir, { recursive: true });
  await surface(
    "D mecache-ttl",
    fc.property(
      fc.integer({ min: 0, max: 10_000 }),
      fc.integer({ min: 1, max: 5_000 }),
      fc.integer({ min: 0, max: 20_000 }),
      (cachedAt, ttl, now) => {
        let clock = cachedAt;
        const cache = new MeCache({
          accountName: "ttl",
          storageDir: dir,
          ttlSeconds: ttl,
          now: () => clock,
        });
        cache.put(new MeResponse({ user_id: 9 }));
        clock = now;
        const hit = cache.get() !== null;
        // Mini-model (`me.py:519-528`): expired iff now-cachedAt > ttl.
        const expectedHit = !(now - cachedAt > ttl);
        return hit === expectedHit;
      },
    ) as never,
  );
}

// ── Surface E: quote_plus agreement on the refresh body ─────────────
/** CPython quote_plus mini-model (UTF-8 bytes; `_.-~` literal). */
function pyQuotePlus(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let out = "";
  for (const byte of bytes) {
    const ch = String.fromCharCode(byte);
    if (/[A-Za-z0-9_.\-~]/.test(ch)) {
      out += ch;
    } else if (ch === " ") {
      out += "+";
    } else {
      out += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    }
  }
  return out;
}

await surface(
  "E quote-plus-agreement",
  fc.asyncProperty(
    fc.oneof(
      fc.string({ minLength: 1, maxLength: 40 }),
      fc.constantFrom("a b+c&d=e", "𝒳", "tok/with=+*~", "é é", "%41", "?#[]@"),
    ),
    fc.stringMatching(/^[A-Za-z0-9._~*+/=-]{1,30}$/),
    async (refreshTok, clientId) => {
      let captured = "";
      const fetchImpl = ((
        _input: RequestInfo | URL,
        init?: RequestInit,
      ): Promise<Response> => {
        captured = typeof init?.body === "string" ? init.body : "";
        return Promise.resolve(
          new Response(
            JSON.stringify({
              access_token: "a",
              expires_in: 60,
              scope: "",
              token_type: "Bearer",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      }) as typeof fetch;
      const flow = new OAuthFlow({
        region: "us",
        storage: new OAuthStorage({ storageDir: join(ROOT, "unused") }),
        fetchImpl,
        now: () => NOW_MS,
      });
      const tokens = new OAuthTokens({
        access_token: new Secret("a"),
        refresh_token: new Secret(refreshTok),
        expires_at: pythonUtcIsoformat(NOW_MS - 1000),
        scope: "s",
        token_type: "Bearer",
      });
      await flow.refreshTokens(tokens, clientId);
      const expected =
        `grant_type=refresh_token&refresh_token=${pyQuotePlus(refreshTok)}` +
        `&client_id=${pyQuotePlus(clientId)}`;
      return captured === expected;
    },
  ) as never,
);

for (const line of table) {
  console.log(line);
}
rmSync(ROOT, { recursive: true, force: true });
console.log(`fuzz: ${table.length} surfaces, ${failures} divergent`);
if (failures > 0) {
  process.exitCode = 1;
}
