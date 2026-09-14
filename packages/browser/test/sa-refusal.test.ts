// Layer-3 suite for the service-account Basic-auth runtime refusal —
// EVERY enumerated ingress path (b9-packets.md §2.3 table; contract
// arbiter R9.3: "Service-account Basic auth refused at runtime in
// browser builds with an explanatory error"). No Python twin exists —
// Python happily serves service accounts everywhere; the refusal is a
// browser-build policy (plan §4.3 Tier C note: Basic credentials are
// long-lived secrets that must not ship to a browser origin, even
// though CORS would technically permit the calls).
// R5: every assertion keys on the CODE, never message text.

import { describe, expect, it } from "vitest";

import * as browserEntry from "../src/index.js";
import type { Session } from "@mixpanel-headless/core";
import { Secret } from "@mixpanel-headless/core";
import {
  BROWSER_SERVICE_ACCOUNT_REFUSED,
  BrowserUnsupportedError,
  CREDENTIAL_KEYS,
  InMemoryCredentialStore,
  createBrowserWorkspace,
  createBrowserWorkspaceFromStore,
  type BrowserSessionOptions,
} from "../src/index.js";
import { fakeTransport } from "./helpers.js";

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

describe("§2.3 path 1 — createBrowserWorkspace({session}) with an SA session", () => {
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

describe("§2.3 path 2 — browserSession cannot even EXPRESS an SA (compile-time)", () => {
  it("BrowserSessionOptions rejects username/secret shapes (type-level fixture)", () => {
    // Defense in depth: the RUNTIME gate for this ingress is path 1
    // (asserted above); this fixture locks the COMPILE-TIME exclusion.
    const saShape = {
      username: "sa.user",
      secret: "hunter2",
      projectId: "12345",
      region: "us",
    } as const;
    // @ts-expect-error — BrowserSessionOptions carries only `token`
    // (an SA credential shape has no `token` and does not typecheck).
    const options: BrowserSessionOptions = saShape;
    expect(options).toBeDefined();
  });
  // §2.3 path 5 (beginLogin/completeLogin take no Account at all) is
  // type-level too and belongs to B9-R2 — documented in the R2 module
  // header per the packet table; no fixture here.
});

describe("§2.3 path 3 — createBrowserWorkspaceFromStore over a store holding SA creds", () => {
  it("refuses a persisted record whose type is service_account (out-of-band write)", async () => {
    const store = new InMemoryCredentialStore();
    await store.set(
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

describe("§2.3 path 4 — session switching on a browser-built facade", () => {
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

  it("Workspace.use({account}) cannot fetch a config SA — resolver seams stay unported in browser (R9.4)", async () => {
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

describe("§2.3 path 6 (pair-B FB-1) — clients DERIVED via withProject keep the SA guard", () => {
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

describe("§2.3 path 7 (pair-B FB-2) — no raw Workspace constructor in the browser entry", () => {
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
