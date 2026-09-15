// `Workspace.buildRetentionParams`: default structure, time sections,
// per-event and global filters, bucket sizes, display modes, unbounded mode,
// cumulative retention and data_group_id. Mirrors all 10 classes of
// `tests/test_build_retention_params.py`.

import { describe, expect, it } from "vitest";

import { Filter } from "../../src/types/query-params/filter.js";
import { RetentionEvent } from "../../src/types/query-params/retention.js";
import { makeStubWorkspace } from "../../test-support/workspace-test-helpers.js";

/** `result["sections"]["show"][0]["behavior"]`. */
function behaviorOf(result: Record<string, unknown>): Record<string, unknown> {
  const sections = result["sections"] as Record<string, unknown>;
  const show = sections["show"] as Array<Record<string, unknown>>;
  return show[0]!["behavior"] as Record<string, unknown>;
}

/** `result["sections"]["show"][0]["measurement"]`. */
function measurementOf(
  result: Record<string, unknown>,
): Record<string, unknown> {
  const sections = result["sections"] as Record<string, unknown>;
  const show = sections["show"] as Array<Record<string, unknown>>;
  return show[0]!["measurement"] as Record<string, unknown>;
}

/** `result["sections"][name]`. */
function section(result: Record<string, unknown>, name: string): unknown {
  return (result["sections"] as Record<string, unknown>)[name];
}

/** `behavior["behaviors"]`. */
function behaviorsOf(
  result: Record<string, unknown>,
): Array<Record<string, unknown>> {
  return behaviorOf(result)["behaviors"] as Array<Record<string, unknown>>;
}

// ===========================================================================
// T015: default structure
// ===========================================================================

describe("Build retention params defaults", () => {
  // python: TestBuildRetentionParamsDefaults
  it("behavior.type is 'retention'", async () => {
    const result = await makeStubWorkspace().buildRetentionParams(
      "Signup",
      "Login",
    );
    expect(behaviorOf(result)["type"]).toBe("retention");
  });

  it("behaviors has exactly 2 entries", async () => {
    const result = await makeStubWorkspace().buildRetentionParams(
      "Signup",
      "Login",
    );
    expect(behaviorsOf(result)).toHaveLength(2);
  });

  it("behavior names match the born and return events", async () => {
    const result = await makeStubWorkspace().buildRetentionParams(
      "Signup",
      "Login",
    );
    const behaviors = behaviorsOf(result);
    expect(behaviors[0]!["name"]).toBe("Signup");
    expect(behaviors[1]!["name"]).toBe("Login");
  });

  it("retentionUnit defaults to 'week'", async () => {
    const result = await makeStubWorkspace().buildRetentionParams(
      "Signup",
      "Login",
    );
    expect(behaviorOf(result)["retentionUnit"]).toBe("week");
  });

  it("retentionAlignmentType defaults to 'birth'", async () => {
    const result = await makeStubWorkspace().buildRetentionParams(
      "Signup",
      "Login",
    );
    expect(behaviorOf(result)["retentionAlignmentType"]).toBe("birth");
  });

  it("measurement.math defaults to 'retention_rate'", async () => {
    const result = await makeStubWorkspace().buildRetentionParams(
      "Signup",
      "Login",
    );
    expect(measurementOf(result)["math"]).toBe("retention_rate");
  });

  it("chartType defaults to 'retention-curve'", async () => {
    const result = await makeStubWorkspace().buildRetentionParams(
      "Signup",
      "Login",
    );
    const display = result["displayOptions"] as Record<string, unknown>;
    expect(display["chartType"]).toBe("retention-curve");
  });

  it("the sorting object is present with the expected chart-type keys", async () => {
    const result = await makeStubWorkspace().buildRetentionParams(
      "Signup",
      "Login",
    );
    const sorting = result["sorting"] as Record<string, unknown>;
    expect(Object.hasOwn(sorting, "bar")).toBe(true);
    expect(Object.hasOwn(sorting, "line")).toBe(true);
    expect(Object.hasOwn(sorting, "table")).toBe(true);
    expect((sorting["bar"] as Record<string, unknown>)["sortBy"]).toBe(
      "column",
    );
  });

  it("the columnWidths object is present", async () => {
    const result = await makeStubWorkspace().buildRetentionParams(
      "Signup",
      "Login",
    );
    expect(result["columnWidths"]).toStrictEqual({ bar: {} });
  });

  it("retentionCustomBucketSizes defaults to an empty list", async () => {
    const result = await makeStubWorkspace().buildRetentionParams(
      "Signup",
      "Login",
    );
    expect(behaviorOf(result)["retentionCustomBucketSizes"]).toStrictEqual([]);
  });

  it("sections contains show, time, filter, group and formula", async () => {
    const result = await makeStubWorkspace().buildRetentionParams(
      "Signup",
      "Login",
    );
    const sections = result["sections"] as Record<string, unknown>;
    for (const key of ["show", "time", "filter", "group", "formula"]) {
      expect(Object.hasOwn(sections, key)).toBe(true);
    }
  });

  it("the result has a displayOptions key", async () => {
    const result = await makeStubWorkspace().buildRetentionParams(
      "Signup",
      "Login",
    );
    expect(Object.hasOwn(result, "displayOptions")).toBe(true);
  });
});

