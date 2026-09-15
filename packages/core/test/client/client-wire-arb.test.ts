// B4-ARB resolution locks (b4-review-resolution.md) — TS-native tests
// pinning the four wire-review fixes applied at arbitration:
//
// - W-F1: exportEvents mid-stream body-read failures are inside the
//   `except httpx.HTTPError` scope (api_client.py:1870-1953) — they
//   retry, then wrap as HTTP_ERROR.
// - W-F2: `timeoutSeconds` is ENFORCED at the fetch adapter — a hung
//   server fails like httpx's Timeout (an httpx.HTTPError → retried →
//   HTTP_ERROR), and the clock covers the headers phase + buffered body
//   read; a streaming body is NOT clock-bounded after headers
//   (deviation D-B4ARB-1: httpx read-timeouts are per-read, so a
//   healthy long-running export must not be killed by a total clock).
// - W-F3: a custom abort reason (controller.abort("user-stop")) exits
//   the request point as DOMException name "AbortError" (R6.7).
// - W-F5: export_profiles threads `session_id` into the next page's
//   JSON body VERBATIM (api_client.py:2105 — `response.get` value, not
//   a stringification).
//
// (W-F4, the pagination `except Exception` scope, is locked in
// pagination.test.ts alongside the other INVALID_RESPONSE tests.)
import { describe, expect, it } from "vitest";

import { createMixpanelClient } from "../../src/client/client.js";
import type { JsonValue } from "../../src/client/json-value.js";
import { MixpanelHeadlessError } from "../../src/errors.js";
import {
  createMockClient,
  makeSession,
  staticTokenResolver,
} from "../../test-support/client-test-helpers.js";

/** Drain an async generator into an array (`list(...)`). */
async function drain<T>(source: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of source) {
    out.push(item);
  }
  return out;
}

/** Read the `event` member of a yielded export line. */
function eventName(value: unknown): unknown {
  return (value as { event?: unknown }).event;
}

/** Assemble a client over an arbitrary fetch with recorded sleeps. */
function clientOver(
  fetchImpl: typeof fetch,
  extra: {
    maxRetries?: number;
    timeoutSeconds?: number;
    exportTimeoutSeconds?: number;
  } = {},
): {
  client: ReturnType<typeof createMixpanelClient>;
  sleeps: number[];
} {
  const sleeps: number[] = [];
  const client = createMixpanelClient({
    session: makeSession(),
    fetch: fetchImpl,
    sleep: async (ms: number): Promise<void> => {
      sleeps.push(ms);
    },
    random: () => 0,
    tokenResolver: staticTokenResolver(),
    ...extra,
  });
  return { client, sleeps };
}

/** A fetch whose response body errors after `lines` complete lines. */
function brokenBodyFetch(
  lines: readonly string[],
  failure: () => unknown,
  options: { failForever?: boolean; goodBody?: string } = {},
): { fetchImpl: typeof fetch; calls: () => number } {
  const encoder = new TextEncoder();
  let calls = 0;
  const fetchImpl = (async (): Promise<Response> => {
    calls += 1;
    if (options.failForever !== true && calls > 1) {
      return new Response(encoder.encode(options.goodBody ?? lines.join("")), {
        status: 200,
      });
    }
    // Deliver the good lines across pulls, THEN error: erroring a
    // stream discards its queue, so the error must wait for the reads.
    // Fresh per attempt — every failing attempt re-streams its lines.
    const pending = [...lines];
    const body = new ReadableStream<Uint8Array>({
      pull(controller): void {
        const next = pending.shift();
        if (next !== undefined) {
          controller.enqueue(encoder.encode(next));
          return;
        }
        controller.error(failure());
      },
    });
    return new Response(body, { status: 200 });
  }) as typeof fetch;
  return { fetchImpl, calls: () => calls };
}

/** A fetch that never settles until its signal aborts (hung server). */
function hangingFetch(): { fetchImpl: typeof fetch; calls: () => number } {
  let calls = 0;
  const fetchImpl = (async (
    _input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    calls += 1;
    const signal = init?.signal ?? null;
    return new Promise<Response>((_resolve, reject) => {
      if (signal === null) {
        return; // hang forever (no signal ever supplied — test fails by timeout)
      }
      if (signal.aborted) {
        reject(signal.reason);
        return;
      }
      signal.addEventListener(
        "abort",
        () => {
          reject(signal.reason);
        },
        { once: true },
      );
    });
  }) as typeof fetch;
  return { fetchImpl, calls: () => calls };
}

