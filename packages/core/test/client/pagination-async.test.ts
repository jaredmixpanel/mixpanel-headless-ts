// TS-only async behaviour of `paginateAll`: laziness across real await
// points (page N+1 is not requested before page N's items are consumed),
// abort between pages and during the backoff sleep (every exit normalised
// to `DOMException("AbortError")`), and early `return()`. No Python source
// suite: the synchronous Python iterator has no cancellation surface.
import { describe, expect, it } from "vitest";

import { createMixpanelClient } from "../../src/client/client.js";
import { toNativeJson } from "../../src/client/json-value.js";
import { paginateAll } from "../../src/client/pagination.js";
import {
  type CannedResponse,
  createMockClient,
  drain,
  makeSession,
  staticTokenResolver,
} from "../../test-support/client-test-helpers.js";

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

/** Whether a rejection is the normalized AbortError. */
function isAbortError(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === "AbortError";
}

describe("paginateAll async behaviour", () => {
  it("delayed mock pages: laziness across real await points", async () => {
    // Each response resolves on a macrotask boundary; the walk must
    // still deliver pages strictly in cursor order, one request per
    // page, with no page fetched before the previous page's items were
    // consumed (laziness).
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
      let body: ReturnType<typeof page>;
      if (cursor === null) {
        body = page([1], "c2");
      } else if (cursor === "c2") {
        body = page([2], "c3");
      } else {
        body = page([3], null);
      }
      return Response.json(body.json, {
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
    expect(items).toStrictEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    // Page N+1 is not requested until page N's item was yielded.
    expect(requestsAtYield).toStrictEqual([1, 2, 3]);
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
    expect(toNativeJson(first.value ?? null)).toStrictEqual({ id: 1 });
    // Abort while parked between pages — the next pull
    // must reject BEFORE issuing another request.
    controller.abort();
    let raised: unknown = null;
    try {
      await walk.next();
    } catch (error) {
      raised = error;
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
      await drain(
        paginateAll(abortingClient, "/projects/12345/items", {
          signal: controller.signal,
        }),
      );
    } catch (error) {
      raised = error;
    }
    expect(isAbortError(raised)).toBe(true);
    // Exactly one 429 request, one sleep entered — the abort landed in
    // the backoff wait, not after another attempt.
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
