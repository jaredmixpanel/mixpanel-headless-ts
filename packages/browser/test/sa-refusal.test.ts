// Service-account Basic auth is refused at runtime on every browser ingress
// path (browser-only policy: long-lived secrets must not ship to a browser
// origin). No Python twin; every assertion keys on the error code.

import { describe, expect, it } from "vitest";

import { Secret, type Session } from "@mixpanel-headless/core";

import { fakeTransport } from "../../core/test-support/client-test-helpers.js";
import * as browserEntry from "../src/index.js";
import {
  BROWSER_SERVICE_ACCOUNT_REFUSED,
  BrowserUnsupportedError,
  createBrowserWorkspace,
  createBrowserWorkspaceFromStore,
  CREDENTIAL_KEYS,
  InMemoryCredentialStore,
} from "../src/index.js";

/**
 * Hand-build a service-account Session (the out-of-band ingress the
 * §2.3 gates exist for — nothing inside the browser package can build
 * one).
 *
 * @returns The SA session.
 */
function serviceAccountSession(): Session {
  return {
    account: {
      type: "service_account",
      name: "sa-account",
      region: "us",
      username: "sa.user",
      secret: new Secret("hunter2"),
    },
    project: { id: "12345" },
    workspace: null,
    headers: new Map<string, string>(),
  };
}

