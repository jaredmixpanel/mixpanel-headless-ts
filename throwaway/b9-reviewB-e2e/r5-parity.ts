// Flow set R5: browser-vs-node parity on the shared (hoisted) surfaces —
// the same core calls must produce identical requests. Diffed field by
// field.
import {
  InMemoryCredentialStore,
  beginLogin,
  completeLogin,
  ensureBrowserClientRegistered,
} from "../../packages/browser/src/index.js";
import { PkceChallenge } from "../../packages/core/src/auth/pkce.js";
import { OAuthFlow } from "../../packages/node/src/auth/flow.js";
import { ensureClientRegistered } from "../../packages/node/src/auth/client-registration.js";
import { OAuthStorage } from "../../packages/node/src/auth/storage.js";
import { record, recordingFetch, summary } from "./harness.js";
import type { CannedResponse, RecordedRequest } from "./harness.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const NOW = (): number => Date.parse("2026-01-15T12:00:00Z");

function idp(req: RecordedRequest): CannedResponse {
  if (req.url.endsWith("mcp/register/")) {
    return { status: 201, body: JSON.stringify({ client_id: "cid-1" }) };
  }
  return {
    status: 200,
    body: JSON.stringify({
      access_token: "at-1",
      refresh_token: "rt-1",
      expires_in: 3600,
      token_type: "Bearer",
      scope: "projects",
    }),
  };
}

function diff(a: RecordedRequest, b: RecordedRequest): string[] {
  const out: string[] = [];
  if (a.method !== b.method) out.push(`method ${a.method} != ${b.method}`);
  if (a.url !== b.url) out.push(`url ${a.url} != ${b.url}`);
  if (a.body !== b.body) out.push(`body ${a.body} != ${b.body}`);
  const keys = new Set([...Object.keys(a.headers), ...Object.keys(b.headers)]);
  for (const k of keys) {
    if (a.headers[k] !== b.headers[k]) {
      out.push(`header ${k}: ${a.headers[k]} != ${b.headers[k]}`);
    }
  }
  return out;
}

async function main(): Promise<void> {
  // --- DCR POST parity ---------------------------------------------------
  const bf = recordingFetch(idp);
  await ensureBrowserClientRegistered({
    fetch: bf.fetch,
    region: "us",
    redirectUri: "https://app.example.com/cb",
    store: new InMemoryCredentialStore(),
    now: NOW,
  });
  const nf = recordingFetch(idp);
  const home = mkdtempSync(join(tmpdir(), "b9rev-"));
  await ensureClientRegistered({
    fetchImpl: nf.fetch,
    region: "us",
    redirectUri: "https://app.example.com/cb",
    storage: new OAuthStorage({ storageDir: join(home, "oauth") }),
    now: NOW,
  });
  const dcrDiff = diff(
    bf.requests[0] as RecordedRequest,
    nf.requests[0] as RecordedRequest,
  );
  record(
    "R5a DCR POST parity",
    dcrDiff.length === 0,
    dcrDiff.join(" | ") || "identical",
  );

  // --- token exchange POST parity ---------------------------------------
  const store = new InMemoryCredentialStore();
  const bf2 = recordingFetch(idp);
  const begun = await beginLogin({
    region: "us",
    redirectUri: "https://app.example.com/cb",
    store,
    fetch: bf2.fetch,
    now: NOW,
  });
  const pending = JSON.parse(
    String(await store.get("mp.pending_login.us")),
  ) as { verifier: string };
  await completeLogin({
    region: "us",
    returnUrl: `https://app.example.com/cb?code=CODE1&state=${begun.state}`,
    store,
    fetch: bf2.fetch,
    now: NOW,
  });
  const nf2 = recordingFetch(idp);
  const flow = new OAuthFlow({
    region: "us",
    fetchImpl: nf2.fetch,
    now: NOW,
    storage: new OAuthStorage({ storageDir: join(home, "oauth2") }),
  });
  await flow.exchangeCode(
    "CODE1",
    pending.verifier,
    "cid-1",
    "https://app.example.com/cb",
  );
  const bTok = bf2.requests.find((r) => r.url.endsWith("token/"));
  const nTok = nf2.requests.find((r) => r.url.endsWith("token/"));
  const tokDiff = diff(bTok as RecordedRequest, nTok as RecordedRequest);
  record(
    "R5b token-exchange POST parity",
    tokDiff.length === 0,
    tokDiff.join(" | ") || "identical",
  );

  // --- authorize URL parity ---------------------------------------------
  // node's OAuthFlow.#buildAuthorizeUrl delegates to core
  // buildAuthorizeUrl (flow.ts:639) — compare that exact output against
  // the browser's beginLogin URL for identical inputs.
  const { buildAuthorizeUrl } =
    await import("../../packages/core/src/auth/oauth-http.js");
  const bf4 = recordingFetch(idp);
  const store4 = new InMemoryCredentialStore();
  const b4 = await beginLogin({
    region: "us",
    redirectUri: "http://localhost:19284/callback",
    store: store4,
    fetch: bf4.fetch,
    now: NOW,
  });
  const pending4 = JSON.parse(
    String(await store4.get("mp.pending_login.us")),
  ) as { verifier: string };
  const challenge4 = await PkceChallenge.challengeFor(pending4.verifier);
  const nodeStyle = buildAuthorizeUrl("https://mixpanel.com/oauth/", {
    clientId: "cid-1",
    redirectUri: "http://localhost:19284/callback",
    challenge: challenge4,
    state: b4.state,
  });
  record(
    "R5c authorize-URL parity (node delegate vs browser beginLogin)",
    nodeStyle === b4.authorizeUrl,
    nodeStyle === b4.authorizeUrl
      ? nodeStyle
      : `${nodeStyle} != ${b4.authorizeUrl}`,
  );

  // --- state entropy shape parity (token_urlsafe(32) twin) --------------
  const states = new Set<string>();
  for (let i = 0; i < 25; i += 1) {
    const s = new InMemoryCredentialStore();
    const ff = recordingFetch(idp);
    const r = await beginLogin({
      region: "us",
      redirectUri: "https://app.example.com/cb",
      store: s,
      fetch: ff.fetch,
      now: NOW,
    });
    states.add(r.state);
  }
  const allShaped = [...states].every(
    (s) => s.length === 43 && /^[A-Za-z0-9_-]+$/.test(s),
  );
  record(
    "R5d state: 43-char base64url, unique across 25 draws",
    allShaped && states.size === 25,
    `${states.size} unique, sample=${[...states][0]}`,
  );

  // --- PKCE parity: RFC 7636 Appendix-B vector through both entries -----
  const rfc = await PkceChallenge.challengeFor(
    "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
  );
  const { PkceChallenge: NodePkce } =
    await import("../../packages/node/src/auth/pkce.js");
  const rfcNode = await NodePkce.challengeFor(
    "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
  );
  record(
    "R5e PKCE RFC vector identical in both entry points",
    rfc === "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM" && rfc === rfcNode,
    rfc,
  );

  summary();
}

await main();
