// Translated custom-property E2E tests (B5-S2, packet §3 + §8):
// assertion-for-assertion port of tests/test_custom_property_query.py
// (R10.2) — 4 of its 5 classes (TestGroupByCustomPropertyE2E :62,
// TestFilterCustomPropertyE2E :124, TestMeasurementCustomPropertyE2E
// :158, TestCombinedPositions :209), PLUS the B3-K2 deferral
// `tests/test_custom_property_builders.py::TestMeasurementPropertyBuilder`
// :361 (`B3-K2-notes.md:123`).
//
// OUTBOUND DEFERRAL TO B6 (header-cited):
// `TestListCustomPropertiesErrorHandling` :260 exercises
// `ws.list_custom_properties()` — the FACADE member, whose contract is
// the `displayFormula` QueryError RE-RAISE at `workspace.py:7742-7790`
// (`raised is not original`, `__cause__ is original`, HTTP context
// carried over). The api-map puts `workspace.list_custom_properties` in
// batch **B6** (`jq '.workspace_members[] | select(.name==
// "list_custom_properties")'` -> `"batch": "B6"`), and the B4 client
// method `listCustomProperties` does NOT perform that wrapping — it is
// a plain `appRequest` + `expectListResult`
// (`services/entities/custom-properties.ts:115-122`). The packet's
// "translate against the B4 client method" instruction therefore cannot
// preserve the assertions (there is no re-raise to observe), so the
// class defers to B6 with the facade member it tests.

import { describe, expect, it } from "vitest";
import { Workspace } from "../../src/workspace.js";
import {
  CustomPropertyRef,
  Filter,
  InlineCustomProperty,
} from "../../src/types/query-params/filter.js";
import { GroupBy } from "../../src/types/query-params/group-by.js";
import { Metric } from "../../src/types/query-params/metric.js";
import { mockWorkspaceClient, TEST_SESSION } from "./workspace-test-helpers.js";

/**
 * The `ws` fixture.
 *
 * @returns The facade under test.
 */
function makeWs(): Workspace {
  return new Workspace({
    session: TEST_SESSION,
    client: mockWorkspaceClient().client,
  });
}

/** `result["sections"][name]` as an array of records. */
function section(
  result: Record<string, unknown>,
  name: string,
): Array<Record<string, unknown>> {
  const sections = result["sections"] as Record<string, unknown>;
  return sections[name] as Array<Record<string, unknown>>;
}

/** `result["sections"]["show"][0]["measurement"]`. */
function measurementOf(
  result: Record<string, unknown>,
): Record<string, unknown> {
  return section(result, "show")[0]!["measurement"] as Record<string, unknown>;
}

// ===========================================================================
// T023: E2E group_by with custom properties
// ===========================================================================

describe("TestGroupByCustomPropertyE2E", () => {
  it("build_params with a CustomPropertyRef in group_by", async () => {
    const params = await makeWs().buildParams("Purchase", {
      group_by: new GroupBy({
        property: new CustomPropertyRef({ id: 42 }),
        property_type: "number",
      }),
    });

    const group = section(params, "group");
    expect(group.length).toBe(1);
    expect(group[0]!["customPropertyId"]).toBe(42);
  });

  it("build_params with an InlineCustomProperty in group_by", async () => {
    const icp = InlineCustomProperty.numeric("A * B", { A: "price", B: "qty" });
    const params = await makeWs().buildParams("Purchase", {
      group_by: new GroupBy({ property: icp, property_type: "number" }),
    });

    const group = section(params, "group");
    expect(group.length).toBe(1);
    expect(Object.hasOwn(group[0]!, "customProperty")).toBe(true);
    const cp = group[0]!["customProperty"] as Record<string, unknown>;
    expect(cp["displayFormula"]).toBe("A * B");
  });

  it("build_funnel_params with a CustomPropertyRef in group_by", async () => {
    const params = await makeWs().buildFunnelParams(["Signup", "Purchase"], {
      group_by: new GroupBy({
        property: new CustomPropertyRef({ id: 42 }),
        property_type: "number",
      }),
    });

    const group = section(params, "group");
    expect(group.length).toBe(1);
    expect(group[0]!["customPropertyId"]).toBe(42);
  });

  it("build_retention_params with a CustomPropertyRef in group_by", async () => {
    const params = await makeWs().buildRetentionParams("Signup", "Login", {
      group_by: new GroupBy({
        property: new CustomPropertyRef({ id: 42 }),
        property_type: "number",
      }),
    });

    const group = section(params, "group");
    expect(group.length).toBe(1);
    expect(group[0]!["customPropertyId"]).toBe(42);
  });
});

// ===========================================================================
// T032: E2E filter with custom properties
// ===========================================================================

describe("TestFilterCustomPropertyE2E", () => {
  it("build_params with a CustomPropertyRef in the filter", async () => {
    const params = await makeWs().buildParams("Purchase", {
      where: Filter.greaterThan(new CustomPropertyRef({ id: 42 }), 100),
    });

    const filters = section(params, "filter");
    expect(filters.length).toBe(1);
    expect(filters[0]!["customPropertyId"]).toBe(42);
    expect(Object.hasOwn(filters[0]!, "value")).toBe(false);
  });

  it("build_params with an InlineCustomProperty in the filter", async () => {
    const icp = InlineCustomProperty.numeric("A * B", { A: "price", B: "qty" });
    const params = await makeWs().buildParams("Purchase", {
      where: Filter.greaterThan(icp, 1000),
    });

    const filters = section(params, "filter");
    expect(filters.length).toBe(1);
    expect(Object.hasOwn(filters[0]!, "customProperty")).toBe(true);
    const cp = filters[0]!["customProperty"] as Record<string, unknown>;
    expect(cp["displayFormula"]).toBe("A * B");
  });
});

