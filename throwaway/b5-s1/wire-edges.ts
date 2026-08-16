/**
 * B5-S1 R10.9 harness, part 2 — the WIRE edge set (packet §4 "R10.9
 * harness spec (S1)").
 *
 * The DiscoveryService members are wire-kind (no oracle family), so the
 * mandated edge set runs through canned responses on the injected fetch
 * seam: empty lists, non-BMP names, integral floats through
 * parseLossless, cache hit/miss/clear sequences, the uncached
 * `list_top_events`, schema-graph density/force-refresh, and EVERY
 * error branch reachable through the delegates (code passthrough, not
 * re-handling).
 *
 *     npx vite-node throwaway/b5-s1/wire-edges.ts
 */

import {
  createMockClient,
  makeSession,
  type CannedResponse,
  type CapturedFetchRequest,
} from "../../packages/core/test/client/client-test-helpers.js";
import { DiscoveryService } from "../../packages/core/src/services/discovery.js";
import { KeyError } from "../../packages/core/src/query/python-builtins.js";

let checks = 0;
let failures = 0;

/**
 * Record one expectation.
 *
 * @param label - What is being checked.
 * @param actual - The observed value (JSON-compared).
 * @param expected - The expected value.
 */
function check(label: string, actual: unknown, expected: unknown): void {
  checks += 1;
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    failures += 1;
    console.log(`FAIL ${label}\n  actual   ${a}\n  expected ${b}`);
  }
}

/**
 * Run a thunk and return the thrown error's class name (or `null`).
 *
 * @param fn - The thunk.
 * @returns The class name, or `null` when it resolved.
 */
async function thrown(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (error) {
    return (error as Error).constructor.name;
  }
}

/** Build a service over a canned handler plus its call counter. */
function svc(handler: (r: CapturedFetchRequest) => CannedResponse): {
  service: DiscoveryService;
  calls: { n: number };
} {
  const calls = { n: 0 };
  const { client } = createMockClient(makeSession(), (request) => {
    calls.n += 1;
    return handler(request);
  });
  return { service: new DiscoveryService(client), calls };
}

const NON_BMP = "\u{1D4B3}";

