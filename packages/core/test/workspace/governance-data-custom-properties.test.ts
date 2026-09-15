// `Workspace` custom-property members: list, create, get, update, delete
// and validate. Mirrors the `Test*CustomProperty` / `TestListCustomProperties`
// classes of `tests/unit/test_workspace_data_governance.py`;
// `httpx.MockTransport` becomes the injected-fetch seam. `ADDITIVE:` locks
// the facade's `displayFormula` re-raise branch at the member seam.

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
  it("listCustomProperties() returns list of CustomProperty objects", async () => {
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

  it("listCustomProperties() returns empty list when none exist", async () => {
    const { ws } = makeWorkspace(() => ok([]));
    await expect(ws.listCustomProperties()).resolves.toStrictEqual([]);
  });
});

describe("Create custom property", () => {
  // python: TestCreateCustomProperty
  it("createCustomProperty() returns the created CustomProperty", async () => {
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
  it("getCustomProperty() returns a single CustomProperty by ID", async () => {
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
  it("updateCustomProperty() returns the updated CustomProperty", async () => {
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
  it("deleteCustomProperty() returns None on success", async () => {
    const { ws } = makeWorkspace(() => okBare());
    await expect(ws.deleteCustomProperty("42")).resolves.toBeUndefined();
  });
});

describe("Validate custom property", () => {
  // python: TestValidateCustomProperty
  it("validateCustomProperty() returns an opaque dict", async () => {
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
// ADDITIVE — the facade-local `displayFormula` re-raise branch, probed at
// the member seam. Nothing here substitutes for a translated Python
// assertion.
// =============================================================================

describe("ADDITIVE: list_custom_properties displayFormula corruption branch", () => {
  /**
   * Build the `QueryError` the App API raises when a project holds a
   * custom property with an invalid `displayFormula`
   * (`mixpanel_headless.workspace.Workspace.list_custom_properties`).
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
