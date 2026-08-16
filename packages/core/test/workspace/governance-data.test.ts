// B6-W7 Layer-3 translation (packet `b6-packets.md` §9) — the class
// split of `tests/unit/test_workspace_data_governance.py` (1,842 lines)
// that W7 owns:
//
//   drop filters      : `TestListDropFilters` (:623),
//     `TestCreateDropFilter` (:663), `TestUpdateDropFilter` (:694),
//     `TestDeleteDropFilter` (:720), `TestGetDropFilterLimits` (:743)
//   custom properties : `TestListCustomProperties` (:771),
//     `TestCreateCustomProperty` (:811), `TestGetCustomProperty` (:843),
//     `TestUpdateCustomProperty` (:867), `TestDeleteCustomProperty`
//     (:891), `TestValidateCustomProperty` (:905)
//   custom events     : `TestCreateCustomEvent` (:939),
//     `TestListCustomEvents` (:1016), `TestUpdateCustomEvent` (:1055),
//     `TestDeleteCustomEvent` (:1146)
//   lookup tables     : `TestListLookupTables` (:1363),
//     `TestUploadLookupTable` (:1423), `TestMarkLookupTableReady`
//     (:1648), `TestGetLookupUploadUrl` (:1672),
//     `TestGetLookupUploadStatus` (:1723), `TestUpdateLookupTable`
//     (:1751), `TestDeleteLookupTables` (:1775),
//     `TestDownloadLookupTable` (:1789), `TestGetLookupDownloadUrl`
//     (:1822)
//
// The lexicon / tags / tracking-history classes in the same Python file
// belong to W6 (`b6-packets.md` §8) and are NOT re-translated here.
//
// Python's `httpx.MockTransport` handler becomes the injected-fetch
// `fakeTransport` seam; `_make_workspace(temp_dir, handler)` (:97-116)
// becomes `makeWorkspace(handler)` — the client is built over the OAuth
// session (`_make_oauth_credentials`, :82-88) while the facade carries
// the service-account `_TEST_SESSION` (:66-75), exactly as Python does.
// `temp_dir` has no TS analog EXCEPT in `TestUploadLookupTable`, where
// Python writes a real CSV and the facade reads it with
// `Path(...).read_bytes()`; the TS twin injects the W7-D1 `readFile`
// seam with the same bytes (packet §9 W7-D1: `packages/core` is
// runtime-agnostic, so `node:fs` is a B8 wiring job).
//
// ADDITIVE sections (clearly headed, never substituting for a
// translated Python assertion — B5 Caution #13 / packet §0.2): the
// facade-local branches Python's suite does not cover — the
// `displayFormula` corruption re-raise (`workspace.py:7766-7786`), the
// `to_form_body` JSON spelling, the `readFile` seam default, the
// `REVOKED` / `NOTFOUND` / non-dict-result poll arms
// (`workspace.py:8106-8131`) and the per-member delegation contracts
// (which client method, with which arguments).

import { describe, expect, it } from "vitest";
import { Workspace, type WorkspaceOptions } from "../../src/workspace.js";
import {
  createMockClient,
  makeSession,
  type CannedResponse,
  type CapturedFetchRequest,
  type FakeTransport,
} from "../client/client-test-helpers.js";
import type { MixpanelClient } from "../../src/client/client.js";
import {
  AuthenticationError,
  MixpanelHeadlessError,
  QueryError,
  ResponseValidationError,
} from "../../src/errors.js";
import {
  ComposedPropertyValue,
  CreateCustomEventParams,
  CreateCustomPropertyParams,
  CreateDropFilterParams,
  CustomEvent,
  CustomProperty,
  DropFilter,
  DropFilterLimitsResponse,
  LookupTable,
  LookupTableUploadUrl,
  MarkLookupTableReadyParams,
  UpdateCustomPropertyParams,
  UpdateDropFilterParams,
  UpdateLookupTableParams,
  UploadLookupTableParams,
} from "../../src/types/entities/data-governance.js";
import {
  EventDefinition,
  UpdateEventDefinitionParams,
} from "../../src/types/entities/lexicon.js";
import { CustomPropertyResourceType } from "../../src/types/enums.js";
import {
  listCustomProperties as listCustomPropertiesMember,
  uploadLookupTable as uploadLookupTableMember,
  type LookupUploadSeams,
} from "../../src/workspace-members/governance-data.js";

/** A canned-response handler (the `httpx.MockTransport` handler twin). */
type Handler = (request: CapturedFetchRequest) => CannedResponse;

/** The OAuth session the mock client is built over (`:82-88`). */
const CLIENT_SESSION = makeSession({
  projectId: "12345",
  region: "us",
  oauthToken: "test-token",
});

/** The canonical service-account facade session (`_TEST_SESSION`, :66-75). */
const FACADE_SESSION = makeSession({
  projectId: "12345",
  region: "us",
  username: "test_user",
  secret: "test_secret",
});

/**
 * Build a Workspace whose client routes through `handler`
 * (`_make_workspace`, :97-116).
 *
 * @param handler - The canned-response handler.
 * @param options - Extra facade options (the W7-D1/D2 seams).
 * @param sleep - Optional client sleep override (the virtual clock).
 * @returns The facade plus the transport capture log.
 */
function makeWorkspace(
  handler: Handler,
  options: Partial<WorkspaceOptions> = {},
  sleep?: (ms: number) => Promise<void>,
): { ws: Workspace; transport: FakeTransport } {
  const { client, transport } = createMockClient(
    CLIENT_SESSION,
    handler,
    sleep !== undefined ? { sleep } : {},
  );
  return {
    ws: new Workspace({ session: FACADE_SESSION, client, ...options }),
    transport,
  };
}

/**
 * A 200 App-API envelope wrapping `results`.
 *
 * @param results - The `results` payload.
 * @returns The canned response.
 */
function ok(results: unknown): CannedResponse {
  return { status: 200, json: { status: "ok", results } };
}

/**
 * A 200 App-API envelope with NO `results` key (the Python
 * `{"status": "ok"}` delete responses).
 *
 * @returns The canned response.
 */
