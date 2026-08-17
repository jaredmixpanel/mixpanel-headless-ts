// Flow set R8: residual ingress edges — token_env arms, degenerate
// tokens, oauth_browser session without persisted tokens.
import {
  InMemoryCredentialStore,
  browserSession,
  createBrowserWorkspace,
} from "../../packages/browser/src/index.js";
import { parseAccount } from "../../packages/core/src/auth/account.js";
import { parseSession } from "../../packages/core/src/auth/session.js";
import { capture, record, recordingFetch, summary } from "./harness.js";

const OK = { status: 200, body: "{}" };

async function main(): Promise<void> {
  // --- R8a: token_env account in a browser build -------------------------
  const envAccount = parseAccount(
    {
      type: "oauth_token",
      name: "ci",
      region: "us",
      token_env: "MP_OAUTH_TOKEN",
    },
    { boundary: "param" },
  );
  const envSession = parseSession(
    { account: envAccount, project: { id: "1" } },
    { boundary: "param" },
  );
  const f = recordingFetch(() => OK);
  const ws = createBrowserWorkspace({
    token: "unused",
    projectId: "1",
    region: "us",
    session: envSession,
    fetch: f.fetch,
  });
  const e8a = await capture(() =>
    ws.client.appRequest("GET", "/projects/1/dashboards"),
  );
  record(
    "R8a token_env account → OAUTH_TOKEN_ERROR {account_name, env_var}",
    e8a?.code === "OAUTH_TOKEN_ERROR",
    JSON.stringify(e8a),
  );

  // --- R8b: oauth_browser session with an empty store --------------------
  const brAccount = parseAccount(
    { type: "oauth_browser", name: "browser", region: "us" },
    { boundary: "param" },
  );
  const brSession = parseSession(
    { account: brAccount, project: { id: "1" } },
    { boundary: "param" },
  );
  const g = recordingFetch(() => OK);
  const ws2 = createBrowserWorkspace({
    token: "unused",
    projectId: "1",
    region: "us",
    session: brSession,
    store: new InMemoryCredentialStore(),
    fetch: g.fetch,
  });
  const e8b = await capture(() =>
    ws2.client.appRequest("GET", "/projects/1/dashboards"),
  );
  record(
    "R8b oauth_browser session, empty store → OAUTH_TOKEN_ERROR",
    e8b?.code === "OAUTH_TOKEN_ERROR" && g.requests.length === 0,
    JSON.stringify({ err: e8b, requests: g.requests.length }),
  );

  // --- R8c: degenerate bearer -------------------------------------------
  const h = recordingFetch(() => OK);
  const e8c = await capture(async () => {
    const w = createBrowserWorkspace({
      token: "",
      projectId: "1",
      region: "us",
      fetch: h.fetch,
    });
    await w.client.appRequest("GET", "/projects/1/dashboards");
  });
  record(
    "R8c empty bearer token rejected or sent?",
    e8c !== null,
    JSON.stringify({
      err: e8c,
      auth: h.requests[0]?.headers["authorization"] ?? null,
    }),
  );

  // --- R8d: browserSession field shapes (R7.6 snake_case) ----------------
  const s = browserSession({ token: "t", projectId: "42", region: "eu" });
  record(
    "R8d browserSession account/session shape",
    s.account.type === "oauth_token" &&
      s.account.name === "browser" &&
      s.project.id === "42" &&
      s.account.region === "eu",
    JSON.stringify({
      type: s.account.type,
      name: s.account.name,
      region: s.account.region,
      project: s.project.id,
    }),
  );

  summary();
}

await main();
