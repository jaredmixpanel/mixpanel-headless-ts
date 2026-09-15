// Translated ReplaysService tests (packet B5-S3, `b5-packets.md` §5):
// assertion-for-assertion ports (R10.2) of ALL NINE classes of
//   tests/unit/_internal/test_replays_service.py
//     TestSignWrapping                 :72
//     TestFetchFilesHappyPath          :143
//     TestFetchFilesTermination        :222
//     TestFetchFiles403Retry           :266
//     TestFetchFilesCredentialRedaction :336
//     TestMobileReplayDetection        :366
//     TestDiscoverNoQueryFn            :397
//     TestDiscoverParsing              :503
//     TestEventsForParsing             :647
//
// Translation notes:
// - `MagicMock()` api client → the B4 `createMockClient` transport
//   analog; `api.sign_replays` assertions become assertions on the
//   captured POST bodies of `/replays/sign/bulk` (the REAL client
//   method runs — R10.8 binding honesty: the service must call the
//   ported client, not a stub of it).
// - `httpx.MockTransport(handler)` for CDN GETs → the `fetchImpl`
//   option (the `_async_transport` twin), a plain injected fetch.
// - `pytest.warns(UserWarning, match=...)` → the injected
//   {@link WarningSink} collector (R9.5), same wording asserted.
// - `RuntimeError("… query_fn …")` → `MixpanelHeadlessError` code
//   `REPLAYS_QUERY_FN_REQUIRED`; Python's `RuntimeError` carries no
//   registry code, so the port assigns one and the test asserts BOTH
//   the code and the Python message substring.
// - `dict[str, list[ReplayEvent]]` → a `Map` (R4.8); `set(out)` →
//   `new Set(out.keys())`.
// - `service.fetch_files(...)` is sync in Python (it drives
//   `asyncio.run`); the port is `async` (R6.1) and every call awaits.
import { describe, expect, it } from "vitest";

import {
  MixpanelHeadlessError,
  ReplayNotFoundError,
  SignedURLExpiredError,
  UnsupportedReplayFormatError,
} from "../../src/errors.js";
import type { WarningSink } from "../../src/services/discovery.js";
import { ReplaysService } from "../../src/services/replays.js";
import { SignedReplay } from "../../src/types/results/replays.js";
import {
  type CannedResponse,
  type CapturedFetchRequest,
  createMockClient,
  makeSession,
} from "../../test-support/client-test-helpers.js";

/** A canned-response handler (the httpx.MockTransport handler twin). */
type Handler = (request: CapturedFetchRequest) => CannedResponse;

/** A CDN handler that may also throw (the transport-error path). */
type CdnHandler = (url: string) => CannedResponse;

/**
 * The `_mock_api_client` fixture (`test_replays_service.py:34-39`) —
 * a real B4 client over a canned App-API transport.
 *
 * @param options - `projectId` (default `"12345"`) and the
 *   `signResponse` served by `POST /replays/sign/bulk`.
 * @returns The client plus the sign-call capture log.
 */
function mockApiClient(
  options: {
    projectId?: string;
    signResponse?: () => unknown;
  } = {},
): {
  client: ReturnType<typeof createMockClient>["client"];
  signCalls: CapturedFetchRequest[];
} {
  const signCalls: CapturedFetchRequest[] = [];
  const handler: Handler = (request) => {
    if (request.url.includes("/replays/sign/bulk")) {
      signCalls.push(request);
      return { status: 200, json: options.signResponse?.() ?? [] };
    }
    return { status: 404, json: { error: "unexpected app call" } };
  };
  const { client } = createMockClient(
    makeSession({ projectId: options.projectId ?? "12345" }),
    handler,
  );
  return { client, signCalls };
}

/**
 * Build a `SignedReplay` pointing at the fake CDN host used in the
 * fixtures (`_signed`, `test_replays_service.py:42-51`).
 *
 * @param replayId - The replay id (default `"r-1"`).
 * @param env - The environment (default `"prod"`).
 * @returns The signed handle.
 */