function okBare(): CannedResponse {
  return { status: 200, json: { status: "ok" } };
}

/**
 * A minimal drop filter dict matching the API shape
 * (`_drop_filter_json`, :187-205).
 *
 * @param id - Drop filter ID.
 * @param eventName - Event name to filter.
 * @returns The payload record.
 */
function dropFilterJson(
  id = 1,
  eventName = "debug_log",
): Record<string, unknown> {
  return { id, event_name: eventName, filters: [], active: true };
}

/**
 * A minimal custom property dict matching the API shape
 * (`_custom_property_json`, :208-230).
 *
 * @param customPropertyId - Custom property ID.
 * @param name - Property name.
 * @param resourceType - Resource type.
 * @returns The payload record.
 */
function customPropertyJson(
  customPropertyId = 1,
  name = "Revenue",
  resourceType = "events",
): Record<string, unknown> {
  return {
    custom_property_id: customPropertyId,
    name,
    resource_type: resourceType,
    description: `Custom property ${name}`,
    display_formula: 'number(properties["amount"])',
    is_visible: true,
  };
}

/**
 * A minimal lookup table dict matching the API shape
 * (`_lookup_table_json`, :233-251).
 *
 * @param id - Lookup table ID.
 * @param name - Table name.
 * @returns The payload record.
 */
function lookupTableJson(id = 1, name = "Products"): Record<string, unknown> {
  return { id, name, token: "abc123", created_at: "2026-01-01T00:00:00Z" };
}

/**
 * A minimal event definition dict matching the API shape
 * (`_event_def_json`, :124-143).
 *
 * @param id - Event definition ID.
 * @param name - Event name.
 * @returns The payload record.
 */
function eventDefJson(id = 1, name = "Purchase"): Record<string, unknown> {
  return {
    id,
    name,
    description: `Description for ${name}`,
    hidden: false,
    dropped: false,
  };
}

/**
 * A client stub whose single method returns `value` (the additive
 * delegation probes — the W6 `stubClient` pattern).
 *
 * @param method - The client method name to stub.
 * @param value - The value the stub resolves to.
 * @param calls - Optional log receiving each argument list.
 * @returns The stub cast to the client type.
 */
function stubClient(
  method: string,
  value: unknown,
  calls: unknown[][] = [],
): MixpanelClient {
  return {
    // The facade installs a `/me` workspace resolver at construction
    // (`workspace.py:775-793`), so every stub must accept one.
    hasWorkspaceResolver: false,
    setWorkspaceResolver: (): void => {},
    [method]: (...args: unknown[]): Promise<unknown> => {
      calls.push(args);
      return Promise.resolve(value);
    },
  } as unknown as MixpanelClient;
}

/**
 * A client stub whose single method REJECTS with `error`.
 *
 * @param method - The client method name to stub.
 * @param error - The rejection value.
 * @returns The stub cast to the client type.
 */
function throwingClient(method: string, error: unknown): MixpanelClient {
  return {
    [method]: (): Promise<never> => Promise.reject(error),
  } as unknown as MixpanelClient;
}

/**
 * A virtual monotonic clock whose `sleep` advances it — the
 * deterministic twin of Python's `time.sleep` + `time.monotonic` in
 * `_poll_lookup_upload` (`workspace.py:8099-8102`). Real timers are
 * banned in Layer-3 (playbook risk #4).
 *
 * @returns The `monotonic` seam plus the matching client `sleep`.
 */
function virtualClock(): {
  monotonic: () => number;
  sleep: (ms: number) => Promise<void>;
  slept: number[];
} {
  let seconds = 0;
  const slept: number[] = [];
  return {
    monotonic: (): number => seconds,
    sleep: (ms: number): Promise<void> => {
      slept.push(ms);
      seconds += ms / 1000;
      return Promise.resolve();
    },
    slept,
  };
}

/**
 * The `readFile` seam returning fixed bytes (the tmp-CSV twin).
 *
 * @param content - The CSV text.
 * @param paths - Optional log receiving each requested path.
 * @returns The seam.
 */
function fakeReadFile(
  content: string,
  paths: string[] = [],
): (path: string) => Promise<Uint8Array> {
  return (path: string): Promise<Uint8Array> => {
    paths.push(path);
    return Promise.resolve(new TextEncoder().encode(content));
  };
}

// =============================================================================
// US3: Drop Filters
// =============================================================================

describe("TestListDropFilters", () => {
  it("list_drop_filters() returns list of DropFilter objects", async () => {
    const { ws } = makeWorkspace(() =>
      ok([dropFilterJson(1, "debug_log"), dropFilterJson(2, "test_event")]),
    );
    const filters = await ws.listDropFilters();

    expect(filters).toHaveLength(2);
    expect(filters[0]).toBeInstanceOf(DropFilter);
    expect(filters[0]?.event_name).toBe("debug_log");
    expect(filters[1]?.id).toBe(2);
  });

  it("list_drop_filters() returns empty list when none exist", async () => {
    const { ws } = makeWorkspace(() => ok([]));
    expect(await ws.listDropFilters()).toEqual([]);
  });
});

describe("TestCreateDropFilter", () => {
  it("create_drop_filter() returns the full list of DropFilter objects", async () => {
    const { ws } = makeWorkspace(() =>
      ok([dropFilterJson(1, "debug_log"), dropFilterJson(2, "new_filter")]),
    );
    const params = new CreateDropFilterParams({
      event_name: "new_filter",
      filters: { property: "env", operator: "equals", value: "test" },
    });
    const result = await ws.createDropFilter(params);

    expect(result).toHaveLength(2);
    expect(result[0]).toBeInstanceOf(DropFilter);
    expect(result[1]?.event_name).toBe("new_filter");
  });
});

describe("TestUpdateDropFilter", () => {
  it("update_drop_filter() returns the full list of DropFilter objects", async () => {
    const { ws } = makeWorkspace(() => ok([dropFilterJson(1, "debug_log")]));
    const params = new UpdateDropFilterParams({ id: 1, active: false });
    const result = await ws.updateDropFilter(params);

    expect(result).toHaveLength(1);
    expect(result[0]).toBeInstanceOf(DropFilter);
  });
});

