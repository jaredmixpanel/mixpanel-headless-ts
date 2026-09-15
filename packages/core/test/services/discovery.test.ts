// Translated DiscoveryService tests (B5-S1, packet §4): assertion-for-
// assertion port of tests/unit/test_discovery.py (R10.2) — ALL 10
// classes (TestDiscoveryService :62, TestListEvents :95,
// TestListProperties :236, TestFindSimilarEvents :360,
// TestListPropertyValues :465, TestClearCache :580, TestListFunnels
// :661, TestListCohorts :759, TestListTopEvents :930,
// TestListSubproperties :1080).
//
// Translation notes (applied consistently):
// - `discovery_factory` -> `discoveryFactory` over the B4
//   `createMockClient` httpx.MockTransport analog
//   (`test-support/client-test-helpers.ts`); `success_handler` ->
//   `successHandler`.
// - Python's `_cache` dict -> the `cache` Map (R4.8); `== {}` asserts
//   become `.size === 0`.
// - Handlers that `assert` on the captured request (`test_list_top_
//   events_with_type_parameter`, `..._with_limit_parameter`) capture
//   the params and assert AFTER the await: a throw inside the injected
//   fetch would be normalized into a transport error by the B4 client
//   and mask the assertion. Same assertion, same values.
// - `warnings.catch_warnings(record=True)` -> the injected
//   {@link WarningSink} collector; `simplefilter("error")` (a warning
//   FAILS the test) -> a sink that throws.
// - `test_mixed_warning_stacklevel_points_at_user_frame` (:1410) has no
//   TS analog: `warnings.warn(stacklevel=N)` attributes a warning to a
//   caller frame, and the TS side channel is an injected sink with no
//   frame attribution. The behaviour it pins (the mixed-type warning
//   fires through the Workspace -> service -> inference chain) is
//   asserted by `test_mixed_types_collapse_to_string_with_warning`
//   here and by the sink-threading case in
//   `test/workspace/discovery-facade.test.ts`.
//   Recorded in `B5-S1-notes.md` §2.

import { describe, expect, it } from "vitest";

import {
  AuthenticationError,
  EventNotFoundError,
  QueryError,
} from "../../src/errors.js";
import { ValueError } from "../../src/query/python-builtins.js";
import {
  DiscoveryService,
  inferScalarType,
  type WarningSink,
} from "../../src/services/discovery.js";
import {
  type CannedResponse,
  type CapturedFetchRequest,
  createMockClient,
  makeSession,
} from "../../test-support/client-test-helpers.js";

/** A canned-response handler (the httpx.MockTransport handler twin). */
type Handler = (request: CapturedFetchRequest) => CannedResponse;

/**
 * The `discovery_factory` fixture (test_discovery.py:26-59).
 *
 * @param handler - The canned-response handler.
 * @param warn - Optional warning sink (Python's warnings machinery).
 * @returns The service under test.
 */
function discoveryFactory(
  handler: Handler,
  warn?: WarningSink,
): DiscoveryService {
  const { client } = createMockClient(makeSession(), handler);
  return new DiscoveryService(
    client,
    ...(warn === undefined ? [] : [{ warn }]),
  );
}

/** The `success_handler` fixture (conftest.py:311-317). */
const successHandler: Handler = () => ({ status: 200, json: [] });

describe("TestDiscoveryService", () => {
  it("accepts an API client", () => {
    const { client } = createMockClient(makeSession(), successHandler);
    const discovery = new DiscoveryService(client);
    expect(discovery.apiClient).toBe(client);
  });

  it("initializes with an empty cache", () => {
    const { client } = createMockClient(makeSession(), successHandler);
    const discovery = new DiscoveryService(client);
    expect(discovery.cache.size).toBe(0);
  });
});

