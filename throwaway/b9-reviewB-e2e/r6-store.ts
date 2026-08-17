// Flow set R6: store-backed session lifecycle — per-request resolution,
// rotation, mid-session expiry, cross-runtime payload interop, DCR cache
// semantics, and the localStorage adapter under a hostile Storage.
import {
  CREDENTIAL_KEYS,
  InMemoryCredentialStore,
  LocalStorageCredentialStore,
  beginLogin,
  createBrowserWorkspaceFromStore,
  ensureBrowserClientRegistered,
  serializeTokensPayload,
} from "../../packages/browser/src/index.js";
import { parseOAuthTokens } from "../../packages/core/src/auth/token.js";
import type { StorageLike } from "../../packages/browser/src/credential-store.js";
import { capture, record, recordingFetch, summary } from "./harness.js";
import type { CannedResponse, RecordedRequest } from "./harness.js";

const OK: CannedResponse = { status: 200, body: "{}" };
const T0 = Date.parse("2026-01-15T12:00:00Z");

function tokensPayload(accessToken: string, expiresAt: string): string {
  return JSON.stringify({
    access_token: accessToken,
    expires_at: expiresAt,
    scope: "projects",
    token_type: "Bearer",
    refresh_token: null,
  });
}

async function main(): Promise<void> {
  // --- R6a: per-request re-resolution (rotation) -------------------------
  const store = new InMemoryCredentialStore();
  store.set(
    CREDENTIAL_KEYS.tokens("us"),
    tokensPayload("at-old", "2026-01-15T13:00:00+00:00"),
  );
  const f = recordingFetch(() => OK);
  let clock = T0;
  const ws = await createBrowserWorkspaceFromStore({
    region: "us",
    projectId: "1",
    store,
    fetch: f.fetch,
    now: () => clock,
  });
  await ws.client.appRequest("GET", "/projects/1/dashboards");
  store.set(
    CREDENTIAL_KEYS.tokens("us"),
    tokensPayload("at-new", "2026-01-15T14:00:00+00:00"),
  );
  await ws.client.appRequest("GET", "/projects/1/dashboards");
  record(
    "R6a rotation picked up per request",
    f.requests[0]?.headers["authorization"] === "Bearer at-old" &&
      f.requests[1]?.headers["authorization"] === "Bearer at-new",
    JSON.stringify(f.requests.map((r) => r.headers["authorization"])),
  );

  // --- R6b: mid-session expiry -------------------------------------------
  clock = Date.parse("2026-01-15T14:30:00Z");
  const e6b = await capture(() =>
    ws.client.appRequest("GET", "/projects/1/dashboards"),
  );
  record(
    "R6b expiry re-fires per request with a coded error",
    e6b?.code === "OAUTH_TOKEN_ERROR",
    JSON.stringify(e6b),
  );

  // --- R6c: token deleted mid-session (logout in another tab) ------------
  clock = T0;
  store.delete(CREDENTIAL_KEYS.tokens("us"));
  const e6c = await capture(() =>
    ws.client.appRequest("GET", "/projects/1/dashboards"),
  );
  record(
    "R6c store wiped mid-session → coded error",
    e6c?.code === "OAUTH_TOKEN_ERROR",
    JSON.stringify(e6c),
  );

  // --- R6d: SA record planted mid-session (path-3 re-fires per request) --
  store.set(
    CREDENTIAL_KEYS.tokens("us"),
    JSON.stringify({ type: "service_account", username: "u", secret: "s" }),
  );
  const e6d = await capture(() =>
    ws.client.appRequest("GET", "/projects/1/dashboards"),
  );
  record(
    "R6d SA planted mid-session → refusal on the request path",
    e6d?.code === "BROWSER_SERVICE_ACCOUNT_REFUSED",
    JSON.stringify(e6d),
  );

  // --- R6e: cross-runtime payload interop --------------------------------
  // node's save_tokens writer bytes (b8 golden shape) read by the browser.
  const nodeBytes = JSON.stringify(
    {
      access_token: "at-node",
      refresh_token: "rt-node",
      expires_at: "2026-01-15T13:00:00+00:00",
      scope: "projects analysis",
      token_type: "Bearer",
    },
    null,
    2,
  );
  const s6e = new InMemoryCredentialStore();
  s6e.set(CREDENTIAL_KEYS.tokens("us"), nodeBytes);
  const f6e = recordingFetch(() => OK);
  const e6e = await capture(async () => {
    const w = await createBrowserWorkspaceFromStore({
      region: "us",
      projectId: "1",
      store: s6e,
      fetch: f6e.fetch,
      now: () => T0,
    });
    await w.client.appRequest("GET", "/projects/1/dashboards");
  });
  record(
    "R6e node-written tokens payload readable by the browser",
    e6e === null &&
      f6e.requests[0]?.headers["authorization"] === "Bearer at-node",
    JSON.stringify({
      err: e6e,
      auth: f6e.requests[0]?.headers["authorization"],
    }),
  );

  // --- R6f: browser writer round-trips through the strict reader ---------
  const roundTrip = parseOAuthTokens(JSON.parse(nodeBytes));
  record(
    "R6f serializeTokensPayload ↔ parseOAuthTokens closed loop",
    JSON.parse(serializeTokensPayload(roundTrip))["expires_at"] ===
      "2026-01-15T13:00:00+00:00",
    serializeTokensPayload(roundTrip).replace(/\n/g, ""),
  );

  // --- R6g: DCR cache semantics ------------------------------------------
  const s6g = new InMemoryCredentialStore();
  let registrations = 0;
  const f6g = recordingFetch((req: RecordedRequest): CannedResponse => {
    if (req.url.endsWith("mcp/register/")) {
      registrations += 1;
      return {
        status: 201,
        body: JSON.stringify({ client_id: `cid-${registrations}` }),
      };
    }
    return OK;
  });
  const first = await ensureBrowserClientRegistered({
    fetch: f6g.fetch,
    region: "us",
    redirectUri: "https://a.example.com/cb",
    store: s6g,
    now: () => T0,
  });
  const cached = await ensureBrowserClientRegistered({
    fetch: f6g.fetch,
    region: "us",
    redirectUri: "https://a.example.com/cb",
    store: s6g,
    now: () => T0,
  });
  const changed = await ensureBrowserClientRegistered({
    fetch: f6g.fetch,
    region: "us",
    redirectUri: "https://b.example.com/cb",
    store: s6g,
    now: () => T0,
  });
  record(
    "R6g DCR cache: hit iff redirect_uri matches",
    registrations === 2 &&
      first.client_id === "cid-1" &&
      cached.client_id === "cid-1" &&
      changed.client_id === "cid-2",
    JSON.stringify({
      registrations,
      first: first.client_id,
      changed: changed.client_id,
    }),
  );
  record(
    "R6h client-info payload uses the pydantic Z shape",
    String(await s6g.get(CREDENTIAL_KEYS.clientInfo("us"))).includes(
      '"created_at": "2026-01-15T12:00:00Z"',
    ),
    String(await s6g.get(CREDENTIAL_KEYS.clientInfo("us"))).replace(/\n/g, ""),
  );

  // --- R6i: localStorage adapter over a hostile Storage ------------------
  const backing = new Map<string, string>();
  const quotaStorage: StorageLike = {
    getItem: (k) => backing.get(k) ?? null,
    setItem: () => {
      // Safari private mode / quota exhaustion.
      throw new DOMException("quota exceeded", "QuotaExceededError");
    },
    removeItem: (k) => {
      backing.delete(k);
    },
  };
  const lsStore = new LocalStorageCredentialStore(quotaStorage);
  const f6i = recordingFetch((req) =>
    req.url.endsWith("mcp/register/")
      ? { status: 201, body: JSON.stringify({ client_id: "cid" }) }
      : OK,
  );
  const e6i = await capture(() =>
    beginLogin({
      region: "us",
      redirectUri: "https://a.example.com/cb",
      store: lsStore,
      fetch: f6i.fetch,
      now: () => T0,
    }),
  );
  record(
    "R6i localStorage write failure surfaces as a CODED error",
    e6i !== null && e6i.code !== null,
    JSON.stringify(e6i),
  );

  // --- R6j: missing global localStorage ----------------------------------
  const e6j = await capture(async () => new LocalStorageCredentialStore());
  record(
    "R6j missing globalThis.localStorage → OAUTH_CONFIG_ERROR",
    e6j?.code === "OAUTH_CONFIG_ERROR",
    JSON.stringify(e6j),
  );

  summary();
}

await main();
