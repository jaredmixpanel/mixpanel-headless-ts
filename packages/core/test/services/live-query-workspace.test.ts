// Translated LiveQueryService workspace-passthrough tests — 045-report-links
// (Python PR #223 review). Source: tests/unit/test_live_query_workspace.py
// (TestWorkspacePassthrough): the four inline query methods forward
// `workspace_id` / `inject_workspace_id` to `insights_query` /
// `arb_funnels_query`.
//
// Translation notes:
// - `MagicMock(spec=MixpanelAPIClient)` → a structural stub cast to
//   `MixpanelClient` (the `live-query-flow.test.ts` precedent) that
//   records the options bag each inline call receives.
// - `call_args.kwargs["workspace_id"]` → the recorded second argument of
//   `insightsQuery` / `arbFunnelsQuery`. The TS service materializes the
//   Python defaults (`workspace_id=None`, `inject_workspace_id=True`) so
//   both keys are always present, exactly as the Python kwargs are.
// - `getattr(service, method)` parametrization → `it.each` over the three
//   method names, dispatched through a typed switch.
import { describe, expect, it } from "vitest";

import type { MixpanelClient } from "../../src/client/client.js";
import type { JsonValue } from "../../src/client/json-value.js";
import {
  type InlineQueryScope,
  LiveQueryService,
} from "../../src/services/live-query.js";

const INSIGHTS_RAW: JsonValue = {
  computed_at: "2025-01-15T10:00:00",
  date_range: { from_date: "2025-01-01", to_date: "2025-01-07" },
  headers: ["$event"],
  series: { Login: { "2025-01-01": 1 } },
};
const FLOW_RAW: JsonValue = { computed_at: "2025-01-15T10:00:00", steps: [] };

/** The recorded call shape (`call_args.kwargs` twin). */
interface RecordedCall {
  readonly body: Record<string, unknown>;
  readonly options: InlineQueryScope | undefined;
}

/** The `mock_api_client` fixture twin: the stub plus its call logs. */
interface MockApiClient {
  readonly client: MixpanelClient;
  readonly insightsCalls: RecordedCall[];
  readonly arbFunnelsCalls: RecordedCall[];
}

/**
 * Build the spec'd mock API client (`mock_api_client` fixture).
 *
 * @returns The stub client plus its call logs.
 */
function mockApiClient(): MockApiClient {
  const insightsCalls: RecordedCall[] = [];
  const arbFunnelsCalls: RecordedCall[] = [];
  const stub = {
    insightsQuery: (
      body: Record<string, unknown>,
      options?: InlineQueryScope,
    ): Promise<JsonValue> => {
      insightsCalls.push({ body, options });
      return Promise.resolve(INSIGHTS_RAW);
    },
    arbFunnelsQuery: (
      body: Record<string, unknown>,
      options?: InlineQueryScope,
    ): Promise<JsonValue> => {
      arbFunnelsCalls.push({ body, options });
      return Promise.resolve(FLOW_RAW);
    },
  };
  return {
    client: stub as unknown as MixpanelClient,
    insightsCalls,
    arbFunnelsCalls,
  };
}

/** The three insights-backed inline methods (`method` parametrization). */
type InsightsMethod = "query" | "queryFunnel" | "queryRetention";
const INSIGHTS_METHODS: readonly InsightsMethod[] = [
  "query",
  "queryFunnel",
  "queryRetention",
];

/**
 * `getattr(service, method)(...)` twin.
 *
 * @param service - The service under test.
 * @param method - The inline method name.
 * @param scope - The optional workspace scope bag.
 * @returns The method's result promise.
 */
function callInsightsMethod(
  service: LiveQueryService,
  method: InsightsMethod,
  scope?: InlineQueryScope,
): Promise<unknown> {
  const params = { sections: {} };
  switch (method) {
    case "query": {
      return service.query(params, 12345, scope);
    }
    case "queryFunnel": {
      return service.queryFunnel(params, 12345, scope);
    }
    case "queryRetention": {
      return service.queryRetention(params, 12345, scope);
    }
  }
}

/**
 * The last recorded call's options (`call_args.kwargs`).
 *
 * @param calls - A call log.
 * @returns The options bag of the most recent call.
 */
function lastKwargs(calls: readonly RecordedCall[]): InlineQueryScope {
  const last = calls.at(-1);
  expect(last).toBeDefined();
  return last?.options ?? {};
}

describe("TestWorkspacePassthrough", () => {
  it.each(INSIGHTS_METHODS)(
    "test_insights_methods_forward_workspace[%s]",
    async (method) => {
      const mock = mockApiClient();
      const service = new LiveQueryService(mock.client);
      await callInsightsMethod(service, method, { workspace_id: 75 });

      expect(lastKwargs(mock.insightsCalls).workspace_id).toBe(75);
    },
  );

  it.each(INSIGHTS_METHODS)(
    "test_insights_methods_default_to_none[%s]",
    async (method) => {
      const mock = mockApiClient();
      const service = new LiveQueryService(mock.client);
      await callInsightsMethod(service, method);

      expect(lastKwargs(mock.insightsCalls).workspace_id).toBeNull();
    },
  );

  it("test_query_flow_forwards_workspace", async () => {
    const mock = mockApiClient();
    const service = new LiveQueryService(mock.client);
    await service.queryFlow({ steps: [] }, 12345, "sankey", {
      workspace_id: 75,
    });

    expect(lastKwargs(mock.arbFunnelsCalls).workspace_id).toBe(75);
  });

  it.each(INSIGHTS_METHODS)(
    "test_insights_methods_forward_pin_opt_out[%s]",
    async (method) => {
      const mock = mockApiClient();
      const service = new LiveQueryService(mock.client);
      await callInsightsMethod(service, method, { inject_workspace_id: false });

      const kwargs = lastKwargs(mock.insightsCalls);
      expect(kwargs.inject_workspace_id).toBe(false);
      expect(kwargs.workspace_id).toBeNull();
    },
  );

  it.each(INSIGHTS_METHODS)(
    "test_insights_methods_default_to_pin_injection[%s]",
    async (method) => {
      const mock = mockApiClient();
      const service = new LiveQueryService(mock.client);
      await callInsightsMethod(service, method);

      expect(lastKwargs(mock.insightsCalls).inject_workspace_id).toBe(true);
    },
  );

  it("test_query_flow_forwards_pin_opt_out", async () => {
    const mock = mockApiClient();
    const service = new LiveQueryService(mock.client);
    await service.queryFlow({ steps: [] }, 12345, "sankey", {
      inject_workspace_id: false,
    });

    expect(lastKwargs(mock.arbFunnelsCalls).inject_workspace_id).toBe(false);
  });

  it("test_query_flow_defaults_to_none", async () => {
    const mock = mockApiClient();
    const service = new LiveQueryService(mock.client);
    await service.queryFlow({ steps: [] }, 12345);

    expect(lastKwargs(mock.arbFunnelsCalls).workspace_id).toBeNull();
  });
});
