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

import type { MixpanelClient } from "../../src/client/client.js";
import { MixpanelHeadlessError, QueryError } from "../../src/errors.js";
import {
  ComposedPropertyValue,
  CreateCustomPropertyParams,
  CustomProperty,
  UpdateCustomPropertyParams,
} from "../../src/types/entities/data-governance.js";
import { CustomPropertyResourceType } from "../../src/types/enums.js";
import { listCustomProperties as listCustomPropertiesMember } from "../../src/workspace-members/governance-data.js";
import { ok } from "../../test-support/client-test-helpers.js";
import {
  customPropertyJson,
  makeWorkspace,
  okBare,
} from "./governance-data-fixtures.js";

/**
 * A client stub whose single method REJECTS with `error`.
 *
 * @param method - The client method name to stub.
 * @param error - The rejection value.
 * @returns The stub cast to the client type.
 */
function throwingClient(method: string, error: Error): MixpanelClient {
  return {
    [method]: (): Promise<never> => Promise.reject(error),
  } as unknown as MixpanelClient;
}

// =============================================================================
// US4: Custom Properties
// =============================================================================

describe("List custom properties", () => {
  // python: TestListCustomProperties
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
    await expect(ws.listCustomProperties()).resolves.toStrictEqual([]);
  });
});

describe("Create custom property", () => {
  // python: TestCreateCustomProperty
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

describe("Get custom property", () => {
  // python: TestGetCustomProperty
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

describe("Update custom property", () => {
  // python: TestUpdateCustomProperty
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

describe("Delete custom property", () => {
  // python: TestDeleteCustomProperty
  it("delete_custom_property() returns None on success", async () => {
    const { ws } = makeWorkspace(() => okBare());
    await expect(ws.deleteCustomProperty("42")).resolves.toBeUndefined();
  });
});

describe("Validate custom property", () => {
  // python: TestValidateCustomProperty
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
// ADDITIVE — facade-local branches and delegation contracts
// (B5 Caution #13 / packet §0.2). None of these substitute for a
// translated Python assertion; they lock behavior Python's suite leaves
// uncovered.
// =============================================================================

describe("ADDITIVE: list_custom_properties displayFormula corruption branch", () => {
  /**
   * Build the `QueryError` the App API raises when a project holds a
   * custom property with an invalid `displayFormula`
   * (`workspace.py`).
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
        expect(err.requestParams).toStrictEqual({ a: 1 });
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
