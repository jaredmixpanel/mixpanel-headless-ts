// `paginateAll`: cursor following, page-size and extra params, query_origin
// injection, malformed `results`, mid-walk 429/500/401 handling and the
// Retry-After clamp/fallback schedule. Mirrors tests/unit/test_pagination.py
// (all classes plus `run_rate_limited_pagination`). `patch(MAX_PAGES, 50)` is
// the `maxPages` option; recorded `time.sleep` seconds appear as ms (`[30000] * 3`).
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
  drain,
  makeSession,
} from "../../test-support/client-test-helpers.js";

/** The `oauth_credentials` fixture. */
function oauthCredentials(): Session {
  return makeSession({
    projectId: "12345",
    region: "us",
    oauthToken: "test-oauth-token",
  });
}

/** Native-JSON view of drained page items (JsonNumber tokens folded). */
function native(items: readonly JsonValue[]): unknown[] {
  return items.map((item) => toNativeJson(item));
}

describe("Paginate all", () => {
  // python: TestPaginateAll
  it("yields all results across pages", async () => {
    // python: test_yields_all_results_across_pages
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
    expect(native(items)).toStrictEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(callCount).toBe(2);
  });

  it("follows next cursor until null", async () => {
    // python: test_follows_next_cursor_until_none
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
    expect(cursorsSeen).toStrictEqual([null, "c2", "c3"]);
  });

  it("handles empty results", async () => {
    // python: test_handles_empty_results
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
    expect(items).toStrictEqual([]);
  });

  it("handles missing pagination field", async () => {
    // python: test_handles_missing_pagination_field
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
    expect(native(items)).toStrictEqual([{ id: 1 }, { id: 2 }]);
  });

  it("respects page size parameter", async () => {
    // python: test_respects_page_size_parameter
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

  it("passes additional params", async () => {
    // python: test_passes_additional_params
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

  it("injects query origin telemetry", async () => {
    // python: test_injects_query_origin_telemetry
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

  it("canonical query origin wins over caller", async () => {
    // python: test_canonical_query_origin_wins_over_caller
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

  it("handles response without results key", async () => {
    // python: test_handles_response_without_results_key
    const { client } = createMockClient(
      oauthCredentials(),
      (): CannedResponse => ({
        status: 200,
        json: { status: "ok", results: [{ id: 1 }] },
      }),
    );
    const items = await drain(paginateAll(client, "/projects/12345/items"));
    expect(native(items)).toStrictEqual([{ id: 1 }]);
  });
});

describe("Paginate all robustness", () => {
  // python: TestPaginateAllRobustness
  it("infinite loop same cursor", async () => {
    // python: test_infinite_loop_same_cursor
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
    // MAX_PAGES monkeypatch → the injectable maxPages option.
    await expect(
      drain(paginateAll(client, "/projects/12345/items", { maxPages: 50 })),
    ).rejects.toThrow(/maximum page limit/);
  });

  it("non JSON response", async () => {
    // python: test_non_json_response
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

  it("wraps ANY body-parse failure as INVALID_RESPONSE", async () => {
    // TS-only: `mixpanel_headless._internal.pagination` catches a broad
    // `except Exception` — even a RecursionError from pathological nesting
    // wraps as INVALID_RESPONSE. The TS analog is the RangeError the
    // recursive-descent parser throws on deep nesting; it must NOT escape
    // uncoded.
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

  it("HTTP 429 mid pagination", async () => {
    // python: test_http_429_mid_pagination
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
    // (seconds); the TS sleep seam is ms.
    expect(sleeps).toStrictEqual([30_000, 30_000, 30_000]);
  });

  it("HTTP 500 mid pagination", async () => {
    // python: test_http_500_mid_pagination
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

  it("HTTP 401 mid pagination", async () => {
    // python: test_http_401_mid_pagination
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

describe("Paginate all malformed results", () => {
  // python: TestPaginateAllMalformedResults
  it("null results treated as empty page", async () => {
    // python: test_null_results_treated_as_empty_page
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
    expect(items).toStrictEqual([]);
  });

  it("null results still follows next cursor", async () => {
    // python: test_null_results_still_follows_next_cursor
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
    expect(native(items)).toStrictEqual([{ id: 1 }]);
    expect(callCount).toBe(2);
  });

  it.each([
    ["string", "abc"],
    ["int", 42],
    ["dict", { id: 1 }],
    ["bool", true],
  ])(
    "non list results raises invalid response[%s]", // python: test_non_list_results_raises_invalid_response
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
 * `run_rate_limited_pagination`: drive a
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

describe("Paginate all retry after", () => {
  // python: TestPaginateAllRetryAfter
  it("valid retry after is honored", async () => {
    // python: test_valid_retry_after_is_honored
    const { durations, raised } = await runRateLimitedPagination("30");
    expect(durations).toStrictEqual([30_000]);
    expect(raised).toStrictEqual([]);
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
    "hostile retry after falls back to backoff[%s]", // python: test_hostile_retry_after_falls_back_to_backoff
    async (_label: string, retryAfter: string) => {
      const { durations, raised } = await runRateLimitedPagination(retryAfter);
      expect(durations).toStrictEqual([1_000]);
      expect(raised).toStrictEqual([]);
    },
  );

  it.each([
    ["huge-int", "999999"],
    ["exponent", "1e9"],
    ["one-day", "86400"],
  ])(
    "oversized retry after is clamped[%s]", // python: test_oversized_retry_after_is_clamped
    async (_label: string, retryAfter: string) => {
      const { durations, raised } = await runRateLimitedPagination(retryAfter);
      expect(durations).toStrictEqual([PAGINATION_BACKOFF_MAX_SECONDS * 1000]);
      expect(raised).toStrictEqual([]);
    },
  );

  it("missing retry after uses exponential backoff", async () => {
    // python: test_missing_retry_after_uses_exponential_backoff
    const { durations, raised } = await runRateLimitedPagination(null);
    expect(durations).toStrictEqual([1_000]);
    expect(raised).toStrictEqual([]);
  });

  it("exhausted retries backoff schedule is bounded", async () => {
    // python: test_exhausted_retries_backoff_schedule_is_bounded
    const { durations, raised } = await runRateLimitedPagination("inf", true);
    expect(durations).toStrictEqual([1_000, 2_000, 4_000]);
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
    "hostile retry after not reported on error[%s]", // python: test_hostile_retry_after_not_reported_on_error
    async (_label: string, retryAfter: string) => {
      const { raised } = await runRateLimitedPagination(retryAfter, true);
      expect(raised[0]).toBeInstanceOf(RateLimitError);
      expect((raised[0] as RateLimitError).retryAfter).toBeNull();
    },
  );

  it("valid retry after reported on error", async () => {
    // python: test_valid_retry_after_reported_on_error
    const { raised } = await runRateLimitedPagination("45", true);
    expect(raised[0]).toBeInstanceOf(RateLimitError);
    expect((raised[0] as RateLimitError).retryAfter).toBe(45);
  });
});
