// Layer-3 translation — Python PR #215 server-deadline-aware timeout
// locks. Sources:
//
// - tests/unit/test_api_client.py::TestServerDeadlineAccommodation
//   (all six cases)
// - tests/unit/test_pagination.py::TestPaginateAll::
//   test_default_timeout_outlasts_app_deadline
// - tests/unit/test_schema_graph.py::TestApiClientPerEventProperties::
//   test_uses_export_timeout
//
// Entry-point substitution (B0-notes decision 13 lineage): Python's
// httpx.MockTransport handlers read the per-request figure from
// `request.extensions["timeout"]["read"]`. The TS transport contract
// carries the same figure as `TransportRequestOptions.timeoutSeconds`
// on its way into `createRequestExecutor` (the httpx-transport analog);
// the injected-fetch fake one layer below cannot see it (rawFetch turns
// it into an armed abort clock), so this file wraps the executor via
// vi.mock and records each request's timeoutSeconds. Every assertion is
// otherwise preserved 1:1 (R10.2).

import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  RequestExecutor,
  TransportRequestOptions,
} from "../../src/client/internals.js";
import { createMixpanelClient } from "../../src/client/client.js";
import { paginateAll } from "../../src/client/pagination.js";
import {
  APP_API_SERVER_DEADLINE_S,
  DEFAULT_APP_TIMEOUT_S,
  DEFAULT_QUERY_TIMEOUT_S,
  QUERY_API_SERVER_DEADLINE_S,
  endpointBase,
} from "../../src/client/url.js";
import {
  createMockClient,
  makeSession,
  type CannedResponse,
} from "./client-test-helpers.js";

/** The per-request `extensions["timeout"]["read"]` capture log. */
const capturedTimeouts: number[] = [];

vi.mock(import("../../src/client/transport.js"), async (importOriginal) => {
  const mod = await importOriginal();
  return {
    ...mod,
    createRequestExecutor: (
      fetchImpl: typeof fetch,
      signal?: AbortSignal,
    ): RequestExecutor => {
      const real = mod.createRequestExecutor(fetchImpl, signal);
      return (options: TransportRequestOptions) => {
        capturedTimeouts.push(options.timeoutSeconds);
        return real(options);
      };
    },
  };
});

beforeEach(() => {
  capturedTimeouts.length = 0;
});

/** The `_capture_client` handler: a bare 200 `{"results": []}`. */
function okResults(): CannedResponse {
  return { status: 200, json: { results: [] } };
}

describe("TestServerDeadlineAccommodation", () => {
  it("test_default_constants_outlast_server_deadlines", () => {
    expect(DEFAULT_APP_TIMEOUT_S).toBeGreaterThan(APP_API_SERVER_DEADLINE_S);
    expect(DEFAULT_QUERY_TIMEOUT_S).toBeGreaterThan(
      QUERY_API_SERVER_DEADLINE_S,
    );
  });

  it("test_default_export_timeout_outlasts_query_deadline", async () => {
    const client = createMixpanelClient({ session: makeSession() });
    expect(client.core.exportTimeoutSeconds).toBeGreaterThan(
      QUERY_API_SERVER_DEADLINE_S,
    );
    await client.close();
  });

  it("test_app_request_outlasts_app_deadline", async () => {
    const { client } = createMockClient(makeSession(), okResults);
    await client.appRequest("GET", "/projects/12345/dashboards");
    expect(capturedTimeouts[0]).toBe(DEFAULT_APP_TIMEOUT_S);
  });

  it("test_query_request_outlasts_query_deadline", async () => {
    const { client } = createMockClient(makeSession(), okResults);
    await client.request("GET", `${endpointBase("us", "query")}/segmentation`);
    expect(capturedTimeouts[0]).toBe(DEFAULT_QUERY_TIMEOUT_S);
  });

  it("test_explicit_constructor_timeout_wins_everywhere", async () => {
    const { client } = createMockClient(makeSession(), okResults, {
      timeoutSeconds: 42.0,
    });
    await client.appRequest("GET", "/projects/12345/dashboards");
    expect(capturedTimeouts[0]).toBe(42.0);
    await client.request("GET", `${endpointBase("us", "query")}/segmentation`);
    expect(capturedTimeouts[1]).toBe(42.0);
  });

  it("test_per_call_timeout_wins_over_defaults", async () => {
    const { client } = createMockClient(makeSession(), okResults, {
      timeoutSeconds: 42.0,
    });
    await client.request("GET", `${endpointBase("us", "query")}/segmentation`, {
      timeoutSeconds: 7.0,
    });
    expect(capturedTimeouts[0]).toBe(7.0);
  });
});

describe("TestPaginateAll (server-deadline half)", () => {
  it("test_default_timeout_outlasts_app_deadline", async () => {
    // With no explicit client timeout, the request timeout must be the
    // app-route default (sized to outlast the server's ~120s deadline),
    // never `None` (httpx reads that as "no timeout at all").
    const { client } = createMockClient(
      makeSession({
        projectId: "12345",
        region: "us",
        oauthToken: "test-oauth-token",
      }),
      () => ({
        status: 200,
        json: {
          status: "ok",
          results: [{ id: 1 }],
          pagination: { page_size: 100, next_cursor: null },
        },
      }),
    );
    for await (const item of paginateAll(
      client,
      "/projects/12345/dashboards",
    )) {
      void item;
    }
    expect(capturedTimeouts[0]).not.toBeUndefined();
    expect(capturedTimeouts[0]).toBe(DEFAULT_APP_TIMEOUT_S);
  });
});

describe("TestApiClientPerEventProperties (server-deadline half)", () => {
  it("test_uses_export_timeout", async () => {
    // The gather runs under the long export timeout, not the route
    // default.
    const { client } = createMockClient(makeSession(), okResults);
    await client.listPerEventProperties();
    expect(capturedTimeouts[0]).toBe(600.0);
  });
});