/** A fetch serving one streamed response with real delays per chunk. */
function slowChunkFetch(
  chunks: readonly string[],
  delayMs: number,
): typeof fetch {
  const encoder = new TextEncoder();
  const remaining = [...chunks];
  return async (): Promise<Response> => {
    const body = new ReadableStream<Uint8Array>({
      async pull(controller): Promise<void> {
        if (remaining.length === 0) {
          controller.close();
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        controller.enqueue(encoder.encode(remaining.shift()));
        if (remaining.length === 0) {
          controller.close();
        }
      },
    });
    return new Response(body, { status: 200 });
  };
}

describe("W-F1: mid-stream body failures retry inside the httpx.HTTPError scope", () => {
  it("retries a body-read failure and re-streams (Python re-yields)", async () => {
    const line = '{"event":"A","properties":{"time":1}}\n';
    const good =
      '{"event":"A","properties":{"time":1}}\n' +
      '{"event":"B","properties":{"time":2}}\n';
    const { fetchImpl, calls } = brokenBodyFetch(
      [line],
      () => new TypeError("terminated"),
      { goodBody: good },
    );
    const { client, sleeps } = clientOver(fetchImpl);
    const events = await drain(client.exportEvents("2024-01-01", "2024-01-31"));
    // Attempt 1 yields A then dies mid-body; attempt 2 re-streams A, B —
    // the duplicate is Python's exact observable (generator re-entry).
    expect(events.map(eventName)).toEqual(["A", "A", "B"]);
    expect(calls()).toBe(2);
    expect(sleeps).toEqual([1000]); // _calculate_backoff(0), random=0.
  });

  it("wraps an exhausted mid-stream failure as HTTP_ERROR", async () => {
    const { fetchImpl, calls } = brokenBodyFetch(
      ['{"event":"A","properties":{}}\n'],
      () => new TypeError("terminated"),
      { failForever: true },
    );
    const { client } = clientOver(fetchImpl, { maxRetries: 1 });
    let caught: unknown;
    try {
      await drain(client.exportEvents("2024-01-01", "2024-01-31"));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(MixpanelHeadlessError);
    expect((caught as MixpanelHeadlessError).code).toBe("HTTP_ERROR");
    expect((caught as MixpanelHeadlessError).message).toContain(
      "HTTP error during export:",
    );
    expect(calls()).toBe(2); // initial + 1 retry
  });
});

describe("W-F2: request timeouts are enforced at the adapter", () => {
  it("times out a hung buffered request and wraps as HTTP_ERROR", async () => {
    const { fetchImpl, calls } = hangingFetch();
    const { client } = clientOver(fetchImpl, {
      maxRetries: 0,
      timeoutSeconds: 0.02,
    });
    let caught: unknown;
    try {
      await client.request("GET", "https://mixpanel.com/api/app/test");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(MixpanelHeadlessError);
    expect((caught as MixpanelHeadlessError).code).toBe("HTTP_ERROR");
    expect((caught as MixpanelHeadlessError).message).toContain("timed out");
    expect(calls()).toBe(1);
  });

  it("times out a hung export stream (export_timeout) and wraps as HTTP_ERROR", async () => {
    const { fetchImpl } = hangingFetch();
    const { client } = clientOver(fetchImpl, {
      maxRetries: 0,
      exportTimeoutSeconds: 0.02,
    });
    let caught: unknown;
    try {
      await drain(client.exportEvents("2024-01-01", "2024-01-31"));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(MixpanelHeadlessError);
    expect((caught as MixpanelHeadlessError).code).toBe("HTTP_ERROR");
    expect((caught as MixpanelHeadlessError).message).toContain(
      "HTTP error during export:",
    );
  });

  it("does NOT clock-bound a healthy streaming body (D-B4ARB-1)", async () => {
    // Two chunks, each behind a 30ms real delay: total wall time far
    // exceeds the 20ms export timeout, but the clock stops at headers.
    const fetchImpl = slowChunkFetch(
      ['{"event":"A","properties":{}}\n', '{"event":"B","properties":{}}\n'],
      30,
    );
    const { client } = clientOver(fetchImpl, {
      maxRetries: 0,
      exportTimeoutSeconds: 0.02,
    });
    const events = await drain(client.exportEvents("2024-01-01", "2024-01-31"));
    expect(events.map(eventName)).toEqual(["A", "B"]);
  });
});

describe("W-F3: custom abort reasons exit the request point as AbortError", () => {
  it("controller.abort('user-stop') rejects as DOMException AbortError", async () => {
    const { fetchImpl } = hangingFetch();
    const { client } = clientOver(fetchImpl, { maxRetries: 0 });
    const controller = new AbortController();
    queueMicrotask(() => {
      controller.abort("user-stop");
    });
    let caught: unknown;
    try {
      await client.request("GET", "https://mixpanel.com/api/app/test", {
        signal: controller.signal,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(DOMException);
    expect((caught as DOMException).name).toBe("AbortError");
  });
});

describe("W-F5: export_profiles threads session_id verbatim", () => {
  it("a numeric session_id round-trips as a JSON number, not a string", async () => {
    const { client, transport } = createMockClient(makeSession(), (request) => {
      const body =
        request.bodyText === ""
          ? {}
          : (JSON.parse(request.bodyText) as Record<string, unknown>);
      if (!Object.hasOwn(body, "session_id")) {
        return {
          status: 200,
          json: {
            results: [{ $distinct_id: "u1", $properties: {} }],
            session_id: 123,
          },
        };
      }
      return { status: 200, json: { results: [], session_id: null } };
    });
    const profiles: JsonValue[] = await drain(client.exportProfiles());
    expect(profiles).toHaveLength(1);
    expect(transport.captures).toHaveLength(2);
    const secondBody = JSON.parse(
      transport.captures[1]?.bodyText ?? "{}",
    ) as Record<string, unknown>;
    // Python: `params["session_id"] = response.get("session_id")` — the
    // int stays an int in the next page's JSON body.
    expect(secondBody["session_id"]).toBe(123);
    expect(secondBody["page"]).toBe(1);
  });
});
