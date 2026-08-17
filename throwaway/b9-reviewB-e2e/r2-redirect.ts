// Flow set R2: PKCE redirect round trip and its adversarial variants.
import {
  CREDENTIAL_KEYS,
  InMemoryCredentialStore,
  beginLogin,
  completeLogin,
  createBrowserWorkspaceFromStore,
} from "../../packages/browser/src/index.js";
import { capture, record, recordingFetch, summary } from "./harness.js";
import type { CannedResponse, RecordedRequest } from "./harness.js";

const DCR_OK: CannedResponse = {
  status: 201,
  body: JSON.stringify({ client_id: "cid-1" }),
};
const TOKEN_OK: CannedResponse = {
  status: 200,
  body: JSON.stringify({
    access_token: "at-1",
    refresh_token: "rt-1",
    expires_in: 3600,
    token_type: "Bearer",
    scope: "projects analysis",
  }),
};

function idp(overrides: Partial<Record<string, CannedResponse>> = {}) {
  return (req: RecordedRequest): CannedResponse => {
    if (req.url.endsWith("mcp/register/")) {
      return overrides["register"] ?? DCR_OK;
    }
    if (req.url.endsWith("token/")) {
      return overrides["token"] ?? TOKEN_OK;
    }
    return overrides["other"] ?? { status: 200, body: "{}" };
  };
}

const NOW = () => Date.parse("2026-01-15T12:00:00Z");

