// B6-W1 Layer-3 translation of `tests/unit/test_workspace_streaming.py`
// (WHOLE file, 744 lines — packet §3 table): `TestStreamEvents` (:106),
// `TestStreamProfiles` (:369), `TestNormalizedEventFormat` (:622),
// `TestRawEventFormat` (:659), `TestNormalizedProfileFormat` (:689),
// `TestRawProfileFormat` (:720).
//
// The members under test are the W1-D3 veneers: `ws.streamEvents` /
// `ws.streamProfiles` are R6.6 item-level `yield*` wrappers over the
// B4-C2 `streamEvents`/`streamProfiles` helpers
// (`services/queries/streaming.ts:708,744`), which in turn wrap the
// client's `exportEvents`/`exportProfiles`. Python's
// `MagicMock(spec=MixpanelAPIClient)` becomes a stub client carrying
// only those two members plus the call log.
//
// TRANSLATION NOTE (watchlist #5 / B4-C2 precedent): Python's normalized
// `event_time` is a `datetime`; the TS transform emits the SAME instant
// as UTC ISO TEXT (`transforms.ts:443-444`). `isinstance(…, datetime)`
// therefore translates to the ISO-text spelling assertion, and
// `event_time.tzinfo == timezone.utc` to the trailing `+00:00`.

import { describe, expect, it } from "vitest";
import { Workspace } from "../../src/workspace.js";
import { makeSession } from "../../test-support/client-test-helpers.js";
import type { MixpanelClient } from "../../src/client/client.js";
import type { JsonValue } from "../../src/client/json-value.js";

/** The `_TEST_SESSION` twin (`test_workspace_streaming.py:21-29`). */
const TEST_SESSION = makeSession({
  name: "test_account",
  projectId: "12345",
  username: "test_user",
  secret: "test_secret",
});

/** One recorded `exportEvents` call. */
interface ExportEventsCall {
  readonly from_date: string;
  readonly to_date: string;
  readonly options: Record<string, unknown>;
}

/** The `MagicMock(spec=MixpanelAPIClient)` twin for the export pair. */
interface StubClient {
  readonly client: MixpanelClient;
  readonly exportEventsCalls: ExportEventsCall[];
  readonly exportProfilesCalls: Array<Record<string, unknown>>;
  setEvents(source: () => AsyncGenerator<JsonValue, void, undefined>): void;
  setProfiles(source: () => AsyncGenerator<JsonValue, void, undefined>): void;
}

/**
 * Build the export-only client stub.
 *
 * @returns The stub plus its call logs.
 */
function stubClient(): StubClient {
  const exportEventsCalls: ExportEventsCall[] = [];
  const exportProfilesCalls: Array<Record<string, unknown>> = [];
  let events: () => AsyncGenerator<JsonValue, void, undefined> =
    async function* () {};
  let profiles: () => AsyncGenerator<JsonValue, void, undefined> =
    async function* () {};
  const client = {
    // The `MagicMock(spec=MixpanelAPIClient)` twin auto-provides every
    // client member; the facade constructor touches these two
    // (`_install_workspace_resolver`, `workspace.py:775-793`).
    hasWorkspaceResolver: false,
    setWorkspaceResolver: (): void => {},
    close: (): Promise<void> => Promise.resolve(),
    exportEvents: (
      fromDate: string,
      toDate: string,
      options: Record<string, unknown> = {},
    ): AsyncGenerator<JsonValue, void, undefined> => {
      exportEventsCalls.push({
        from_date: fromDate,
        to_date: toDate,
        options,
      });
      return events();
    },
    exportProfiles: (
      options: Record<string, unknown> = {},
    ): AsyncGenerator<JsonValue, void, undefined> => {
      exportProfilesCalls.push(options);
      return profiles();
    },
  } as unknown as MixpanelClient;
  return {
    client,
    exportEventsCalls,
    exportProfilesCalls,
    setEvents: (source): void => {
      events = source;
    },
    setProfiles: (source): void => {
      profiles = source;
    },
  };
}

/**
 * Build a raw event in Mixpanel API format (`raw_event`, :71-82).
 *
 * @param name - Event name.
 * @param distinctId - User id.
 * @param timestamp - Unix seconds.
 * @param extra - Extra properties.
 * @returns The raw event dict.
 */
function rawEvent(
  name = "PageView",
  distinctId = "user_123",
  timestamp = 1705328400,
  extra: Record<string, JsonValue> = {},
): JsonValue {
  return {
    event: name,
    properties: {
      distinct_id: distinctId,
      time: timestamp,
      $insert_id: `evt_${String(timestamp)}`,
      ...extra,
    },
  } as unknown as JsonValue;
}