async function main(): Promise<void> {
  // --- empty collections through every list member -----------------
  {
    const a = svc(() => ({ status: 200, json: [] }));
    check("events/empty", await a.service.listEvents(), []);
    const b = svc(() => ({ status: 200, json: {} }));
    check("properties/empty", await b.service.listProperties("E"), []);
    const c = svc(() => ({ status: 200, json: [] }));
    check("propertyValues/empty", await c.service.listPropertyValues("p"), []);
    const d = svc(() => ({ status: 200, json: [] }));
    check("funnels/empty", await d.service.listFunnels(), []);
    const e = svc(() => ({ status: 200, json: [] }));
    check("cohorts/empty", await e.service.listCohorts(), []);
    const f = svc(() => ({ status: 200, json: { results: [] } }));
    check("bookmarks/empty", await f.service.listBookmarks(), []);
    const g = svc(() => ({ status: 200, json: { events: [] } }));
    check("topEvents/empty", await g.service.listTopEvents(), []);
    const h = svc(() => ({ status: 200, json: { results: [] } }));
    check("schemas/empty", await h.service.listSchemas(), []);
    const i = svc(() => ({ status: 200, json: [] }));
    check("subproperties/empty", await i.service.listSubproperties("cart"), []);
  }

  // --- non-BMP + code-point sorting --------------------------------
  {
    const a = svc(() => ({
      status: 200,
      json: [NON_BMP, "｡", "b", ""],
    }));
    // Python `sorted`: "" < "b" < U+FF61 < U+1D4B3 (code points).
    check("events/non-bmp sort", await a.service.listEvents(), [
      "",
      "b",
      "｡",
      NON_BMP,
    ]);
    const b = svc(() => ({
      status: 200,
      json: [
        { funnel_id: 1, name: NON_BMP },
        { funnel_id: 2, name: "｡" },
      ],
    }));
    check(
      "funnels/non-bmp sort",
      (await b.service.listFunnels()).map((f) => f.name),
      ["｡", NON_BMP],
    );
  }

  // --- integral floats through parseLossless -----------------------
  {
    const a = svc(() => ({
      status: 200,
      text: '{"events": [{"event": "E", "amount": 18.0, "percent_change": 1.5}]}',
      headers: { "content-type": "application/json" },
    }));
    const top = await a.service.listTopEvents();
    check("topEvents/18.0 count", top[0]?.count, 18);
    check("topEvents/1.5 change", top[0]?.percent_change, 1.5);

    const b = svc(() => ({
      status: 200,
      text: '[{"funnel_id": 18.0, "name": "F"}]',
      headers: { "content-type": "application/json" },
    }));
    check("funnels/18.0 id", (await b.service.listFunnels())[0]?.funnel_id, 18);

    const c = svc(() => ({
      status: 200,
      json: [JSON.stringify({ Price: 18.0 }), JSON.stringify({ Price: 18 })],
    }));
    const subs = await c.service.listSubproperties("cart");
    // CPython dedupes 18.0 and 18 in the `seen` set (one sample).
    check("subproperties/18.0 dedupe", subs[0]?.sample_values, [18]);
    check("subproperties/18.0 type", subs[0]?.type, "number");
  }

  // --- cache hit / miss / clear ------------------------------------
  {
    const a = svc(() => ({ status: 200, json: ["e"] }));
    await a.service.listEvents();
    await a.service.listEvents();
    check("events/cache hit", a.calls.n, 1);
    await a.service.listEvents({ limit: 1 });
    check("events/cache miss on new triple", a.calls.n, 2);
    a.service.clearCache();
    await a.service.listEvents();
    check("events/cache clear", a.calls.n, 3);

    const b = svc(() => ({ status: 200, json: { events: [] } }));
    await b.service.listTopEvents();
    await b.service.listTopEvents();
    check("topEvents/uncached", b.calls.n, 2);

    const c = svc(() => ({ status: 200, json: { results: [] } }));
    await c.service.listBookmarks();
    await c.service.listBookmarks();
    check("bookmarks/uncached", c.calls.n, 2);

    const d = svc(() => ({
      status: 200,
      json: { status: "ok", results: { properties: {} } },
    }));
    await d.service.getSchema("event", "A");
    await d.service.getSchema("event", "A");
    await d.service.getSchema("event", "B");
    check("getSchema/cache per name", d.calls.n, 2);

    const e = svc(() => ({ status: 200, json: ["v"] }));
    await e.service.listPropertyValues("p", { event: "X", limit: 5 });
    await e.service.listPropertyValues("p", { event: "X", limit: 5 });
    await e.service.listPropertyValues("p", { event: "X", limit: 6 });
    check("propertyValues/cache per triple", e.calls.n, 2);

    // The returned list is a COPY: mutating it must not poison the cache.
    const f = svc(() => ({ status: 200, json: ["a", "b"] }));
    const first = await f.service.listEvents();
    first.push("MUTATED");
    check("events/copy-on-return", await f.service.listEvents(), ["a", "b"]);
  }

  // --- schema graph: density / user properties / force refresh ------
  {
    const calls: Array<Record<string, string>> = [];
    const { client } = createMockClient(makeSession(), (request) => {
      calls.push({ ...request.params });
      return { status: 200, json: [] };
    });
    const service = new DiscoveryService(client);
    await service.getSchemaGraph();
    check("schemaGraph/3 calls by default", calls.length, 3);
    check(
      "schemaGraph/no density by default",
      calls[1]?.["includeDensity"],
      undefined,
    );
    check("schemaGraph/user pass", calls[2]?.["resourceType"], "User");
    await service.getSchemaGraph();
    check("schemaGraph/cached", calls.length, 3);
    await service.getSchemaGraph({ force_refresh: true });
    check("schemaGraph/force_refresh", calls.length, 6);
    await service.getSchemaGraph({
      include_density: true,
      include_user_properties: false,
    });
    check("schemaGraph/density on", calls[7]?.["includeDensity"], "true");
    check("schemaGraph/2 calls without user props", calls.length, 8);
    const result = await service.getSchemaGraph({
      include_user_properties: false,
    });
    check("schemaGraph/params echo", result.params, {
      include_density: false,
      include_user_properties: false,
    });
  }

  // --- listBookmarks response shapes --------------------------------
  {
    const a = svc(() => ({
      status: 200,
      json: {
        results: [
          {
            id: 1,
            name: "R",
            type: "insights",
            project_id: 2,
            created: "c",
            modified: "m",
          },
        ],
      },
    }));
    check("bookmarks/flat", (await a.service.listBookmarks()).length, 1);
    const b = svc(() => ({
      status: 200,
      json: {
        results: {
          results: [
            {
              id: 2,
              name: "R",
              type: "insights",
              project_id: 2,
              created: "c",
              modified: "m",
            },
          ],
        },
      },
    }));
    check("bookmarks/nested", (await b.service.listBookmarks())[0]?.id, 2);
    const c = svc(() => ({ status: 200, json: {} }));
    check("bookmarks/absent results", await c.service.listBookmarks(), []);
  }

  // --- missing required keys (the CPython KeyError twin) ------------
  {
    const a = svc(() => ({ status: 200, json: [{ name: "F" }] }));
    check(
      "funnels/missing funnel_id",
      await thrown(() => a.service.listFunnels()),
      KeyError.name,
    );
    const b = svc(() => ({ status: 200, json: { events: [{ event: "E" }] } }));
    check(
      "topEvents/missing amount",
      await thrown(() => b.service.listTopEvents()),
      KeyError.name,
    );
    const c = svc(() => ({ status: 200, json: { results: [{ id: 1 }] } }));
    check(
      "bookmarks/missing name",
      await thrown(() => c.service.listBookmarks()),
      KeyError.name,
    );
  }

  // --- every error branch through the delegates ---------------------
  {
    const cases: Array<[number, string]> = [
      [401, "AuthenticationError"],
      [403, "QueryError"],
      [429, "RateLimitError"],
      [500, "ServerError"],
      [503, "ServerError"],
    ];
    for (const [status, expected] of cases) {
      const a = svc(() => ({ status, json: { error: "x" } }));
      check(
        `events/${String(status)}`,
        await thrown(() => a.service.listEvents()),
        expected,
      );
    }
    // 400 on `list_properties` is the EventNotFoundError branch (the
    // suggestion fetch is the SECOND call).
    const props = svc((request) =>
      request.url.includes("/events/names")
        ? { status: 200, json: ["Sign Up"] }
        : { status: 400, json: { error: "bad" } },
    );
    check(
      "properties/400 -> EventNotFoundError",
      await thrown(() => props.service.listProperties("sign up")),
      "EventNotFoundError",
    );
    check("properties/400 fetched suggestions", props.calls.n, 2);
    // 400 anywhere else stays a QueryError (code passthrough).
    const values = svc(() => ({ status: 400, json: { error: "bad" } }));
    check(
      "propertyValues/400 -> QueryError",
      await thrown(() => values.service.listPropertyValues("p")),
      "QueryError",
    );
    const schemas = svc(() => ({ status: 400, json: { error: "bad" } }));
    check(
      "getSchema/400 -> QueryError",
      await thrown(() => schemas.service.getSchema("event", "X")),
      "QueryError",
    );
    // A non-JSON 200 body is the wire layer's problem, not the service's.
    const garbage = svc(() => ({
      status: 200,
      text: "<html>nope",
      headers: { "content-type": "text/html" },
    }));
    console.log(
      `note: non-JSON 200 -> ${String(
        await thrown(() => garbage.service.listEvents()),
      )}`,
    );
    // Transport failure (fetch rejects) — normalized by the B4 adapter.
    const { client } = createMockClient(makeSession(), () => {
      throw new TypeError("fetch failed");
    });
    console.log(
      `note: transport failure -> ${String(
        await thrown(() => new DiscoveryService(client).listEvents()),
      )}`,
    );
  }

  console.log(`\n${String(checks)} checks / ${String(failures)} failures`);
  process.exitCode = failures === 0 ? 0 : 1;
}

await main();
