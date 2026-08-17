// R10.9 harness — B9-R1 mandatory edge set (b9-packets.md §2.7.1).
// Throwaway: removed at the B9 gate after arbiter sign-off (P3-2c).
// Run: npx vite-node throwaway/b9-r1/edges.ts

import {
  CREDENTIAL_KEYS,
  InMemoryCredentialStore,
  LocalStorageCredentialStore,
  browserSession,
  createBrowserWorkspace,
  createBrowserWorkspaceFromStore,
  type CredentialStore,
} from "../../packages/browser/src/index.js";
import { PkceChallenge } from "../../packages/core/src/auth/pkce.js";
import type { Session } from "../../packages/core/src/auth/session.js";
import { Secret } from "../../packages/core/src/secret.js";

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

function saSession(): Session {
  return {
    account: {
      type: "service_account",
      name: "sa",
      region: "us",
      username: "u",
      secret: new Secret("s"),
    },
    project: { id: "12345" },
    workspace: null,
    headers: new Map(),
  };
}

const cannedFetch = (async (): Promise<Response> =>
  new Response("[]", {
    status: 200,
    headers: { "content-type": "application/json" },
  })) as typeof fetch;

async function storeEdges(
  store: CredentialStore,
  label: string,
): Promise<void> {
  // Value edges: integral-float-string, fractional, boolean-string,
  // empty string, non-BMP key AND value (§2.7.1).
  for (const value of ["18.0", "1.5", "true", "", "𝒳"]) {
    await store.set("mp.tokens.us", value);
    check(
      `${label}: value ${JSON.stringify(value)} round-trips`,
      (await store.get("mp.tokens.us")) === value,
    );
  }
  // Empty-key probe: no guard exists in the contract — both
  // implementations treat "" as an ordinary key (observation recorded).
  await store.set("", "empty-key-value");
  check(
    `${label}: empty key behaves as ordinary key`,
    (await store.get("")) === "empty-key-value",
  );
  await store.delete("");
  check(`${label}: empty key deleted`, (await store.get("")) === null);
  // Non-BMP key.
  await store.set("mp.𝒳.key", "v");
  check(
    `${label}: non-BMP key round-trips`,
    (await store.get("mp.𝒳.key")) === "v",
  );
}