describe("TestListEvents", () => {
  it("returns events sorted alphabetically", async () => {
    const discovery = discoveryFactory(() => ({
      status: 200,
      json: ["Signup", "Login", "Purchase", "Add to Cart"],
    }));
    const events = await discovery.listEvents();
    expect(events).toStrictEqual([
      "Add to Cart",
      "Login",
      "Purchase",
      "Signup",
    ]);
  });

  it("caches results and does not call the API on the second request", async () => {
    let callCount = 0;
    const discovery = discoveryFactory(() => {
      callCount += 1;
      return { status: 200, json: ["Event1", "Event2"] };
    });

    const events1 = await discovery.listEvents();
    expect(callCount).toBe(1);

    const events2 = await discovery.listEvents();
    expect(callCount).toBe(1);

    expect(events1).toStrictEqual(events2);
  });

  it("propagates AuthenticationError from the API client", async () => {
    const discovery = discoveryFactory(() => ({
      status: 401,
      json: { error: "Invalid credentials" },
    }));
    await expect(discovery.listEvents()).rejects.toBeInstanceOf(
      AuthenticationError,
    );
  });

  it("returns an empty list when no events exist", async () => {
    const discovery = discoveryFactory(() => ({ status: 200, json: [] }));
    expect(await discovery.listEvents()).toStrictEqual([]);
  });

  it("caches per (limit, from_date, to_date) triple", async () => {
    let callCount = 0;
    const discovery = discoveryFactory(() => {
      callCount += 1;
      return { status: 200, json: [`E${String(callCount)}`] };
    });

    await discovery.listEvents({ limit: 10 });
    await discovery.listEvents({ limit: 10 });
    expect(callCount).toBe(1); // second call cached

    await discovery.listEvents({ limit: 20 });
    expect(callCount).toBe(2); // different triple, new HTTP call

    await discovery.listEvents(); // all-None triple, distinct from above
    expect(callCount).toBe(3);
  });

  it("forwards caller-supplied kwargs to the outbound request", async () => {
    const capturedParams: Record<string, string> = {};
    const discovery = discoveryFactory((request) => {
      for (const [key, value] of Object.entries(request.params)) {
        capturedParams[key] = value;
      }
      return { status: 200, json: ["e1"] };
    });
    await discovery.listEvents({
      limit: 7,
      from_date: "2024-01-01",
      to_date: "2024-12-31",
    });

    expect(capturedParams["limit"]).toBe("7");
    expect(capturedParams["from_date"]).toBe("2024-01-01");
    expect(capturedParams["to_date"]).toBe("2024-12-31");
  });
});

describe("TestListProperties", () => {
  it("returns properties sorted alphabetically", async () => {
    const discovery = discoveryFactory(() => ({
      status: 200,
      json: { user_id: 100, amount: 50, currency: 75 },
    }));
    const properties = await discovery.listProperties("Purchase");
    expect(properties).toStrictEqual(["amount", "currency", "user_id"]);
  });

  it("caches results per event name", async () => {
    let callCount = 0;
    const discovery = discoveryFactory((request) => {
      callCount += 1;
      if (request.url.includes("event=Purchase")) {
        return { status: 200, json: { amount: 1, currency: 1 } };
      }
      return { status: 200, json: { user_id: 1, email: 1 } };
    });

    const props1 = await discovery.listProperties("Purchase");
    expect(callCount).toBe(1);

    const props2 = await discovery.listProperties("Purchase");
    expect(callCount).toBe(1);

    const props3 = await discovery.listProperties("Signup");
    expect(callCount).toBe(2);

    expect(props1).toStrictEqual(["amount", "currency"]);
    expect(props2).toStrictEqual(["amount", "currency"]);
    expect(props3).toStrictEqual(["email", "user_id"]);
  });

  it("raises EventNotFoundError with suggestions for a 400", async () => {
    let callCount = 0;
    const discovery = discoveryFactory((request) => {
      callCount += 1;
      // First call: get events for suggestions
      if (request.url.includes("/events/names") || callCount === 2) {
        return {
          status: 200,
          json: ["Sign Up", "Login", "Purchase", "sign_up_complete"],
        };
      }
      // Second call: get properties fails
      return { status: 400, json: { error: "Invalid event name" } };
    });

    const error = await discovery.listProperties("sign up").then(
      () => {
        throw new Error("expected EventNotFoundError");
      },
      (error_: unknown) => error_,
    );
    expect(error).toBeInstanceOf(EventNotFoundError);
    // Should have case-insensitive match as suggestion
    expect((error as EventNotFoundError).eventName).toBe("sign up");
    expect((error as EventNotFoundError).similarEvents).toContain("Sign Up");
  });

  it("propagates QueryError for non-400 errors", async () => {
    const discovery = discoveryFactory(() => ({
      status: 403,
      json: { error: "Permission denied" },
    }));
    await expect(discovery.listProperties("SomeEvent")).rejects.toBeInstanceOf(
      QueryError,
    );
  });

  it("returns an empty list when the event has no properties", async () => {
    const discovery = discoveryFactory(() => ({ status: 200, json: {} }));
    expect(await discovery.listProperties("EmptyEvent")).toStrictEqual([]);
  });
});

