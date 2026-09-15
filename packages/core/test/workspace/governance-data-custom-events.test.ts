// `Workspace` custom-event members: create (form-encoded, alternatives as
// JSON), list, update and delete, plus the `customEventId` body contract.
// Mirrors the `TestCreateCustomEvent` / `TestListCustomEvents` /
// `TestUpdateCustomEvent` / `TestDeleteCustomEvent` classes of
// `tests/unit/test_workspace_data_governance.py`; `ADDITIVE:` is `toFormBody`.

import { describe, expect, it } from "vitest";

import {
  AuthenticationError,
  MixpanelHeadlessError,
} from "../../src/errors.js";
import {
  CreateCustomEventParams,
  CustomEvent,
} from "../../src/types/entities/data-governance.js";
import {
  EventDefinition,
  UpdateEventDefinitionParams,
} from "../../src/types/entities/lexicon.js";
import {
  type CapturedFetchRequest,
  ok,
} from "../../test-support/client-test-helpers.js";
import { makeWorkspace, okBare } from "./governance-data-fixtures.js";

/**
 * A minimal event definition dict matching the API shape
 * (`_event_def_json`).
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

// =============================================================================
// US6: Custom Events
// =============================================================================

describe("Create custom event", () => {
  // python: TestCreateCustomEvent
  it("createCustomEvent() returns a typed CustomEvent built from the API response", async () => {
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
    expect(result.alternatives.map((a) => a.event)).toStrictEqual([
      "Home",
      "Product",
    ]);
  });

  it("createCustomEvent() POSTs alternatives as JSON list of {event:...} dicts", async () => {
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
    expect(JSON.parse(body.get("alternatives") ?? "null")).toStrictEqual([
      { event: "A" },
      { event: "B" },
    ]);
    expect(body.get("name")).toBe("X");
    expect(captured[0]?.headers["content-type"]).toMatch(
      /^application\/x-www-form-urlencoded/,
    );
  });

  it("createCustomEvent() surfaces 401 as AuthenticationError", async () => {
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

describe("List custom events", () => {
  // python: TestListCustomEvents
  it("listCustomEvents() returns list of EventDefinition objects", async () => {
    const { ws } = makeWorkspace(() =>
      ok([eventDefJson(1, "CustomEvent1"), eventDefJson(2, "CustomEvent2")]),
    );
    const events = await ws.listCustomEvents();

    expect(events).toHaveLength(2);
    expect(events[0]).toBeInstanceOf(EventDefinition);
    expect(events[0]?.name).toBe("CustomEvent1");
  });

  it("listCustomEvents() returns empty list when none exist", async () => {
    const { ws } = makeWorkspace(() => ok([]));
    await expect(ws.listCustomEvents()).resolves.toStrictEqual([]);
  });
});

describe("Update custom event", () => {
  // python: TestUpdateCustomEvent
  it("updateCustomEvent() returns the updated EventDefinition", async () => {
    const { ws } = makeWorkspace(() => ok(eventDefJson(1, "CustomEvent1")));
    const params = new UpdateEventDefinitionParams({ description: "Updated" });
    const result = await ws.updateCustomEvent(2044168, params);

    expect(result).toBeInstanceOf(EventDefinition);
    expect(result.name).toBe("CustomEvent1");
  });

  it("updateCustomEvent() must send customEventId in the PATCH body", async () => {
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

  it("updateCustomEvent() raises if server echoes a different id", async () => {
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

describe("Delete custom event", () => {
  // python: TestDeleteCustomEvent
  it("deleteCustomEvent() returns None on success", async () => {
    const { ws } = makeWorkspace(() => okBare());
    await expect(ws.deleteCustomEvent(2044168)).resolves.toBeUndefined();
  });

  it("deleteCustomEvent() must send customEventId in the DELETE body", async () => {
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

describe("ADDITIVE: CreateCustomEventParams.toFormBody", () => {
  it("matches CPython json.dumps spelling (space after the colon)", () => {
    const params = new CreateCustomEventParams({
      name: "X",
      alternatives: ["A", "B"],
    });
    expect(params.toFormBody()).toStrictEqual({
      name: "X",
      alternatives: '[{"event": "A"}, {"event": "B"}]',
    });
  });

  it("escapes non-BMP characters like ensure_ascii=True does", () => {
    const params = new CreateCustomEventParams({
      name: "\u{1D4B3}",
      alternatives: ["\u{1D4B3}"],
    });
    expect(params.toFormBody()).toStrictEqual({
      name: "\u{1D4B3}",
      alternatives: String.raw`[{"event": "\ud835\udcb3"}]`,
    });
  });
});