async function main(): Promise<void> {
  // ── store contract edges over BOTH implementations ──
  await storeEdges(new InMemoryCredentialStore(), "in-memory");
  const backing = new Map<string, string>();
  await storeEdges(
    new LocalStorageCredentialStore({
      getItem: (k) => backing.get(k) ?? null,
      setItem: (k, v) => void backing.set(k, v),
      removeItem: (k) => void backing.delete(k),
    }),
    "localStorage-adapter",
  );

  // ── error branches (§2.7.1 "every error branch") ──

  // BROWSER_SERVICE_ACCOUNT_REFUSED × path 1 (factory session gate).
  await expectCode("SA path 1", "BROWSER_SERVICE_ACCOUNT_REFUSED", () =>
    createBrowserWorkspace({
      session: saSession(),
      token: "t",
      projectId: "12345",
      region: "us",
      fetch: cannedFetch,
    }),
  );

  // BROWSER_SERVICE_ACCOUNT_REFUSED × path 3 (SA blob in the store).
  const saStore = new InMemoryCredentialStore();
  saStore.set(
    CREDENTIAL_KEYS.tokens("us"),
    JSON.stringify({ type: "service_account", username: "u", secret: "s" }),
  );
  await expectCode("SA path 3", "BROWSER_SERVICE_ACCOUNT_REFUSED", () =>
    createBrowserWorkspaceFromStore({
      region: "us",
      projectId: "12345",
      store: saStore,
      fetch: cannedFetch,
    }),
  );

  // BROWSER_SERVICE_ACCOUNT_REFUSED × path 4 (client.use guard).
  const ws = createBrowserWorkspace({
    token: "tok",
    projectId: "12345",
    region: "us",
    fetch: cannedFetch,
  });
  await expectCode("SA path 4", "BROWSER_SERVICE_ACCOUNT_REFUSED", () =>
    ws.client.use({ account: saSession().account }),
  );

  // BROWSER_EXPORT_UNSUPPORTED × all 3 export hosts.
  for (const host of [
    "https://data.mixpanel.com",
    "https://data-eu.mixpanel.com",
    "https://data-in.mixpanel.com",
  ]) {
    await expectCode(
      `export refusal ${host}`,
      "BROWSER_EXPORT_UNSUPPORTED",
      () => ws.client.request("GET", `${host}/api/2.0/export`),
    );
  }

  // localStorage-missing → OAUTH_CONFIG_ERROR.
  const holder = globalThis as { localStorage?: unknown };
  const saved = holder.localStorage;
  delete holder.localStorage;
  try {
    await expectCode(
      "localStorage missing",
      "OAUTH_CONFIG_ERROR",
      () => new LocalStorageCredentialStore(),
    );
  } finally {
    if (saved !== undefined) holder.localStorage = saved;
  }

  // Expired-no-refresh → OAUTH_TOKEN_ERROR (frozen clock).
  const expiredStore = new InMemoryCredentialStore();
  expiredStore.set(
    CREDENTIAL_KEYS.tokens("us"),
    JSON.stringify({
      access_token: "a",
      expires_at: "2020-01-01T00:00:00+00:00",
      scope: "s",
      token_type: "Bearer",
    }),
  );
  await expectCode("expired-no-refresh", "OAUTH_TOKEN_ERROR", () =>
    createBrowserWorkspaceFromStore({
      region: "us",
      projectId: "12345",
      store: expiredStore,
      fetch: cannedFetch,
      now: () => Date.parse("2026-01-01T00:00:00Z"),
    }),
  );

  // Expired WITH refresh → OAUTH_TOKEN_ERROR too (browser v1 has no
  // refresh — §2.2 disposition, TODO(port) in client.ts).
  const expiredRefreshStore = new InMemoryCredentialStore();
  expiredRefreshStore.set(
    CREDENTIAL_KEYS.tokens("us"),
    JSON.stringify({
      access_token: "a",
      refresh_token: "r",
      expires_at: "2020-01-01T00:00:00+00:00",
      scope: "s",
      token_type: "Bearer",
    }),
  );
  await expectCode("expired-with-refresh", "OAUTH_TOKEN_ERROR", () =>
    createBrowserWorkspaceFromStore({
      region: "us",
      projectId: "12345",
      store: expiredRefreshStore,
      fetch: cannedFetch,
      now: () => Date.parse("2026-01-01T00:00:00Z"),
    }),
  );

  // Absent tokens → OAUTH_TOKEN_ERROR.
  await expectCode("absent tokens", "OAUTH_TOKEN_ERROR", () =>
    createBrowserWorkspaceFromStore({
      region: "us",
      projectId: "12345",
      store: new InMemoryCredentialStore(),
      fetch: cannedFetch,
    }),
  );

  // Non-JSON persisted tokens → OAUTH_TOKEN_ERROR.
  const junkStore = new InMemoryCredentialStore();
  junkStore.set(CREDENTIAL_KEYS.tokens("us"), "not json {");
  await expectCode("non-JSON tokens", "OAUTH_TOKEN_ERROR", () =>
    createBrowserWorkspaceFromStore({
      region: "us",
      projectId: "12345",
      store: junkStore,
      fetch: cannedFetch,
    }),
  );

  // Malformed persisted tokens (valid JSON, bad schema) → strict parse
  // rejection (RESPONSE_VALIDATION_ERROR).
  const malformedStore = new InMemoryCredentialStore();
  malformedStore.set(
    CREDENTIAL_KEYS.tokens("us"),
    JSON.stringify({ access_token: "only" }),
  );
  await expectCode("malformed tokens", "RESPONSE_VALIDATION_ERROR", () =>
    createBrowserWorkspaceFromStore({
      region: "us",
      projectId: "12345",
      store: malformedStore,
      fetch: cannedFetch,
    }),
  );

  // Naive expires_at (tz-naive) → strict rejection.
  const naiveStore = new InMemoryCredentialStore();
  naiveStore.set(
    CREDENTIAL_KEYS.tokens("us"),
    JSON.stringify({
      access_token: "a",
      expires_at: "2030-01-01T00:00:00",
      scope: "s",
      token_type: "Bearer",
    }),
  );
  await expectCode("naive expires_at", "RESPONSE_VALIDATION_ERROR", () =>
    createBrowserWorkspaceFromStore({
      region: "us",
      projectId: "12345",
      store: naiveStore,
      fetch: cannedFetch,
    }),
  );

  // Bad region through browserSession → param boundary VALIDATION_ERROR.
  await expectCode("bad region", "VALIDATION_ERROR", () =>
    browserSession({
      token: "t",
      projectId: "12345",
      region: "xx" as "us",
    }),
  );

  // token_env-only account through getStaticToken → OAUTH_CONFIG_ERROR
  // (hand-built session; browserSession cannot express it).
  const envSession: Session = {
    account: {
      type: "oauth_token",
      name: "env",
      region: "us",
      token_env: "MP_OAUTH_TOKEN",
    },
    project: { id: "12345" },
    workspace: null,
    headers: new Map(),
  };
  const envWs = createBrowserWorkspace({
    session: envSession,
    token: "unused",
    projectId: "12345",
    region: "us",
    fetch: cannedFetch,
  });
  await expectCode("token_env in browser", "OAUTH_CONFIG_ERROR", () =>
    envWs.client.getEvents(),
  );

  // RFC 7636 Appendix-B vector through the browser entry re-export.
  check(
    "RFC Appendix-B vector via browser entry",
    (await PkceChallenge.challengeFor(
      "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
    )) === "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
  );

  console.log(`edges: ${checks} checks, ${failures} failures`);
  if (failures > 0) process.exit(1);
}

await main();