describe("TestFindSimilarEvents", () => {
  it("finds exact case-insensitive matches first", () => {
    const discovery = discoveryFactory(successHandler);
    const events = ["Sign Up", "Login", "Purchase"];
    expect(discovery.findSimilarEvents("sign up", events)).toStrictEqual([
      "Sign Up",
    ]);
  });

  it("finds events containing the query as a substring", () => {
    const discovery = discoveryFactory(successHandler);
    const events = [
      "User Sign Up",
      "Sign Up Complete",
      "Login",
      "sign_up_flow",
    ];
    const result = discovery.findSimilarEvents("sign", events);
    // Should be sorted by length (shorter = more specific)
    expect(result).toContain("sign_up_flow");
    expect(result).not.toContain("Login");
  });

  it("finds events with overlapping words", () => {
    const discovery = discoveryFactory(successHandler);
    const events = [
      "User Created",
      "User Updated",
      "Order Placed",
      "user_deleted",
    ];
    const result = discovery.findSimilarEvents("user signup", events);
    expect(result).toContain("User Created");
    expect(result).toContain("User Updated");
    expect(result).toContain("user_deleted");
    expect(result).not.toContain("Order Placed");
  });

  it("treats underscores and hyphens as word separators", () => {
    const discovery = discoveryFactory(successHandler);
    const events = ["user_sign_up", "user-login", "User Logout"];
    expect(discovery.findSimilarEvents("user", events)).toHaveLength(3);
  });

  it("returns at most 5 suggestions", () => {
    const discovery = discoveryFactory(successHandler);
    const events = Array.from({ length: 10 }, (_v, i) => `Event ${String(i)}`);
    expect(
      discovery.findSimilarEvents("event", events).length,
    ).toBeLessThanOrEqual(5);
  });

  it("returns an empty list when nothing matches", () => {
    const discovery = discoveryFactory(successHandler);
    const events = ["Login", "Logout", "Purchase"];
    expect(
      discovery.findSimilarEvents("completely_different", events),
    ).toStrictEqual([]);
  });
});

