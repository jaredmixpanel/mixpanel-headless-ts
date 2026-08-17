// Flow set R4: service-account refusal — every ingress path plus an
// independent hunt for a path that reaches accountAuthHeader with a
// service_account (R9.3: refused at runtime in browser builds).
import {
  CREDENTIAL_KEYS,
  InMemoryCredentialStore,
  createBrowserWorkspace,
  createBrowserWorkspaceFromStore,
} from "../../packages/browser/src/index.js";
import { parseAccount } from "../../packages/core/src/auth/account.js";
import { parseSession } from "../../packages/core/src/auth/session.js";
import { capture, record, recordingFetch, summary } from "./harness.js";

const OK = { status: 200, body: "{}" };
const NOW = (): number => Date.parse("2026-01-15T12:00:00Z");

const saAccount = parseAccount(
  {
    type: "service_account",
    name: "sa",
    region: "us",
    username: "sa.user",
    secret: "hunter2",
  },
  { boundary: "param" },
);
const saSession = parseSession(
  { account: saAccount, project: { id: "12345" } },
  { boundary: "param" },
);

async function main(): Promise<void> {
  // --- P1: pre-built SA session -----------------------------------------
  const f = recordingFetch(() => OK);
  const e1 = await capture(async () =>
    createBrowserWorkspace({
      token: "t",
      projectId: "12345",
      region: "us",
      session: saSession,
      fetch: f.fetch,
    }),
  );
  record(
    "P1 createBrowserWorkspace(session=SA)",
    e1?.code === "BROWSER_SERVICE_ACCOUNT_REFUSED",
    JSON.stringify(e1),
  );

  // --- P3: SA-shaped persisted record ------------------------------------
  const store = new InMemoryCredentialStore();
  store.set(
    CREDENTIAL_KEYS.tokens("us"),
    JSON.stringify({
      type: "service_account",
      username: "sa.user",
      secret: "hunter2",
    }),
  );
  const e3 = await capture(() =>
    createBrowserWorkspaceFromStore({
      region: "us",
      projectId: "12345",
      store,
      fetch: f.fetch,
      now: NOW,
    }),
  );
  record(
    "P3 store carries SA record",
    e3?.code === "BROWSER_SERVICE_ACCOUNT_REFUSED",
    JSON.stringify(e3),
  );

  // --- P4: client.use({account: SA}) on a browser-built facade -----------
  const ws = createBrowserWorkspace({
    token: "t",
    projectId: "12345",
    region: "us",
    fetch: f.fetch,
  });
  const e4 = await capture(() => ws.client.use({ account: saAccount }));
  record(
    "P4 ws.client.use({account: SA})",
    e4?.code === "BROWSER_SERVICE_ACCOUNT_REFUSED",
    JSON.stringify(e4),
  );
  const stillOauth = ws.client.session.account.type;
  record(
    "P4b prior session survives the refusal",
    stillOauth === "oauth_token",
    stillOauth,
  );

  // --- P4c: Workspace.use({account: "name"}) resolver route -------------
  const e4c = await capture(() => ws.use({ account: "some-sa" }));
  record(
    "P4c ws.use({account}) blocked by resolver seam",
    e4c !== null,
    JSON.stringify(e4c),
  );

  // --- HUNT H1: withProject() escapes the use-guard proxy? --------------
  const g = recordingFetch(() => OK);
  const ws2 = createBrowserWorkspace({
    token: "t",
    projectId: "12345",
    region: "us",
    fetch: g.fetch,
  });
  const derived = ws2.client.withProject("999");
  const hunted = await capture(async () => {
    await derived.use({ account: saAccount });
    return derived.currentAuthHeader();
  });
  let leakedHeader: string | null = null;
  if (hunted === null) {
    leakedHeader = await derived.currentAuthHeader();
    await derived.appRequest("GET", "/projects/999/dashboards");
  }
  record(
    "H1 withProject()-derived client refuses SA",
    hunted !== null && hunted.code === "BROWSER_SERVICE_ACCOUNT_REFUSED",
    JSON.stringify({
      error: hunted,
      leakedHeader,
      sentAuth: g.requests.at(-1)?.headers["authorization"] ?? null,
      sentUrl: g.requests.at(-1)?.url ?? null,
    }),
  );

  // --- HUNT H2: does the export/transport guard survive withProject? ----
  const derived2 = ws2.client.withProject("999");
  const e2h = await capture(() =>
    derived2.request("GET", "https://data.mixpanel.com/api/2.0/export"),
  );
  record(
    "H2 withProject() keeps the export guard",
    e2h?.code === "BROWSER_EXPORT_UNSUPPORTED",
    JSON.stringify(e2h),
  );

  // --- HUNT H3: SA via clientOptions.tokenResolver / raw options ---------
  const h3 = await capture(async () => {
    const w = createBrowserWorkspace({
      token: "t",
      projectId: "12345",
      region: "us",
      fetch: g.fetch,
      clientOptions: {
        // A caller-supplied resolver cannot make an SA account, but check
        // that nothing else in the options bag can install one.
        tokenResolver: {
          getBrowserToken: () => Promise.resolve("x"),
          getStaticToken: () => Promise.resolve("x"),
        },
      },
    });
    return w.client.session.account.type;
  });
  record(
    "H3 clientOptions cannot install an SA",
    h3 === null,
    JSON.stringify(h3),
  );

  summary();
}

await main();
