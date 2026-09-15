// Layer-3 translation — Phase-3 packet B4-C2 export/streaming locks.
// Sources:
//
// - tests/unit/test_api_client.py::TestEventExport (:557-703) — ALL.
// - tests/unit/test_api_client.py::TestRequestEncodingRegression (:1370)
//   — the profile-export JSON-body encoding lock.
// - tests/unit/test_api_client.py::TestRetryStateResetRegression
//   (:1401-1572) — ALL FOUR tests + the :1551 project_id lock (the B0
//   deviation-3 deferrals, B0-ARB carried item 6b; gate diff-checks
//   these names).
// - tests/unit/test_api_client.py::TestRetryAfterHardening::
//   test_export_events_negative_retry_after_uses_backoff (:3810) — the
//   remaining deviation-3 deferral. The Python `monkeypatch.setattr(
//   client, "_calculate_backoff", lambda _: 0.75)` pin translates to the
//   injected-RNG-deterministic value (B0 deviation-5 precedent):
//   `random: () => 0` makes the fallback backoff EXACTLY 1.0 s, so
//   `recorded_sleeps == [0.75]` becomes `sleeps == [1000]` (ms seam,
//   R2.12) — assertion content (negative Retry-After is NOT honored;
//   exactly one backoff sleep) preserved, R10.2.
// - tests/unit/test_query_workspace_scoping.py::TestNonQueryHostsUnaffected::
//   test_export_stream_carries_no_workspace_id_param (:300) — the C1
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
  makeSession,
} from "../../test-support/client-test-helpers.js";

/** Drain an async generator into an array (the `list(...)` analog). */
async function drain<T>(source: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of source) {
    out.push(item);
  }
  return out;
}

/** Read the `event` member of a yielded export line. */
function eventName(value: JsonValue): unknown {
  return (toNativeJson(value) as { event?: unknown }).event;
}

describe("TestEventExport", () => {
  const mockData =
    '{"event":"A","properties":{"time":1}}\n{"event":"B","properties":{"time":2}}\n';

  it("test_export_events_returns_iterator", () => {
    const { client } = createMockClient(makeSession(), () => ({
      status: 200,
      text: mockData,
    }));
    const result = client.exportEvents("2024-01-01", "2024-01-31");
    // AsyncGenerator protocol — the Python `__iter__`/`__next__` twin.
    expect(typeof result[Symbol.asyncIterator]).toBe("function");
    expect(typeof result.next).toBe("function");
  });

  it("test_jsonl_parsing_line_by_line", async () => {
    const { client } = createMockClient(makeSession(), () => ({
      status: 200,
      text: mockData,
    }));
    const events = await drain(client.exportEvents("2024-01-01", "2024-01-31"));
    expect(events).toHaveLength(2);
    expect(eventName(events[0] as JsonValue)).toBe("A");
    expect(eventName(events[1] as JsonValue)).toBe("B");
  });

  it("test_on_batch_callback", async () => {
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

  it("test_event_name_filtering", async () => {
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

  it("test_malformed_json_skipped", async () => {
    const { client } = createMockClient(makeSession(), () => ({
      status: 200,
      text: '{"event":"A","properties":{"time":1}}\nNOT JSON\n{"event":"B","properties":{"time":2}}\n',
    }));
    const events = await drain(client.exportEvents("2024-01-01", "2024-01-31"));
    expect(events).toHaveLength(2);
    expect(eventName(events[0] as JsonValue)).toBe("A");
    expect(eventName(events[1] as JsonValue)).toBe("B");
  });

  it("test_export_events_with_limit", async () => {
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

  it("test_export_events_without_limit", async () => {
    let capturedUrl = "";
    const { client } = createMockClient(makeSession(), (request) => {
      capturedUrl = request.url;
      return { status: 200, text: "" };
    });
    await drain(client.exportEvents("2024-01-01", "2024-01-31"));
    expect(capturedUrl.includes("limit=")).toBe(false);
  });

  it("test_export_events_limit_with_other_params", async () => {
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

describe("TestRequestEncodingRegression", () => {
  it("test_profile_export_uses_json_body", async () => {
    let capturedContentType = "";
    const { client } = createMockClient(makeSession(), (request) => {
      capturedContentType = request.headers["content-type"] ?? "";
      return { status: 200, json: { results: [] } };
    });
    await drain(client.exportProfiles());
    expect(capturedContentType.includes("application/json")).toBe(true);
  });
});

describe("TestRetryStateResetRegression", () => {
  it("test_batch_count_resets_on_retry", async () => {
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
    const lastAttemptCounts = batchCountsPerAttempt.at(-1) as number[];
    expect(lastAttemptCounts).toContain(1000);
    expect(lastAttemptCounts).toContain(1500);
  });

  it("test_profile_page_count_resets_on_retry", async () => {
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
    expect(currentAttemptCounts).toEqual([1]);
  });

  it("test_multiple_retries_dont_accumulate_state", async () => {
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

  it("test_stream_rate_limit_error_carries_project_id", async () => {
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

describe("TestRetryAfterHardening (export slice)", () => {
  it("test_export_events_negative_retry_after_uses_backoff", async () => {
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
    expect(sleeps).toEqual([1000]);
  });
});

describe("TestNonQueryHostsUnaffected (C1 hand-off)", () => {
  it("test_export_stream_carries_no_workspace_id_param", async () => {
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
    const request = captured[0] as CapturedFetchRequest;
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