/**
 * Build a raw profile in Mixpanel API format (`raw_profile`, :85-93).
 *
 * @param distinctId - User id.
 * @param lastSeen - `$last_seen` value (omitted when `null`).
 * @param extra - Extra properties.
 * @returns The raw profile dict.
 */
function rawProfile(
  distinctId = "user_123",
  lastSeen: string | null = "2024-01-15T14:30:00",
  extra: Record<string, JsonValue> = {},
): JsonValue {
  const props: Record<string, JsonValue> = { ...extra };
  if (lastSeen !== null) {
    props["$last_seen"] = lastSeen;
  }
  return {
    $distinct_id: distinctId,
    $properties: props,
  } as unknown as JsonValue;
}

/**
 * Build the facade over a stub client.
 *
 * @param stub - The stub client.
 * @returns The facade.
 */
function makeWorkspace(stub: StubClient): Workspace {
  return new Workspace({ session: TEST_SESSION, client: stub.client });
}

/**
 * Drain an async iterable into an array (Python's `list(...)`).
 *
 * @param source - The async iterable.
 * @returns Every yielded item, in order.
 */
async function drain<T>(source: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of source) {
    out.push(item);
  }
  return out;
}

/** Cast helper for the transformed-record assertions. */
type Rec = Record<string, unknown>;

