// `buildTimeSection`, `buildDateRange` and `buildTimeComparison` from
// `bookmarks/builders`, mirroring `TestBuildTimeSection`, `TestBuildDateRange`
// and `TestBuildTimeComparison` of `tests/unit/test_bookmark_builders.py`.
// The clock is injected through the `today` seam; the seam test is TS-only.
import { describe, expect, it } from "vitest";

import {
  buildDateRange,
  buildTimeComparison,
  buildTimeSection,
} from "../../src/bookmarks/builders.js";
import { TimeComparison } from "../../src/types/index.js";

/**
 * Frozen `today` seam used wherever Python patches
 * `bookmark_builders.date`.
 *
 * @param iso - The date the seam should report.
 * @returns A zero-arg seam function returning `iso`.
 */
function frozenToday(iso: string): () => string {
  return () => iso;
}

// --- Time section (TestBuildTimeSection) ---

describe("buildTimeSection", () => {
  it("absolute range from and to", () => {
    const result = buildTimeSection({
      from_date: "2025-01-01",
      to_date: "2025-01-31",
      last: 30,
      unit: "day",
    });
    expect(result).toHaveLength(1);
    const entry = result[0]!;
    expect(entry["dateRangeType"]).toBe("between");
    expect(entry["unit"]).toBe("day");
    expect(entry["value"]).toStrictEqual(["2025-01-01", "2025-01-31"]);
    expect(Object.hasOwn(entry, "window")).toBe(false);
  });

  it("from only fills today", () => {
    const result = buildTimeSection({
      from_date: "2025-01-01",
      to_date: null,
      last: 30,
      unit: "week",
      today: frozenToday("2025-06-15"),
    });
    expect(result).toHaveLength(1);
    const entry = result[0]!;
    expect(entry["dateRangeType"]).toBe("between");
    expect(entry["unit"]).toBe("week");
    expect(entry["value"]).toStrictEqual(["2025-01-01", "2025-06-15"]);
  });

  it("relative range last n", () => {
    const result = buildTimeSection({
      from_date: null,
      to_date: null,
      last: 30,
      unit: "day",
    });
    expect(result).toHaveLength(1);
    const entry = result[0]!;
    expect(entry["dateRangeType"]).toBe("in the last");
    expect(entry["unit"]).toBe("day");
    expect(entry["window"]).toStrictEqual({ unit: "day", value: 30 });
    expect(Object.hasOwn(entry, "value")).toBe(false);
  });

  it("relative range custom last", () => {
    const result = buildTimeSection({
      from_date: null,
      to_date: null,
      last: 7,
      unit: "hour",
    });
    const entry = result[0]!;
    expect(entry["dateRangeType"]).toBe("in the last");
    expect(entry["unit"]).toBe("hour");
    expect((entry["window"] as Record<string, unknown>)["value"]).toBe(7);
  });

  it("returns single element list", () => {
    const cases = [
      { from_date: "2025-01-01", to_date: "2025-01-31", last: 30 },
      { from_date: "2025-01-01", to_date: null, last: 30 },
      { from_date: null, to_date: null, last: 30 },
    ] as const;
    for (const kwargs of cases) {
      const result = buildTimeSection({
        ...kwargs,
        unit: "day",
        today: frozenToday("2025-06-15"),
      });
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(1);
    }
  });

  it("relative branch never reads the clock (no `today` seam needed)", () => {
    // TS-only: the from-only branch is the ONLY
    // `date.today()` read.
    const seam = (): string => {
      throw new Error("clock must not be read on the relative branch");
    };
    expect(() =>
      buildTimeSection({
        from_date: null,
        to_date: null,
        last: 5,
        unit: "day",
        today: seam,
      }),
    ).not.toThrow();
    expect(() =>
      buildTimeSection({
        from_date: "2025-01-01",
        to_date: "2025-01-31",
        last: 5,
        unit: "day",
        today: seam,
      }),
    ).not.toThrow();
  });
});

// --- Date range (TestBuildDateRange) ---

describe("buildDateRange", () => {
  it("relative last n", () => {
    const result = buildDateRange({ from_date: null, to_date: null, last: 30 });
    expect(result["type"]).toBe("in the last");
    expect(result["from_date"]).toStrictEqual({ unit: "day", value: 30 });
    expect(result["to_date"]).toBe("$now");
  });

  it("absolute range", () => {
    const result = buildDateRange({
      from_date: "2025-01-01",
      to_date: "2025-03-31",
      last: 30,
    });
    expect(result["type"]).toBe("between");
    expect(result["from_date"]).toBe("2025-01-01");
    expect(result["to_date"]).toBe("2025-03-31");
  });

  it("relative custom last", () => {
    const result = buildDateRange({ from_date: null, to_date: null, last: 7 });
    const fromDate = result["from_date"] as Record<string, unknown>;
    expect(fromDate["value"]).toBe(7);
    expect(fromDate["unit"]).toBe("day");
  });
});

// --- Time comparison (TestBuildTimeComparison) ---

describe("buildTimeComparison", () => {
  it("relative produces correct dict", () => {
    expect(buildTimeComparison(TimeComparison.relative("month"))).toStrictEqual(
      {
        type: "relative",
        value: "month",
      },
    );
  });

  it("absolute start produces correct dict", () => {
    expect(
      buildTimeComparison(TimeComparison.absoluteStart("2026-01-01")),
    ).toStrictEqual({ type: "absolute-start", value: "2026-01-01" });
  });

  it("absolute end produces correct dict", () => {
    expect(
      buildTimeComparison(TimeComparison.absoluteEnd("2026-12-31")),
    ).toStrictEqual({ type: "absolute-end", value: "2026-12-31" });
  });

  it("relative day unit", () => {
    expect(buildTimeComparison(TimeComparison.relative("day")).value).toBe(
      "day",
    );
  });

  it("relative year unit", () => {
    expect(buildTimeComparison(TimeComparison.relative("year")).value).toBe(
      "year",
    );
  });
});