describe("createBrowserWorkspace({session}) with a service-account session", () => {
  it("throws BROWSER_SERVICE_ACCOUNT_REFUSED before any client construction", () => {
    const transport = fakeTransport(() => ({ status: 200, json: {} }));
    let thrown: unknown;
    try {
      createBrowserWorkspace({
        session: serviceAccountSession(),
        token: "unused",
        projectId: "12345",
        region: "us",
        fetch: transport.fetch,
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(BrowserUnsupportedError);
    expect((thrown as BrowserUnsupportedError).code).toBe(
      BROWSER_SERVICE_ACCOUNT_REFUSED,
    );
    // The gate fires before construction — nothing hit the transport.
    expect(transport.captures).toHaveLength(0);
  });
});

// §2.3 path 2 — `browserSession` cannot even EXPRESS a service account
// (`BrowserSessionOptions` carries only `token`) — is a compile-time
// contract and lives in session-options.test-d.ts. Path 5 (beginLogin /
// completeLogin take no Account at all) is type-level too and is documented
// in the redirect-flow module header; no fixture here.

describe("createBrowserWorkspaceFromStore over a store holding service-account credentials", () => {
  it("refuses a persisted record whose type is service_account (out-of-band write)", async () => {
    const store = new InMemoryCredentialStore();
    store.set(
      CREDENTIAL_KEYS.tokens("us"),
      JSON.stringify({
        type: "service_account",
        name: "smuggled",
        region: "us",
        username: "sa.user",
        secret: "hunter2",
      }),
    );
    const transport = fakeTransport(() => ({ status: 200, json: {} }));
    await expect(
      createBrowserWorkspaceFromStore({
        region: "us",
        projectId: "12345",
        store,
        fetch: transport.fetch,
      }),
    ).rejects.toMatchObject({ code: BROWSER_SERVICE_ACCOUNT_REFUSED });
    expect(transport.captures).toHaveLength(0);
  });
});

describe("session switching on a browser-built facade", () => {
  it("client.use({account: SA}) is refused by the browser guard (in-memory replacement path)", async () => {
    const transport = fakeTransport(() => ({ status: 200, json: {} }));
    const ws = createBrowserWorkspace({
      token: "tok-123",
      projectId: "12345",
      region: "us",
      fetch: transport.fetch,
    });
    await expect(
      ws.client.use({ account: serviceAccountSession().account }),
    ).rejects.toMatchObject({ code: BROWSER_SERVICE_ACCOUNT_REFUSED });
    // The refusal left the prior session intact (atomic-on-failure).
    expect(ws.client.session.account.type).toBe("oauth_token");
  });

  it("non-SA axis swaps still pass through the guard", async () => {
    const transport = fakeTransport(() => ({ status: 200, json: {} }));
    const ws = createBrowserWorkspace({
      token: "tok-123",
      projectId: "12345",
      region: "us",
      fetch: transport.fetch,
    });
    await ws.client.use({ project: "67890" });
    expect(ws.client.projectId).toBe("67890");
  });

  it("Workspace.use({account}) cannot fetch a config service account: resolver seams stay unported in the browser", async () => {
    // The browser factory passes NO sources/seams: `use(account=...)`
    // re-resolution hits the UNPORTED_RESOLVER_SEAM defaults and can
    // never produce a service account (b9-packets.md §2.3 row 4
    // rationale; the guarded path above covers the explicit in-memory
    // replacement).
    const transport = fakeTransport(() => ({ status: 200, json: {} }));
    const ws = createBrowserWorkspace({
      token: "tok-123",
      projectId: "12345",
      region: "us",
      fetch: transport.fetch,
    });
    await expect(ws.use({ account: "anything" })).rejects.toMatchObject({
      code: "UNPORTED_RESOLVER_SEAM",
    });
  });
});

describe("clients derived via withProject keep the service-account guard", () => {
  // Pair-B blind review (b9-reviewB-threat.md F1 / b9-reviewB-e2e.md F1,
  // both reproduced by the arbiter): `withProject` returns a fresh core
  // client, so without recursion the §2.3 path-4 guard is bypassed and
  // `derived.use({account: SA})` builds a Basic header in the browser
  // build. The guard must wrap every derived client too.
  it("derived.use({account: SA}) is refused; no Basic header ever reaches the wire", async () => {
    const transport = fakeTransport(() => ({ status: 200, json: {} }));
    const ws = createBrowserWorkspace({
      token: "tok-123",
      projectId: "12345",
      region: "us",
      fetch: transport.fetch,
    });
    const derived = ws.client.withProject("67890");
    await expect(
      derived.use({ account: serviceAccountSession().account }),
    ).rejects.toMatchObject({ code: BROWSER_SERVICE_ACCOUNT_REFUSED });
    // Atomic-on-failure: the derived client keeps its oauth_token session.
    expect(derived.session.account.type).toBe("oauth_token");
    expect(transport.captures).toHaveLength(0);
  });

  it("the guard RECURSES: a client derived from a derived client still refuses SA", async () => {
    const transport = fakeTransport(() => ({ status: 200, json: {} }));
    const ws = createBrowserWorkspace({
      token: "tok-123",
      projectId: "12345",
      region: "us",
      fetch: transport.fetch,
    });
    const twiceDerived = ws.client.withProject("67890").withProject("13579");
    await expect(
      twiceDerived.use({ account: serviceAccountSession().account }),
    ).rejects.toMatchObject({ code: BROWSER_SERVICE_ACCOUNT_REFUSED });
    expect(transport.captures).toHaveLength(0);
  });

  it("derived clients stay fully usable for non-SA traffic (guard is transparent)", async () => {
    const transport = fakeTransport(() => ({ status: 200, json: {} }));
    const ws = createBrowserWorkspace({
      token: "tok-123",
      projectId: "12345",
      region: "us",
      fetch: transport.fetch,
    });
    const derived = ws.client.withProject("67890");
    expect(derived.projectId).toBe("67890");
    await derived.use({ project: "24680" });
    expect(derived.projectId).toBe("24680");
  });
});

describe("no raw Workspace constructor in the browser entry", () => {
  // Pair-B blind review (b9-reviewB-threat.md F2, reproduced): a VALUE
  // re-export of core `Workspace` let `new Workspace({session: SA})`
  // bypass both the SA gate and the export-refusing fetch wrap. The
  // entry now re-exports `Workspace` as a TYPE only — annotations keep
  // working; construction must go through the gated factories.
  it("`Workspace` is type-only: the entry point exposes no runtime value", () => {
    expect(Object.keys(browserEntry)).not.toContain("Workspace");
  });

  it("the gated factories remain the only construction paths exported", () => {
    expect(typeof browserEntry.createBrowserWorkspace).toBe("function");
    expect(typeof browserEntry.createBrowserWorkspaceFromStore).toBe(
      "function",
    );
    expect(typeof browserEntry.browserSession).toBe("function");
  });
});