function signedFixture(
  replayId = "r-1",
  env: "prod" | "dev" = "prod",
): SignedReplay {
  return new SignedReplay({
    replay_id: replayId,
    url: `https://cdn.test/srr-us/sha-${replayId}/`,
    query_string: "URLPrefix=A&Expires=1&KeyName=K&Signature=S",
    env,
    signed_at: 1716810000.0,
  });
}

/**
 * Build a minimal rrweb-shaped event (`_rrweb_event`,
 * `test_replays_service.py:54-56`).
 *
 * @param timestamp - Unix ms.
 * @param type_ - The rrweb type discriminator (default `3`).
 * @returns The event dict.
 */
function rrwebEvent(timestamp: number, type_ = 3): Record<string, unknown> {
  return { type: type_, data: {}, timestamp };
}

/**
 * Pull the NNNN file index out of a CDN URL (`_parse_file_num`,
 * `test_replays_service.py:59-65`).
 *
 * @param url - The full CDN URL.
 * @returns The parsed file number.
 */
function parseFileNum(url: string): number {
  const path = new URL(url).pathname;
  const last = path.slice(path.lastIndexOf("/") + 1);
  return Number(last.slice(0, last.indexOf("-")));
}

/**
 * Turn a CDN handler into an injected fetch (the `_async_transport`
 * seam).
 *
 * @param handler - Receives the URL, returns the canned response, or
 *   throws a `TypeError` for the `httpx.ConnectError` analog.
 * @returns The fetch implementation.
 */
function cdnFetch(handler: CdnHandler): typeof fetch {
  return (async (input: string | URL | Request): Promise<Response> => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const canned = handler(url);
    const headers = new Headers(canned.headers ?? {});
    let body: string | null = null;
    if (canned.json !== undefined) {
      body = JSON.stringify(canned.json);
      headers.set("content-type", "application/json");
    } else if (canned.text !== undefined) {
      body = canned.text;
    }
    return new Response(body, { status: canned.status, headers });
  }) as typeof fetch;
}

/**
 * Build a CDN handler that serves file fixtures (`_make_cdn_handler`,
 * `test_replays_service.py:108-135`).
 *
 * @param options - `fileContents` (file number → events, or `null` for
 *   404), `files403`, and an optional `callLog`.
 * @returns The handler.
 */
function makeCdnHandler(
  options: {
    fileContents?: ReadonlyMap<
      number,
      ReadonlyArray<Record<string, unknown>> | null
    >;
    files403?: ReadonlySet<number>;
    callLog?: number[];
  } = {},
): CdnHandler {
  const fileContents = options.fileContents ?? new Map();
  const files403 = options.files403 ?? new Set<number>();
  return (url) => {
    const fileNum = parseFileNum(url);
    options.callLog?.push(fileNum);
    if (files403.has(fileNum)) {
      return { status: 403, text: "signature expired" };
    }
    const contents = fileContents.get(fileNum);
    if (contents === undefined || contents === null) {
      return { status: 404 };
    }
    return { status: 200, json: contents };
  };
}

// =============================================================================
// sign()
// =============================================================================

