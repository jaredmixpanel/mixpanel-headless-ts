// Drop-filter client methods: list/create/update/delete and the limits
// lookup (methods, scoped paths, result shapes). Mirrors the drop-filter
// classes of tests/unit/test_api_client_data_governance.py; the module's
// other domains live in the sibling `client-entities-*` files.

import { describe, expect, it } from "vitest";

import type { Session } from "../../src/auth/session.js";
import { toNativeJson } from "../../src/client/json-value.js";
import {
  createMockClient,
  makeSession,
  parseBody,
} from "../../test-support/client-test-helpers.js";

/** The `oauth_credentials` fixture twin. */
function oauthCredentials(): Session {
  return makeSession({
    projectId: "12345",
    region: "us",
    oauthToken: "test-oauth-token",
  });
}

// --- Drop filters ---

describe("List drop filters", () => {
  // python: TestListDropFilters
  it("returns list", async () => {
    // python: test_returns_list
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: {
        status: "ok",
        results: [{ event_name: "debug_event" }, { event_name: "test_event" }],
      },
    }));
    const result = toNativeJson(await client.listDropFilters()) as Array<
      Record<string, unknown>
    >;
    expect(result).toHaveLength(2);
    expect(result[0]?.["event_name"]).toBe("debug_event");
  });

  it("uses maybe scoped path", async () => {
    // python: test_uses_maybe_scoped_path
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.listDropFilters();
    expect(capturedUrls[0]).toContain("/data-definitions/events/drop-filters/");
  });

  it("uses get method", async () => {
    // python: test_uses_get_method
    const capturedMethods: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedMethods.push(request.method);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.listDropFilters();
    expect(capturedMethods[0]).toBe("GET");
  });
});

describe("Create drop filter", () => {
  // python: TestCreateDropFilter
  it("returns list", async () => {
    // python: test_returns_list
    const captured: Array<[string, unknown]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([request.method, parseBody(request.bodyText)]);
      return {
        status: 200,
        json: {
          status: "ok",
          results: [{ event_name: "existing" }, { event_name: "new_filter" }],
        },
      };
    });
    const result = toNativeJson(
      await client.createDropFilter({ event_name: "new_filter" }),
    ) as unknown[];
    expect(captured[0]?.[0]).toBe("POST");
    expect(result).toHaveLength(2);
  });

  it("uses maybe scoped path", async () => {
    // python: test_uses_maybe_scoped_path
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.createDropFilter({ event_name: "x" });
    expect(capturedUrls[0]).toContain("/data-definitions/events/drop-filters/");
  });
});

describe("Update drop filter", () => {
  // python: TestUpdateDropFilter
  it("returns list", async () => {
    // python: test_returns_list
    const captured: Array<[string, unknown]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([request.method, parseBody(request.bodyText)]);
      return {
        status: 200,
        json: { status: "ok", results: [{ id: 1, event_name: "updated" }] },
      };
    });
    const result = toNativeJson(
      await client.updateDropFilter({ id: 1, event_name: "updated" }),
    ) as unknown[];
    expect(captured[0]?.[0]).toBe("PATCH");
    expect(result).toHaveLength(1);
  });

  it("uses maybe scoped path", async () => {
    // python: test_uses_maybe_scoped_path
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.updateDropFilter({ id: 1 });
    expect(capturedUrls[0]).toContain("/data-definitions/events/drop-filters/");
  });
});

describe("Delete drop filter", () => {
  // python: TestDeleteDropFilter
  it("returns list", async () => {
    // python: test_returns_list
    const captured: Array<[string, unknown]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([request.method, parseBody(request.bodyText)]);
      return {
        status: 200,
        json: { status: "ok", results: [{ id: 2, event_name: "remaining" }] },
      };
    });
    const result = toNativeJson(await client.deleteDropFilter(1)) as unknown[];
    expect(captured[0]?.[0]).toBe("DELETE");
    expect(captured[0]?.[1]).toStrictEqual({ id: 1 });
    expect(result).toHaveLength(1);
  });

  it("uses maybe scoped path", async () => {
    // python: test_uses_maybe_scoped_path
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.deleteDropFilter(1);
    expect(capturedUrls[0]).toContain("/data-definitions/events/drop-filters/");
  });
});

describe("Get drop filter limits", () => {
  // python: TestGetDropFilterLimits
  it("returns dict", async () => {
    // python: test_returns_dict
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: { status: "ok", results: { max_filters: 10, current_count: 3 } },
    }));
    const result = toNativeJson(await client.getDropFilterLimits()) as Record<
      string,
      unknown
    >;
    expect(result["max_filters"]).toBe(10);
    expect(result["current_count"]).toBe(3);
  });

  it("uses maybe scoped path", async () => {
    // python: test_uses_maybe_scoped_path
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: {} } };
    });
    await client.getDropFilterLimits();
    expect(capturedUrls[0]).toContain(
      "/data-definitions/events/drop-filters/limits/",
    );
  });

  it("uses get method", async () => {
    // python: test_uses_get_method
    const capturedMethods: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedMethods.push(request.method);
      return { status: 200, json: { status: "ok", results: {} } };
    });
    await client.getDropFilterLimits();
    expect(capturedMethods[0]).toBe("GET");
  });
});