describe("TestListPropertyValues", () => {
  it("returns values from the API", async () => {
    const discovery = discoveryFactory(() => ({
      status: 200,
      json: ["US", "CA", "GB", "DE"],
    }));
    // Note: values are NOT sorted per research.md
    expect(await discovery.listPropertyValues("country")).toStrictEqual([
      "US",
      "CA",
      "GB",
      "DE",
    ]);
  });

  it("passes the event parameter to the API", async () => {
    const discovery = discoveryFactory((request) =>
      request.url.includes("event=Purchase")
        ? { status: 200, json: ["credit_card", "paypal"] }
        : { status: 200, json: ["all_values"] },
    );
    expect(
      await discovery.listPropertyValues("payment_method", {
        event: "Purchase",
      }),
    ).toStrictEqual(["credit_card", "paypal"]);
  });

  it("passes the limit parameter to the API", async () => {
    const discovery = discoveryFactory((request) =>
      request.url.includes("limit=10")
        ? { status: 200, json: ["v1", "v2", "v3"] }
        : { status: 200, json: ["all_values"] },
    );
    expect(
      await discovery.listPropertyValues("country", { limit: 10 }),
    ).toStrictEqual(["v1", "v2", "v3"]);
  });

  it("caches per (property, event, limit)", async () => {
    let callCount = 0;
    const discovery = discoveryFactory(() => {
      callCount += 1;
      return { status: 200, json: ["value1", "value2"] };
    });

    const values1 = await discovery.listPropertyValues("country", {
      event: "Purchase",
      limit: 50,
    });
    expect(callCount).toBe(1);

    const values2 = await discovery.listPropertyValues("country", {
      event: "Purchase",
      limit: 50,
    });
    expect(callCount).toBe(1);

    await discovery.listPropertyValues("country", {
      event: "Purchase",
      limit: 100,
    });
    expect(callCount).toBe(2);

    await discovery.listPropertyValues("country", {
      event: "Signup",
      limit: 50,
    });
    expect(callCount).toBe(3);

    expect(values1).toStrictEqual(["value1", "value2"]);
    expect(values2).toStrictEqual(["value1", "value2"]);
  });

  it("returns an empty list when no values exist", async () => {
    const discovery = discoveryFactory(() => ({ status: 200, json: [] }));
    expect(
      await discovery.listPropertyValues("nonexistent_property"),
    ).toStrictEqual([]);
  });
});

describe("TestClearCache", () => {
  it("clears all cached results", async () => {
    const discovery = discoveryFactory(() => ({
      status: 200,
      json: ["event1", "event2"],
    }));

    await discovery.listEvents();
    expect(discovery.cache.size).toBeGreaterThan(0);

    discovery.clearCache();
    expect(discovery.cache.size).toBe(0);
  });

  it("does not error on an empty cache", () => {
    const discovery = discoveryFactory(() => ({ status: 200, json: [] }));
    expect(discovery.cache.size).toBe(0);
    discovery.clearCache();
    expect(discovery.cache.size).toBe(0);
  });

  it("causes the next request to hit the API", async () => {
    let callCount = 0;
    const discovery = discoveryFactory(() => {
      callCount += 1;
      return { status: 200, json: ["event1", "event2"] };
    });

    await discovery.listEvents();
    expect(callCount).toBe(1);

    await discovery.listEvents();
    expect(callCount).toBe(1);

    discovery.clearCache();

    await discovery.listEvents();
    expect(callCount).toBe(2);
  });
});

describe("TestListFunnels", () => {
  it("returns a list of FunnelInfo objects", async () => {
    const discovery = discoveryFactory(() => ({
      status: 200,
      json: [
        { funnel_id: 123, name: "Checkout Funnel" },
        { funnel_id: 456, name: "Onboarding Flow" },
      ],
    }));
    const funnels = await discovery.listFunnels();
    expect(funnels).toHaveLength(2);
    expect(funnels[0]?.funnel_id).toBe(123);
    expect(funnels[0]?.name).toBe("Checkout Funnel");
  });

  it("returns funnels sorted alphabetically by name", async () => {
    const discovery = discoveryFactory(() => ({
      status: 200,
      json: [
        { funnel_id: 1, name: "Zebra Funnel" },
        { funnel_id: 2, name: "Alpha Funnel" },
        { funnel_id: 3, name: "Beta Funnel" },
      ],
    }));
    const funnels = await discovery.listFunnels();
    expect(funnels[0]?.name).toBe("Alpha Funnel");
    expect(funnels[1]?.name).toBe("Beta Funnel");
    expect(funnels[2]?.name).toBe("Zebra Funnel");
  });

  it("caches results", async () => {
    let callCount = 0;
    const discovery = discoveryFactory(() => {
      callCount += 1;
      return { status: 200, json: [{ funnel_id: 1, name: "Funnel" }] };
    });

    const funnels1 = await discovery.listFunnels();
    expect(callCount).toBe(1);

    const funnels2 = await discovery.listFunnels();
    expect(callCount).toBe(1);

    expect(funnels1).toStrictEqual(funnels2);
  });

  it("returns an empty list when no funnels exist", async () => {
    const discovery = discoveryFactory(() => ({ status: 200, json: [] }));
    expect(await discovery.listFunnels()).toStrictEqual([]);
  });
});

