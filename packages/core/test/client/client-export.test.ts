// Layer-3 translation — Phase-3 packet B4-C2 export/streaming locks.
// Sources:
//
// - tests/unit/test_api_client.py::TestEventExport — ALL.
// - tests/unit/test_api_client.py::TestRequestEncodingRegression
//   — the profile-export JSON-body encoding lock.
// - tests/unit/test_api_client.py::TestRetryStateResetRegression
//   — ALL FOUR tests + the :1551 project_id lock (the B0
//   deviation-3 deferrals, B0-ARB carried item 6b; gate diff-checks
//   these names).
// - tests/unit/test_api_client.py::TestRetryAfterHardening::
//   test_export_events_negative_retry_after_uses_backoff — the
//   remaining deviation-3 deferral. The Python `monkeypatch.setattr(
//   client, "_calculate_backoff", lambda _: 0.75)` pin translates to the
//   injected-RNG-deterministic value (B0 deviation-5 precedent):
//   `random: () => 0` makes the fallback backoff EXACTLY 1.0 s, so
//   `recorded_sleeps == [0.75]` becomes `sleeps == [1000]` (ms seam,
//   R2.12) — assertion content (negative Retry-After is NOT honored;
//   exactly one backoff sleep) preserved, R10.2.
// - tests/unit/test_query_workspace_scoping.py::TestNonQueryHostsUnaffected::
//   test_export_stream_carries_no_workspace_id_param — the C1
//   hand-off (B4-C1-notes.md finding 5; client-scoping.test.ts header).
//
// The remaining classes of test_api_client.py were translated at B0/C1
// (internals/backoff: `b0-review-assertions.md`; construction/request:
// client-core.test.ts / client-request.test.ts headers) or belong to
// other shards (C3+: CRUD suites).
import { describe, expect, it } from "vitest";

import {
  type JsonNumber,
  type JsonValue,
  toNativeJson,
} from "../../src/client/json-value.js";
import { RateLimitError } from "../../src/errors.js";
import {
  type CannedResponse,
  type CapturedFetchRequest,
  createMockClient,
  drain,
  makeSession,
} from "../../test-support/client-test-helpers.js";

/** Read the `event` member of a yielded export line. */
function eventName(value: JsonValue): unknown {
  return (toNativeJson(value) as { event?: unknown }).event;
}

describe("Event export", () => {
  // python: TestEventExport
  const mockData =
    '{"event":"A","properties":{"time":1}}\n{"event":"B","properties":{"time":2}}\n';

  it("export events returns iterator", () => {
    // python: test_export_events_returns_iterator
    const { client } = createMockClient(makeSession(), () => ({
      status: 200,
      text: mockData,
    }));
    const result = client.exportEvents("2024-01-01", "2024-01-31");
    // AsyncGenerator protocol — the Python `__iter__`/`__next__` twin.
    expect(typeof result[Symbol.asyncIterator]).toBe("function");
    expect(typeof result.next).toBe("function");
  });

  it("JSONL parsing line by line", async () => {
    // python: test_jsonl_parsing_line_by_line
    const { client } = createMockClient(makeSession(), () => ({
      status: 200,
      text: mockData,
    }));
    const events = await drain(client.exportEvents("2024-01-01", "2024-01-31"));
    expect(events).toHaveLength(2);
    expect(eventName(events[0] as JsonValue)).toBe("A");
    expect(eventName(events[1] as JsonValue)).toBe("B");
  });

  it("on batch callback", async () => {
    // python: test_on_batch_callback
    const lines: string[] = [];
    for (let i = 0; i < 1500; i += 1) {
      lines.push(JSON.stringify({ event: `E${i}`, properties: { time: i } }));
    }
    const { client } = createMockClient(makeSession(), () => ({
      status: 200,
      text: `${lines.join("\n")}\n`,
    }));
    const batchCounts: number[] = [];
    await drain(
      client.exportEvents("2024-01-01", "2024-01-31", {
        onBatch: (count) => {
          batchCounts.push(count);
        },
      }),
    );
    expect(batchCounts).toContain(1000);
    expect(batchCounts).toContain(1500);
  });

  it("event name filtering", async () => {
    // python: test_event_name_filtering
    let capturedUrl = "";
    const { client } = createMockClient(makeSession(), (request) => {
      capturedUrl = request.url;
      return { status: 200, text: "" };
    });
    await drain(
      client.exportEvents("2024-01-01", "2024-01-31", {
        events: ["Purchase", "View"],
      }),
    );
    expect(capturedUrl.includes("event=")).toBe(true);
  });

  it("malformed JSON skipped", async () => {
    // python: test_malformed_json_skipped
    const { client } = createMockClient(makeSession(), () => ({
      status: 200,
      text: '{"event":"A","properties":{"time":1}}\nNOT JSON\n{"event":"B","properties":{"time":2}}\n',
    }));
    const events = await drain(client.exportEvents("2024-01-01", "2024-01-31"));
    expect(events).toHaveLength(2);
    expect(eventName(events[0] as JsonValue)).toBe("A");
    expect(eventName(events[1] as JsonValue)).toBe("B");
  });

  it("export events with limit", async () => {
    // python: test_export_events_with_limit
    let capturedUrl = "";
    const { client } = createMockClient(makeSession(), (request) => {
      capturedUrl = request.url;
      return { status: 200, text: "" };
    });
    await drain(
      client.exportEvents("2024-01-01", "2024-01-31", { limit: 1000 }),
    );
    expect(capturedUrl.includes("limit=1000")).toBe(true);
  });

  it("export events without limit", async () => {
    // python: test_export_events_without_limit
    let capturedUrl = "";
    const { client } = createMockClient(makeSession(), (request) => {
      capturedUrl = request.url;
      return { status: 200, text: "" };
    });
    await drain(client.exportEvents("2024-01-01", "2024-01-31"));
    expect(capturedUrl.includes("limit=")).toBe(false);
  });

  it("export events limit with other params", async () => {
    // python: test_export_events_limit_with_other_params
    let capturedUrl = "";
    const { client } = createMockClient(makeSession(), (request) => {
      capturedUrl = request.url;
      return { status: 200, text: "" };
    });
    await drain(
      client.exportEvents("2024-01-01", "2024-01-31", {
        events: ["Purchase"],
        where: 'properties["amount"] > 100',
        limit: 500,
      }),
    );
    expect(capturedUrl.includes("limit=500")).toBe(true);
    expect(capturedUrl.includes("event=")).toBe(true);
    expect(capturedUrl.includes("where=")).toBe(true);
  });
});

