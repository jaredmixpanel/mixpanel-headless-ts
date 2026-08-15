// Colocated runtime backstop for fast-check property list item #7
// (phase2-design C9): enum/alias membership tables contain no
// duplicates and match the declared cardinalities. The compile-time
// half (union⇄tuple drift) is enforced in literals.ts by the
// `satisfies` clauses + `LiteralAliasCoverageProof`; the cross-language
// value lock is the C8(d) artifact test in conformance-runner/test.
import { describe, expect, it } from "vitest";
import {
  ACCOUNT_TYPE_VALUES,
  AlertFrequencyPreset,
  ENUM_TABLES,
  FeatureFlagStatus,
  LITERAL_ALIAS_VALUES,
  TIME_UNIT_VALUES,
} from "../src/types/index.js";
import { BOOKMARK_ENUM_TABLES } from "../src/bookmarks/index.js";

describe("literal-alias and enum tables (C9 #7 runtime backstop)", () => {
  it("registers exactly 37 aliases, 8 enums, and 34 bookmark tables", () => {
    expect(LITERAL_ALIAS_VALUES.size).toBe(37);
    expect(ENUM_TABLES.size).toBe(8);
    expect(BOOKMARK_ENUM_TABLES.size).toBe(34);
  });

  it("no alias tuple contains duplicate members", () => {
    for (const [name, values] of LITERAL_ALIAS_VALUES) {
      expect(new Set(values).size, `duplicates in ${name}`).toBe(values.length);
      expect(values.length, `${name} must be non-empty`).toBeGreaterThan(0);
    }
  });

  it("no enum member record contains duplicate values", () => {
    for (const [name, entry] of ENUM_TABLES) {
      const values = Object.values(entry.members);
      expect(new Set(values).size, `duplicate values in ${name}`).toBe(
        values.length,
      );
    }
  });

  it("spot-checks the documented representative values", () => {
    expect(TIME_UNIT_VALUES).toEqual(["day", "week", "month"]);
    expect(ACCOUNT_TYPE_VALUES).toEqual([
      "service_account",
      "oauth_browser",
      "oauth_token",
    ]);
    // String enum: referenced by member NAME, compared by VALUE.
    expect(FeatureFlagStatus.ENABLED).toBe("enabled");
    // IntEnum port preserves numeric values (R4.3).
    expect(AlertFrequencyPreset.HOURLY).toBe(3600);
    expect(AlertFrequencyPreset.DAILY).toBe(86400);
    expect(AlertFrequencyPreset.WEEKLY).toBe(604800);
  });
});
