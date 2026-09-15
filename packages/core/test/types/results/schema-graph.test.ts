// Translated SchemaGraphResult tests (packet P2-6):
// assertion-for-assertion port of tests/unit/test_schema_graph.py
// (TestSchemaGraphResult) — R10.2, per-frame suites for the
// multi-DataFrame surface (phase2-design C6/F3).
//
// Not ported: the `to_graph()` assertions (networkx — TODO(port)
// batch B5; the underlying adjacency IS asserted via
// event_to_properties/property_to_events); the api_client/
// DiscoveryService/Workspace/CLI layers of the same file (Phase-3
// B4/B5/B6). Frame-identity caching translates to repeated-call
// determinism.
import { describe, expect, it } from "vitest";

import { SchemaGraphResult } from "../../../src/types/results/discovery.js";

/** Build the small sample result (Python `_sample_result`). */
function sampleResult(): SchemaGraphResult {
  return new SchemaGraphResult({
    computed_at: "2026-06-03T00:00:00+00:00",
    events: [{ name: "Purchase", displayName: "Purchase", count: 10 }],
    properties: [
      // densityLocal is a property-level field; it repeats onto each edge.
      { name: "amount", densityLocal: 0.9, events: [{ name: "Purchase" }] },
      { name: "orphan", events: [] },
    ],
    user_properties: [
      { name: "plan", resourceType: "User", displayName: "Plan" },
    ],
    include_density: true,
  });
}