describe("TestListCohorts", () => {
  it("returns a list of SavedCohort objects", async () => {
    const discovery = discoveryFactory(() => ({
      status: 200,
      json: [
        {
          id: 123,
          name: "Power Users",
          count: 1500,
          description: "Users with 10+ purchases",
          created: "2024-01-15 10:30:00",
          is_visible: 1,
          project_id: 999,
        },
      ],
    }));
    const cohorts = await discovery.listCohorts();
    expect(cohorts).toHaveLength(1);
    expect(cohorts[0]?.id).toBe(123);
    expect(cohorts[0]?.name).toBe("Power Users");
    expect(cohorts[0]?.count).toBe(1500);
    expect(cohorts[0]?.is_visible).toBe(true);
  });

  it("converts is_visible int to bool", async () => {
    const discovery = discoveryFactory(() => ({
      status: 200,
      json: [
        {
          id: 1,
          name: "Visible",
          count: 100,
          description: "",
          created: "2024-01-01 00:00:00",
          is_visible: 1,
        },
        {
          id: 2,
          name: "Hidden",
          count: 50,
          description: "",
          created: "2024-01-01 00:00:00",
          is_visible: 0,
        },
      ],
    }));
    const cohorts = await discovery.listCohorts();
    const visible = cohorts.find((c) => c.name === "Visible");
    const hidden = cohorts.find((c) => c.name === "Hidden");
    expect(visible?.is_visible).toBe(true);
    expect(hidden?.is_visible).toBe(false);
  });

  it("returns cohorts sorted alphabetically by name", async () => {
    const discovery = discoveryFactory(() => ({
      status: 200,
      json: [
        {
          id: 1,
          name: "Zebra Cohort",
          count: 100,
          description: "",
          created: "2024-01-01 00:00:00",
          is_visible: 1,
        },
        {
          id: 2,
          name: "Alpha Cohort",
          count: 50,
          description: "",
          created: "2024-01-01 00:00:00",
          is_visible: 1,
        },
      ],
    }));
    const cohorts = await discovery.listCohorts();
    expect(cohorts[0]?.name).toBe("Alpha Cohort");
    expect(cohorts[1]?.name).toBe("Zebra Cohort");
  });

  it("caches results", async () => {
    let callCount = 0;
    const discovery = discoveryFactory(() => {
      callCount += 1;
      return {
        status: 200,
        json: [
          {
            id: 1,
            name: "Cohort",
            count: 100,
            description: "",
            created: "2024-01-01 00:00:00",
            is_visible: 1,
          },
        ],
      };
    });

    const cohorts1 = await discovery.listCohorts();
    expect(callCount).toBe(1);

    const cohorts2 = await discovery.listCohorts();
    expect(callCount).toBe(1);

    expect(cohorts1).toStrictEqual(cohorts2);
  });

  it("returns an empty list when no cohorts exist", async () => {
    const discovery = discoveryFactory(() => ({ status: 200, json: [] }));
    expect(await discovery.listCohorts()).toStrictEqual([]);
  });
});

