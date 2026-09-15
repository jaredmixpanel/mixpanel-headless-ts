// B6-W7 Layer-3 translation (packet `b6-packets.md` §9) — the class
// split of `tests/unit/test_workspace_data_governance.py` (1,842 lines)
// that W7 owns:
//
//   drop filters      : `TestListDropFilters`,
//     `TestCreateDropFilter`, `TestUpdateDropFilter`,
//     `TestDeleteDropFilter`, `TestGetDropFilterLimits`
//   custom properties : `TestListCustomProperties`,
//     `TestCreateCustomProperty`, `TestGetCustomProperty`,
//     `TestUpdateCustomProperty`, `TestDeleteCustomProperty`
//     (:891), `TestValidateCustomProperty` (:905)
//   custom events     : `TestCreateCustomEvent`,
//     `TestListCustomEvents`, `TestUpdateCustomEvent`,
//     `TestDeleteCustomEvent`
//   lookup tables     : `TestListLookupTables`,
//     `TestUploadLookupTable`, `TestMarkLookupTableReady`
//     (:1648), `TestGetLookupUploadUrl` (:1672),
//     `TestGetLookupUploadStatus`, `TestUpdateLookupTable`
//     (:1751), `TestDeleteLookupTables` (:1775),
//     `TestDownloadLookupTable`, `TestGetLookupDownloadUrl`
//
// The lexicon / tags / tracking-history classes in the same Python file
// belong to W6 (`b6-packets.md` §8) and are NOT re-translated here.
//
// Python's `httpx.MockTransport` handler becomes the injected-fetch
// `fakeTransport` seam; `_make_workspace(temp_dir, handler)`
// becomes `makeWorkspace(handler)` — the client is built over the OAuth
// session (`_make_oauth_credentials`, :82-88) while the facade carries
// the service-account `_TEST_SESSION`, exactly as Python does.
// `temp_dir` has no TS analog EXCEPT in `TestUploadLookupTable`, where
// Python writes a real CSV and the facade reads it with
// `Path(...).read_bytes()`; the TS twin injects the W7-D1 `readFile`
// seam with the same bytes (packet §9 W7-D1: `packages/core` is
// runtime-agnostic, so `node:fs` is a B8 wiring job).
//
// ADDITIVE sections (clearly headed, never substituting for a
// translated Python assertion — B5 Caution #13 / packet §0.2): the
// facade-local branches Python's suite does not cover — the
// `displayFormula` corruption re-raise, the
// `to_form_body` JSON spelling, the `readFile` seam default, the
// `REVOKED` / `NOTFOUND` / non-dict-result poll arms
// (`workspace.py`) and the per-member delegation contracts
// (which client method, with which arguments).

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
    expect(result.alternatives.map((a) => a.event)).toStrictEqual([
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
    expect(JSON.parse(body.get("alternatives") ?? "null")).toStrictEqual([
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
    await expect(ws.listCustomEvents()).resolves.toStrictEqual([]);
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