describe("SchemaGraphResult (TestSchemaGraphResult)", () => {
  it("test_events_df_shape", () => {
    const result = sampleResult();
    expect(result.eventsRowColumns()).toStrictEqual([
      "name",
      "display_name",
      "description",
      "hidden",
      "dropped",
      "verified",
      "count",
    ]);
    const row = result.toEventsRows()[0];
    expect(row?.["name"]).toBe("Purchase");
    expect(row?.["display_name"]).toBe("Purchase");
  });

  it("test_properties_df_covers_event_and_user", () => {
    const by_name = new Map(
      sampleResult()
        .toPropertiesRows()
        .map((row) => [row["name"], row]),
    );
    expect(by_name.get("amount")?.["resource_type"]).toBe("event");
    expect(by_name.get("plan")?.["resource_type"]).toBe("user");
    expect(by_name.get("plan")?.["display_name"]).toBe("Plan");
  });

  it("test_relationships_df_is_edge_list", () => {
    const result = sampleResult();
    expect(result.relationshipsRowColumns()).toStrictEqual([
      "event",
      "property",
      "density_local",
    ]);
    const rows = result.toRelationshipsRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["event"]).toBe("Purchase");
    expect(rows[0]?.["property"]).toBe("amount");
    expect(rows[0]?.["density_local"]).toBe(0.9);
  });

  it("test_df_is_relationships", () => {
    const result = sampleResult();
    expect(result.toRows()).toStrictEqual(result.toRelationshipsRows());
    expect(result.rowColumns()).toStrictEqual(result.relationshipsRowColumns());
  });

  it("test_convenience_accessors", () => {
    const result = sampleResult();
    expect(result.propertiesForEvent("Purchase")).toStrictEqual(["amount"]);
    expect(result.eventsForProperty("amount")).toStrictEqual(["Purchase"]);
    expect(result.orphanProperties()).toStrictEqual(["orphan"]);
    expect(result.propertiesForEvent("missing")).toStrictEqual([]);
  });

  it("test_orphan_properties_skips_nameless", () => {
    const result = new SchemaGraphResult({
      computed_at: "t",
      properties: [{ events: [] }, { name: "real", events: [] }],
    });
    expect(result.orphanProperties()).toStrictEqual(["real"]);
  });

  it("test_empty_result_has_typed_empty_frames", () => {
    const result = new SchemaGraphResult({ computed_at: "t" });
    expect(result.toEventsRows()).toHaveLength(0);
    expect(result.relationshipsRowColumns()).toStrictEqual([
      "event",
      "property",
      "density_local",
    ]);
  });

  it("test_to_dict_round_trips_fields", () => {
    const d = sampleResult().toJSON();
    expect(d["event_to_properties"]).toStrictEqual({ Purchase: ["amount"] });
    expect(d["include_density"]).toBe(true);
    expect(Object.hasOwn(d, "user_properties")).toBe(true);
  });

  it("test_dataframes_are_cached (determinism)", () => {
    const result = sampleResult();
    expect(result.toEventsRows()).toStrictEqual(result.toEventsRows());
    expect(result.toPropertiesRows()).toStrictEqual(result.toPropertiesRows());
    expect(result.toRelationshipsRows()).toStrictEqual(
      result.toRelationshipsRows(),
    );
  });

  it("test_density_local_none_when_density_not_requested", () => {
    const result = new SchemaGraphResult({
      computed_at: "t",
      events: [{ name: "Purchase" }],
      properties: [{ name: "amount", events: [{ name: "Purchase" }] }],
    });
    expect(result.include_density).toBe(false);
    expect(result.toRelationshipsRows()[0]?.["density_local"]).toBeNull();
  });

  it("test_non_dict_event_entry_is_filtered", () => {
    const result = new SchemaGraphResult({
      computed_at: "t",
      properties: [
        {
          name: "amount",
          events: ["NotADict", { no: "name" }, { name: "Purchase" }],
        },
      ],
    });
    // Only the well-formed {"name": "Purchase"} entry survives.
    expect(
      result.toRelationshipsRows().map((row) => row["event"]),
    ).toStrictEqual(["Purchase"]);
    expect(result.property_to_events["amount"]).toStrictEqual(["Purchase"]);
  });

  it("test_relationships_df_skips_nameless_property", () => {
    const result = new SchemaGraphResult({
      computed_at: "t",
      properties: [
        { events: [{ name: "Purchase" }] }, // no name -> skipped
        { name: "amount", events: [{ name: "Purchase" }] },
      ],
    });
    expect(
      result.toRelationshipsRows().map((row) => row["property"]),
    ).toStrictEqual(["amount"]);
  });

  it("test_events_for_property_unknown_returns_empty", () => {
    expect(sampleResult().eventsForProperty("missing")).toStrictEqual([]);
  });

  it("test_property_without_events_key", () => {
    const result = new SchemaGraphResult({
      computed_at: "t",
      properties: [{ name: "amount" }],
    });
    expect(result.toRelationshipsRows()).toHaveLength(0);
    expect(result.property_to_events).toStrictEqual({ amount: [] });
    expect(result.orphanProperties()).toStrictEqual(["amount"]);
  });

  it("test_maps_derived_from_properties", () => {
    const result = new SchemaGraphResult({
      computed_at: "t",
      events: [{ name: "Purchase" }, { name: "Login" }],
      properties: [{ name: "amount", events: [{ name: "Purchase" }] }],
    });
    expect(result.event_to_properties).toStrictEqual({
      Purchase: ["amount"],
      Login: [],
    });
    expect(result.property_to_events).toStrictEqual({ amount: ["Purchase"] });
    expect(result.propertiesForEvent("Login")).toStrictEqual([]);
  });

  it("test_meta_records_drop_counts", () => {
    const result = new SchemaGraphResult({
      computed_at: "t",
      events: [{ name: "Purchase" }, { count: 5 }], // one nameless event
      properties: [
        { name: "amount", events: [{ name: "Purchase" }, "bad"] },
        { events: [] }, // nameless property
      ],
      user_properties: [{ name: "plan" }],
    });
    expect(result.meta["event_count"]).toBe(2);
    expect(result.meta["event_property_count"]).toBe(2);
    expect(result.meta["user_property_count"]).toBe(1);
    expect(result.meta["events_without_name"]).toBe(1);
    expect(result.meta["properties_without_name"]).toBe(1);
    expect(result.meta["property_event_entries_dropped"]).toBe(1);
    expect(result.meta["relationship_edges"]).toBe(1);
  });

  it("test_to_dict_contains_all_fields", () => {
    const d = sampleResult().toJSON();
    for (const key of [
      "computed_at",
      "events",
      "properties",
      "user_properties",
      "event_to_properties",
      "property_to_events",
      "include_density",
      "meta",
      "params",
    ]) {
      expect(Object.hasOwn(d, key), key).toBe(true);
    }
  });
});
