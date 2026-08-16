// Dedicated async Layer-3 for B4-C6 (packet C6 §Layer-3 last row —
// "Dedicated async Layer-3 (plan §7): delayed mock pages, abort
// between pages, abort during backoff sleep").
//
// These are TS-native locks (no Python source test to translate —
// Python's synchronous iterator has no cancellation surface; R6.7
// prescribes the AbortSignal contract these tests pin: all four
// points, every exit normalized to `DOMException(..., 'AbortError')`).
import { describe, expect, it } from "vitest";
import { createMixpanelClient } from "../../src/client/client.js";
import { paginateAll } from "../../src/client/pagination.js";
import { toNativeJson } from "../../src/client/json-value.js";
import {
  createMockClient,
  makeSession,
  staticTokenResolver,
  type CannedResponse,
} from "./client-test-helpers.js";

/** One canned page body with the given ids and cursor. */
function page(ids: number[], nextCursor: string | null): CannedResponse {
  return {
    status: 200,
    json: {
      status: "ok",
      results: ids.map((id) => ({ id })),
      pagination: { page_size: ids.length, next_cursor: nextCursor },
    },
  };
}

/** Whether a rejection is the normalized R6.7 AbortError. */
function isAbortError(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === "AbortError";
}

describe("PaginationAsyncBehavior", () => {
  it("delayed mock pages: laziness across real await points", async () => {
    // Each response resolves on a macrotask boundary; the walk must
    // still deliver pages strictly in cursor order, one request per
    // page, with no page fetched before the previous page's items were
    // consumed (R6.1 laziness).
    const requestsAtYield: number[] = [];
    let requestCount = 0;
    const delayedFetch = (async (
      input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      const request = new Request(input, init);
      requestCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 1));
      const cursor = new URL(request.url).searchParams.get("cursor");
      const body =
        cursor === null
          ? page([1], "c2")
          : cursor === "c2"
            ? page([2], "c3")
            : page([3], null);
      return new Response(JSON.stringify(body.json), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    const client = createMixpanelClient({
      session: makeSession(),
      fetch: delayedFetch,
      tokenResolver: staticTokenResolver(),
    });
    const items: unknown[] = [];
    for await (const item of paginateAll(client, "/projects/12345/items")) {
      items.push(toNativeJson(item));
      requestsAtYield.push(requestCount);
    }
    expect(items).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    // Page N+1 is not requested until page N's item was yielded.
    expect(requestsAtYield).toEqual([1, 2, 3]);
  });

  it("abort between pages rejects with a normalized AbortError", async () => {
    const controller = new AbortController();
    const { client, transport } = createMockClient(
      makeSession(),
      (): CannedResponse => page([1], "next"),
    );
    const walk = paginateAll(client, "/projects/12345/items", {
      signal: controller.signal,
    });
    const first = await walk.next();
    expect(toNativeJson(first.value ?? null)).toEqual({ id: 1 });
    // Abort while parked between pages (R6.7 point 1) — the next pull
    // must reject BEFORE issuing another request.
    controller.abort();
    let raised: unknown = null;
    try {
      await walk.next();
    } catch (cause) {
      raised = cause;
    }
    expect(isAbortError(raised)).toBe(true);
    expect(transport.captures).toHaveLength(1);
  });

  it("abort during the backoff sleep rejects with a normalized AbortError", async () => {
    const controller = new AbortController();
    let sleepEntered = 0;
    const { transport } = createMockClient(
      makeSession(),
      (): CannedResponse => ({
        status: 429,
        json: { error: "rate_limited" },
      }),
    );
    // A dedicated client whose sleep seam aborts mid-wait (the
    // createMockClient sleep is fixed at zero-delay).
    const abortingClient = createMixpanelClient({
      session: makeSession(),
      fetch: transport.fetch,
      sleep: (ms: number): Promise<void> => {
        sleepEntered += 1;
        controller.abort();
        return new Promise((resolve) => setTimeout(resolve, Math.min(ms, 5)));
      },
      random: () => 0,
      tokenResolver: staticTokenResolver(),
    });
    let raised: unknown = null;
    try {
      for await (const item of paginateAll(
        abortingClient,
        "/projects/12345/items",
        { signal: controller.signal },
      )) {
        void item;
      }
    } catch (cause) {
      raised = cause;
    }
    expect(isAbortError(raised)).toBe(true);
    // Exactly one 429 request, one sleep entered — the abort landed in
    // the backoff wait (R6.7 point 3), not after another attempt.
    expect(sleepEntered).toBe(1);
    expect(transport.captures).toHaveLength(1);
  });

  it("early return() closes the generator without another request", async () => {
    const { client, transport } = createMockClient(
      makeSession(),
      (): CannedResponse => page([1, 2], "more"),
    );
    const walk = paginateAll(client, "/projects/12345/items");
    const first = await walk.next();
    expect(first.done).toBe(false);
    // AsyncIterable early-return (the `for await ... break` path): the
    // generator finishes and no further page is fetched.
    const closed = await walk.return();
    expect(closed.done).toBe(true);
    const after = await walk.next();
    expect(after.done).toBe(true);
    expect(transport.captures).toHaveLength(1);
  });
});