describe("sign wraps the client call in SignedReplay objects (TestSignWrapping)", () => {
  it("test_sign_returns_list_of_signed_replay", async () => {
    const { client, signCalls } = mockApiClient({
      signResponse: () => [
        {
          replay_id: "r-1",
          url: "https://cdn.test/srr-us/sha-1/",
          query_string: "URLPrefix=A&Signature=X",
        },
        {
          replay_id: "r-2",
          url: "https://cdn.test/srr-us/sha-2/",
          query_string: "URLPrefix=B&Signature=Y",
        },
      ],
    });
    const service = new ReplaysService(client);

    const result = await service.sign(["r-1", "r-2"], "prod");

    expect(result).toHaveLength(2);
    expect(result.every((r) => r instanceof SignedReplay)).toBe(true);
    expect(result[0]?.replay_id).toBe("r-1");
    expect(result[1]?.replay_id).toBe("r-2");
    expect(result[0]?.env).toBe("prod");
    expect(result[0]?.signed_at).toBeGreaterThan(0);
    // `api.sign_replays.assert_called_once_with(["r-1","r-2"], env="prod")`
    // — the ported client's request body is the observable twin.
    expect(signCalls).toHaveLength(1);
    expect(JSON.parse(signCalls[0]?.bodyText ?? "")).toStrictEqual({
      replays: [
        { replay_id: "r-1", replay_env: "prod" },
        { replay_id: "r-2", replay_env: "prod" },
      ],
    });
  });
});

// =============================================================================
// fetch_files() — the CDN walker
// =============================================================================

describe("buffered fetch concatenates + sorts (TestFetchFilesHappyPath)", () => {
  it("test_returns_timestamp_sorted_events", async () => {
    const fileContents = new Map<
      number,
      ReadonlyArray<Record<string, unknown>> | null
    >([
      [0, [rrwebEvent(20), rrwebEvent(10)]],
      [1, [rrwebEvent(40), rrwebEvent(30)]],
      [2, null], // 404 → end of replay
    ]);
    const { client } = mockApiClient();
    const service = new ReplaysService(client, {
      fetchImpl: cdnFetch(makeCdnHandler({ fileContents })),
    });

    const events = await service.fetchFiles(signedFixture(), {
      retentionDays: 30,
      maxFiles: 500,
      concurrency: 50,
    });

    expect(events.map((e) => e["timestamp"])).toStrictEqual([10, 20, 30, 40]);
  });

  it("test_uses_correct_file_naming", async () => {
    const callLog: number[] = [];
    const fileContents = new Map<
      number,
      ReadonlyArray<Record<string, unknown>> | null
    >([
      [0, [rrwebEvent(10)]],
      [1, [rrwebEvent(20)]],
      [2, null],
    ]);
    const { client } = mockApiClient();
    const service = new ReplaysService(client, {
      fetchImpl: cdnFetch(makeCdnHandler({ fileContents, callLog })),
    });

    await service.fetchFiles(signedFixture(), {
      retentionDays: 30,
      maxFiles: 500,
      concurrency: 1,
    });
    // Sequential walk stops the moment file 2 returns 404.
    expect([...callLog].sort((a, b) => a - b)).toStrictEqual([0, 1, 2]);
  });

  it("test_respects_max_files_bound", async () => {
    const fileContents = new Map<
      number,
      ReadonlyArray<Record<string, unknown>> | null
    >();
    for (let n = 0; n < 200; n += 1) {
      fileContents.set(n, [rrwebEvent(n * 10)]);
    }
    const callLog: number[] = [];
    const { client } = mockApiClient();
    const service = new ReplaysService(client, {
      fetchImpl: cdnFetch(makeCdnHandler({ fileContents, callLog })),
    });

    const events = await service.fetchFiles(signedFixture(), {
      retentionDays: 30,
      maxFiles: 10,
      concurrency: 4,
    });

    expect(events).toHaveLength(10);
    expect(Math.max(...callLog)).toBe(9);
  });
});

