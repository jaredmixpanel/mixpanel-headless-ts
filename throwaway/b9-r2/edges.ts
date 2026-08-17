// R10.9 harness — B9-R2 mandatory edge set (b9-packets.md §3.5.1):
// every error branch of the redirect flow enumerated via canned fetch,
// plus the §2.7-style value edges ("18.0", "1.5", "", "𝒳") through
// state/code/description fields.
// Throwaway: removed at the B9 gate after arbiter sign-off (P3-2c).
// Run: npx vite-node throwaway/b9-r2/edges.ts

import {
  CREDENTIAL_KEYS,
  InMemoryCredentialStore,
  beginLogin,
  completeLogin,
  ensureBrowserClientRegistered,
} from "../../packages/browser/src/index.js";
import { parsePastedRedirect } from "../../packages/core/src/auth/redirect-parse.js";

let checks = 0;
let failures = 0;

function check(name: string, condition: boolean): void {
  checks += 1;
  if (!condition) {
    failures += 1;
    console.error(`FAIL: ${name}`);
  }
}

async function expectCode(
  name: string,
  code: string,
  run: () => Promise<unknown> | unknown,
): Promise<void> {
  try {
    await run();
    check(`${name} (threw)`, false);
  } catch (error) {
    const actual = (error as { code?: string }).code;
    check(`${name} (code ${code}, got ${actual ?? "none"})`, actual === code);
  }
}

function fetchReturning(
  status: number,
  body: string,
  headers: Record<string, string> = { "content-type": "application/json" },
): typeof fetch {
  return (async () => new Response(body, { status, headers })) as typeof fetch;
}

const rejectingFetch = (async () => {
  throw new TypeError("fetch failed");
}) as typeof fetch;

const REDIRECT = "https://app.example.com/cb";

/** Store pre-loaded with a pending record for `us` under `state`. */
async function pendingStore(state: string): Promise<InMemoryCredentialStore> {
  const store = new InMemoryCredentialStore();
  await store.set(
    CREDENTIAL_KEYS.pendingLogin("us"),
    JSON.stringify({
      state,
      verifier: "v".repeat(86),
      client_id: "cid",
      redirect_uri: REDIRECT,
      created_at: "2026-01-15T10:30:00+00:00",
    }),
  );
  return store;
}

