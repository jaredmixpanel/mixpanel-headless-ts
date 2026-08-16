// Dedicated async Layer-3 for B4-C2 (packet C2 §Layer-3 last row —
// "NEW Vitest suites: streaming chunk behavior across await points,
// retry timing in the export 429 loop, AsyncIterable early-return()"),
// plus the `stream_events`/`stream_profiles` facade-wrapper locks (the
// 3 B4 api-map members land in this shard; the B6 facade re-locks them
// end-to-end when `Workspace` arrives).
//
// These are TS-native locks (no Python source test to translate — the
// corpus records full-body `body_text` streams, so chunk-boundary and
// cancellation behavior is Layer-3's job per the packet's
// expectation-shape note).
import { describe, expect, it } from "vitest";
import { createMixpanelClient } from "../../src/client/client.js";
import { ParamValidationError } from "../../src/errors.js";
import type { JsonValue } from "../../src/client/json-value.js";
import {
  streamEvents,
  streamProfiles,
} from "../../src/services/queries/streaming.js";
import { makeSession, staticTokenResolver } from "./client-test-helpers.js";

/** Build a fetch serving one streamed response from explicit chunks. */
function chunkedFetch(
  chunks: readonly string[],
  options: { status?: number; delayMs?: number } = {},
): typeof fetch {
  const encoder = new TextEncoder();
  return (async (
    _input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const signal = init?.signal ?? null;
    if (signal?.aborted === true) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }
    const body = new ReadableStream<Uint8Array>({
      async pull(controller): Promise<void> {
        if (chunks.length === 0) {
          controller.close();
          return;
        }
        const next = chunks[0] as string;
        (chunks as string[]).shift();
        if (options.delayMs !== undefined) {
          // A real await point BETWEEN chunks — the consumer must
          // reassemble lines split across it.
          await new Promise((resolve) => setTimeout(resolve, options.delayMs));
        }
        controller.enqueue(encoder.encode(next));
        if (chunks.length === 0) {
          controller.close();
        }
      },
    });
    return new Response(body, { status: options.status ?? 200 });
  }) as typeof fetch;
}

/** Assemble a client over an arbitrary fetch with recorded sleeps. */
function clientOver(
  fetchImpl: typeof fetch,
  maxRetries = 3,
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
    maxRetries,
  });
  return { client, sleeps };
}

/** Read the `event` member of a yielded export line. */
function eventName(value: unknown): unknown {
  return (value as { event?: unknown }).event;
}

describe("streaming chunk behavior across await points", () => {
  it("reassembles a line split across delayed chunks", async () => {
    const fetchImpl = chunkedFetch(
      [
        '{"event":"A","prop',
        'erties":{"time":1}}\n{"event":"B","properties":{"time":2}}\n',
      ],
      { delayMs: 1 },
    );
    const { client } = clientOver(fetchImpl);
    const events: JsonValue[] = [];
    for await (const event of client.exportEvents("2024-01-01", "2024-01-31")) {
      events.push(event);
    }
    expect(events).toHaveLength(2);
    expect(eventName(events[0])).toBe("A");
    expect(eventName(events[1])).toBe("B");
  });

  it("yields items lazily — one event available before the stream closes", async () => {
    const fetchImpl = chunkedFetch(
      ['{"event":"A","properties":{}}\n', '{"event":"B","properties":{}}\n'],
      { delayMs: 1 },
    );
    const { client } = clientOver(fetchImpl);
    const iterator = client.exportEvents("2024-01-01", "2024-01-31");
    const first = await iterator.next();
    expect(first.done).toBe(false);
    expect(eventName(first.value)).toBe("A");
    await iterator.return();
  });
});

describe("AsyncIterable early return (abort between yields)", () => {
  it("return() finishes the generator without draining the stream", async () => {
    const fetchImpl = chunkedFetch([
      '{"event":"A","properties":{}}\n{"event":"B","properties":{}}\n',
    ]);
    const { client } = clientOver(fetchImpl);
    const iterator = client.exportEvents("2024-01-01", "2024-01-31");
    const first = await iterator.next();
    expect(eventName(first.value)).toBe("A");
    const closed = await iterator.return();
    expect(closed.done).toBe(true);
    const after = await iterator.next();
    expect(after.done).toBe(true);
  });
});

