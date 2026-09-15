// Layer-3 translation — Phase-3 packet B4-C6 pagination locks.
// Sources:
//
// - tests/unit/test_pagination.py (824) — ALL: TestPaginateAll (:64),
//   TestPaginateAllRobustness (:335), TestPaginateAllMalformedResults
//   (:519), TestPaginateAllRetryAfter (:702) + the
//   `run_rate_limited_pagination` driver (:647).
//
// Translation notes (R10.2 — assertion content preserved):
// - The Python `patch("mixpanel_headless._internal.pagination.MAX_PAGES",
//   50)` pin translates to the injectable `maxPages` option (default
//   10000) — an option, not a mutable module global (packet C6 §Layer-3,
//   playbook B4 row). The limit error still fires at page N+1 with the
//   code preserved.
// - `patch("time.sleep")` capture translates to the injected sleep seam
//   of `createMockClient` (ms, R2.12): Python's recorded `[30.0] * 3`
//   seconds become `[30000, 30000, 30000]` ms — same schedule, unit
//   moved to the seam.
// - `itertools.islice(..., 15000)` merely bounded Python's consumption;
//   the TS drain consumes until the PAGINATION_LIMIT raise at page 51,
//   which is the same observable.
import { describe, expect, it } from "vitest";

import type { Session } from "../../src/auth/session.js";
import { type JsonValue, toNativeJson } from "../../src/client/json-value.js";
import {
  MAX_RATE_LIMIT_RETRIES,
  paginateAll,
  PAGINATION_BACKOFF_MAX_SECONDS,
} from "../../src/client/pagination.js";
import {
  AuthenticationError,
  MixpanelHeadlessError,
  RateLimitError,
  ServerError,
} from "../../src/errors.js";
import {
  type CannedResponse,
  type CapturedFetchRequest,
  createMockClient,
  makeSession,
} from "../../test-support/client-test-helpers.js";

/** The `oauth_credentials` fixture (test_pagination.py:36-39). */
function oauthCredentials(): Session {
  return makeSession({
    projectId: "12345",
    region: "us",
    oauthToken: "test-oauth-token",
  });
}

/** Drain an async generator into an array (the `list(...)` analog). */
async function drain<T>(source: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of source) {
    out.push(item);
  }
  return out;
}

/** Native-JSON view of drained page items (JsonNumber tokens folded). */
function native(items: readonly JsonValue[]): unknown[] {
  return items.map((item) => toNativeJson(item));
}