describe("TestStreamEvents (test_workspace_streaming.py:106)", () => {
  it("T006: basic streaming with the default (normalized) format", async () => {
    const stub = stubClient();
    stub.setEvents(async function* () {
      yield rawEvent("PageView", "user_1", 1705328400, { page: "/home" });
      yield rawEvent("Click", "user_2", 1705328500, { button: "signup" });
    });
    const ws = makeWorkspace(stub);

    const events = (await drain(
      ws.streamEvents({ from_date: "2024-01-15", to_date: "2024-01-15" }),
    )) as Rec[];

    expect(events.length).toBe(2);
    expect(events[0]?.["event_name"]).toBe("PageView");
    expect(events[0]?.["distinct_id"]).toBe("user_1");
    expect(typeof events[0]?.["event_time"]).toBe("string");
    expect((events[0]?.["properties"] as Rec)["page"]).toBe("/home");
    expect(events[1]?.["event_name"]).toBe("Click");
    expect(events[1]?.["distinct_id"]).toBe("user_2");
    expect(stub.exportEventsCalls.length).toBe(1);
    await ws.close();
  });

  it("T006: an event-name filter forwards verbatim", async () => {
    const stub = stubClient();
    stub.setEvents(async function* () {
      yield rawEvent("Purchase", "user_1", 1705328400, { amount: 99.99 });
    });
    const ws = makeWorkspace(stub);

    const events = (await drain(
      ws.streamEvents({
        from_date: "2024-01-15",
        to_date: "2024-01-15",
        events: ["Purchase", "Signup"],
      }),
    )) as Rec[];

    expect(events.length).toBe(1);
    expect(events[0]?.["event_name"]).toBe("Purchase");
    expect(stub.exportEventsCalls).toEqual([
      {
        from_date: "2024-01-15",
        to_date: "2024-01-15",
        options: {
          events: ["Purchase", "Signup"],
          where: undefined,
          limit: undefined,
          signal: undefined,
        },
      },
    ]);
    await ws.close();
  });

  it("T006: a WHERE filter forwards verbatim", async () => {
    const stub = stubClient();
    stub.setEvents(async function* () {
      yield rawEvent("PageView", "user_1", 1705328400, { country: "US" });
    });
    const ws = makeWorkspace(stub);
    const whereClause = 'properties["country"]=="US"';

    const events = (await drain(
      ws.streamEvents({
        from_date: "2024-01-15",
        to_date: "2024-01-15",
        where: whereClause,
      }),
    )) as Rec[];

    expect(events.length).toBe(1);
    expect((events[0]?.["properties"] as Rec)["country"]).toBe("US");
    expect(stub.exportEventsCalls[0]?.options["where"]).toBe(whereClause);
    await ws.close();
  });

  it("T006: raw=true returns the Mixpanel API format", async () => {
    const stub = stubClient();
    stub.setEvents(async function* () {
      yield rawEvent("PageView", "user_1", 1705328400, { page: "/home" });
      yield rawEvent("Click", "user_2", 1705328500, { button: "signup" });
    });
    const ws = makeWorkspace(stub);

    const events = (await drain(
      ws.streamEvents({
        from_date: "2024-01-15",
        to_date: "2024-01-15",
        raw: true,
      }),
    )) as Rec[];

    expect(events.length).toBe(2);
    expect(events[0]?.["event"]).toBe("PageView");
    expect(Object.hasOwn(events[0] as Rec, "properties")).toBe(true);
    const props = events[0]?.["properties"] as Rec;
    expect(props["distinct_id"]).toBe("user_1");
    expect(props["time"]).toBe(1705328400);
    expect(props["$insert_id"]).toBe("evt_1705328400");
    await ws.close();
  });

  it("T006: raw=false (default) transforms the payload", async () => {
    const stub = stubClient();
    stub.setEvents(async function* () {
      yield rawEvent("Purchase", "user_123", 1705328400, { amount: 49.99 });
    });
    const ws = makeWorkspace(stub);

    const events = (await drain(
      ws.streamEvents({
        from_date: "2024-01-15",
        to_date: "2024-01-15",
        raw: false,
      }),
    )) as Rec[];

    expect(events.length).toBe(1);
    const event = events[0] as Rec;
    expect(event["event_name"]).toBe("Purchase");
    expect(event["distinct_id"]).toBe("user_123");
    // `isinstance(event_time, datetime)` + `tzinfo == utc` (see header).
    expect(event["event_time"]).toBe("2024-01-15T14:20:00+00:00");
    expect(event["insert_id"]).toBe("evt_1705328400");
    const props = event["properties"] as Rec;
    expect(Object.hasOwn(props, "distinct_id")).toBe(false);
    expect(Object.hasOwn(props, "time")).toBe(false);
    expect(Object.hasOwn(props, "$insert_id")).toBe(false);
    expect(props["amount"]).toBe(49.99);
    await ws.close();
  });

  it("returns an empty stream when the export yields nothing", async () => {
    const stub = stubClient();
    stub.setEvents(async function* () {});
    const ws = makeWorkspace(stub);

    const events = await drain(
      ws.streamEvents({ from_date: "2024-01-15", to_date: "2024-01-15" }),
    );

    expect(events).toEqual([]);
    await ws.close();
  });

  it("is a lazy iterator (nothing runs before the first pull)", async () => {
    const stub = stubClient();
    let callCount = 0;
    stub.setEvents(async function* () {
      for (let i = 0; i < 3; i += 1) {
        callCount += 1;
        yield rawEvent("Event", `user_${String(i)}`, 1705328400 + i);
      }
    });
    const ws = makeWorkspace(stub);

    const iterator = ws.streamEvents({
      from_date: "2024-01-15",
      to_date: "2024-01-15",
    });

    expect(callCount).toBe(0);
    await iterator.next();
    expect(callCount).toBe(1);
    await drain({ [Symbol.asyncIterator]: () => iterator });
    expect(callCount).toBe(3);
    await ws.close();
  });

  it("forwards the limit parameter", async () => {
    const stub = stubClient();
    stub.setEvents(async function* () {
      yield rawEvent("Event", "user_1", 1705328400);
    });
    const ws = makeWorkspace(stub);

    await drain(
      ws.streamEvents({
        from_date: "2024-01-15",
        to_date: "2024-01-15",
        limit: 5000,
      }),
    );

    expect(stub.exportEventsCalls[0]?.options["limit"]).toBe(5000);
    await ws.close();
  });
});

