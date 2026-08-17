// Flow set R1: oauth_token happy path, header parity vs a node-style
// core client, export refusal, workspace scoping.
import { createBrowserWorkspace } from "../../packages/browser/src/index.js";
import { parseAccount } from "../../packages/core/src/auth/account.js";
import { parseSession } from "../../packages/core/src/auth/session.js";
import { createMixpanelClient } from "../../packages/core/src/client/client.js";
import { Workspace } from "../../packages/core/src/workspace.js";
import { capture, record, recordingFetch, summary } from "./harness.js";

const OK = { status: 200, body: JSON.stringify({ results: [] }) };

async function main(): Promise<void> {
  // --- F1: oauth_token happy path, mocked fetch ------------------------
  const a = recordingFetch(() => OK);
  const ws = createBrowserWorkspace({
    token: "tok-abc",
    projectId: "12345",
    region: "us",
    fetch: a.fetch,
  });
  await ws.client.appRequest("GET", "/projects/12345/dashboards");
  const r0 = a.requests[0];
  record(
    "F1 oauth_token app request",
    r0 !== undefined &&
      r0.url.startsWith(
        "https://mixpanel.com/api/app/projects/12345/dashboards",
      ) &&
      r0.headers["authorization"] === "Bearer tok-abc",
    JSON.stringify({ url: r0?.url, auth: r0?.headers["authorization"] }),
  );

  // Query host call through the facade-level client.
  await ws.client.requestQueryHost("GET", "/events/names");
  const r1 = a.requests[1];
  record(
    "F1b oauth_token query-host request",
    r1 !== undefined && r1.headers["authorization"] === "Bearer tok-abc",
    JSON.stringify({ url: r1?.url, ua: r1?.headers["user-agent"] }),
  );

  // --- F2: byte-parity vs a directly-built core client -----------------
  const b = recordingFetch(() => OK);
  const account = parseAccount(
    { type: "oauth_token", name: "browser", region: "us", token: "tok-abc" },
    { boundary: "param" },
  );
  const session = parseSession(
    { account, project: { id: "12345" } },
    { boundary: "param" },
  );
  const nodeLike = createMixpanelClient({
    session,
    fetch: b.fetch,
    tokenResolver: {
      getBrowserToken: () => Promise.resolve("tok-abc"),
      getStaticToken: (acct) =>
        Promise.resolve(acct.token?.reveal() ?? "missing"),
    },
  });
  const nodeWs = new Workspace({ session, client: nodeLike });
  await nodeWs.client.appRequest("GET", "/projects/12345/dashboards");
  await nodeWs.client.requestQueryHost("GET", "/events/names");
  const diffs: string[] = [];
  for (let i = 0; i < 2; i += 1) {
    const x = a.requests[i];
    const y = b.requests[i];
    if (JSON.stringify(x) !== JSON.stringify(y)) {
      diffs.push(`#${i}: ${JSON.stringify(x)} !== ${JSON.stringify(y)}`);
    }
  }
  record(
    "F2 browser-vs-core request byte parity",
    diffs.length === 0,
    diffs.join(" | ") || "identical method/url/headers/body",
  );

  // --- F3: export host refusal ----------------------------------------
  for (const [region, host] of [
    ["us", "https://data.mixpanel.com/api/2.0/export"],
    ["eu", "https://data-eu.mixpanel.com/api/2.0/export"],
    ["in", "https://data-in.mixpanel.com/api/2.0/export"],
  ] as const) {
    const c = recordingFetch(() => OK);
    const wsx = createBrowserWorkspace({
      token: "t",
      projectId: "1",
      region,
      fetch: c.fetch,
    });
    const err = await capture(() => wsx.client.request("GET", host));
    record(
      `F3 export refusal ${region}`,
      err !== null && err.code === "BROWSER_EXPORT_UNSUPPORTED",
      JSON.stringify({ ...err, innerRequests: c.requests.length }),
    );
  }

  // --- F4: workspace scoping ------------------------------------------
  const d = recordingFetch(() => OK);
  const wsScoped = createBrowserWorkspace({
    token: "t",
    projectId: "777",
    region: "eu",
    workspaceId: 42,
    fetch: d.fetch,
  });
  await wsScoped.client.appRequest(
    "GET",
    wsScoped.client.maybeScopedPath("flags"),
  );
  record(
    "F4 workspace-scoped path",
    d.requests[0]?.url.includes("/workspaces/42/flags") === true,
    String(d.requests[0]?.url),
  );

  // --- F5: guard preserves an injected fetch that itself fails ---------
  const boom = new TypeError("network down");
  const e = recordingFetch(() => boom);
  const wsFail = createBrowserWorkspace({
    token: "t",
    projectId: "1",
    region: "us",
    fetch: e.fetch,
  });
  const errF5 = await capture(() =>
    wsFail.client.appRequest("GET", "/projects/1/dashboards"),
  );
  record(
    "F5 injected-fetch failure normalization",
    errF5 !== null && errF5.code === "HTTP_ERROR",
    JSON.stringify(errF5),
  );

  summary();
}

await main();
