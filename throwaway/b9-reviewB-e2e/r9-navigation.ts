// Flow set R9: full page-navigation simulation. beginLogin runs in "page
// load 1"; the browser then navigates to the IdP and back, which destroys
// every JS heap object — "page load 2" constructs fresh objects exactly
// as a real return page does.
import {
  InMemoryCredentialStore,
  LocalStorageCredentialStore,
  beginLogin,
  completeLogin,
} from "../../packages/browser/src/index.js";
import type { StorageLike } from "../../packages/browser/src/credential-store.js";
import { capture, record, recordingFetch, summary } from "./harness.js";
import type { CannedResponse, RecordedRequest } from "./harness.js";

const NOW = (): number => Date.parse("2026-01-15T12:00:00Z");

function idp(req: RecordedRequest): CannedResponse {
  if (req.url.endsWith("mcp/register/")) {
    return { status: 201, body: JSON.stringify({ client_id: "cid-1" }) };
  }
  return {
    status: 200,
    body: JSON.stringify({
      access_token: "at-1",
      expires_in: 3600,
      token_type: "Bearer",
      scope: "projects",
    }),
  };
}

/** A localStorage-like backend that survives "navigation". */
function persistentBacking(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

async function main(): Promise<void> {
  // --- R9a: DEFAULT store (in-memory), real navigation -------------------
  const f = recordingFetch(idp);
  // page load 1
  const begun = await beginLogin({
    region: "us",
    redirectUri: "https://app.example.com/cb",
    store: new InMemoryCredentialStore(), // the R9.3 DEFAULT posture
    fetch: f.fetch,
    now: NOW,
  });
  // ...navigation to the IdP and back: heap gone, page load 2 rebuilds.
  const err = await capture(() =>
    completeLogin({
      region: "us",
      returnUrl: `https://app.example.com/cb?code=C&state=${begun.state}`,
      store: new InMemoryCredentialStore(),
      fetch: f.fetch,
      now: NOW,
    }),
  );
  record(
    "R9a redirect PKCE completes with the DEFAULT in-memory store",
    err === null,
    JSON.stringify(err),
  );

  // --- R9b: the localStorage adapter (the only shipped durable store) ----
  const backing = persistentBacking();
  const g = recordingFetch(idp);
  const begun2 = await beginLogin({
    region: "us",
    redirectUri: "https://app.example.com/cb",
    store: new LocalStorageCredentialStore(backing), // page load 1
    fetch: g.fetch,
    now: NOW,
  });
  const tokens = await completeLogin({
    region: "us",
    returnUrl: `https://app.example.com/cb?code=C&state=${begun2.state}`,
    store: new LocalStorageCredentialStore(backing), // page load 2
    fetch: g.fetch,
    now: NOW,
  });
  record(
    "R9b redirect PKCE completes across navigation with localStorage",
    tokens.access_token.reveal() === "at-1",
    "ok",
  );

  summary();
}

await main();
