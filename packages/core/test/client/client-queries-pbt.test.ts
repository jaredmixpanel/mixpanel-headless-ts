// Layer-3 translation — tests/unit/test_api_client_pbt.py::
// TestActivityFeedDateRange → fast-check (Phase-3 packet
// B4-C2; the C1 header exclusion in client-pbt.test.ts pointed here).
//
// Strategy shape: Hypothesis `st.dates(2000-01-01 .. 2100-12-31)
// .map(isoformat)` → an integer day-offset domain mapped through the
// same civil-date arithmetic the implementation uses; `st.none() | ...`
// → fc.option.
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  civilFromDays,
  daysFromCivil,
  formatYmd,
} from "../../src/services/queries/py-dates.js";
import { buildActivityFeedDateRange } from "../../src/services/queries/query-host.js";

/** Day numbers of 2000-01-01 and 2100-12-31 since the epoch. */
const MIN_DAY = daysFromCivil({ year: 2000, month: 1, day: 1 });
const MAX_DAY = daysFromCivil({ year: 2100, month: 12, day: 31 });

/** `feed_dates` — ISO dates between 2000-01-01 and 2100-12-31. */
const feedDates = fc
  .integer({ min: MIN_DAY, max: MAX_DAY })
  .map((day) => formatYmd(civilFromDays(day)));

/** `optional_feed_dates` — None | feed_dates. */
const optionalFeedDates = fc.option(feedDates, { nil: null });

/**
 * The arm `buildActivityFeedDateRange` must select for the given bounds
 * (the Python test's four branches, expressed as data).
 *
 * @param fromDate - Optional lower bound.
 * @param toDate - Optional upper bound.
 * @returns The expected date-range object.
 */
function expectedDateRange(
  fromDate: string | null,
  toDate: string | null,
): Record<string, unknown> {
  if (fromDate !== null && toDate !== null) {
    return { type: "between", from: fromDate, to: toDate };
  }
  if (fromDate !== null) {
    return { type: "since", from: fromDate };
  }
  if (toDate === null) {
    return { type: "relative_after", window: { unit: "day", value: 30 } };
  }
  // `end - start == timedelta(days=30)` via the same civil math.
  const start = formatYmd(civilFromDays(daysFromCivil(civilOf(toDate)) - 30));
  return { type: "between", from: start, to: toDate };
}

describe("TestActivityFeedDateRange", () => {
  it("test_returns_known_type_and_correct_arm", () => {
    fc.assert(
      fc.property(optionalFeedDates, optionalFeedDates, (fromDate, toDate) => {
        const result = buildActivityFeedDateRange(fromDate, toDate);
        expect(["between", "since", "relative_after"]).toContain(
          result["type"],
        );
        expect(result).toStrictEqual(expectedDateRange(fromDate, toDate));
      }),
      { numRuns: 200 },
    );
  });
});

/** Parse a known-good ISO date back to a civil date. */
function civilOf(iso: string): { year: number; month: number; day: number } {
  const [y, m, d] = iso.split("-", 3);
  return {
    year: Number(y),
    month: Number(m),
    day: Number(d),
  };
}