describe("Request encoding regression", () => {
  // python: TestRequestEncodingRegression
  it("profile export uses JSON body", async () => {
    // python: test_profile_export_uses_json_body
    let capturedContentType = "";
    const { client } = createMockClient(makeSession(), (request) => {
      capturedContentType = request.headers["content-type"] ?? "";
      return { status: 200, json: { results: [] } };
    });
    await drain(client.exportProfiles());
    expect(capturedContentType.includes("application/json")).toBe(true);
  });
});

describe("Retry state reset regression", () => {
  // python: TestRetryStateResetRegression
  it("batch count resets on retry", async () => {
    // python: test_batch_count_resets_on_retry
    const lines: string[] = [];
    for (let i = 0; i < 1500; i += 1) {
      lines.push(JSON.stringify({ event: `E${i}`, properties: { time: i } }));
    }
    const mockData = `${lines.join("\n")}\n`;
    let attempt = 0;
    const batchCountsPerAttempt: number[][] = [];
    let currentAttemptCounts: number[] = [];
    const handler = (): CannedResponse => {
      attempt += 1;
      if (currentAttemptCounts.length > 0) {
        batchCountsPerAttempt.push([...currentAttemptCounts]);
      }
      currentAttemptCounts = [];
      if (attempt === 1) {
        return { status: 429, headers: { "Retry-After": "0" } };
      }
      return { status: 200, text: mockData };
    };
    const { client } = createMockClient(makeSession(), handler, {
      maxRetries: 3,
    });
    await drain(
      client.exportEvents("2024-01-01", "2024-01-31", {
        onBatch: (count) => {
          currentAttemptCounts.push(count);
        },
      }),
    );
    if (currentAttemptCounts.length > 0) {
      batchCountsPerAttempt.push([...currentAttemptCounts]);
    }
    expect(batchCountsPerAttempt.length).toBeGreaterThanOrEqual(1);
    const lastAttemptCounts = batchCountsPerAttempt.at(-1)!;
    expect(lastAttemptCounts).toContain(1000);
    expect(lastAttemptCounts).toContain(1500);
  });

  it("profile page count resets on retry", async () => {
    // python: test_profile_page_count_resets_on_retry
    let attempt = 0;
    const currentAttemptCounts: number[] = [];
    const handler = (): CannedResponse => {
      attempt += 1;
      if (attempt === 1) {
        return { status: 429, headers: { "Retry-After": "0" } };
      }
      if (attempt === 2) {
        return {
          status: 200,
          json: { results: [{ $distinct_id: "u1" }], session_id: "abc123" },
        };
      }
      return { status: 200, json: { results: [], session_id: null } };
    };
    const { client } = createMockClient(makeSession(), handler, {
      maxRetries: 3,
    });
    const profiles = await drain(
      client.exportProfiles({
        onBatch: (count) => {
          currentAttemptCounts.push(count);
        },
      }),
    );
    expect(profiles).toHaveLength(1);
    expect(currentAttemptCounts).toStrictEqual([1]);
  });

  it("multiple retries dont accumulate state", async () => {
    // python: test_multiple_retries_dont_accumulate_state
    const lines: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      lines.push(JSON.stringify({ event: `E${i}`, properties: { time: i } }));
    }
    let attempts = 0;
    const handler = (): CannedResponse => {
      attempts += 1;
      if (attempts < 3) {
        return { status: 429, headers: { "Retry-After": "0" } };
      }
      return { status: 200, text: `${lines.join("\n")}\n` };
    };
    const { client } = createMockClient(makeSession(), handler, {
      maxRetries: 3,
    });
    const events = await drain(client.exportEvents("2024-01-01", "2024-01-31"));
    expect(attempts).toBe(3);
    expect(events).toHaveLength(5);
  });

  it("stream rate limit error carries project ID", async () => {
    // python: test_stream_rate_limit_error_carries_project_id
    const { client } = createMockClient(
      makeSession(),
      () => ({ status: 429, headers: { "Retry-After": "0" } }),
      { maxRetries: 1 },
    );
    let caught: unknown;
    try {
      await drain(client.exportEvents("2024-01-01", "2024-01-31"));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RateLimitError);
    expect((caught as RateLimitError).projectId).toBe("12345");
  });
});