// ===========================================================================
// T016: shared section builders
// ===========================================================================

describe("Build retention params time sections", () => {
  // python: TestBuildRetentionParamsTimeSections
  it("the default time section is 'in the last' with last=30", async () => {
    const result = await makeStubWorkspace().buildRetentionParams(
      "Signup",
      "Login",
    );
    const time = section(result, "time") as Array<Record<string, unknown>>;
    expect(time.length).toBeGreaterThan(0);
    const entry = time[0]!;
    expect(entry["dateRangeType"]).toBe("in the last");
    const window = entry["window"] as Record<string, unknown>;
    expect(window["value"]).toBe(30);
    expect(window["unit"]).toBe("day");
  });

  it("explicit dates produce a 'between' range", async () => {
    const result = await makeStubWorkspace().buildRetentionParams(
      "Signup",
      "Login",
      {
        from_date: "2025-01-01",
        to_date: "2025-03-31",
      },
    );
    const time = section(result, "time") as Array<Record<string, unknown>>;
    expect(time.length).toBeGreaterThan(0);
    const entry = time[0]!;
    expect(entry["dateRangeType"]).toBe("between");
    expect(entry["value"]).toStrictEqual(["2025-01-01", "2025-03-31"]);
  });

  it("sections.filter is an empty list without a where filter", async () => {
    const result = await makeStubWorkspace().buildRetentionParams(
      "Signup",
      "Login",
    );
    expect(section(result, "filter")).toStrictEqual([]);
  });

  it("sections.group is an empty list without group_by", async () => {
    const result = await makeStubWorkspace().buildRetentionParams(
      "Signup",
      "Login",
    );
    expect(section(result, "group")).toStrictEqual([]);
  });
});

// ===========================================================================
// T-US2: per-event filters
// ===========================================================================

describe("Build retention params per event filters", () => {
  // python: TestBuildRetentionParamsPerEventFilters
  it("a RetentionEvent with filters populates behaviors[0].filters", async () => {
    const born = new RetentionEvent({
      event: "Signup",
      filters: [Filter.equals("source", "organic")],
    });
    const result = await makeStubWorkspace().buildRetentionParams(
      born,
      new RetentionEvent({ event: "Login" }),
    );
    const behaviors = behaviorsOf(result);
    expect(Array.isArray(behaviors[0]!["filters"])).toBe(true);
    expect((behaviors[0]!["filters"] as unknown[]).length).toBeGreaterThan(0);
  });

  it("filters_combinator='any' maps to filtersDeterminer='any'", async () => {
    const born = new RetentionEvent({
      event: "Signup",
      filters: [Filter.equals("source", "organic")],
      filters_combinator: "any",
    });
    const result = await makeStubWorkspace().buildRetentionParams(
      born,
      new RetentionEvent({ event: "Login" }),
    );
    expect(behaviorsOf(result)[0]!["filtersDeterminer"]).toBe("any");
  });

  it("a default RetentionEvent has an empty filters array", async () => {
    const result = await makeStubWorkspace().buildRetentionParams(
      new RetentionEvent({ event: "Signup" }),
      new RetentionEvent({ event: "Login" }),
    );
    const behaviors = behaviorsOf(result);
    expect(behaviors[0]!["filters"]).toStrictEqual([]);
    expect(behaviors[1]!["filters"]).toStrictEqual([]);
  });
});

// ===========================================================================
// T-US2: global filters and group-by
// ===========================================================================