describe("TestStreamProfiles (test_workspace_streaming.py:369)", () => {
  it("T010: basic streaming with the default (normalized) format", async () => {
    const stub = stubClient();
    stub.setProfiles(async function* () {
      yield rawProfile("user_1", "2024-01-15T10:00:00", { name: "Alice" });
      yield rawProfile("user_2", "2024-01-15T11:00:00", { name: "Bob" });
    });
    const ws = makeWorkspace(stub);

    const profiles = (await drain(ws.streamProfiles())) as Rec[];

    expect(profiles.length).toBe(2);
    expect(profiles[0]?.["distinct_id"]).toBe("user_1");
    expect(profiles[0]?.["last_seen"]).toBe("2024-01-15T10:00:00");
    expect((profiles[0]?.["properties"] as Rec)["name"]).toBe("Alice");
    expect(profiles[1]?.["distinct_id"]).toBe("user_2");
    expect((profiles[1]?.["properties"] as Rec)["name"]).toBe("Bob");
    // Python asserts the full kwargs bag; TS omits absent keys (R3.9)
    // so the equivalent lock is "no filter keys were invented".
    expect(stub.exportProfilesCalls).toEqual([{}]);
    await ws.close();
  });

  it("T010: a WHERE filter forwards verbatim", async () => {
    const stub = stubClient();
    stub.setProfiles(async function* () {
      yield rawProfile("user_1", null, { plan: "premium" });
    });
    const ws = makeWorkspace(stub);
    const whereClause = 'properties["plan"]=="premium"';

    const profiles = (await drain(
      ws.streamProfiles({ where: whereClause }),
    )) as Rec[];

    expect(profiles.length).toBe(1);
    expect((profiles[0]?.["properties"] as Rec)["plan"]).toBe("premium");
    expect(stub.exportProfilesCalls).toEqual([{ where: whereClause }]);
    await ws.close();
  });

  it("forwards cohort_id", async () => {
    const stub = stubClient();
    stub.setProfiles(async function* () {
      yield rawProfile("user_1", null, { plan: "premium" });
    });
    const ws = makeWorkspace(stub);

    const profiles = await drain(
      ws.streamProfiles({ cohort_id: "cohort_12345" }),
    );

    expect(profiles.length).toBe(1);
    expect(stub.exportProfilesCalls).toEqual([{ cohort_id: "cohort_12345" }]);
    await ws.close();
  });

  it("forwards output_properties", async () => {
    const stub = stubClient();
    stub.setProfiles(async function* () {
      yield rawProfile("user_1", null, { email: "test@example.com" });
    });
    const ws = makeWorkspace(stub);

    const profiles = await drain(
      ws.streamProfiles({ output_properties: ["$email", "$name", "plan"] }),
    );

    expect(profiles.length).toBe(1);
    expect(stub.exportProfilesCalls).toEqual([
      { output_properties: ["$email", "$name", "plan"] },
    ]);
    await ws.close();
  });

  it("forwards every filter together", async () => {
    const stub = stubClient();
    stub.setProfiles(async function* () {
      yield rawProfile("user_1", null);
    });
    const ws = makeWorkspace(stub);
    const whereClause = 'properties["plan"]=="premium"';

    await drain(
      ws.streamProfiles({
        where: whereClause,
        cohort_id: "cohort_abc",
        output_properties: ["$email"],
      }),
    );

    expect(stub.exportProfilesCalls).toEqual([
      {
        where: whereClause,
        cohort_id: "cohort_abc",
        output_properties: ["$email"],
      },
    ]);
    await ws.close();
  });

  it("T010: raw=true returns the Mixpanel API format", async () => {
    const stub = stubClient();
    stub.setProfiles(async function* () {
      yield rawProfile("user_1", "2024-01-15T10:00:00", { name: "Alice" });
      yield rawProfile("user_2", null, { name: "Bob" });
    });
    const ws = makeWorkspace(stub);

    const profiles = (await drain(ws.streamProfiles({ raw: true }))) as Rec[];

    expect(profiles.length).toBe(2);
    expect(profiles[0]?.["$distinct_id"]).toBe("user_1");
    expect(Object.hasOwn(profiles[0] as Rec, "$properties")).toBe(true);
    const first = profiles[0]?.["$properties"] as Rec;
    expect(first["$last_seen"]).toBe("2024-01-15T10:00:00");
    expect(first["name"]).toBe("Alice");
    const second = profiles[1]?.["$properties"] as Rec;
    expect(Object.hasOwn(second, "$last_seen")).toBe(false);
    await ws.close();
  });

  it("T010: raw=false (default) transforms the payload", async () => {
    const stub = stubClient();
    stub.setProfiles(async function* () {
      yield rawProfile("user_abc", "2024-01-15T14:30:00", {
        email: "test@example.com",
      });
    });
    const ws = makeWorkspace(stub);

    const profiles = (await drain(ws.streamProfiles({ raw: false }))) as Rec[];

    expect(profiles.length).toBe(1);
    const profile = profiles[0] as Rec;
    expect(profile["distinct_id"]).toBe("user_abc");
    expect(profile["last_seen"]).toBe("2024-01-15T14:30:00");
    const props = profile["properties"] as Rec;
    expect(props["email"]).toBe("test@example.com");
    expect(Object.hasOwn(props, "$last_seen")).toBe(false);
    await ws.close();
  });

  it("returns an empty stream when the export yields nothing", async () => {
    const stub = stubClient();
    stub.setProfiles(async function* () {});
    const ws = makeWorkspace(stub);

    expect(await drain(ws.streamProfiles())).toEqual([]);
    await ws.close();
  });
});