describe("404 termination semantics (TestFetchFilesTermination)", () => {
  it("test_first_file_404_raises_replay_not_found", async () => {
    const { client } = mockApiClient();
    const service = new ReplaysService(client, {
      fetchImpl: cdnFetch(makeCdnHandler()),
    });

    let caught: unknown;
    try {
      await service.fetchFiles(signedFixture(), {
        retentionDays: 30,
        maxFiles: 500,
        concurrency: 50,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ReplayNotFoundError);
    const exc = caught as ReplayNotFoundError;
    expect(exc.details["replay_id"]).toBe("r-1");
    expect(exc.details["retention_days"]).toBe(30);
    expect(String(exc.details["cdn_url_prefix"]).endsWith("/")).toBe(true);
  });

  it("test_mid_walk_404_terminates_cleanly", async () => {
    const fileContents = new Map<
      number,
      ReadonlyArray<Record<string, unknown>> | null
    >([
      [0, [rrwebEvent(10)]],
      [1, [rrwebEvent(20)]],
      [2, [rrwebEvent(30)]],
      // file 3 absent → 404
    ]);
    const { client } = mockApiClient();
    const service = new ReplaysService(client, {
      fetchImpl: cdnFetch(makeCdnHandler({ fileContents })),
    });

    const events = await service.fetchFiles(signedFixture(), {
      retentionDays: 30,
      maxFiles: 500,
      concurrency: 50,
    });
    expect(events.map((e) => e["timestamp"])).toStrictEqual([10, 20, 30]);
  });
});

describe("403 re-sign retry (TestFetchFiles403Retry)", () => {
  it("test_403_with_re_sign_succeeds_after_resign", async () => {
    const state = { resigned: false };
    const signCalls: CapturedFetchRequest[] = [];
    const handler: Handler = (request) => {
      if (request.url.includes("/replays/sign/bulk")) {
        signCalls.push(request);
        state.resigned = true;
        return {
          status: 200,
          json: [
            {
              replay_id: "r-1",
              url: "https://cdn.test/srr-us/sha-1/",
              query_string: "URLPrefix=Z&Signature=NEW",
            },
          ],
        };
      }
      return { status: 404, json: { error: "unexpected app call" } };
    };
    const { client } = createMockClient(makeSession(), handler);
    const service = new ReplaysService(client, {
      fetchImpl: cdnFetch((url) => {
        const fileNum = parseFileNum(url);
        if (fileNum >= 2) {
          return { status: 404 };
        }
        if (!state.resigned) {
          return { status: 403, text: "signature expired" };
        }
        return { status: 200, json: [rrwebEvent(fileNum * 10)] };
      }),
    });

    const events = await service.fetchFiles(signedFixture(), {
      retentionDays: 30,
      maxFiles: 500,
      concurrency: 50,
      reSignOnExpiry: true,
    });
    // Re-sign was called exactly once.
    expect(signCalls).toHaveLength(1);
    // After re-sign we got the events for files 0 and 1.
    expect(events.map((e) => e["timestamp"])).toStrictEqual([0, 10]);
  });

  it("test_403_without_re_sign_raises_expired", async () => {
    const { client, signCalls } = mockApiClient();
    const service = new ReplaysService(client, {
      fetchImpl: cdnFetch(makeCdnHandler({ files403: new Set([0]) })),
    });

    let caught: unknown;
    try {
      await service.fetchFiles(signedFixture(), {
        retentionDays: 30,
        maxFiles: 500,
        concurrency: 50,
        reSignOnExpiry: false,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SignedURLExpiredError);
    const exc = caught as SignedURLExpiredError;
    expect(exc.details["replay_id"]).toBe("r-1");
    expect(Object.hasOwn(exc.details, "signed_at")).toBe(true);
    expect(Object.hasOwn(exc.details, "expired_at")).toBe(true);
    expect(signCalls).toHaveLength(0);
  });
});

describe("credential redaction on transport errors (TestFetchFilesCredentialRedaction)", () => {
  it("test_transport_error_redacts_signed_credential", async () => {
    const signed = signedFixture();
    const { client } = mockApiClient();
    const service = new ReplaysService(client, {
      // A fetch rejection is the `httpx.ConnectError` analog (R2.10
      // normalizes it to MixpanelHttpError); the message embeds the
      // credentialed URL exactly as httpx's does.
      fetchImpl: (async (input: string | URL | Request): Promise<Response> => {
        const url = typeof input === "string" ? input : String(input);
        throw new TypeError(`connection failed for ${url}`);
      }) as typeof fetch,
    });

    let caught: unknown;
    try {
      await service.fetchFiles(signed, {
        retentionDays: 30,
        maxFiles: 500,
        concurrency: 50,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(MixpanelHeadlessError);
    const message = (caught as MixpanelHeadlessError).message;
    expect(message).not.toContain(signed.query_string);
    expect(message).toContain("<redacted>");
  });
});

// =============================================================================
// Mobile-replay detection
// =============================================================================

describe("mobile-replay detection (TestMobileReplayDetection)", () => {
  it("test_non_rrweb_first_event_raises_unsupported_format", async () => {
    const fileContents = new Map<
      number,
      ReadonlyArray<Record<string, unknown>> | null
    >([
      [0, [{ mobile_event: "tap", ts: 1716810000 }]],
      [1, null],
    ]);
    const { client } = mockApiClient();
    const service = new ReplaysService(client, {
      fetchImpl: cdnFetch(makeCdnHandler({ fileContents })),
    });

    let caught: unknown;
    try {
      await service.fetchFiles(signedFixture(), {
        retentionDays: 30,
        maxFiles: 500,
        concurrency: 50,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(UnsupportedReplayFormatError);
    const exc = caught as UnsupportedReplayFormatError;
    expect(exc.message).toContain("mobile session");
    expect(exc.details["replay_id"]).toBe(signedFixture().replay_id);
    expect(exc.details["format"]).toBe("non-rrweb");
  });
});

// =============================================================================
// discover() — no query_fn
// =============================================================================

describe("discover without query_fn (TestDiscoverNoQueryFn)", () => {
  it("test_raises_without_query_fn", async () => {
    const { client } = mockApiClient();
    const service = new ReplaysService(client); // no queryFn
    let caught: unknown;
    try {
      await service.discover({
        distinctId: "u-1",
        fromDate: "2026-05-20",
        toDate: "2026-05-27",
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(MixpanelHeadlessError);
    expect((caught as MixpanelHeadlessError).code).toBe(
      "REPLAYS_QUERY_FN_REQUIRED",
    );
    expect((caught as MixpanelHeadlessError).message).toContain("query_fn");
  });

  it("test_empty_replay_ids_returns_empty", async () => {
    const { client } = mockApiClient();
    const calls: unknown[] = [];
    const service = new ReplaysService(client, {
      queryFn: async (events, options) => {
        calls.push([events, options]);
        return { series: {} };
      },
    });
    const result = await service.discover({ replayIds: [] });
    expect(result).toStrictEqual([]);
    expect(calls).toHaveLength(0);
  });
});

// =============================================================================
// discover() / events_for() parsing against the REAL Insights series
// =============================================================================

/** `_DISCOVERY_SERIES` (`test_replays_service.py:439-451`). */
const DISCOVERY_SERIES: Record<string, unknown> = {
  "Session Recording Checkpoint [Minimum Time]": {
    $overall: { all: 1779319127 },
    "rid-aaa": {
      $overall: { all: 1779322882 },
      "30": { all: 1779322882 },
    },
    "rid-bbb": {
      $overall: { all: 1779332317 },
      "7": { all: 1779332317 },
    },
  },
};

/** `_DISCOVERY_SERIES_NO_RETENTION` (`:453-461`). */
const DISCOVERY_SERIES_NO_RETENTION: Record<string, unknown> = {
  "Session Recording Checkpoint [Minimum Time]": {
    $overall: { all: 1779319127 },
    "rid-old": { $overall: { all: 1779319127 } },
  },
};

/** `_EVENTS_SERIES` (`:463-482`). */
const EVENTS_SERIES: Record<string, unknown> = {
  "All Events [Total Events]": {
    $overall: { all: 13 },
    "2026-05-21T16:31:31": {
      $overall: { all: 1 },
      $mp_dead_click: {
        $overall: { all: 1 },
        "rid-bab": { all: 1 },
      },
    },
    "2026-05-21T16:31:25": {
      $overall: { all: 12 },
      "Browser API fetch": {
        $overall: { all: 12 },
        "rid-bab": { all: 12 },
      },
    },
  },
};

/** `_EVENTS_SERIES_WITH_PROP` (`:484-498`). */
const EVENTS_SERIES_WITH_PROP: Record<string, unknown> = {
  "All Events [Total Events]": {
    $overall: { all: 1 },
    "2026-05-21T16:31:25": {
      $overall: { all: 1 },
      "Browser API fetch": {
        $overall: { all: 1 },
        "rid-bab": {
          $overall: { all: 1 },
          Chrome: { all: 1 },
        },
      },
    },
  },
};

/** One recorded `queryFn` invocation. */
interface QueryCall {
  readonly events: string;
  readonly options: Readonly<Record<string, unknown>>;
}

/**
 * Build a service whose `queryFn` returns a canned series
 * (`_series_result`, `test_replays_service.py:429-434`).
 *
 * @param series - The `result.series` payload.
 * @param options - `projectId` and the optional warning sink.
 * @returns The service plus the query-call log.
 */
function serviceWithSeries(
  series: Record<string, unknown>,
  options: { projectId?: string; warn?: WarningSink } = {},
): { service: ReplaysService; calls: QueryCall[] } {
  const { client } = mockApiClient(
    options.projectId === undefined ? {} : { projectId: options.projectId },
  );
  const calls: QueryCall[] = [];
  const service = new ReplaysService(client, {
    queryFn: async (events, queryOptions) => {
      calls.push({ events, options: queryOptions });
      return { series };
    },
    ...(options.warn === undefined ? {} : { warn: options.warn }),
  });
  return { service, calls };
}

describe("discover parses the min-time series (TestDiscoverParsing)", () => {
  it("test_one_summary_per_replay", async () => {
    const { service } = serviceWithSeries(DISCOVERY_SERIES, {
      projectId: "3",
    });
    const out = await service.discover({
      distinctId: "u-1",
      fromDate: "2026-05-20",
      toDate: "2026-05-27",
    });
    const byId = new Map(out.map((s) => [s.replay_id, s]));
    expect(new Set(byId.keys())).toStrictEqual(new Set(["rid-aaa", "rid-bbb"]));
    expect(byId.get("rid-aaa")?.retention_days).toBe(30);
    expect(byId.get("rid-bbb")?.retention_days).toBe(7);
    // Leaf is unix seconds; start_time is unix ms.
    expect(byId.get("rid-aaa")?.start_time).toBe(1779322882 * 1000);
    expect(byId.get("rid-aaa")?.distinct_id).toBe("u-1");
    expect(byId.get("rid-aaa")?.project_id).toBe(3);
  });

  it("test_query_uses_min_time_aggregation", async () => {
    const { service, calls } = serviceWithSeries(DISCOVERY_SERIES);
    await service.discover({
      distinctId: "u-1",
      fromDate: "2026-05-20",
      toDate: "2026-05-27",
    });
    const kwargs = calls[0]?.options ?? {};
    expect(kwargs["math"]).toBe("min");
    expect(kwargs["math_property"]).toBe("$time");
    expect(kwargs["group_by"]).toStrictEqual([
      "$mp_replay_id",
      "$mp_replay_retention_period",
    ]);
  });

  it("test_missing_retention_defaults_30_with_warning", async () => {
    const warnings: string[] = [];
    const { service } = serviceWithSeries(DISCOVERY_SERIES_NO_RETENTION, {
      warn: (message) => warnings.push(message),
    });
    const out = await service.discover({
      distinctId: "u-1",
      fromDate: "2026-05-20",
      toDate: "2026-05-27",
    });
    expect(
      warnings.some((w) => w.includes("$mp_replay_retention_period")),
    ).toBe(true);
    expect(out).toHaveLength(1);
    expect(out[0]?.retention_days).toBe(30);
    expect(out[0]?.start_time).toBe(1779319127 * 1000);
  });

  it("test_empty_series_returns_empty", async () => {
    const { service } = serviceWithSeries({});
    expect(
      await service.discover({
        distinctId: "u-1",
        fromDate: "2026-05-20",
        toDate: "2026-05-27",
      }),
    ).toStrictEqual([]);
  });

  it("test_nonstandard_retention_defaults_30_with_warning", async () => {
    const warnings: string[] = [];
    const series: Record<string, unknown> = {
      "Session Recording Checkpoint [Minimum Time]": {
        $overall: { all: 1779319127 },
        "rid-weird": {
          $overall: { all: 1779322882 },
          "15": { all: 1779322882 },
        },
      },
    };
    const { service } = serviceWithSeries(series, {
      warn: (message) => warnings.push(message),
    });
    const out = await service.discover({
      distinctId: "u-1",
      fromDate: "2026-05-20",
      toDate: "2026-05-27",
    });
    expect(
      warnings.some((w) => w.includes("$mp_replay_retention_period")),
    ).toBe(true);
    expect(out).toHaveLength(1);
    expect(out[0]?.retention_days).toBe(30);
    expect(out[0]?.start_time).toBe(1779322882 * 1000);
  });

  it("test_limit_caps_summaries", async () => {
    const { service } = serviceWithSeries(DISCOVERY_SERIES);
    const out = await service.discover({
      distinctId: "u-1",
      fromDate: "2026-05-20",
      toDate: "2026-05-27",
      limit: 1,
    });
    expect(out).toHaveLength(1);
  });

  it("test_default_window_is_90_day_lookback", async () => {
    const { service, calls } = serviceWithSeries({});
    await service.discover({ replayIds: ["rid-aaa"] });
    const kwargs = calls[0]?.options ?? {};
    expect(kwargs["last"]).toBe(90);
    expect(Object.hasOwn(kwargs, "from_date")).toBe(false);
    expect(Object.hasOwn(kwargs, "to_date")).toBe(false);
  });

  it("test_explicit_window_overrides_lookback", async () => {
    const { service, calls } = serviceWithSeries(DISCOVERY_SERIES);
    await service.discover({
      distinctId: "u-1",
      fromDate: "2026-05-20",
      toDate: "2026-05-27",
    });
    const kwargs = calls[0]?.options ?? {};
    expect(kwargs["from_date"]).toBe("2026-05-20");
    expect(kwargs["to_date"]).toBe("2026-05-27");
    expect(Object.hasOwn(kwargs, "last")).toBe(false);
  });

  it("test_missing_retention_warning_has_no_doubled_prefix", async () => {
    const warnings: string[] = [];
    const { service } = serviceWithSeries(DISCOVERY_SERIES_NO_RETENTION, {
      warn: (message) => warnings.push(message),
    });
    await service.discover({
      distinctId: "u-1",
      fromDate: "2026-05-20",
      toDate: "2026-05-27",
    });
    const message = warnings[0] ?? "";
    expect(message.startsWith("UserWarning:")).toBe(false);
    expect(message.startsWith("replay ")).toBe(true);
  });
});

describe("events_for parses the $all_events series (TestEventsForParsing)", () => {
  it("test_returns_time_sorted_events_per_replay", async () => {
    const { service } = serviceWithSeries(EVENTS_SERIES);
    const out = await service.eventsFor(["rid-bab"]);
    expect(new Set(out.keys())).toStrictEqual(new Set(["rid-bab"]));
    const events = out.get("rid-bab") ?? [];
    expect(events.map((e) => e.event_name)).toStrictEqual([
      "Browser API fetch",
      "$mp_dead_click",
    ]);
    expect(events[0]?.event_time).toBeLessThan(events[1]?.event_time ?? 0);
  });

  it("test_event_properties_surface", async () => {
    const { service } = serviceWithSeries(EVENTS_SERIES_WITH_PROP);
    const out = await service.eventsFor(["rid-bab"], {
      eventProperties: ["$browser"],
    });
    expect(out.get("rid-bab")?.[0]?.properties).toStrictEqual({
      $browser: "Chrome",
    });
  });

  it("test_issues_all_events_query_shape", async () => {
    const { service, calls } = serviceWithSeries(EVENTS_SERIES);
    await service.eventsFor(["rid-bab"]);
    expect(calls[0]?.events).toBe("$all_events");
    expect(
      (calls[0]?.options["group_by"] as readonly string[]).slice(0, 3),
    ).toStrictEqual(["$time", "$event_name", "$mp_replay_id"]);
  });

  it("test_empty_series_returns_empty_dict", async () => {
    const { service } = serviceWithSeries({});
    expect((await service.eventsFor(["rid-bab"])).size).toBe(0);
  });

  it("test_default_window_is_90_day_lookback", async () => {
    const { service, calls } = serviceWithSeries({});
    await service.eventsFor(["rid-bab"]);
    const kwargs = calls[0]?.options ?? {};
    expect(kwargs["last"]).toBe(90);
    expect(Object.hasOwn(kwargs, "from_date")).toBe(false);
    expect(Object.hasOwn(kwargs, "to_date")).toBe(false);
  });

  it("test_explicit_window_overrides_lookback", async () => {
    const { service, calls } = serviceWithSeries({});
    await service.eventsFor(["rid-bab"], {
      fromDate: "2026-05-20",
      toDate: "2026-05-21",
    });
    const kwargs = calls[0]?.options ?? {};
    expect(kwargs["from_date"]).toBe("2026-05-20");
    expect(kwargs["to_date"]).toBe("2026-05-21");
    expect(Object.hasOwn(kwargs, "last")).toBe(false);
  });
});

// =============================================================================
// B5-ARB FID-F3 (additive — `b5-review-resolution.md`): the walker's
// per-file sort key is Python `int(e.get("timestamp", 0))` — an ABSENT
// key defaults to 0, an explicit `null` raises `TypeError` (CPython
// probe), and `sorted(key=...)` computes the key even for single-element
// files, where a bare JS comparator would never run.
// =============================================================================

describe("FID-F3: walker per-file sort key null vs absent timestamps", () => {
  it("an explicit null timestamp in a single-event file raises TypeError", async () => {
    const fileContents = new Map<
      number,
      ReadonlyArray<Record<string, unknown>> | null
    >([
      [0, [{ type: 3, data: {}, timestamp: null }]],
      [1, null],
    ]);
    const { client } = mockApiClient();
    const service = new ReplaysService(client, {
      fetchImpl: cdnFetch(makeCdnHandler({ fileContents })),
    });

    await expect(
      service.fetchFiles(signedFixture(), {
        retentionDays: 30,
        maxFiles: 500,
        concurrency: 50,
      }),
    ).rejects.toThrow(
      /int\(\) argument must be a string, a bytes-like object or a real number, not 'NoneType'/,
    );
  });

  it("an absent timestamp key defaults to 0 and sorts first", async () => {
    const fileContents = new Map<
      number,
      ReadonlyArray<Record<string, unknown>> | null
    >([
      [0, [rrwebEvent(20), { type: 3, data: {} }]],
      [1, null],
    ]);
    const { client } = mockApiClient();
    const service = new ReplaysService(client, {
      fetchImpl: cdnFetch(makeCdnHandler({ fileContents })),
    });

    const events = await service.fetchFiles(signedFixture(), {
      retentionDays: 30,
      maxFiles: 500,
      concurrency: 50,
    });
    expect(events.map((e) => e["timestamp"])).toStrictEqual([undefined, 20]);
  });
});