async function main(): Promise<void> {
  // --- F6: happy path begin → navigate → complete → store-backed ws ----
  const store = new InMemoryCredentialStore();
  const f = recordingFetch(idp());
  const begun = await beginLogin({
    region: "us",
    redirectUri: "https://app.example.com/oauth/callback",
    store,
    fetch: f.fetch,
    now: NOW,
  });
  const url = new URL(begun.authorizeUrl);
  record(
    "F6a authorize URL shape",
    url.origin + url.pathname === "https://mixpanel.com/oauth/authorize/" &&
      url.searchParams.get("client_id") === "cid-1" &&
      url.searchParams.get("code_challenge_method") === "S256" &&
      url.searchParams.get("state") === begun.state &&
      url.searchParams.get("scope") === null,
    begun.authorizeUrl,
  );
  const pendingRaw = await store.get(CREDENTIAL_KEYS.pendingLogin("us"));
  record(
    "F6b pending record persisted",
    pendingRaw !== null,
    String(pendingRaw),
  );
  const tokens = await completeLogin({
    region: "us",
    returnUrl: `https://app.example.com/oauth/callback?code=CODE1&state=${begun.state}`,
    store,
    fetch: f.fetch,
    now: NOW,
  });
  const tokenReq = f.requests.find((r) => r.url.endsWith("token/"));
  record(
    "F6c token exchange body",
    tokenReq?.body ===
      `grant_type=authorization_code&code=CODE1&redirect_uri=https%3A%2F%2Fapp.example.com%2Foauth%2Fcallback&client_id=cid-1&code_verifier=${
        JSON.parse(String(pendingRaw)).verifier as string
      }`,
    String(tokenReq?.body),
  );
  record(
    "F6d tokens persisted + pending consumed",
    (await store.get(CREDENTIAL_KEYS.pendingLogin("us"))) === null &&
      (await store.get(CREDENTIAL_KEYS.tokens("us"))) !== null,
    String(await store.get(CREDENTIAL_KEYS.tokens("us"))),
  );
  record(
    "F6e expires_at isoformat +00:00",
    tokens.expires_at === "2026-01-15T13:00:00+00:00",
    tokens.expires_at,
  );

  // store-backed workspace uses the persisted bearer
  const api = recordingFetch(() => ({ status: 200, body: "{}" }));
  const ws = await createBrowserWorkspaceFromStore({
    region: "us",
    projectId: "111",
    store,
    fetch: api.fetch,
    now: NOW,
  });
  await ws.client.appRequest("GET", "/projects/111/dashboards");
  record(
    "F6f store-backed workspace bearer",
    api.requests[0]?.headers["authorization"] === "Bearer at-1",
    String(api.requests[0]?.headers["authorization"]),
  );

  // --- F7: wrong state --------------------------------------------------
  const s7 = new InMemoryCredentialStore();
  const f7 = recordingFetch(idp());
  const b7 = await beginLogin({
    region: "us",
    redirectUri: "https://app.example.com/cb",
    store: s7,
    fetch: f7.fetch,
    now: NOW,
  });
  const e7 = await capture(() =>
    completeLogin({
      region: "us",
      returnUrl: "https://app.example.com/cb?code=C&state=WRONG",
      store: s7,
      fetch: f7.fetch,
      now: NOW,
    }),
  );
  const survived = (await s7.get(CREDENTIAL_KEYS.pendingLogin("us"))) !== null;
  record(
    "F7 wrong-state → OAUTH_STATE_MISMATCH, no token POST",
    e7?.code === "OAUTH_STATE_MISMATCH" &&
      f7.requests.filter((r) => r.url.endsWith("token/")).length === 0,
    JSON.stringify({ ...e7, pendingSurvived: survived }),
  );
  // and the honest return still completes afterwards
  const ok7 = await completeLogin({
    region: "us",
    returnUrl: `https://app.example.com/cb?code=C2&state=${b7.state}`,
    store: s7,
    fetch: f7.fetch,
    now: NOW,
  });
  record(
    "F7b recovery after wrong-state attempt",
    ok7.access_token.reveal() === "at-1",
    "completed",
  );

  // --- F8: provider error return ---------------------------------------
  const s8 = new InMemoryCredentialStore();
  const f8 = recordingFetch(idp());
  await beginLogin({
    region: "us",
    redirectUri: "https://app.example.com/cb",
    store: s8,
    fetch: f8.fetch,
    now: NOW,
  });
  const e8 = await capture(() =>
    completeLogin({
      region: "us",
      returnUrl:
        "https://app.example.com/cb?error=access_denied&error_description=User+said+no",
      store: s8,
      fetch: f8.fetch,
      now: NOW,
    }),
  );
  record(
    "F8 error return → OAUTH_AUTH_DENIED w/ description",
    e8?.code === "OAUTH_AUTH_DENIED" && e8.message.includes("User said no"),
    JSON.stringify(e8),
  );

  // --- F9: replay of a consumed return URL ------------------------------
  const e9 = await capture(() =>
    completeLogin({
      region: "us",
      returnUrl: `https://app.example.com/oauth/callback?code=CODE1&state=${begun.state}`,
      store,
      fetch: f.fetch,
      now: NOW,
    }),
  );
  record(
    "F9 replay → BROWSER_NO_PENDING_LOGIN",
    e9?.code === "BROWSER_NO_PENDING_LOGIN",
    JSON.stringify(e9),
  );

  // --- F10: failed exchange must not resurrect state --------------------
  const s10 = new InMemoryCredentialStore();
  const f10 = recordingFetch(
    idp({ token: { status: 400, body: JSON.stringify({ error: "bad" }) } }),
  );
  const b10 = await beginLogin({
    region: "us",
    redirectUri: "https://app.example.com/cb",
    store: s10,
    fetch: f10.fetch,
    now: NOW,
  });
  const e10 = await capture(() =>
    completeLogin({
      region: "us",
      returnUrl: `https://app.example.com/cb?code=C&state=${b10.state}`,
      store: s10,
      fetch: f10.fetch,
      now: NOW,
    }),
  );
  const e10b = await capture(() =>
    completeLogin({
      region: "us",
      returnUrl: `https://app.example.com/cb?code=C&state=${b10.state}`,
      store: s10,
      fetch: f10.fetch,
      now: NOW,
    }),
  );
  record(
    "F10 failed exchange consumes state (no resurrection)",
    e10?.code === "OAUTH_TOKEN_ERROR" &&
      e10b?.code === "BROWSER_NO_PENDING_LOGIN",
    JSON.stringify({ first: e10?.code, second: e10b?.code }),
  );

  // --- F11: store swap mid-flow ----------------------------------------
  const sA = new InMemoryCredentialStore();
  const sB = new InMemoryCredentialStore();
  const f11 = recordingFetch(idp());
  const b11 = await beginLogin({
    region: "us",
    redirectUri: "https://app.example.com/cb",
    store: sA,
    fetch: f11.fetch,
    now: NOW,
  });
  const e11 = await capture(() =>
    completeLogin({
      region: "us",
      returnUrl: `https://app.example.com/cb?code=C&state=${b11.state}`,
      store: sB,
      fetch: f11.fetch,
      now: NOW,
    }),
  );
  record(
    "F11 store swap mid-flow → BROWSER_NO_PENDING_LOGIN",
    e11?.code === "BROWSER_NO_PENDING_LOGIN",
    JSON.stringify(e11),
  );

  // --- F12: concurrent flows, same region -------------------------------
  const s12 = new InMemoryCredentialStore();
  const f12 = recordingFetch(idp());
  const b12a = await beginLogin({
    region: "us",
    redirectUri: "https://app.example.com/cb",
    store: s12,
    fetch: f12.fetch,
    now: NOW,
  });
  const b12b = await beginLogin({
    region: "us",
    redirectUri: "https://app.example.com/cb",
    store: s12,
    fetch: f12.fetch,
    now: NOW,
  });
  const e12 = await capture(() =>
    completeLogin({
      region: "us",
      returnUrl: `https://app.example.com/cb?code=C&state=${b12a.state}`,
      store: s12,
      fetch: f12.fetch,
      now: NOW,
    }),
  );
  const ok12 = await capture(() =>
    completeLogin({
      region: "us",
      returnUrl: `https://app.example.com/cb?code=C&state=${b12b.state}`,
      store: s12,
      fetch: f12.fetch,
      now: NOW,
    }),
  );
  record(
    "F12 two same-region tabs: first tab's return loses",
    e12?.code === "OAUTH_STATE_MISMATCH" && ok12 === null,
    JSON.stringify({ tab1: e12?.code, tab2: ok12 }),
  );

  // --- F13: concurrent flows, different regions -------------------------
  const s13 = new InMemoryCredentialStore();
  const f13 = recordingFetch(idp());
  const us = await beginLogin({
    region: "us",
    redirectUri: "https://app.example.com/cb",
    store: s13,
    fetch: f13.fetch,
    now: NOW,
  });
  const eu = await beginLogin({
    region: "eu",
    redirectUri: "https://app.example.com/cb",
    store: s13,
    fetch: f13.fetch,
    now: NOW,
  });
  const okUs = await capture(() =>
    completeLogin({
      region: "us",
      returnUrl: `https://app.example.com/cb?code=C&state=${us.state}`,
      store: s13,
      fetch: f13.fetch,
      now: NOW,
    }),
  );
  const okEu = await capture(() =>
    completeLogin({
      region: "eu",
      returnUrl: `https://app.example.com/cb?code=C&state=${eu.state}`,
      store: s13,
      fetch: f13.fetch,
      now: NOW,
    }),
  );
  record(
    "F13 cross-region concurrency isolated",
    okUs === null &&
      okEu === null &&
      eu.authorizeUrl.startsWith("https://eu.mixpanel.com/oauth/authorize/"),
    JSON.stringify({ okUs, okEu }),
  );

  // --- F14: RACE — double-invoked completeLogin (React StrictMode) -----
  const s14 = new InMemoryCredentialStore();
  const f14 = recordingFetch(idp());
  const b14 = await beginLogin({
    region: "us",
    redirectUri: "https://app.example.com/cb",
    store: s14,
    fetch: f14.fetch,
    now: NOW,
  });
  const ret = `https://app.example.com/cb?code=CODE-RACE&state=${b14.state}`;
  const settled = await Promise.allSettled([
    completeLogin({
      region: "us",
      returnUrl: ret,
      store: s14,
      fetch: f14.fetch,
      now: NOW,
    }),
    completeLogin({
      region: "us",
      returnUrl: ret,
      store: s14,
      fetch: f14.fetch,
      now: NOW,
    }),
  ]);
  const tokenPosts = f14.requests.filter((r) =>
    r.url.endsWith("token/"),
  ).length;
  record(
    "F14 double-invoked completeLogin: single-use state holds?",
    tokenPosts === 1,
    JSON.stringify({
      tokenPosts,
      outcomes: settled.map((s) => s.status),
    }),
  );

  summary();
}

await main();
