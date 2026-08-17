// Flow set R3: the double-invoke race against a REALISTIC IdP that
// rejects an already-redeemed authorization code (RFC 6749 §4.1.2 —
// "the authorization code MUST be used only once").
import {
  CREDENTIAL_KEYS,
  InMemoryCredentialStore,
  beginLogin,
  completeLogin,
} from "../../packages/browser/src/index.js";
import { record, recordingFetch, summary } from "./harness.js";
import type { CannedResponse, RecordedRequest } from "./harness.js";

const NOW = (): number => Date.parse("2026-01-15T12:00:00Z");

async function main(): Promise<void> {
  const redeemed = new Set<string>();
  const responder = (req: RecordedRequest): CannedResponse => {
    if (req.url.endsWith("mcp/register/")) {
      return { status: 201, body: JSON.stringify({ client_id: "cid-1" }) };
    }
    const params = new URLSearchParams(req.body ?? "");
    const code = params.get("code") ?? "";
    if (redeemed.has(code)) {
      return {
        status: 400,
        body: JSON.stringify({ error: "invalid_grant" }),
      };
    }
    redeemed.add(code);
    return {
      status: 200,
      body: JSON.stringify({
        access_token: "at-1",
        expires_in: 3600,
        token_type: "Bearer",
        scope: "projects",
      }),
    };
  };

  const store = new InMemoryCredentialStore();
  const f = recordingFetch(responder);
  const begun = await beginLogin({
    region: "us",
    redirectUri: "https://app.example.com/cb",
    store,
    fetch: f.fetch,
    now: NOW,
  });
  const ret = `https://app.example.com/cb?code=CODE-RACE&state=${begun.state}`;
  // React 18 StrictMode / double-mounted effect: the same return URL is
  // handed to completeLogin twice in the same tick.
  const settled = await Promise.allSettled([
    completeLogin({
      region: "us",
      returnUrl: ret,
      store,
      fetch: f.fetch,
      now: NOW,
    }),
    completeLogin({
      region: "us",
      returnUrl: ret,
      store,
      fetch: f.fetch,
      now: NOW,
    }),
  ]);
  const codes = settled.map((s) =>
    s.status === "rejected"
      ? ((s.reason as { code?: string }).code ?? "unknown")
      : "ok",
  );
  const tokenPosts = f.requests.filter((r) => r.url.endsWith("token/")).length;
  record(
    "R3 double-invoke against single-use-code IdP",
    codes.every((c) => c === "ok") && tokenPosts === 1,
    JSON.stringify({
      tokenPosts,
      outcomes: codes,
      storedTokens: await store.get(CREDENTIAL_KEYS.tokens("us")),
    }),
  );
  summary();
}

await main();