describe("TestPaginateAll", () => {
  it("test_yields_all_results_across_pages", async () => {
    let callCount = 0;
    const { client } = createMockClient(
      oauthCredentials(),
      (request: CapturedFetchRequest): CannedResponse => {
        callCount += 1;
        const cursor = request.params["cursor"];
        if (cursor === undefined) {
          return {
            status: 200,
            json: {
              status: "ok",
              results: [{ id: 1 }, { id: 2 }],
              pagination: { page_size: 2, next_cursor: "cursor_page2" },
            },
          };
        }
        if (cursor === "cursor_page2") {
          return {
            status: 200,
            json: {
              status: "ok",
              results: [{ id: 3 }],
              pagination: { page_size: 2, next_cursor: null },
            },
          };
        }
        return { status: 404, json: { error: "Unknown cursor" } };
      },
    );
    const items = await drain(
      paginateAll(client, "/projects/12345/dashboards"),
    );
    expect(native(items)).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(callCount).toBe(2);
  });

  it("test_follows_next_cursor_until_none", async () => {
    const cursorsSeen: Array<string | null> = [];
    const { client } = createMockClient(
      oauthCredentials(),
      (request: CapturedFetchRequest): CannedResponse => {
        const cursor = request.params["cursor"] ?? null;
        cursorsSeen.push(cursor);
        if (cursor === null) {
          return {
            status: 200,
            json: {
              status: "ok",
              results: [{ id: 1 }],
              pagination: { page_size: 1, next_cursor: "c2" },
            },
          };
        }
        if (cursor === "c2") {
          return {
            status: 200,
            json: {
              status: "ok",
              results: [{ id: 2 }],
              pagination: { page_size: 1, next_cursor: "c3" },
            },
          };
        }
        return {
          status: 200,
          json: {
            status: "ok",
            results: [{ id: 3 }],
            pagination: { page_size: 1, next_cursor: null },
          },
        };
      },
    );
    const items = await drain(paginateAll(client, "/projects/12345/items"));
    expect(items).toHaveLength(3);
    expect(cursorsSeen).toEqual([null, "c2", "c3"]);
  });

  it("test_handles_empty_results", async () => {
    const { client } = createMockClient(
      oauthCredentials(),
      (): CannedResponse => ({
        status: 200,
        json: {
          status: "ok",
          results: [],
          pagination: { page_size: 100, next_cursor: null },
        },
      }),
    );
    const items = await drain(
      paginateAll(client, "/projects/12345/dashboards"),
    );
    expect(items).toEqual([]);
  });

  it("test_handles_missing_pagination_field", async () => {
    const { client } = createMockClient(
      oauthCredentials(),
      (): CannedResponse => ({
        status: 200,
        json: { status: "ok", results: [{ id: 1 }, { id: 2 }] },
      }),
    );
    const items = await drain(
      paginateAll(client, "/projects/12345/dashboards"),
    );
    expect(native(items)).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("test_respects_page_size_parameter", async () => {
    const capturedParams: Array<Record<string, string>> = [];
    const { client } = createMockClient(
      oauthCredentials(),
      (request: CapturedFetchRequest): CannedResponse => {
        capturedParams.push({ ...request.params });
        return {
          status: 200,
          json: {
            status: "ok",
            results: [{ id: 1 }],
            pagination: { page_size: 25, next_cursor: null },
          },
        };
      },
    );
    await drain(
      paginateAll(client, "/projects/12345/dashboards", { page_size: 25 }),
    );
    expect(capturedParams[0]?.["page_size"]).toBe("25");
  });

  it("test_passes_additional_params", async () => {
    const capturedParams: Array<Record<string, string>> = [];
    const { client } = createMockClient(
      oauthCredentials(),
      (request: CapturedFetchRequest): CannedResponse => {
        capturedParams.push({ ...request.params });
        return {
          status: 200,
          json: {
            status: "ok",
            results: [],
            pagination: { page_size: 100, next_cursor: null },
          },
        };
      },
    );
    await drain(
      paginateAll(client, "/projects/12345/dashboards", {
        params: { include_archived: "true" },
      }),
    );
    expect(capturedParams[0]?.["include_archived"]).toBe("true");
  });

  it("test_injects_query_origin_telemetry", async () => {
    const capturedParams: Array<Record<string, string>> = [];
    const { client } = createMockClient(
      oauthCredentials(),
      (request: CapturedFetchRequest): CannedResponse => {
        capturedParams.push({ ...request.params });
        return {
          status: 200,
          json: {
            status: "ok",
            results: [{ id: 1 }],
            pagination: { page_size: 100, next_cursor: null },
          },
        };
      },
    );
    await drain(paginateAll(client, "/projects/12345/dashboards"));
    expect(capturedParams[0]?.["query_origin"]).toBe("mixpanel-headless");
  });

  it("test_canonical_query_origin_wins_over_caller", async () => {
    const capturedParams: Array<Record<string, string>> = [];
    const { client } = createMockClient(
      oauthCredentials(),
      (request: CapturedFetchRequest): CannedResponse => {
        capturedParams.push({ ...request.params });
        return {
          status: 200,
          json: {
            status: "ok",
            results: [{ id: 1 }],
            pagination: { page_size: 100, next_cursor: null },
          },
        };
      },
    );
    await drain(
      paginateAll(client, "/projects/12345/dashboards", {
        params: { query_origin: "spoofed-by-caller" },
      }),
    );
    expect(capturedParams[0]?.["query_origin"]).toBe("mixpanel-headless");
  });

  it("test_handles_response_without_results_key", async () => {
    const { client } = createMockClient(
      oauthCredentials(),
      (): CannedResponse => ({
        status: 200,
        json: { status: "ok", results: [{ id: 1 }] },
      }),
    );
    const items = await drain(paginateAll(client, "/projects/12345/items"));
    expect(native(items)).toEqual([{ id: 1 }]);
  });
});

describe("TestPaginateAllRobustness", () => {
  it("test_infinite_loop_same_cursor", async () => {
    const { client } = createMockClient(
      oauthCredentials(),
      (): CannedResponse => ({
        status: 200,
        json: {
          status: "ok",
          results: [{ id: 1 }],
          pagination: { page_size: 1, next_cursor: "same" },
        },
      }),
    );
    // MAX_PAGES monkeypatch → injectable maxPages option (packet C6).
    await expect(
      drain(paginateAll(client, "/projects/12345/items", { maxPages: 50 })),
    ).rejects.toThrow(/maximum page limit/);
  });

  it("test_non_json_response", async () => {
    const { client } = createMockClient(
      oauthCredentials(),
      (): CannedResponse => ({
        status: 200,
        text: "<html><body>Error</body></html>",
        headers: { "content-type": "text/html" },
      }),
    );
    await expect(
      drain(paginateAll(client, "/projects/12345/items")),
    ).rejects.toThrow(/Non-JSON response/);
  });

  it("wraps ANY body-parse failure as INVALID_RESPONSE (W-F4)", async () => {
    // TS-native B4-ARB lock (b4-review-wire.md F4): pagination.py:246
    // catches broad `except Exception` — even a RecursionError from
    // pathological nesting wraps as INVALID_RESPONSE. The TS analog is
    // the RangeError the recursive-descent parser throws on deep
    // nesting; it must NOT escape uncoded.
    const { client } = createMockClient(
      oauthCredentials(),
      (): CannedResponse => ({
        status: 200,
        text: "[".repeat(200000),
        headers: { "content-type": "application/json" },
      }),
    );
    let raised: unknown = null;
    try {
      await drain(paginateAll(client, "/projects/12345/items"));
    } catch (error_) {
      raised = error_;
    }
    expect(raised).toBeInstanceOf(MixpanelHeadlessError);
    const error = raised as MixpanelHeadlessError;
    expect(error.code).toBe("INVALID_RESPONSE");
    expect(error.message).toMatch(/Non-JSON response during pagination/);
  });

  it("test_http_429_mid_pagination", async () => {
    let callCount = 0;
    const { client, sleeps } = createMockClient(
      oauthCredentials(),
      (): CannedResponse => {
        callCount += 1;
        if (callCount === 1) {
          return {
            status: 200,
            json: {
              status: "ok",
              results: [{ id: 1 }],
              pagination: { page_size: 1, next_cursor: "c2" },
            },
          };
        }
        return {
          status: 429,
          json: { error: "rate_limited" },
          headers: { "Retry-After": "30" },
        };
      },
    );
    await expect(
      drain(paginateAll(client, "/projects/12345/items")),
    ).rejects.toThrow(RateLimitError);
    // Python: `[call.args[0] for call in mock_sleep...] == [30.0] * 3`
    // (seconds); the TS sleep seam is ms (R2.12).
    expect(sleeps).toEqual([30_000, 30_000, 30_000]);
  });

  it("test_http_500_mid_pagination", async () => {
    let callCount = 0;
    const { client } = createMockClient(
      oauthCredentials(),
      (): CannedResponse => {
        callCount += 1;
        if (callCount === 1) {
          return {
            status: 200,
            json: {
              status: "ok",
              results: [{ id: 1 }],
              pagination: { page_size: 1, next_cursor: "c2" },
            },
          };
        }
        return { status: 500, json: { error: "internal_error" } };
      },
    );
    await expect(
      drain(paginateAll(client, "/projects/12345/items")),
    ).rejects.toThrow(ServerError);
  });

  it("test_http_401_mid_pagination", async () => {
    let callCount = 0;
    const { client } = createMockClient(
      oauthCredentials(),
      (): CannedResponse => {
        callCount += 1;
        if (callCount === 1) {
          return {
            status: 200,
            json: {
              status: "ok",
              results: [{ id: 1 }],
              pagination: { page_size: 1, next_cursor: "c2" },
            },
          };
        }
        return { status: 401, json: { error: "unauthorized" } };
      },
    );
    await expect(
      drain(paginateAll(client, "/projects/12345/items")),
    ).rejects.toThrow(AuthenticationError);
  });
});

describe("TestPaginateAllMalformedResults", () => {
  it("test_null_results_treated_as_empty_page", async () => {
    const { client } = createMockClient(
      oauthCredentials(),
      (): CannedResponse => ({
        status: 200,
        json: {
          status: "ok",
          results: null,
          pagination: { page_size: 100, next_cursor: null },
        },
      }),
    );
    const items = await drain(paginateAll(client, "/projects/12345/items"));
    expect(items).toEqual([]);
  });

  it("test_null_results_still_follows_next_cursor", async () => {
    let callCount = 0;
    const { client } = createMockClient(
      oauthCredentials(),
      (): CannedResponse => {
        callCount += 1;
        if (callCount === 1) {
          return {
            status: 200,
            json: {
              status: "ok",
              results: null,
              pagination: { page_size: 100, next_cursor: "c2" },
            },
          };
        }
        return {
          status: 200,
          json: {
            status: "ok",
            results: [{ id: 1 }],
            pagination: { page_size: 100, next_cursor: null },
          },
        };
      },
    );
    const items = await drain(paginateAll(client, "/projects/12345/items"));
    expect(native(items)).toEqual([{ id: 1 }]);
    expect(callCount).toBe(2);
  });

  it.each([
    ["string", "abc"],
    ["int", 42],
    ["dict", { id: 1 }],
    ["bool", true],
  ])(
    "test_non_list_results_raises_invalid_response[%s]",
    async (_label: string, resultsValue: unknown) => {
      const { client } = createMockClient(
        oauthCredentials(),
        (): CannedResponse => ({
          status: 200,
          json: {
            status: "ok",
            results: resultsValue,
            pagination: { page_size: 100, next_cursor: null },
          },
        }),
      );
      let raised: unknown = null;
      try {
        await drain(paginateAll(client, "/projects/12345/items"));
      } catch (error_) {
        raised = error_;
      }
      expect(raised).toBeInstanceOf(MixpanelHeadlessError);
      const error = raised as MixpanelHeadlessError;
      expect(error.message).toMatch(/must be a list/);
      expect(error.code).toBe("INVALID_RESPONSE");
    },
  );
});

/**
 * `run_rate_limited_pagination` (test_pagination.py:647-699): drive a
 * rate-limited walk and capture the sleep durations (ms seam) and any
 * raised error.
 *
 * @param retryAfter - `Retry-After` header value, or `null` to omit.
 * @param always429 - When `true` every response is a 429.
 * @returns Sleep durations (ms) and the raised exceptions.
 */
async function runRateLimitedPagination(
  retryAfter: string | null,
  always429 = false,
): Promise<{ durations: number[]; raised: unknown[] }> {
  let callCount = 0;
  const { client, sleeps } = createMockClient(
    oauthCredentials(),
    (): CannedResponse => {
      callCount += 1;
      if (always429 || callCount === 1) {
        return {
          status: 429,
          json: { error: "rate_limited" },
          ...(retryAfter === null
            ? {}
            : { headers: { "Retry-After": retryAfter } }),
        };
      }
      return {
        status: 200,
        json: {
          status: "ok",
          results: [{ id: 1 }],
          pagination: { page_size: 100, next_cursor: null },
        },
      };
    },
  );
  const raised: unknown[] = [];
  try {
    await drain(paginateAll(client, "/projects/12345/items"));
  } catch (error) {
    raised.push(error);
  }
  return { durations: sleeps, raised };
}

describe("TestPaginateAllRetryAfter", () => {
  it("test_valid_retry_after_is_honored", async () => {
    const { durations, raised } = await runRateLimitedPagination("30");
    expect(durations).toEqual([30_000]);
    expect(raised).toEqual([]);
  });

  it.each([
    ["negative-int", "-1"],
    ["negative-float", "-0.5"],
    ["nan", "nan"],
    ["nan-mixed-case", "NaN"],
    ["infinity", "inf"],
    ["negative-infinity", "-inf"],
    ["garbage", "abc"],
    ["empty", ""],
    ["thousands-separator", "1,000"],
  ])(
    "test_hostile_retry_after_falls_back_to_backoff[%s]",
    async (_label: string, retryAfter: string) => {
      const { durations, raised } = await runRateLimitedPagination(retryAfter);
      expect(durations).toEqual([1_000]);
      expect(raised).toEqual([]);
    },
  );

  it.each([
    ["huge-int", "999999"],
    ["exponent", "1e9"],
    ["one-day", "86400"],
  ])(
    "test_oversized_retry_after_is_clamped[%s]",
    async (_label: string, retryAfter: string) => {
      const { durations, raised } = await runRateLimitedPagination(retryAfter);
      expect(durations).toEqual([PAGINATION_BACKOFF_MAX_SECONDS * 1000]);
      expect(raised).toEqual([]);
    },
  );

  it("test_missing_retry_after_uses_exponential_backoff", async () => {
    const { durations, raised } = await runRateLimitedPagination(null);
    expect(durations).toEqual([1_000]);
    expect(raised).toEqual([]);
  });

  it("test_exhausted_retries_backoff_schedule_is_bounded", async () => {
    const { durations, raised } = await runRateLimitedPagination("inf", true);
    expect(durations).toEqual([1_000, 2_000, 4_000]);
    expect(durations).toHaveLength(MAX_RATE_LIMIT_RETRIES);
    expect(
      durations.every(
        (d) => d >= 0 && d <= PAGINATION_BACKOFF_MAX_SECONDS * 1000,
      ),
    ).toBe(true);
    expect(raised[0]).toBeInstanceOf(RateLimitError);
  });

  it.each([
    ["negative", "-5"],
    ["nan", "nan"],
    ["infinity", "inf"],
    ["garbage", "abc"],
  ])(
    "test_hostile_retry_after_not_reported_on_error[%s]",
    async (_label: string, retryAfter: string) => {
      const { raised } = await runRateLimitedPagination(retryAfter, true);
      expect(raised[0]).toBeInstanceOf(RateLimitError);
      expect((raised[0] as RateLimitError).retryAfter).toBeNull();
    },
  );

  it("test_valid_retry_after_reported_on_error", async () => {
    const { raised } = await runRateLimitedPagination("45", true);
    expect(raised[0]).toBeInstanceOf(RateLimitError);
    expect((raised[0] as RateLimitError).retryAfter).toBe(45);
  });
});