describe("TestListTopEvents", () => {
  it("returns a list of TopEvent objects", async () => {
    const discovery = discoveryFactory(() => ({
      status: 200,
      json: {
        events: [
          { event: "Sign Up", amount: 1500, percent_change: 0.25 },
          { event: "Purchase", amount: 500, percent_change: -0.1 },
        ],
        type: "general",
      },
    }));
    const events = await discovery.listTopEvents();
    expect(events).toHaveLength(2);
    expect(events[0]?.event).toBe("Sign Up");
    expect(events[0]?.count).toBe(1500);
    expect(events[0]?.percent_change).toBe(0.25);
  });

  it("maps the API 'amount' field to 'count'", async () => {
    const discovery = discoveryFactory(() => ({
      status: 200,
      json: {
        events: [{ event: "Test", amount: 999, percent_change: 0.0 }],
        type: "general",
      },
    }));
    const events = await discovery.listTopEvents();
    expect(events[0]?.count).toBe(999); // 'amount' mapped to 'count'
  });

  it("does NOT cache results (real-time data)", async () => {
    let callCount = 0;
    const discovery = discoveryFactory(() => {
      callCount += 1;
      return {
        status: 200,
        json: {
          events: [{ event: "Test", amount: 100, percent_change: 0.0 }],
          type: "general",
        },
      };
    });

    await discovery.listTopEvents();
    expect(callCount).toBe(1);

    await discovery.listTopEvents();
    expect(callCount).toBe(2); // API called again, not cached
  });

  it("passes the type parameter to the API", async () => {
    let seenUrl = "";
    const discovery = discoveryFactory((request) => {
      seenUrl = request.url;
      return { status: 200, json: { events: [], type: "unique" } };
    });
    await discovery.listTopEvents({ type: "unique" });
    expect(seenUrl).toContain("type=unique");
  });

  it("passes the limit parameter to the API", async () => {
    let seenUrl = "";
    const discovery = discoveryFactory((request) => {
      seenUrl = request.url;
      return { status: 200, json: { events: [], type: "general" } };
    });
    await discovery.listTopEvents({ limit: 10 });
    expect(seenUrl).toContain("limit=10");
  });

  it("returns an empty list when there are no events", async () => {
    const discovery = discoveryFactory(() => ({
      status: 200,
      json: { events: [], type: "general" },
    }));
    expect(await discovery.listTopEvents()).toStrictEqual([]);
  });
});