describe("TestNormalizedEventFormat (test_workspace_streaming.py:622)", () => {
  it("T019: normalized events carry every required field", async () => {
    const stub = stubClient();
    stub.setEvents(async function* () {
      yield rawEvent("Purchase", "user_abc123", 1705328400, { amount: 99.99 });
    });
    const ws = makeWorkspace(stub);

    const events = (await drain(
      ws.streamEvents({ from_date: "2024-01-15", to_date: "2024-01-15" }),
    )) as Rec[];

    const event = events[0] as Rec;
    for (const key of [
      "event_name",
      "event_time",
      "distinct_id",
      "insert_id",
      "properties",
    ]) {
      expect(Object.hasOwn(event, key)).toBe(true);
    }
    expect(typeof event["event_name"]).toBe("string");
    // datetime → ISO text (see file header).
    expect(event["event_time"]).toBe("2024-01-15T14:20:00+00:00");
    expect(typeof event["distinct_id"]).toBe("string");
    expect(typeof event["insert_id"]).toBe("string");
    expect(typeof event["properties"]).toBe("object");
    await ws.close();
  });
});

describe("TestRawEventFormat (test_workspace_streaming.py:659)", () => {
  it("T020: raw events keep the Mixpanel API structure", async () => {
    const stub = stubClient();
    stub.setEvents(async function* () {
      yield rawEvent("Purchase", "user_abc123", 1705328400, { amount: 99.99 });
    });
    const ws = makeWorkspace(stub);

    const events = (await drain(
      ws.streamEvents({
        from_date: "2024-01-15",
        to_date: "2024-01-15",
        raw: true,
      }),
    )) as Rec[];

    const event = events[0] as Rec;
    expect(Object.hasOwn(event, "event")).toBe(true);
    expect(Object.hasOwn(event, "properties")).toBe(true);
    const props = event["properties"] as Rec;
    expect(props["time"]).toBe(1705328400);
    expect(props["distinct_id"]).toBe("user_abc123");
    expect(Object.hasOwn(props, "$insert_id")).toBe(true);
    await ws.close();
  });
});

describe("TestNormalizedProfileFormat (test_workspace_streaming.py:689)", () => {
  it("T021: normalized profiles carry every required field", async () => {
    const stub = stubClient();
    stub.setProfiles(async function* () {
      yield rawProfile("user_abc123", "2024-01-15T14:30:00", {
        name: "Alice",
      });
    });
    const ws = makeWorkspace(stub);

    const profiles = (await drain(ws.streamProfiles())) as Rec[];

    const profile = profiles[0] as Rec;
    for (const key of ["distinct_id", "last_seen", "properties"]) {
      expect(Object.hasOwn(profile, key)).toBe(true);
    }
    expect(typeof profile["distinct_id"]).toBe("string");
    expect(
      typeof profile["last_seen"] === "string" || profile["last_seen"] === null,
    ).toBe(true);
    expect(typeof profile["properties"]).toBe("object");
    await ws.close();
  });
});

describe("TestRawProfileFormat (test_workspace_streaming.py:720)", () => {
  it("T022: raw profiles keep the `$`-prefixed API structure", async () => {
    const stub = stubClient();
    stub.setProfiles(async function* () {
      yield rawProfile("user_abc123", "2024-01-15T14:30:00", {
        name: "Alice",
      });
    });
    const ws = makeWorkspace(stub);

    const profiles = (await drain(ws.streamProfiles({ raw: true }))) as Rec[];

    const profile = profiles[0] as Rec;
    expect(Object.hasOwn(profile, "$distinct_id")).toBe(true);
    expect(Object.hasOwn(profile, "$properties")).toBe(true);
    expect(profile["$distinct_id"]).toBe("user_abc123");
    expect((profile["$properties"] as Rec)["$last_seen"]).toBe(
      "2024-01-15T14:30:00",
    );
    await ws.close();
  });
});

describe("W1-D3 — the streaming veneers stay PROJECT-scoped", () => {
  it("a pinned workspace does not leak into the export options", async () => {
    // `workspace.py:566-573`: "Raw export streaming remains
    // project-scoped by design."
    const stub = stubClient();
    stub.setEvents(async function* () {});
    const ws = new Workspace({
      session: makeSession({ workspaceId: 4242 }),
      client: stub.client,
    });

    await drain(
      ws.streamEvents({ from_date: "2024-01-15", to_date: "2024-01-15" }),
    );

    expect(
      Object.hasOwn(stub.exportEventsCalls[0]?.options ?? {}, "workspace_id"),
    ).toBe(false);
    await ws.close();
  });
});