async function main(): Promise<void> {
  const goodIdp = fetchReturning(
    200,
    JSON.stringify({
      access_token: "at",
      expires_in: 3600,
      token_type: "Bearer",
    }),
  );

  // ── OAUTH_CONFIG_ERROR (bad region, flow.py:160-165 twin) ──────────
  for (const region of ["uk", "US", ""]) {
    await expectCode(
      `beginLogin region ${JSON.stringify(region)}`,
      "OAUTH_CONFIG_ERROR",
      () =>
        beginLogin({
          region: region as "us",
          redirectUri: REDIRECT,
          store: new InMemoryCredentialStore(),
          fetch: goodIdp,
        }),
    );
    await expectCode(
      `completeLogin region ${JSON.stringify(region)}`,
      "OAUTH_CONFIG_ERROR",
      () =>
        completeLogin({
          region: region as "us",
          returnUrl: "?code=A&state=B",
          store: new InMemoryCredentialStore(),
          fetch: goodIdp,
        }),
    );
  }

  // ── OAUTH_PASTE_ERROR: empty, no-code, no-state, garbage ───────────
  for (const [label, returnUrl] of [
    ["empty", "   \n"],
    ["no-code", "state=XYZ"],
    ["no-state", "code=ABC"],
    ["garbage", "complete garbage with no params"],
    // Empty-string state VALUE: parse_qs drops blank values
    // (keep_blank_values=False) → missing-state branch.
    ["empty-state-value", "code=ABC&state="],
  ] as const) {
    await expectCode(`paste error: ${label}`, "OAUTH_PASTE_ERROR", async () =>
      completeLogin({
        region: "us",
        returnUrl,
        store: await pendingStore("XYZ"),
        fetch: goodIdp,
      }),
    );
  }

  // ── OAUTH_AUTH_DENIED ± description (value edge "𝒳" through the
  // description field; non-BMP survives the twin decode) ─────────────
  await expectCode(
    "auth denied (no description)",
    "OAUTH_AUTH_DENIED",
    async () =>
      completeLogin({
        region: "us",
        returnUrl: "?error=access_denied&state=XYZ",
        store: await pendingStore("XYZ"),
        fetch: goodIdp,
      }),
  );
  try {
    parsePastedRedirect(
      "?error=denied&error_description=%F0%9D%92%B3&state=s",
      {
        expectedState: "s",
      },
    );
    check("auth denied with 𝒳 description (threw)", false);
  } catch (error) {
    const err = error as { code?: string; message: string };
    check(
      "auth denied with 𝒳 description code",
      err.code === "OAUTH_AUTH_DENIED",
    );
    check("𝒳 description decoded", err.message.includes("𝒳"));
  }

  // ── OAUTH_STATE_MISMATCH ────────────────────────────────────────────
  await expectCode("state mismatch", "OAUTH_STATE_MISMATCH", async () =>
    completeLogin({
      region: "us",
      returnUrl: "?code=ABC&state=FORGED",
      store: await pendingStore("XYZ"),
      fetch: goodIdp,
    }),
  );

  // ── Value edges through state/code fields (pending-record wiring:
  // "18.0", "1.5", "𝒳" round-trip as exact strings) ───────────────────
  for (const state of ["18.0", "1.5", "𝒳", "true"]) {
    const store = await pendingStore(state);
    const tokens = await completeLogin({
      region: "us",
      returnUrl: `?code=${encodeURIComponent("code-𝒳-18.0")}&state=${encodeURIComponent(state)}`,
      store,
      fetch: goodIdp,
    });
    check(
      `state ${JSON.stringify(state)} completes`,
      tokens.token_type === "Bearer",
    );
  }

  // ── BROWSER_NO_PENDING_LOGIN: absent + replayed + corrupted ────────
  await expectCode("no pending (absent)", "BROWSER_NO_PENDING_LOGIN", () =>
    completeLogin({
      region: "us",
      returnUrl: "?code=A&state=B",
      store: new InMemoryCredentialStore(),
      fetch: goodIdp,
    }),
  );
  {
    const store = await pendingStore("XYZ");
    await completeLogin({
      region: "us",
      returnUrl: "?code=A&state=XYZ",
      store,
      fetch: goodIdp,
    });
    await expectCode("no pending (replayed)", "BROWSER_NO_PENDING_LOGIN", () =>
      completeLogin({
        region: "us",
        returnUrl: "?code=A&state=XYZ",
        store,
        fetch: goodIdp,
      }),
    );
  }
  {
    const store = new InMemoryCredentialStore();
    await store.set(CREDENTIAL_KEYS.pendingLogin("us"), "{corrupt");
    await expectCode("no pending (corrupted)", "BROWSER_NO_PENDING_LOGIN", () =>
      completeLogin({
        region: "us",
        returnUrl: "?code=A&state=B",
        store,
        fetch: goodIdp,
      }),
    );
  }

  // ── OAUTH_TOKEN_ERROR: network reject, 400, 401, 429, 500,
  // non-JSON 200, missing access_token ────────────────────────────────
  const tokenErrorCases: readonly (readonly [string, typeof fetch])[] = [
    ["network reject", rejectingFetch],
    [
      "400 invalid_grant (exchange stays generic)",
      fetchReturning(400, JSON.stringify({ error: "invalid_grant" })),
    ],
    [
      "401 invalid_grant (exchange stays generic)",
      fetchReturning(401, JSON.stringify({ error: "invalid_grant" })),
    ],
    [
      "429",
      fetchReturning(429, "rate limited", { "content-type": "text/plain" }),
    ],
    ["500", fetchReturning(500, "boom", { "content-type": "text/plain" })],
    [
      "non-JSON 200",
      fetchReturning(200, "<html>", { "content-type": "text/html" }),
    ],
    [
      "missing access_token",
      fetchReturning(
        200,
        JSON.stringify({ token_type: "Bearer", expires_in: 60 }),
      ),
    ],
  ];
  for (const [label, fetchImpl] of tokenErrorCases) {
    await expectCode(`token error: ${label}`, "OAUTH_TOKEN_ERROR", async () =>
      completeLogin({
        region: "us",
        returnUrl: "?code=A&state=XYZ",
        store: await pendingStore("XYZ"),
        fetch: fetchImpl,
      }),
    );
  }

  // ── OAUTH_REGISTRATION_ERROR: network, 429 (Retry-After detail),
  // non-success, bad JSON, missing client_id ──────────────────────────
  await expectCode("registration: network", "OAUTH_REGISTRATION_ERROR", () =>
    ensureBrowserClientRegistered({
      region: "us",
      redirectUri: REDIRECT,
      store: new InMemoryCredentialStore(),
      fetch: rejectingFetch,
    }),
  );
  try {
    await ensureBrowserClientRegistered({
      region: "us",
      redirectUri: REDIRECT,
      store: new InMemoryCredentialStore(),
      fetch: fetchReturning(429, "slow", {
        "content-type": "text/plain",
        "retry-after": "17",
      }),
    });
    check("registration 429 (threw)", false);
  } catch (error) {
    const err = error as { code?: string; details?: Record<string, unknown> };
    check("registration 429 code", err.code === "OAUTH_REGISTRATION_ERROR");
    check(
      "registration 429 retry_after detail",
      err.details?.["retry_after"] === "17",
    );
  }
  for (const [label, fetchImpl] of [
    [
      "non-success",
      fetchReturning(500, "boom", { "content-type": "text/plain" }),
    ],
    [
      "bad JSON",
      fetchReturning(201, "not json", { "content-type": "text/plain" }),
    ],
    ["missing client_id", fetchReturning(201, JSON.stringify({ id: "x" }))],
  ] as const) {
    await expectCode(`registration: ${label}`, "OAUTH_REGISTRATION_ERROR", () =>
      ensureBrowserClientRegistered({
        region: "us",
        redirectUri: REDIRECT,
        store: new InMemoryCredentialStore(),
        fetch: fetchImpl,
      }),
    );
  }

  console.log(`b9-r2 edges: ${checks} checks, ${failures} failures`);
  if (failures > 0) {
    process.exitCode = 1;
  }
}

await main();
