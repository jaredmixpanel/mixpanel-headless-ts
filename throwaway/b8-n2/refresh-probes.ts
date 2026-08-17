// B8-N2 R10.9 harness — §3.6 rows 1, 3 and the row-7 sentinel sweep
// over the refresh branches (b8-packets.md).
// Run: npx vite-node throwaway/b8-n2/refresh-probes.ts
//
// Row 1: exact-body probe (URLSearchParams-vs-Python-urlencode
// agreement is fuzz.ts surface E; here the deterministic edge set) +
// every §3.2 classifier branch: no-refresh-token, transport error,
// 400/401 invalid_grant (refresh AND exchange-op control via a
// bare-operation call is N3's — the refresh op is probed on both
// statuses), 400/401 non-invalid_grant, 400 unparseable body,
// 403/404/500/503, 200 non-JSON, 200 missing-field matrix,
// rotation-keep (resolver side re-probed in fs-probes.ts), expires_at
// rendering table.
// Row 3: get_valid_token truth table × the 30s-buffer boundary
// (now = expiry−31s/−30s/−29s).
// Row 7 (partial — fs-probes.ts covers the FS branches): sentinel
// secrets through every refresh error branch → sentinel in NO thrown
// message and NO details JSON (response_body carries only what the
// SERVER sent; the sentinel refresh token must never round-trip into
// the error surface).

import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

import { OAuthTokens } from "../../packages/core/src/auth/token.js";
import { OAuthError } from "../../packages/core/src/errors.js";
import { Secret } from "../../packages/core/src/secret.js";
import {
  OAuthFlow,
  pythonUtcIsoformat,
} from "../../packages/node/src/auth/flow.js";
import { OAuthStorage } from "../../packages/node/src/auth/storage.js";

const RECORD_EPOCH_MS = Date.parse("2026-01-15T12:00:00Z");
const SENTINEL = "S3NT1NEL-refresh-secret-XYZZY";

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
function assertNotUnderHome(path: string): void {
  const home = resolve(homedir());
  if (resolve(path).startsWith(home + sep)) {
    throw new Error(`harness guard: ${path} is under the real home`);
  }
}

const ROOT = mkdtempSync(join(tmpdir(), "mp-b8n2-refresh-"));
assertNotUnderHome(ROOT);

/** Captured request. */
interface Captured {
  url: string;
  body: string;
  contentType: string | null;
}

/**
 * Build a flow whose fetch replies with `respond` and records requests.
 *
 * @param respond - Response factory (throw to simulate transport
 *   failure).
 * @returns Flow + captured log.
 */
function flowWith(respond: () => Response): {
  flow: OAuthFlow;
  captured: Captured[];
  storage: OAuthStorage;
} {
  const captured: Captured[] = [];
  const fetchImpl = ((
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    captured.push({
      url: String(input),
      body: typeof init?.body === "string" ? init.body : "",
      contentType:
        Object.entries(headers).find(
          ([k]) => k.toLowerCase() === "content-type",
        )?.[1] ?? null,
    });
    return Promise.resolve(respond());
  }) as typeof fetch;
  const storage = new OAuthStorage({
    storageDir: mkdtempSync(join(ROOT, "st-")),
  });
  return {
    flow: new OAuthFlow({
      region: "us",
      storage,
      fetchImpl,
      now: () => RECORD_EPOCH_MS,
    }),
    captured,
    storage,
  };
}

/**
 * Token fixture expiring one hour before the record epoch.
 *
 * @param refresh - Refresh token value (null = absent).
 * @returns The tokens.
 */
function expired(refresh: string | null): OAuthTokens {
  return new OAuthTokens({
    access_token: new Secret("old-access"),
    refresh_token: refresh === null ? null : new Secret(refresh),
    expires_at: pythonUtcIsoformat(RECORD_EPOCH_MS - 3_600_000),
    scope: "projects",
    token_type: "Bearer",
  });
}

/**
 * Await an expected OAuthError.
 *
 * @param promise - The failing call.
 * @returns The error (or null when it resolved).
 */
async function catchOAuth(
  promise: Promise<unknown>,
): Promise<OAuthError | null> {
  try {
    await promise;
    return null;
  } catch (exc) {
    return exc instanceof OAuthError ? exc : null;
  }
}