describe("TestDeleteDropFilter", () => {
  it("delete_drop_filter() returns the remaining list of DropFilter objects", async () => {
    const { ws } = makeWorkspace(() => ok([dropFilterJson(2, "kept_filter")]));
    const result = await ws.deleteDropFilter(1);

    expect(result).toHaveLength(1);
    expect(result[0]?.event_name).toBe("kept_filter");
  });
});

describe("TestGetDropFilterLimits", () => {
  it("get_drop_filter_limits() returns DropFilterLimitsResponse", async () => {
    const { ws } = makeWorkspace(() => ok({ filter_limit: 10 }));
    const limits = await ws.getDropFilterLimits();

    expect(limits).toBeInstanceOf(DropFilterLimitsResponse);
    expect(limits.filter_limit).toBe(10);
  });
});

// =============================================================================
// US4: Custom Properties
// =============================================================================

describe("TestListCustomProperties", () => {
  it("list_custom_properties() returns list of CustomProperty objects", async () => {
    const { ws } = makeWorkspace(() =>
      ok([
        customPropertyJson(1, "Revenue", "events"),
        customPropertyJson(2, "LTV", "people"),
      ]),
    );
    const props = await ws.listCustomProperties();

    expect(props).toHaveLength(2);
    expect(props[0]).toBeInstanceOf(CustomProperty);
    expect(props[0]?.name).toBe("Revenue");
    expect(props[1]?.resource_type).toBe("people");
  });

  it("list_custom_properties() returns empty list when none exist", async () => {
    const { ws } = makeWorkspace(() => ok([]));
    expect(await ws.listCustomProperties()).toEqual([]);
  });
});

describe("TestCreateCustomProperty", () => {
  it("create_custom_property() returns the created CustomProperty", async () => {
    const { ws } = makeWorkspace(() =>
      ok(customPropertyJson(99, "New Prop", "events")),
    );
    const params = new CreateCustomPropertyParams({
      name: "New Prop",
      resource_type: CustomPropertyResourceType.EVENTS,
      display_formula: 'number(properties["amount"])',
      composed_properties: {
        amount: new ComposedPropertyValue({ resource_type: "event" }),
      },
    });
    const prop = await ws.createCustomProperty(params);

    expect(prop).toBeInstanceOf(CustomProperty);
    expect(prop.custom_property_id).toBe(99);
    expect(prop.name).toBe("New Prop");
  });
});

describe("TestGetCustomProperty", () => {
  it("get_custom_property() returns a single CustomProperty by ID", async () => {
    const { ws } = makeWorkspace(() =>
      ok(customPropertyJson(42, "Revenue", "events")),
    );
    const prop = await ws.getCustomProperty("42");

    expect(prop).toBeInstanceOf(CustomProperty);
    expect(prop.custom_property_id).toBe(42);
    expect(prop.name).toBe("Revenue");
  });
});

describe("TestUpdateCustomProperty", () => {
  it("update_custom_property() returns the updated CustomProperty", async () => {
    const { ws } = makeWorkspace(() =>
      ok(customPropertyJson(42, "Renamed", "events")),
    );
    const params = new UpdateCustomPropertyParams({ name: "Renamed" });
    const prop = await ws.updateCustomProperty("42", params);

    expect(prop).toBeInstanceOf(CustomProperty);
    expect(prop.name).toBe("Renamed");
  });
});

describe("TestDeleteCustomProperty", () => {
  it("delete_custom_property() returns None on success", async () => {
    const { ws } = makeWorkspace(() => okBare());
    await expect(ws.deleteCustomProperty("42")).resolves.toBeUndefined();
  });
});

describe("TestValidateCustomProperty", () => {
  it("validate_custom_property() returns an opaque dict", async () => {
    const { ws } = makeWorkspace(() => ok({ valid: true, errors: [] }));
    const params = new CreateCustomPropertyParams({
      name: "Test Prop",
      resource_type: CustomPropertyResourceType.EVENTS,
      display_formula: 'number(properties["x"])',
      composed_properties: {
        x: new ComposedPropertyValue({ resource_type: "event" }),
      },
    });
    const result = await ws.validateCustomProperty(params);

    expect(typeof result).toBe("object");
    expect(result["valid"]).toBe(true);
  });
});

// =============================================================================
// US6: Custom Events
// =============================================================================