describe("TestListSubproperties", () => {
  /**
   * The `_values_handler` static helper (test_discovery.py:1083-1092).
   *
   * @param values - The canned property-value strings.
   * @returns A handler always replying with them.
   */
  const valuesHandler = (values: string[]): Handler => {
    return () => ({ status: 200, json: values });
  };

  /** A sink that FAILS the test on any warning (`simplefilter("error")`). */
  const throwingSink: WarningSink = (message) => {
    throw new Error(`unexpected UserWarning: ${message}`);
  };

  it("reports string subproperties as type 'string'", async () => {
    const values = [
      JSON.stringify({ Brand: "nike", Category: "hats" }),
      JSON.stringify({ Brand: "puma", Category: "shoes" }),
      JSON.stringify({ Brand: "h&m", Category: "hats" }),
    ];
    const discovery = discoveryFactory(valuesHandler(values));
    const subs = await discovery.listSubproperties("cart", {
      event: "Cart Viewed",
    });
    expect(new Set(subs.map((s) => s.name))).toStrictEqual(
      new Set(["Brand", "Category"]),
    );
    for (const s of subs) {
      expect(s.type).toBe("string");
    }
  });

  it("reports numeric subproperties as type 'number'", async () => {
    const values = [
      JSON.stringify({ Price: 51, "Item ID": 35317 }),
      JSON.stringify({ Price: 87.5, "Item ID": 35318 }),
      JSON.stringify({ Price: 102, "Item ID": 35319 }),
    ];
    const discovery = discoveryFactory(valuesHandler(values));
    const subs = new Map(
      (await discovery.listSubproperties("cart", { event: "X" })).map((s) => [
        s.name,
        s,
      ]),
    );
    expect(subs.get("Price")?.type).toBe("number");
    expect(subs.get("Item ID")?.type).toBe("number");
  });

  it("detects booleans as 'boolean', not 'number'", async () => {
    const values = [
      JSON.stringify({ on_sale: true }),
      JSON.stringify({ on_sale: false }),
    ];
    const discovery = discoveryFactory(valuesHandler(values));
    const subs = await discovery.listSubproperties("cart", { event: "X" });
    expect(subs).toHaveLength(1);
    expect(subs[0]?.name).toBe("on_sale");
    expect(subs[0]?.type).toBe("boolean");
  });

  it("detects ISO date/datetime strings as 'datetime'", async () => {
    const values = [
      JSON.stringify({ added_at: "2025-04-23" }),
      JSON.stringify({ added_at: "2025-04-24" }),
      JSON.stringify({ added_at: "2025-04-25T10:30:00Z" }),
    ];
    const discovery = discoveryFactory(valuesHandler(values));
    const subs = await discovery.listSubproperties("cart", { event: "X" });
    expect(subs[0]?.name).toBe("added_at");
    expect(subs[0]?.type).toBe("datetime");
  });

  it("collapses mixed sub-value types to 'string' with a UserWarning", async () => {
    const values = [JSON.stringify({ id: "abc" }), JSON.stringify({ id: 123 })];
    const captured: string[] = [];
    const discovery = discoveryFactory(valuesHandler(values), (message) => {
      captured.push(message);
    });
    const subs = await discovery.listSubproperties("cart", { event: "X" });
    expect(subs[0]?.type).toBe("string");
    expect(captured.some((m) => m.toLowerCase().includes("mixed"))).toBe(true);
  });

  it("returns subproperties sorted alphabetically by name", async () => {
    const values = [JSON.stringify({ Z: "z", A: "a", M: "m" })];
    const discovery = discoveryFactory(valuesHandler(values));
    const names = (
      await discovery.listSubproperties("cart", { event: "X" })
    ).map((s) => s.name);
    expect(names).toStrictEqual(["A", "M", "Z"]);
  });

  it("caps sample_values at five distinct values", async () => {
    const values = Array.from({ length: 20 }, (_v, i) =>
      JSON.stringify({ Brand: `b${String(i)}` }),
    );
    const discovery = discoveryFactory(valuesHandler(values));
    const subs = await discovery.listSubproperties("cart", { event: "X" });
    const samples = subs[0]?.sample_values ?? [];
    expect(samples.length).toBeLessThanOrEqual(5);
    expect(new Set(samples).size).toBe(samples.length);
  });

  it("silently skips unparseable / non-dict values", async () => {
    const values = [
      "not json at all",
      JSON.stringify(["just", "a", "list"]),
      JSON.stringify({ Brand: "nike" }),
    ];
    const discovery = discoveryFactory(valuesHandler(values));
    const subs = await discovery.listSubproperties("cart", { event: "X" });
    expect(subs.map((s) => s.name)).toStrictEqual(["Brand"]);
  });

  it("skips nested dict/list sub-values (scalars only)", async () => {
    const values = [
      JSON.stringify({
        Brand: "nike",
        metadata: { sku: "x" }, // nested dict — skip
        tags: ["a", "b"], // nested list — skip
      }),
    ];
    const discovery = discoveryFactory(valuesHandler(values));
    const names = new Set(
      (await discovery.listSubproperties("cart", { event: "X" })).map(
        (s) => s.name,
      ),
    );
    expect(names).toStrictEqual(new Set(["Brand"]));
  });

  it("returns an empty list for no values", async () => {
    const discovery = discoveryFactory(valuesHandler([]));
    expect(
      await discovery.listSubproperties("cart", { event: "X" }),
    ).toStrictEqual([]);
  });

  it("treats a JSON list of dicts as one row per dict", async () => {
    const values = [
      JSON.stringify([{ Brand: "nike" }, { Brand: "puma" }]),
      JSON.stringify([{ Brand: "h&m" }]),
    ];
    const discovery = discoveryFactory(valuesHandler(values));
    const subs = await discovery.listSubproperties("cart", { event: "X" });
    expect(subs[0]?.name).toBe("Brand");
    expect((subs[0]?.sample_values ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("treats null sub-values as missing, with no mixed warning", async () => {
    const values = [
      JSON.stringify({ Brand: "nike", Coupon: null }),
      JSON.stringify({ Brand: "puma", Coupon: "FALL20" }),
      JSON.stringify({ Brand: "h&m", Coupon: null }),
    ];
    const discovery = discoveryFactory(valuesHandler(values), throwingSink);
    const subs = await discovery.listSubproperties("cart", { event: "X" });
    const byName = new Map(subs.map((s) => [s.name, s]));
    expect(byName.get("Coupon")?.type).toBe("string");
    expect(byName.get("Coupon")?.sample_values).not.toContain(null);
    expect(byName.get("Coupon")?.sample_values).toStrictEqual(["FALL20"]);
  });

  it("filters non-dict items inside a JSON list", async () => {
    const values = [
      JSON.stringify([{ Brand: "nike" }, "junk", { Brand: "puma" }]),
    ];
    const discovery = discoveryFactory(valuesHandler(values));
    const subs = await discovery.listSubproperties("cart", { event: "X" });
    expect(subs.map((s) => s.name)).toStrictEqual(["Brand"]);
    expect(new Set(subs[0]?.sample_values)).toStrictEqual(
      new Set(["nike", "puma"]),
    );
  });

  it("warns and keeps the scalar form for mixed scalar/dict shapes", async () => {
    const values = [
      JSON.stringify({ X: 1 }),
      JSON.stringify({ X: { nested: 2 } }), // dict — silently dropped previously
      JSON.stringify({ X: 3 }),
    ];
    const captured: string[] = [];
    const discovery = discoveryFactory(valuesHandler(values), (message) => {
      captured.push(message);
    });
    const subs = await discovery.listSubproperties("cart", { event: "X" });
    const byName = new Map(subs.map((s) => [s.name, s]));
    expect(byName.get("X")?.type).toBe("number"); // scalar form retained
    expect(new Set(byName.get("X")?.sample_values)).toStrictEqual(
      new Set([1, 3]),
    );
    expect(captured.some((m) => m.includes("scalar and nested-object"))).toBe(
      true,
    );
  });

  it("warns and excludes an all-null subproperty", async () => {
    const values = [
      JSON.stringify({ Brand: "nike", Coupon: null }),
      JSON.stringify({ Brand: "puma", Coupon: null }),
    ];
    const captured: string[] = [];
    const discovery = discoveryFactory(valuesHandler(values), (message) => {
      captured.push(message);
    });
    const subs = await discovery.listSubproperties("cart", { event: "X" });
    const names = subs.map((s) => s.name);
    expect(names).not.toContain("Coupon");
    expect(names).toContain("Brand");
    expect(
      captured.some((m) => m.includes("all sampled values were null")),
    ).toBe(true);
  });

  it("classifies ISO-shaped strings with invalid calendars as 'string'", async () => {
    for (const bad of ["2025-13-99", "2025-04-23T25:99:99"]) {
      const values = [JSON.stringify({ X: bad })];
      const discovery = discoveryFactory(valuesHandler(values));
      const subs = await discovery.listSubproperties("cart", { event: "X" });
      expect(subs[0]?.type, `${bad} should not be datetime`).toBe("string");
    }
  });

  it("raises ValueError for an empty inferScalarType input", () => {
    expect(() => inferScalarType([])).toThrow(ValueError);
    expect(() => inferScalarType([])).toThrow(/non-empty/);
  });

  it("returns ('string', true) for mixed int/bool values", () => {
    const [inferred, mixed] = inferScalarType([true, 1]);
    expect(inferred).toBe("string");
    expect(mixed).toBe(true);
  });
});