/** JSON response helper. */
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const OK_BODY = {
  access_token: "new-access",
  expires_in: 3600,
  scope: "projects",
  token_type: "Bearer",
  refresh_token: "new-refresh",
};

/** Row 1 — the branch matrix. */
async function branchMatrix(): Promise<void> {
  // Exact body + insertion order + edge-set token values.
  for (const refresh of ["plain", "a b+c&d=e", "𝒳", "tok/with=specials+*~"]) {
    const { flow, captured } = flowWith(() => json(200, OK_BODY));
    await flow.refreshTokens(expired(refresh), "cid-1");
    const body = captured[0]?.body ?? "";
    check(
      `body-starts grant_type [${refresh}]`,
      body.startsWith("grant_type=refresh_token&refresh_token="),
      body,
    );
    check(
      `body-ends client_id [${refresh}]`,
      body.endsWith("&client_id=cid-1"),
      body,
    );
    check(
      `content-type [${refresh}]`,
      captured[0]?.contentType === "application/x-www-form-urlencoded",
    );
    check(
      `url [${refresh}]`,
      captured[0]?.url === "https://mixpanel.com/oauth/token/",
    );
  }

  // No refresh token → BEFORE any request; two detail shapes.
  {
    const { flow, captured } = flowWith(() => json(200, OK_BODY));
    const errNoName = await catchOAuth(flow.refreshTokens(expired(null), "c"));
    check("no-refresh code", errNoName?.code === "OAUTH_REFRESH_ERROR");
    check("no-refresh details {}", JSON.stringify(errNoName?.details) === "{}");
    const errNamed = await catchOAuth(
      flow.refreshTokens(expired(null), "c", { accountName: "acme" }),
    );
    check(
      "no-refresh details {account_name}",
      JSON.stringify(errNamed?.details) === '{"account_name":"acme"}',
    );
    check("no-refresh zero fetches", captured.length === 0);
  }

  // Transport failure → details {url}.
  {
    const { flow } = flowWith(() => {
      throw new DOMException("boom", "TimeoutError");
    });
    const err = await catchOAuth(flow.refreshTokens(expired("r"), "c"));
    check("transport code", err?.code === "OAUTH_REFRESH_ERROR");
    check(
      "transport details url only",
      JSON.stringify(Object.keys(err?.details ?? {})) === '["url"]' &&
        err?.details["url"] === "https://mixpanel.com/oauth/token/",
    );
  }

  // 400/401 invalid_grant → REVOKED (refresh op), account_name always
  // present (null when unnamed).
  for (const status of [400, 401]) {
    const { flow } = flowWith(() => json(status, { error: "invalid_grant" }));
    const err = await catchOAuth(flow.refreshTokens(expired("bad"), "c"));
    check(
      `invalid_grant ${status} code`,
      err?.code === "OAUTH_REFRESH_REVOKED",
    );
    check(
      `invalid_grant ${status} account_name null`,
      err !== null &&
        Object.hasOwn(err.details, "account_name") &&
        err.details["account_name"] === null,
    );
    check(
      `invalid_grant ${status} body echoed`,
      err?.details["response_body"] === '{"error":"invalid_grant"}',
    );
  }

  // 400/401 non-invalid_grant and unparseable 400 → generic.
  for (const body of ['{"error":"other"}', "not json", '["invalid_grant"]']) {
    const { flow } = flowWith(() => new Response(body, { status: 400 }));
    const err = await catchOAuth(flow.refreshTokens(expired("r"), "c"));
    check(`400 generic [${body}]`, err?.code === "OAUTH_REFRESH_ERROR");
  }

  // 403/404/500/503 stay generic even with an invalid_grant body
  // (status gate — caution 6).
  for (const status of [403, 404, 500, 503]) {
    const { flow } = flowWith(() => json(status, { error: "invalid_grant" }));
    const err = await catchOAuth(flow.refreshTokens(expired("r"), "c"));
    check(`status ${status} generic`, err?.code === "OAUTH_REFRESH_ERROR");
    check(
      `status ${status} details`,
      err?.details["status_code"] === status &&
        typeof err?.details["response_body"] === "string" &&
        !Object.hasOwn(err?.details ?? {}, "account_name"),
    );
  }

  // Generic WITH account name → spread shape adds account_name.
  {
    const { flow } = flowWith(() => new Response("SU", { status: 503 }));
    const err = await catchOAuth(
      flow.refreshTokens(expired("r"), "c", { accountName: "team" }),
    );
    check(
      "generic named details carry account_name",
      err?.details["account_name"] === "team",
    );
  }

  // 200 non-JSON → error with {response_body}.
  {
    const { flow } = flowWith(
      () =>
        new Response("<html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    );
    const err = await catchOAuth(flow.refreshTokens(expired("r"), "c"));
    check("200 non-JSON code", err?.code === "OAUTH_REFRESH_ERROR");
    check(
      "200 non-JSON details response_body",
      err?.details["response_body"] === "<html>",
    );
  }

  // 200 missing-field matrix (each required key dropped).
  for (const missing of ["access_token", "expires_in", "token_type"]) {
    const body: Record<string, unknown> = { ...OK_BODY };
    delete body[missing];
    const { flow } = flowWith(() => json(200, body));
    const err = await catchOAuth(flow.refreshTokens(expired("r"), "c"));
    check(`200 missing ${missing}`, err?.code === "OAUTH_REFRESH_ERROR");
    check(
      `200 missing ${missing} details response_data`,
      typeof err?.details["response_data"] === "string",
    );
  }
  // `scope` is NOT required (defaults "") — Python .get fallback.
  {
    const body: Record<string, unknown> = { ...OK_BODY };
    delete body["scope"];
    const { flow } = flowWith(() => json(200, body));
    const result = await flow.refreshTokens(expired("r"), "c");
    check("200 missing scope defaults empty", result.scope === "");
  }

  // Rotation response WITHOUT refresh_token: flow returns null refresh
  // (the KEEP happens at the resolver layer — fs-probes.ts row 4).
  {
    const body: Record<string, unknown> = { ...OK_BODY };
    delete body["refresh_token"];
    const { flow } = flowWith(() => json(200, body));
    const result = await flow.refreshTokens(expired("keep-me"), "c");
    check(
      "no-rotation refresh null at flow layer",
      result.refresh_token === null,
    );
  }

  // expires_at rendering table (whole seconds; fractional expires_in
  // is int-typed → coerceInt rejection verbatim).
  {
    const { flow } = flowWith(() => json(200, OK_BODY));
    const result = await flow.refreshTokens(expired("r"), "c");
    check(
      "expires_at Python isoformat",
      result.expires_at === "2026-01-15T13:00:00+00:00",
      result.expires_at,
    );
  }
  {
    const { flow } = flowWith(() => json(200, { ...OK_BODY, expires_in: 90 }));
    const result = await flow.refreshTokens(expired("r"), "c");
    check(
      "expires_at 90s",
      result.expires_at === "2026-01-15T12:01:30+00:00",
      result.expires_at,
    );
  }
  {
    const { flow } = flowWith(() =>
      json(200, { ...OK_BODY, expires_in: 3600.5 }),
    );
    const err = await catchOAuth(flow.refreshTokens(expired("r"), "c"));
    check(
      "fractional expires_in rejected",
      err?.code === "OAUTH_REFRESH_ERROR",
    );
  }
  // Sub-second clock → 6-digit microseconds rendering.
  check(
    "isoformat microseconds",
    pythonUtcIsoformat(RECORD_EPOCH_MS + 1.5) ===
      "2026-01-15T12:00:00.001500+00:00",
    pythonUtcIsoformat(RECORD_EPOCH_MS + 1.5),
  );
}

/** Row 3 — get_valid_token truth table. */
async function getValidTokenTable(): Promise<void> {
  const clientInfo = {
    client_id: "cid",
    region: "us",
    redirect_uri: "http://localhost:19284/callback",
    scope: "projects",
    created_at: pythonUtcIsoformat(RECORD_EPOCH_MS),
  };

  // no tokens.
  {
    const { flow } = flowWith(() => json(200, OK_BODY));
    const err = await catchOAuth(flow.getValidToken("us"));
    check("gvt no tokens", err?.code === "OAUTH_TOKEN_ERROR");
  }
  // fresh / boundary rows: expiry at epoch+31/+30/+29 seconds.
  for (const [delta, expectRefresh] of [
    [31_000, false],
    [30_000, true],
    [29_000, true],
  ] as const) {
    const { flow, storage, captured } = flowWith(() => json(200, OK_BODY));
    storage.saveTokens(
      new OAuthTokens({
        access_token: new Secret("cur"),
        refresh_token: new Secret("r"),
        expires_at: pythonUtcIsoformat(RECORD_EPOCH_MS + delta),
        scope: "projects",
        token_type: "Bearer",
      }),
      "us",
    );
    storage.saveClientInfo(clientInfo);
    const token = await flow.getValidToken("us");
    check(
      `gvt boundary +${delta / 1000}s`,
      expectRefresh ? token === "new-access" : token === "cur",
      `${token} fetches=${captured.length}`,
    );
    check(
      `gvt boundary fetch count +${delta / 1000}s`,
      captured.length === (expectRefresh ? 1 : 0),
    );
  }
  // expired + no client info.
  {
    const { flow, storage } = flowWith(() => json(200, OK_BODY));
    storage.saveTokens(expired("r"), "us");
    const err = await catchOAuth(flow.getValidToken("us"));
    check("gvt no client info", err?.code === "OAUTH_REFRESH_ERROR");
  }
  // expired + refresh ok → persisted.
  {
    const { flow, storage } = flowWith(() => json(200, OK_BODY));
    storage.saveTokens(expired("r"), "us");
    storage.saveClientInfo(clientInfo);
    const token = await flow.getValidToken("us");
    check("gvt refresh ok", token === "new-access");
    check(
      "gvt persisted",
      storage.loadTokens("us")?.access_token.reveal() === "new-access",
    );
  }
  // expired + revoked.
  {
    const { flow, storage } = flowWith(() =>
      json(400, { error: "invalid_grant" }),
    );
    storage.saveTokens(expired("r"), "us");
    storage.saveClientInfo(clientInfo);
    const err = await catchOAuth(flow.getValidToken("us"));
    check("gvt revoked", err?.code === "OAUTH_REFRESH_REVOKED");
  }
  // expired + transient.
  {
    const { flow, storage } = flowWith(
      () => new Response("x", { status: 503 }),
    );
    storage.saveTokens(expired("r"), "us");
    storage.saveClientInfo(clientInfo);
    const err = await catchOAuth(flow.getValidToken("us"));
    check("gvt transient", err?.code === "OAUTH_REFRESH_ERROR");
  }
}

/** Row 7 (refresh half) — sentinel never leaks into the error surface. */
async function sentinelSweep(): Promise<void> {
  const responders: Array<[string, () => Response]> = [
    [
      "transport",
      (): Response => {
        throw new DOMException("t", "TimeoutError");
      },
    ],
    ["revoked", (): Response => json(400, { error: "invalid_grant" })],
    ["generic-503", (): Response => new Response("SU", { status: 503 })],
    ["non-json-200", (): Response => new Response("<x>", { status: 200 })],
    ["missing-field", (): Response => json(200, { token_type: "Bearer" })],
  ];
  for (const [label, respond] of responders) {
    const { flow } = flowWith(respond);
    const err = await catchOAuth(
      flow.refreshTokens(expired(SENTINEL), "cid", { accountName: "n" }),
    );
    check(`sentinel branch raised [${label}]`, err !== null);
    if (err !== null) {
      const surface = `${err.message} ${JSON.stringify(err.details)}`;
      check(`sentinel absent [${label}]`, !surface.includes(SENTINEL));
    }
  }
  // No-refresh-token branch message must not leak either (it has no
  // token to leak — control row).
  const { flow } = flowWith(() => json(200, OK_BODY));
  const err = await catchOAuth(flow.refreshTokens(expired(null), "cid"));
  check("sentinel control no-refresh", err !== null);
}

await branchMatrix();
await getValidTokenTable();
await sentinelSweep();

rmSync(ROOT, { recursive: true, force: true });
console.log(
  `refresh-probes: ${checks} checks, ${failures} failures ` +
    `(${failures === 0 ? "ZERO-DIVERGENCE" : "DIVERGENT"})`,
);
if (failures > 0) {
  process.exitCode = 1;
}