// ===========================================================================
// T038-T040: E2E measurement with custom properties
// ===========================================================================

describe("TestMeasurementCustomPropertyE2E", () => {
  it("T038: Metric(property=CustomPropertyRef(...))", async () => {
    const params = await makeWs().buildParams(
      new Metric({
        event: "Purchase",
        math: "average",
        property: new CustomPropertyRef({ id: 42 }),
      }),
    );

    const prop = measurementOf(params)["property"] as Record<string, unknown>;
    expect(prop["customPropertyId"]).toBe(42);
    expect(prop["resourceType"]).toBe("events");
  });

  it("T039: Metric(property=InlineCustomProperty.numeric(...))", async () => {
    const icp = InlineCustomProperty.numeric("A * B", {
      A: "price",
      B: "quantity",
    });
    const params = await makeWs().buildParams(
      new Metric({ event: "Purchase", math: "average", property: icp }),
    );

    const prop = measurementOf(params)["property"] as Record<string, unknown>;
    expect(Object.hasOwn(prop, "customProperty")).toBe(true);
    const cp = prop["customProperty"] as Record<string, unknown>;
    expect(cp["displayFormula"]).toBe("A * B");
    expect(prop["resourceType"]).toBe("events");
  });

  it("T040: funnels keep the plain-string math_property path", async () => {
    const params = await makeWs().buildFunnelParams(["Signup", "Purchase"], {
      math: "average",
      math_property: "amount",
    });

    const prop = measurementOf(params)["property"] as Record<string, unknown>;
    expect(prop["name"]).toBe("amount");
  });
});

// ===========================================================================
// T044-T045: combined positions
// ===========================================================================

describe("TestCombinedPositions", () => {
  it("T044: a ref in group_by plus an inline in where", async () => {
    const icp = InlineCustomProperty.numeric("A * B", { A: "price", B: "qty" });
    const params = await makeWs().buildParams("Purchase", {
      group_by: new GroupBy({
        property: new CustomPropertyRef({ id: 42 }),
        property_type: "number",
      }),
      where: Filter.greaterThan(icp, 100),
    });

    expect(section(params, "group")[0]!["customPropertyId"]).toBe(42);
    expect(Object.hasOwn(section(params, "filter")[0]!, "customProperty")).toBe(
      true,
    );
  });

  it("T045: all three positions simultaneously", async () => {
    const revenue = InlineCustomProperty.numeric("A * B", {
      A: "price",
      B: "qty",
    });
    const params = await makeWs().buildParams(
      new Metric({
        event: "Purchase",
        math: "average",
        property: new CustomPropertyRef({ id: 99 }),
      }),
      {
        group_by: new GroupBy({
          property: revenue,
          property_type: "number",
          bucket_size: 100,
          bucket_min: 0,
          bucket_max: 1000,
        }),
        where: Filter.greaterThan(revenue, 50),
      },
    );

    // Measurement
    const prop = measurementOf(params)["property"] as Record<string, unknown>;
    expect(prop["customPropertyId"]).toBe(99);

    // Group
    const group = section(params, "group");
    expect(Object.hasOwn(group[0]!, "customProperty")).toBe(true);
    const customBucket = group[0]!["customBucket"] as Record<string, unknown>;
    expect(customBucket["bucketSize"]).toBe(100);

    // Filter
    expect(Object.hasOwn(section(params, "filter")[0]!, "customProperty")).toBe(
      true,
    );
  });
});

// ===========================================================================
// B3-K2 deferral: tests/test_custom_property_builders.py
//                 ::TestMeasurementPropertyBuilder :361
// ===========================================================================

describe("TestMeasurementPropertyBuilder", () => {
  it("T034: a plain-string Metric.property is unchanged", async () => {
    const params = await makeWs().buildParams(
      new Metric({ event: "Purchase", math: "average", property: "amount" }),
    );
    expect(measurementOf(params)["property"]).toEqual({
      name: "amount",
      resourceType: "events",
    });
  });

  it("T035: a CustomPropertyRef produces customPropertyId", async () => {
    const params = await makeWs().buildParams(
      new Metric({
        event: "Purchase",
        math: "average",
        property: new CustomPropertyRef({ id: 42 }),
      }),
    );
    const prop = measurementOf(params)["property"] as Record<string, unknown>;
    expect(prop["customPropertyId"]).toBe(42);
    expect(prop["resourceType"]).toBe("events");
    // name present for server compat
    expect(prop["name"]).not.toBeUndefined();
    expect(prop["name"]).not.toBeNull();
  });

  it("T036: an InlineCustomProperty produces a customProperty dict", async () => {
    const icp = InlineCustomProperty.numeric("A * B", {
      A: "price",
      B: "quantity",
    });
    const params = await makeWs().buildParams(
      new Metric({ event: "Purchase", math: "average", property: icp }),
    );
    const prop = measurementOf(params)["property"] as Record<string, unknown>;
    expect(Object.hasOwn(prop, "customProperty")).toBe(true);
    const cp = prop["customProperty"] as Record<string, unknown>;
    expect(cp["displayFormula"]).toBe("A * B");
    expect(prop["resourceType"]).toBe("events");
    // name present for server compat
    expect(prop["name"]).not.toBeUndefined();
    expect(prop["name"]).not.toBeNull();
  });

  it("T037: a top-level string math_property is unchanged", async () => {
    const params = await makeWs().buildParams("Purchase", {
      math: "average",
      math_property: "amount",
    });
    expect(measurementOf(params)["property"]).toEqual({
      name: "amount",
      resourceType: "events",
    });
  });
});