describe("Build retention params global filters", () => {
  // python: TestBuildRetentionParamsGlobalFilters
  it("a where filter populates sections.filter", async () => {
    const result = await makeStubWorkspace().buildRetentionParams(
      "Signup",
      "Login",
      {
        where: Filter.equals("platform", "iOS"),
      },
    );
    expect((section(result, "filter") as unknown[]).length).toBeGreaterThan(0);
  });

  it("group_by='platform' populates sections.group", async () => {
    const result = await makeStubWorkspace().buildRetentionParams(
      "Signup",
      "Login",
      {
        group_by: "platform",
      },
    );
    expect((section(result, "group") as unknown[]).length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// T-US3: custom bucket sizes
// ===========================================================================

describe("Build retention params bucket sizes", () => {
  // python: TestBuildRetentionParamsBucketSizes
  it("explicit bucket_sizes populate retentionCustomBucketSizes", async () => {
    const result = await makeStubWorkspace().buildRetentionParams(
      "Signup",
      "Login",
      {
        bucket_sizes: [1, 3, 7, 14, 30],
      },
    );
    expect(behaviorOf(result)["retentionCustomBucketSizes"]).toStrictEqual([
      1, 3, 7, 14, 30,
    ]);
  });

  it("null bucket_sizes produce an empty list", async () => {
    const result = await makeStubWorkspace().buildRetentionParams(
      "Signup",
      "Login",
    );
    expect(behaviorOf(result)["retentionCustomBucketSizes"]).toStrictEqual([]);
  });
});

// ===========================================================================
// T-US6: display modes
// ===========================================================================

describe("Build retention params mode", () => {
  // python: TestBuildRetentionParamsMode
  it("mode='curve' produces chartType 'retention-curve'", async () => {
    const result = await makeStubWorkspace().buildRetentionParams(
      "Signup",
      "Login",
      {
        mode: "curve",
      },
    );
    expect(
      (result["displayOptions"] as Record<string, unknown>)["chartType"],
    ).toBe("retention-curve");
  });

  it("mode='trends' produces chartType 'line'", async () => {
    const result = await makeStubWorkspace().buildRetentionParams(
      "Signup",
      "Login",
      {
        mode: "trends",
      },
    );
    expect(
      (result["displayOptions"] as Record<string, unknown>)["chartType"],
    ).toBe("line");
  });

  it("mode='table' produces chartType 'table'", async () => {
    const result = await makeStubWorkspace().buildRetentionParams(
      "Signup",
      "Login",
      {
        mode: "table",
      },
    );
    expect(
      (result["displayOptions"] as Record<string, unknown>)["chartType"],
    ).toBe("table");
  });
});

// ===========================================================================
// T005: new retention math types
// ===========================================================================

describe("Build retention params new math types", () => {
  // python: TestBuildRetentionParamsNewMathTypes
  it("math='total' is accepted", async () => {
    const result = await makeStubWorkspace().buildRetentionParams(
      "Signup",
      "Login",
      {
        math: "total",
      },
    );
    expect(measurementOf(result)["math"]).toBe("total");
  });

  it("math='average' is accepted", async () => {
    const result = await makeStubWorkspace().buildRetentionParams(
      "Signup",
      "Login",
      {
        math: "average",
      },
    );
    expect(measurementOf(result)["math"]).toBe("average");
  });
});

// ===========================================================================
// T009: unbounded_mode
// ===========================================================================

describe("Build retention params unbounded mode", () => {
  // python: TestBuildRetentionParamsUnboundedMode
  for (const mode of [
    "carry_forward",
    "carry_back",
    "none",
    "consecutive_forward",
  ]) {
    it(`unbounded_mode='${mode}' produces retentionUnboundedMode`, async () => {
      const result = await makeStubWorkspace().buildRetentionParams(
        "Signup",
        "Login",
        {
          unbounded_mode: mode,
        },
      );
      expect(behaviorOf(result)["retentionUnboundedMode"]).toBe(mode);
    });
  }

  it("omitting unbounded_mode omits the key", async () => {
    const result = await makeStubWorkspace().buildRetentionParams(
      "Signup",
      "Login",
    );
    expect(Object.hasOwn(behaviorOf(result), "retentionUnboundedMode")).toBe(
      false,
    );
  });
});

// ===========================================================================
// T009: retention_cumulative
// ===========================================================================

describe("Build retention params cumulative", () => {
  // python: TestBuildRetentionParamsCumulative
  it("retention_cumulative=true produces retentionCumulative", async () => {
    const result = await makeStubWorkspace().buildRetentionParams(
      "Signup",
      "Login",
      {
        retention_cumulative: true,
      },
    );
    expect(measurementOf(result)["retentionCumulative"]).toBe(true);
  });

  it("the default omits retentionCumulative", async () => {
    const result = await makeStubWorkspace().buildRetentionParams(
      "Signup",
      "Login",
    );
    expect(Object.hasOwn(measurementOf(result), "retentionCumulative")).toBe(
      false,
    );
  });

  it("an explicit false omits retentionCumulative", async () => {
    const result = await makeStubWorkspace().buildRetentionParams(
      "Signup",
      "Login",
      {
        retention_cumulative: false,
      },
    );
    expect(Object.hasOwn(measurementOf(result), "retentionCumulative")).toBe(
      false,
    );
  });

  it("omitting both new params keeps backward compatibility", async () => {
    const result = await makeStubWorkspace().buildRetentionParams(
      "Signup",
      "Login",
    );
    expect(Object.hasOwn(behaviorOf(result), "retentionUnboundedMode")).toBe(
      false,
    );
    expect(Object.hasOwn(measurementOf(result), "retentionCumulative")).toBe(
      false,
    );
  });
});

// ===========================================================================
// T032: data_group_id
// ===========================================================================

describe("Data group ID retention", () => {
  // python: TestDataGroupIdRetention
  it('data_group_id=5 includes globalDataGroupId: "5" in sections', async () => {
    const result = await makeStubWorkspace().buildRetentionParams(
      "Signup",
      "Login",
      {
        data_group_id: 5,
      },
    );
    expect(section(result, "globalDataGroupId")).toBe("5");
    const sections = result["sections"] as Record<string, unknown>;
    expect(Object.hasOwn(sections, "dataGroupId")).toBe(false);
  });

  it("omitting data_group_id omits the key", async () => {
    const result = await makeStubWorkspace().buildRetentionParams(
      "Signup",
      "Login",
    );
    const sections = result["sections"] as Record<string, unknown>;
    expect(Object.hasOwn(sections, "globalDataGroupId")).toBe(false);
    expect(Object.hasOwn(sections, "dataGroupId")).toBe(false);
  });
});