describe("retry timing in the export 429 loop", () => {
  it("honors a positive Retry-After through the ms sleep seam", async () => {
    let calls = 0;
    const encoder = new TextEncoder();
    const fetchImpl = (async (): Promise<Response> => {
      calls += 1;
      if (calls === 1) {
        return new Response(null, {
          status: 429,
          headers: { "Retry-After": "5" },
        });
      }
      return new Response(encoder.encode('{"event":"A","properties":{}}\n'), {
        status: 200,
      });
    }) as typeof fetch;
    const { client, sleeps } = clientOver(fetchImpl);
    const events: JsonValue[] = [];
    for await (const event of client.exportEvents("2024-01-01", "2024-01-31")) {
      events.push(event);
    }
    expect(events).toHaveLength(1);
    expect(sleeps).toEqual([5000]); // header path, unjittered, R2.12 ms.
  });

  it("normalizes an abort during the backoff sleep to AbortError", async () => {
    const controller = new AbortController();
    let calls = 0;
    const fetchImpl = (async (): Promise<Response> => {
      calls += 1;
      return new Response(null, { status: 429 });
    }) as typeof fetch;
    const sleeps: number[] = [];
    const client = createMixpanelClient({
      session: makeSession(),
      fetch: fetchImpl,
      sleep: (ms: number): Promise<void> => {
        sleeps.push(ms);
        // A never-resolving sleep: only the abort can end the wait.
        queueMicrotask(() => controller.abort());
        return new Promise<void>(() => {
          /* pending forever */
        });
      },
      random: () => 0,
      tokenResolver: staticTokenResolver(),
      maxRetries: 3,
    });
    let caught: unknown;
    try {
      for await (const event of client.exportEvents(
        "2024-01-01",
        "2024-01-31",
        { signal: controller.signal },
      )) {
        void event; // unreachable
      }
    } catch (exc) {
      caught = exc;
    }
    expect(caught).toBeInstanceOf(DOMException);
    expect((caught as DOMException).name).toBe("AbortError");
    expect(calls).toBe(1);
    expect(sleeps).toHaveLength(1);
  });
});

describe("stream_events / stream_profiles facade wrappers", () => {
  it("raw=true yields undecoded (untransformed) events", async () => {
    const fetchImpl = chunkedFetch([
      '{"event":"A","properties":{"time":1,"distinct_id":"u1"}}\n',
    ]);
    const { client } = clientOver(fetchImpl);
    const out: unknown[] = [];
    for await (const event of streamEvents(client, {
      from_date: "2024-01-01",
      to_date: "2024-01-31",
      raw: true,
    })) {
      out.push(event);
    }
    expect(out).toHaveLength(1);
    expect(eventName(out[0])).toBe("A");
  });

  it("normalizes events via transformEvent (injected uuid seam)", async () => {
    const fetchImpl = chunkedFetch([
      '{"event":"Sign Up","properties":{"time":1704067200,"distinct_id":"u1","plan":"pro"}}\n',
    ]);
    const { client } = clientOver(fetchImpl);
    const out: Array<Record<string, unknown>> = [];
    for await (const event of streamEvents(client, {
      from_date: "2024-01-01",
      to_date: "2024-01-31",
      uuid: () => "fixed-uuid",
    })) {
      out.push(event as Record<string, unknown>);
    }
    expect(out).toHaveLength(1);
    const transformed = out[0] as Record<string, unknown>;
    expect(transformed["event_name"]).toBe("Sign Up");
    expect(transformed["distinct_id"]).toBe("u1");
    expect(transformed["insert_id"]).toBe("fixed-uuid");
    expect(transformed["properties"]).toEqual({ plan: "pro" });
  });

  it("validates limit lazily with the WR2/WR3 codes", async () => {
    const { client } = clientOver(chunkedFetch([]));
    for (const [limit, code] of [
      [0, "WR2_LIMIT_TOO_SMALL"],
      [100001, "WR3_LIMIT_TOO_LARGE"],
    ] as const) {
      const iterator = streamEvents(client, {
        from_date: "2024-01-01",
        to_date: "2024-01-31",
        limit,
      });
      let caught: unknown;
      try {
        await iterator.next();
      } catch (exc) {
        caught = exc;
      }
      expect(caught).toBeInstanceOf(ParamValidationError);
      expect((caught as ParamValidationError).code).toBe(code);
    }
  });

  it("normalizes profiles via transformProfile", async () => {
    const fetchImpl = (async (): Promise<Response> =>
      new Response(
        JSON.stringify({
          results: [
            {
              $distinct_id: "u1",
              $properties: { $last_seen: "2024-01-15T10:30:00", plan: "pro" },
            },
          ],
          session_id: null,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as typeof fetch;
    const { client } = clientOver(fetchImpl);
    const out: Array<Record<string, unknown>> = [];
    for await (const profile of streamProfiles(client)) {
      out.push(profile as Record<string, unknown>);
    }
    expect(out).toHaveLength(1);
    expect(out[0]?.["distinct_id"]).toBe("u1");
    expect(out[0]?.["last_seen"]).toBe("2024-01-15T10:30:00");
    expect(out[0]?.["properties"]).toEqual({ plan: "pro" });
  });
});