describe("TestCreateCustomEvent", () => {
  it("create_custom_event() returns a typed CustomEvent built from the API response", async () => {
    const { ws } = makeWorkspace(() => ({
      status: 200,
      json: {
        custom_event: {
          id: 42,
          name: "Page View",
          alternatives: [{ event: "Home" }, { event: "Product" }],
        },
      },
    }));
    const result = await ws.createCustomEvent(
      new CreateCustomEventParams({
        name: "Page View",
        alternatives: ["Home", "Product"],
      }),
    );

    expect(result).toBeInstanceOf(CustomEvent);
    expect(result.id).toBe(42);
    expect(result.name).toBe("Page View");
    expect(result.alternatives.map((a) => a.event)).toEqual([
      "Home",
      "Product",
    ]);
  });

  it("create_custom_event() POSTs alternatives as JSON list of {event:...} dicts", async () => {
    const captured: CapturedFetchRequest[] = [];
    const { ws } = makeWorkspace((request) => {
      captured.push(request);
      return {
        status: 200,
        json: { custom_event: { id: 1, name: "X", alternatives: [] } },
      };
    });
    await ws.createCustomEvent(
      new CreateCustomEventParams({ name: "X", alternatives: ["A", "B"] }),
    );

    const body = new URLSearchParams(captured[0]?.bodyText ?? "");
    expect(JSON.parse(body.get("alternatives") ?? "null")).toEqual([
      { event: "A" },
      { event: "B" },
    ]);
    expect(body.get("name")).toBe("X");
    expect(captured[0]?.headers["content-type"]).toMatch(
      /^application\/x-www-form-urlencoded/,
    );
  });

  it("create_custom_event() surfaces 401 as AuthenticationError", async () => {
    const { ws } = makeWorkspace(() => ({
      status: 401,
      json: { error: "unauthorized" },
    }));
    await expect(
      ws.createCustomEvent(
        new CreateCustomEventParams({ name: "X", alternatives: ["A"] }),
      ),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });
});

describe("TestListCustomEvents", () => {
  it("list_custom_events() returns list of EventDefinition objects", async () => {
    const { ws } = makeWorkspace(() =>
      ok([eventDefJson(1, "CustomEvent1"), eventDefJson(2, "CustomEvent2")]),
    );
    const events = await ws.listCustomEvents();

    expect(events).toHaveLength(2);
    expect(events[0]).toBeInstanceOf(EventDefinition);
    expect(events[0]?.name).toBe("CustomEvent1");
  });

  it("list_custom_events() returns empty list when none exist", async () => {
    const { ws } = makeWorkspace(() => ok([]));
    expect(await ws.listCustomEvents()).toEqual([]);
  });
});

describe("TestUpdateCustomEvent", () => {
  it("update_custom_event() returns the updated EventDefinition", async () => {
    const { ws } = makeWorkspace(() => ok(eventDefJson(1, "CustomEvent1")));
    const params = new UpdateEventDefinitionParams({ description: "Updated" });
    const result = await ws.updateCustomEvent(2044168, params);

    expect(result).toBeInstanceOf(EventDefinition);
    expect(result.name).toBe("CustomEvent1");
  });

  it("update_custom_event() must send customEventId in the PATCH body", async () => {
    const captured: CapturedFetchRequest[] = [];
    const { ws } = makeWorkspace((request) => {
      captured.push(request);
      return ok(eventDefJson(1, "CustomEvent1"));
    });
    const params = new UpdateEventDefinitionParams({
      description: "Updated",
      verified: true,
    });
    await ws.updateCustomEvent(2044168, params);

    const body = JSON.parse(captured[0]?.bodyText ?? "null") as Record<
      string,
      unknown
    >;
    expect(body["customEventId"]).toBe(2044168);
    expect(Object.hasOwn(body, "name")).toBe(false);
    expect(body["description"]).toBe("Updated");
    expect(body["verified"]).toBe(true);
  });

  it("update_custom_event() raises if server echoes a different id", async () => {
    const { ws } = makeWorkspace(() =>
      ok({ ...eventDefJson(1, "CustomEvent1"), customEventId: 99999 }),
    );
    const params = new UpdateEventDefinitionParams({ description: "Updated" });
    await expect(ws.updateCustomEvent(2044168, params)).rejects.toSatisfy(
      (error: unknown) => {
        expect(error).toBeInstanceOf(MixpanelHeadlessError);
        const err = error as MixpanelHeadlessError;
        expect(err.code).toBe("UPDATE_TARGET_MISMATCH");
        expect(err.message).toContain("99999");
        expect(err.message).toContain("2044168");
        return true;
      },
    );
  });
});

describe("TestDeleteCustomEvent", () => {
  it("delete_custom_event() returns None on success", async () => {
    const { ws } = makeWorkspace(() => okBare());
    await expect(ws.deleteCustomEvent(2044168)).resolves.toBeUndefined();
  });

  it("delete_custom_event() must send customEventId in the DELETE body", async () => {
    const captured: CapturedFetchRequest[] = [];
    const { ws } = makeWorkspace((request) => {
      captured.push(request);
      return okBare();
    });
    await ws.deleteCustomEvent(2044168);

    const body = JSON.parse(captured[0]?.bodyText ?? "null") as Record<
      string,
      unknown
    >;
    expect(body["customEventId"]).toBe(2044168);
    expect(Object.hasOwn(body, "name")).toBe(false);
  });
});

// =============================================================================
// US5: Lookup Tables
// =============================================================================

describe("TestListLookupTables", () => {
  it("list_lookup_tables() returns list of LookupTable objects", async () => {
    const { ws } = makeWorkspace(() =>
      ok([lookupTableJson(1, "Products"), lookupTableJson(2, "Categories")]),
    );
    const tables = await ws.listLookupTables();

    expect(tables).toHaveLength(2);
    expect(tables[0]).toBeInstanceOf(LookupTable);
    expect(tables[0]?.name).toBe("Products");
    expect(tables[1]?.id).toBe(2);
  });

  it("list_lookup_tables() returns empty list when none exist", async () => {
    const { ws } = makeWorkspace(() => ok([]));
    expect(await ws.listLookupTables()).toEqual([]);
  });

  it("list_lookup_tables(data_group_id=5) passes param to API", async () => {
    const capturedUrls: string[] = [];
    const { ws } = makeWorkspace((request) => {
      capturedUrls.push(request.url);
      return ok([lookupTableJson()]);
    });
    const tables = await ws.listLookupTables({ data_group_id: 5 });

    expect(tables).toHaveLength(1);
    // ADDITIVE: Python captures the URL but only asserts the length
    // (:1402-1420); the `data-group-id` param spelling is the B4
    // client's contract.
    expect(capturedUrls[0]).toContain("data-group-id=5");
  });
});

describe("TestUploadLookupTable", () => {
  /**
   * The three-step upload handler (`:1430-1460`).
   *
   * @param registerResult - The `results` payload of step 3.
   * @param statusResults - Successive `results` payloads of the status
   *   polls.
   * @param log - Counters mutated by the handler.
   * @returns The handler.
   */
  function uploadHandler(
    registerResult: unknown,
    statusResults: readonly unknown[] = [],
    log: { requests: number; polls: number } = { requests: 0, polls: 0 },
  ): Handler {
    return (request: CapturedFetchRequest): CannedResponse => {
      log.requests += 1;
      const url = request.url;
      if (url.includes("upload-url") || url.includes("upload_url")) {
        return ok({
          url: "https://storage.googleapis.com/upload",
          path: "gs://bucket/path",
          key: "product_id",
        });
      }
      if (url.includes("storage.googleapis.com")) {
        return { status: 200, text: "" };
      }
      if (!url.includes("upload-status") && request.method === "POST") {
        return ok(registerResult);
      }
      const index = Math.min(log.polls, statusResults.length - 1);
      log.polls += 1;
      return ok(statusResults[index] ?? {});
    };
  }

  it("upload_lookup_table() handles get URL, upload, register steps", async () => {
    const log = { requests: 0, polls: 0 };
    const paths: string[] = [];
    const { ws } = makeWorkspace(
      uploadHandler(lookupTableJson(99, "Products"), [], log),
      {
        readFile: fakeReadFile("product_id,name\n1,Widget\n2,Gadget\n", paths),
      },
    );
    const params = new UploadLookupTableParams({
      name: "Products",
      file_path: "/tmp/products.csv",
    });
    const result = await ws.uploadLookupTable(params);

    expect(result).toBeInstanceOf(LookupTable);
    expect(result.name).toBe("Products");
    expect(result.id).toBe(99);
    expect(log.requests).toBeGreaterThanOrEqual(2);
    // ADDITIVE (W7-D1): the CSV is read through the injected seam.
    expect(paths).toEqual(["/tmp/products.csv"]);
  });

  it("upload_lookup_table() polls status for async uploads (>= 5 MB)", async () => {
    const log = { requests: 0, polls: 0 };
    const clock = virtualClock();
    const { ws } = makeWorkspace(
      uploadHandler(
        { uploadId: "task-abc-123" },
        [
          { uploadStatus: "PENDING" },
          {
            uploadStatus: "SUCCESS",
            result: lookupTableJson(99, "BigTable"),
          },
        ],
        log,
      ),
      {
        readFile: fakeReadFile("product_id,name\n1,Widget\n"),
        monotonic: clock.monotonic,
      },
      clock.sleep,
    );
    const params = new UploadLookupTableParams({
      name: "BigTable",
      file_path: "/tmp/big.csv",
    });
    const result = await ws.uploadLookupTable(params, { poll_interval: 0.01 });

    expect(result).toBeInstanceOf(LookupTable);
    expect(result.name).toBe("BigTable");
    expect(result.id).toBe(99);
    expect(log.polls).toBeGreaterThanOrEqual(2);
  });

  it("upload_lookup_table() raises MixpanelHeadlessError on async timeout", async () => {
    const clock = virtualClock();
    const { ws } = makeWorkspace(
      uploadHandler({ uploadId: "task-timeout" }, [
        { uploadStatus: "PENDING" },
      ]),
      {
        readFile: fakeReadFile("product_id,name\n1,Widget\n"),
        monotonic: clock.monotonic,
      },
      clock.sleep,
    );
    const params = new UploadLookupTableParams({
      name: "BigTable",
      file_path: "/tmp/big.csv",
    });

    const call = ws.uploadLookupTable(params, {
      poll_interval: 0.01,
      max_poll_seconds: 0.05,
    });
    // B6-ARB (assertions Finding C): Python asserts BOTH the class and
    // the message (`pytest.raises(MixpanelHeadlessError, match="timed out")`,
    // test_workspace_data_governance.py:1594).
    await expect(call).rejects.toBeInstanceOf(MixpanelHeadlessError);
    await expect(call).rejects.toThrow(/timed out/);
  });

  it("upload_lookup_table() raises MixpanelHeadlessError on async failure", async () => {
    const clock = virtualClock();
    const { ws } = makeWorkspace(
      uploadHandler({ uploadId: "task-fail" }, [{ uploadStatus: "FAILURE" }]),
      {
        readFile: fakeReadFile("product_id,name\n1,Widget\n"),
        monotonic: clock.monotonic,
      },
      clock.sleep,
    );
    const params = new UploadLookupTableParams({
      name: "BadTable",
      file_path: "/tmp/bad.csv",
    });

    const call = ws.uploadLookupTable(params, { poll_interval: 0.01 });
    // B6-ARB (assertions Finding C): Python asserts BOTH the class and
    // the message (`pytest.raises(MixpanelHeadlessError, match="failed")`,
    // test_workspace_data_governance.py:1644).
    await expect(call).rejects.toBeInstanceOf(MixpanelHeadlessError);
    await expect(call).rejects.toThrow(/failed/);
  });
});

describe("TestMarkLookupTableReady", () => {
  it("mark_lookup_table_ready() returns a LookupTable", async () => {
    const { ws } = makeWorkspace(() => ok(lookupTableJson(1, "Products")));
    const params = new MarkLookupTableReadyParams({
      name: "Products",
      key: "product_id",
    });
    const result = await ws.markLookupTableReady(params);

    expect(result).toBeInstanceOf(LookupTable);
    expect(result.name).toBe("Products");
  });
});

describe("TestGetLookupUploadUrl", () => {
  it("get_lookup_upload_url() returns LookupTableUploadUrl", async () => {
    const { ws } = makeWorkspace(() =>
      ok({
        url: "https://storage.googleapis.com/upload",
        path: "gs://bucket/path",
        key: "id",
      }),
    );
    const result = await ws.getLookupUploadUrl();

    expect(result).toBeInstanceOf(LookupTableUploadUrl);
    expect(result.url).toContain("storage.googleapis.com");
  });

  it("get_lookup_upload_url(content_type='text/csv') passes param", async () => {
    const capturedUrls: string[] = [];
    const { ws } = makeWorkspace((request) => {
      capturedUrls.push(request.url);
      return ok({
        url: "https://storage.googleapis.com/upload",
        path: "gs://bucket/path",
        key: "id",
      });
    });
    const result = await ws.getLookupUploadUrl("text/csv");

    expect(result).toBeInstanceOf(LookupTableUploadUrl);
    // ADDITIVE: Python captures the URL but asserts only the type
    // (:1698-1720).
    expect(capturedUrls[0]).toContain("content-type=text%2Fcsv");
  });
});

describe("TestGetLookupUploadStatus", () => {
  it("get_lookup_upload_status() returns an opaque dict", async () => {
    const { ws } = makeWorkspace(() =>
      ok({ upload_id: "abc123", state: "completed", rows_imported: 1000 }),
    );
    const result = await ws.getLookupUploadStatus("abc123");

    expect(typeof result).toBe("object");
    expect(result["state"]).toBe("completed");
    expect(result["rows_imported"]).toBe(1000);
  });
});

describe("TestUpdateLookupTable", () => {
  it("update_lookup_table() returns the updated LookupTable", async () => {
    const { ws } = makeWorkspace(() =>
      ok(lookupTableJson(1, "Renamed Catalog")),
    );
    const params = new UpdateLookupTableParams({ name: "Renamed Catalog" });
    const result = await ws.updateLookupTable(1, params);

    expect(result).toBeInstanceOf(LookupTable);
    expect(result.name).toBe("Renamed Catalog");
  });
});

describe("TestDeleteLookupTables", () => {
  it("delete_lookup_tables() returns None on success", async () => {
    const { ws } = makeWorkspace(() => okBare());
    await expect(ws.deleteLookupTables([1, 2])).resolves.toBeUndefined();
  });
});

describe("TestDownloadLookupTable", () => {
  it("download_lookup_table() returns raw bytes", async () => {
    const csvContent = "product_id,name\n1,Widget\n2,Gadget\n";
    const { ws } = makeWorkspace(() => ({ status: 200, text: csvContent }));
    const result = await ws.downloadLookupTable(1);

    expect(result).toBeInstanceOf(Uint8Array);
    const decoded = new TextDecoder().decode(result);
    expect(decoded).toContain("product_id");
    expect(decoded).toContain("Widget");
  });

  it("download_lookup_table() accepts optional file_name and limit", async () => {
    const capturedUrls: string[] = [];
    const { ws } = makeWorkspace((request) => {
      capturedUrls.push(request.url);
      return { status: 200, text: "id,name\n1,A\n" };
    });
    const result = await ws.downloadLookupTable(1, {
      file_name: "export.csv",
      limit: 100,
    });

    expect(result).toBeInstanceOf(Uint8Array);
    // ADDITIVE: Python captures the URL but asserts only the type
    // (:1807-1819).
    expect(capturedUrls[0]).toContain("file-name=export.csv");
    expect(capturedUrls[0]).toContain("limit=100");
  });
});

describe("TestGetLookupDownloadUrl", () => {
  it("get_lookup_download_url() returns a signed download URL string", async () => {
    const { ws } = makeWorkspace(() =>
      ok("https://storage.googleapis.com/download/abc"),
    );
    const result = await ws.getLookupDownloadUrl(1);

    expect(typeof result).toBe("string");
    expect(result).toContain("storage.googleapis.com");
  });
});

// =============================================================================
// ADDITIVE — facade-local branches and delegation contracts
// (B5 Caution #13 / packet §0.2). None of these substitute for a
// translated Python assertion; they lock behavior Python's suite leaves
// uncovered.
// =============================================================================

describe("ADDITIVE: list_custom_properties displayFormula corruption branch", () => {
  /**
   * Build the `QueryError` the App API raises when a project holds a
   * custom property with an invalid `displayFormula`
   * (`workspace.py:7768-7773`).
   *
   * @param body - The `response_body` detail.
   * @returns The error.
   */
  function corruptionError(body: unknown): QueryError {
    return new QueryError("boom", {
      statusCode: 400,
      responseBody: body,
      requestMethod: "GET",
      requestUrl: "https://mixpanel.com/api/app/custom_properties/",
      requestParams: { a: 1 },
    });
  }

  it("re-raises a QueryError with the actionable message when field == displayFormula", async () => {
    const original = corruptionError({ field: "displayFormula" });
    const client = throwingClient("listCustomProperties", original);

    await expect(listCustomPropertiesMember(client)).rejects.toSatisfy(
      (error: unknown) => {
        expect(error).toBeInstanceOf(QueryError);
        const err = error as QueryError;
        expect(err).not.toBe(original);
        expect(err.message).toContain("invalid displayFormula");
        expect(err.statusCode).toBe(400);
        expect(err.requestMethod).toBe("GET");
        expect(err.requestParams).toEqual({ a: 1 });
        expect(err.cause).toBe(original);
        return true;
      },
    );
  });

  it("re-raises the ORIGINAL error for any other field", async () => {
    const original = corruptionError({ field: "name" });
    const client = throwingClient("listCustomProperties", original);
    await expect(listCustomPropertiesMember(client)).rejects.toBe(original);
  });

  it("re-raises the ORIGINAL error when response_body is absent", async () => {
    const original = new QueryError("boom", { statusCode: 400 });
    const client = throwingClient("listCustomProperties", original);
    await expect(listCustomPropertiesMember(client)).rejects.toBe(original);
  });

  it("re-raises the ORIGINAL error when response_body is not a dict", async () => {
    const original = corruptionError(["displayFormula"]);
    const client = throwingClient("listCustomProperties", original);
    await expect(listCustomPropertiesMember(client)).rejects.toBe(original);
  });

  it("does not intercept non-QueryError failures", async () => {
    const original = new MixpanelHeadlessError("nope", "OTHER");
    const client = throwingClient("listCustomProperties", original);
    await expect(listCustomPropertiesMember(client)).rejects.toBe(original);
  });
});

describe("ADDITIVE: CreateCustomEventParams.toFormBody", () => {
  it("matches CPython json.dumps spelling (space after the colon)", () => {
    const params = new CreateCustomEventParams({
      name: "X",
      alternatives: ["A", "B"],
    });
    expect(params.toFormBody()).toEqual({
      name: "X",
      alternatives: '[{"event": "A"}, {"event": "B"}]',
    });
  });

  it("escapes non-BMP characters like ensure_ascii=True does", () => {
    const params = new CreateCustomEventParams({
      name: "\u{1D4B3}",
      alternatives: ["\u{1D4B3}"],
    });
    expect(params.toFormBody()).toEqual({
      name: "\u{1D4B3}",
      alternatives: '[{"event": "\\ud835\\udcb3"}]',
    });
  });
});

describe("ADDITIVE: upload_lookup_table seams and poll arms", () => {
  /** The three canned interactions of the happy path. */
  const urlInfo = {
    url: "https://storage.googleapis.com/upload",
    path: "gs://bucket/path",
    key: "product_id",
  };

  /**
   * Stub client covering the five wire calls the orchestrator makes.
   *
   * @param registerResult - Step-3 payload.
   * @param statuses - Successive poll payloads.
   * @param calls - Log of `[method, ...args]` tuples.
   * @returns The stub.
   */
  function uploadStub(
    registerResult: unknown,
    statuses: readonly Record<string, unknown>[] = [],
    calls: unknown[][] = [],
  ): MixpanelClient {
    let poll = 0;
    return {
      getLookupUploadUrl: (...args: unknown[]): Promise<unknown> => {
        calls.push(["getLookupUploadUrl", ...args]);
        return Promise.resolve(urlInfo);
      },
      uploadToSignedUrl: (...args: unknown[]): Promise<void> => {
        calls.push(["uploadToSignedUrl", ...args]);
        return Promise.resolve();
      },
      registerLookupTable: (...args: unknown[]): Promise<unknown> => {
        calls.push(["registerLookupTable", ...args]);
        return Promise.resolve(registerResult);
      },
      getLookupUploadStatus: (...args: unknown[]): Promise<unknown> => {
        calls.push(["getLookupUploadStatus", ...args]);
        const value = statuses[Math.min(poll, statuses.length - 1)] ?? {};
        poll += 1;
        return Promise.resolve(value);
      },
    } as unknown as MixpanelClient;
  }

  /**
   * The seam bag with a virtual clock and a fixed CSV.
   *
   * @param monotonic - The clock seam.
   * @returns The seams.
   */
  function seams(monotonic: () => number): LookupUploadSeams {
    return {
      readFile: fakeReadFile("a,b\n1,2\n"),
      monotonic,
      sleep: (): Promise<void> => Promise.resolve(),
    };
  }

  it("registers the form body with name/path/key and the data-group-id", async () => {
    const calls: unknown[][] = [];
    const client = uploadStub(lookupTableJson(7, "T"), [], calls);
    const clock = virtualClock();
    await uploadLookupTableMember(
      client,
      new UploadLookupTableParams({
        name: "T",
        file_path: "/tmp/t.csv",
        data_group_id: 5,
      }),
      {},
      { ...seams(clock.monotonic), sleep: clock.sleep },
    );

    const register = calls.find((c) => c[0] === "registerLookupTable");
    expect(register?.[1]).toEqual({
      name: "T",
      path: "gs://bucket/path",
      key: "product_id",
      "data-group-id": "5",
    });
    const upload = calls.find((c) => c[0] === "uploadToSignedUrl");
    expect(upload?.[1]).toBe(urlInfo.url);
    expect(new TextDecoder().decode(upload?.[2] as Uint8Array)).toBe(
      "a,b\n1,2\n",
    );
  });

  it("omits data-group-id when the param is absent", async () => {
    const calls: unknown[][] = [];
    const client = uploadStub(lookupTableJson(7, "T"), [], calls);
    const clock = virtualClock();
    await uploadLookupTableMember(
      client,
      new UploadLookupTableParams({ name: "T", file_path: "/tmp/t.csv" }),
      {},
      { ...seams(clock.monotonic), sleep: clock.sleep },
    );

    const register = calls.find((c) => c[0] === "registerLookupTable");
    expect(Object.hasOwn(register?.[1] as object, "data-group-id")).toBe(false);
  });

  it("injects the params name when the register response omits it", async () => {
    const client = uploadStub({ id: 7 });
    const clock = virtualClock();
    const table = await uploadLookupTableMember(
      client,
      new UploadLookupTableParams({ name: "Injected", file_path: "/tmp/t" }),
      {},
      { ...seams(clock.monotonic), sleep: clock.sleep },
    );
    expect(table.name).toBe("Injected");
    expect(table.id).toBe(7);
  });

  it("hands a non-dict register payload to validation untouched (B6-ARB FID-F2)", async () => {
    // ADDITIVE (B6-ARB red-first lock, fidelity F2): Python guards BOTH
    // register-response reads with `isinstance(raw, dict)`
    // (`workspace.py:8060` uploadId read, `:8072` name-inject). Through
    // an INJECTED client delivering a non-dict payload (the real B4
    // client raises `expected dict` first — api_client.py:7741-7746),
    // the raw value must reach `validate_response_model` UNTOUCHED and
    // fail as a pydantic `model_type` error on the list itself, never
    // as a spread-mangled `{0: …, name: …}` object missing `id`.
    const client = uploadStub(["oops"]);
    const clock = virtualClock();

    const error = await uploadLookupTableMember(
      client,
      new UploadLookupTableParams({ name: "NonDict", file_path: "/tmp/t" }),
      {},
      { ...seams(clock.monotonic), sleep: clock.sleep },
    ).then(
      () => null,
      (exc: unknown) => exc,
    );

    expect(error).toBeInstanceOf(ResponseValidationError);
    const details = (error as ResponseValidationError).details as {
      errors: readonly { type: string; input: unknown }[];
    };
    expect(details.errors[0]?.type).toBe("model_type");
    expect(details.errors[0]?.input).toEqual(["oops"]);
  });

  it("raises UPLOAD_NOT_FOUND on a NOTFOUND poll", async () => {
    const clock = virtualClock();
    const client = uploadStub({ uploadId: "u1" }, [
      { uploadStatus: "NOTFOUND" },
    ]);
    await expect(
      uploadLookupTableMember(
        client,
        new UploadLookupTableParams({ name: "T", file_path: "/tmp/t" }),
        {},
        { ...seams(clock.monotonic), sleep: clock.sleep },
      ),
    ).rejects.toMatchObject({ code: "UPLOAD_NOT_FOUND" });
  });

  it("raises UPLOAD_FAILED on a REVOKED poll", async () => {
    const clock = virtualClock();
    const client = uploadStub({ uploadId: "u1" }, [
      { uploadStatus: "REVOKED" },
    ]);
    await expect(
      uploadLookupTableMember(
        client,
        new UploadLookupTableParams({ name: "T", file_path: "/tmp/t" }),
        {},
        { ...seams(clock.monotonic), sleep: clock.sleep },
      ),
    ).rejects.toMatchObject({ code: "UPLOAD_FAILED" });
  });

  it("raises INVALID_RESPONSE when SUCCESS carries a non-dict result", async () => {
    const clock = virtualClock();
    const client = uploadStub({ uploadId: "u1" }, [
      { uploadStatus: "SUCCESS", result: "nope" },
    ]);
    await expect(
      uploadLookupTableMember(
        client,
        new UploadLookupTableParams({ name: "T", file_path: "/tmp/t" }),
        {},
        { ...seams(clock.monotonic), sleep: clock.sleep },
      ),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("treats an ABSENT uploadStatus as UNKNOWN and keeps polling", async () => {
    const clock = virtualClock();
    const client = uploadStub({ uploadId: "u1" }, [
      {},
      { uploadStatus: "SUCCESS", result: lookupTableJson(3, "Late") },
    ]);
    const table = await uploadLookupTableMember(
      client,
      new UploadLookupTableParams({ name: "Late", file_path: "/tmp/t" }),
      { poll_interval: 0.01 },
      { ...seams(clock.monotonic), sleep: clock.sleep },
    );
    expect(table.id).toBe(3);
  });

  it("the default readFile seam throws UNPORTED_FILE_READ_SEAM (B8 owns the wiring)", async () => {
    // Step 1 (the signed-URL call) must succeed so the failure lands on
    // the step-2 read, exactly where Python's `read_bytes()` sits.
    const { ws } = makeWorkspace(() => ok(urlInfo));
    await expect(
      ws.uploadLookupTable(
        new UploadLookupTableParams({ name: "T", file_path: "/tmp/t.csv" }),
      ),
    ).rejects.toMatchObject({ code: "UNPORTED_FILE_READ_SEAM" });
  });
});

describe("ADDITIVE: delegation contracts", () => {
  it("create_drop_filter dumps the params with exclude_none and no aliases", async () => {
    const calls: unknown[][] = [];
    const client = stubClient("createDropFilter", [], calls);
    const params = new CreateDropFilterParams({
      event_name: "e",
      filters: { a: 1 },
    });
    await new Workspace({ session: FACADE_SESSION, client }).createDropFilter(
      params,
    );
    expect(calls[0]?.[0]).toEqual({ event_name: "e", filters: { a: 1 } });
  });

  it("update_custom_property dumps the params with by_alias=True", async () => {
    const calls: unknown[][] = [];
    const client = stubClient(
      "updateCustomProperty",
      customPropertyJson(1, "N", "events"),
      calls,
    );
    const params = new UpdateCustomPropertyParams({
      name: "N",
      display_formula: "f",
    });
    await new Workspace({
      session: FACADE_SESSION,
      client,
    }).updateCustomProperty("42", params);
    expect(calls[0]?.[0]).toBe("42");
    expect(calls[0]?.[1]).toEqual({ name: "N", displayFormula: "f" });
  });

  it("mark_lookup_table_ready builds the form body Python builds", async () => {
    const calls: unknown[][] = [];
    const client = stubClient(
      "markLookupTableReady",
      lookupTableJson(1, "P"),
      calls,
    );
    await new Workspace({
      session: FACADE_SESSION,
      client,
    }).markLookupTableReady(
      new MarkLookupTableReadyParams({
        name: "P",
        key: "k",
        data_group_id: 9,
      }),
    );
    expect(calls[0]?.[0]).toEqual({
      name: "P",
      key: "k",
      "data-group-id": "9",
    });
  });

  it("update_lookup_table forwards the id and the plain dump", async () => {
    const calls: unknown[][] = [];
    const client = stubClient(
      "updateLookupTable",
      lookupTableJson(1, "P"),
      calls,
    );
    await new Workspace({ session: FACADE_SESSION, client }).updateLookupTable(
      3,
      new UpdateLookupTableParams({ name: "P" }),
    );
    expect(calls[0]?.[0]).toBe(3);
    expect(calls[0]?.[1]).toEqual({ name: "P" });
  });

  it("get_lookup_upload_url defaults content_type to text/csv", async () => {
    const calls: unknown[][] = [];
    const client = stubClient(
      "getLookupUploadUrl",
      { url: "u", path: "p", key: "k" },
      calls,
    );
    await new Workspace({
      session: FACADE_SESSION,
      client,
    }).getLookupUploadUrl();
    expect(calls[0]?.[0]).toBe("text/csv");
  });

  it("download_lookup_table forwards file_name/limit under their Python names", async () => {
    const calls: unknown[][] = [];
    const client = stubClient(
      "downloadLookupTable",
      new Uint8Array([1]),
      calls,
    );
    await new Workspace({
      session: FACADE_SESSION,
      client,
    }).downloadLookupTable(4, { file_name: "f.csv", limit: 2 });
    expect(calls[0]?.[0]).toBe(4);
    expect(calls[0]?.[1]).toEqual({ file_name: "f.csv", limit: 2 });
  });

  it("delete_lookup_tables forwards the id list verbatim", async () => {
    const calls: unknown[][] = [];
    const client = stubClient("deleteLookupTables", undefined, calls);
    await new Workspace({ session: FACADE_SESSION, client }).deleteLookupTables(
      [1, 2, 3],
    );
    expect(calls[0]?.[0]).toEqual([1, 2, 3]);
  });

  it("validate_custom_property returns the client payload unvalidated", async () => {
    const client = stubClient("validateCustomProperty", { anything: [1, 2] });
    const result = await new Workspace({
      session: FACADE_SESSION,
      client,
    }).validateCustomProperty(
      new CreateCustomPropertyParams({
        name: "n",
        resource_type: CustomPropertyResourceType.EVENTS,
        display_formula: "f",
        composed_properties: {
          x: new ComposedPropertyValue({ resource_type: "event" }),
        },
      }),
    );
    expect(result).toEqual({ anything: [1, 2] });
  });
});