describe("Retry after hardening (export slice)", () => {
  // python: TestRetryAfterHardening
  it("export events negative retry after uses backoff", async () => {
    // python: test_export_events_negative_retry_after_uses_backoff
    let calls = 0;
    const handler = (): CannedResponse => {
      calls += 1;
      if (calls === 1) {
        return { status: 429, headers: { "Retry-After": "-30" } };
      }
      return { status: 200, text: '{"event":"A","properties":{"time":1}}\n' };
    };
    const { client, sleeps } = createMockClient(makeSession(), handler, {
      maxRetries: 2,
    });
    const events = await drain(client.exportEvents("2024-01-01", "2024-01-31"));
    expect(events).toHaveLength(1);
    // Injected-RNG substitution for the Python `_calculate_backoff`
    // monkeypatch pin (header note): random()=0 → backoff exactly 1.0 s
    // → ONE sleep of 1000 ms, proving Retry-After "-30" was rejected.
    expect(sleeps).toStrictEqual([1000]);
  });
});

describe("Non query hosts unaffected (C1 hand-off)", () => {
  // python: TestNonQueryHostsUnaffected
  it("export stream carries no workspace ID param", async () => {
    // python: test_export_stream_carries_no_workspace_id_param
    const captured: CapturedFetchRequest[] = [];
    const { client } = createMockClient(
      makeSession({ workspaceId: 777 }),
      (incoming) => {
        captured.push(incoming);
        return { status: 200, text: '{"event":"A","properties":{"time":1}}\n' };
      },
    );
    const events = await drain(client.exportEvents("2024-01-01", "2024-01-31"));
    expect(events).toHaveLength(1);
    expect(captured).toHaveLength(1);
    const request = captured[0]!;
    expect(new URL(request.url).host).toBe("data.mixpanel.com");
    expect(Object.hasOwn(request.params, "workspace_id")).toBe(false);
  });
});

describe("export lossless spine (GATE-VERDICT R5)", () => {
  it("parses NaN/Infinity constants and preserves float tokens per line", async () => {
    const { client } = createMockClient(makeSession(), () => ({
      status: 200,
      text: '{"event":"A","properties":{"x":NaN,"y":18.0}}\n',
    }));
    const events = await drain(client.exportEvents("2024-01-01", "2024-01-31"));
    expect(events).toHaveLength(1);
    const props = (events[0] as { properties: Record<string, unknown> })
      .properties;
    // pythonConstants: NaN parses to the native non-finite number (the
    // lossless layer reserves tokens for FINITE numerals).
    expect(Number.isNaN(props["x"] as number)).toBe(true);
    expect((props["y"] as JsonNumber).raw).toBe("18.0");
  });
});
