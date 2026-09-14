// B8-ARB-B unit table for the shared pydantic datetime twins
// (`b8-reviewB-resolution.md` findings F1/F2). Every expected value in
// the lax table below was LIVE-PROBED against CPython 3.14.6 /
// pydantic v2 (`OAuthTokens.model_validate({... expires_at: X})`) and
// is recorded in the resolution file; the formatter rows mirror the
// `model_dump(mode="json")` / `datetime.isoformat()` probe outputs.

import { describe, expect, it } from "vitest";

import { ParamValidationError } from "@mixpanel-headless/core";
import {
  coerceLaxExpiresAt,
  pydanticJsonDatetimeText,
  pythonIsoformatDatetimeText,
} from "../src/auth/pydantic-datetime.js";

describe("coerceLaxExpiresAt — speedate lax mirror (probe table)", () => {
  const ACCEPT: readonly [unknown, string][] = [
    [1_893_456_000, "2030-01-01T00:00:00+00:00"],
    [1_893_456_000.5, "2030-01-01T00:00:00.500000+00:00"],
    ["1893456000", "2030-01-01T00:00:00+00:00"],
    ["+1893456000", "2030-01-01T00:00:00+00:00"],
    ["-1893456000", "1910-01-01T00:00:00+00:00"],
    [".5", "1970-01-01T00:00:00.500000+00:00"],
    ["5.", "1970-01-01T00:00:05+00:00"],
    [0, "1970-01-01T00:00:00+00:00"],
    [-1, "1969-12-31T23:59:59+00:00"],
    // The seconds→ms watershed is |v| STRICTLY ABOVE 20_000_000_000.
    [19_999_999_999, "2603-10-11T11:33:19+00:00"],
    [20_000_000_000, "2603-10-11T11:33:20+00:00"],
    [20_000_000_001, "1970-08-20T11:33:20.001000+00:00"],
    [-20_000_000_000, "1336-03-23T12:26:40+00:00"],
    [-20_000_000_001, "1969-05-14T12:26:39.999000+00:00"],
    [1_893_456_000_000, "2030-01-01T00:00:00+00:00"],
    [1_893_456_000_000.5, "2030-01-01T00:00:00.000500+00:00"],
    ["20000000000", "2603-10-11T11:33:20+00:00"],
    // Python datetime range boundaries (year 1 .. 9999).
    [253_402_300_799_999, "9999-12-31T23:59:59.999000+00:00"],
    [-62_135_596_800_000, "0001-01-01T00:00:00+00:00"],
    // ISO text passes through verbatim (validated downstream).
    ["2030-01-01T00:00:00Z", "2030-01-01T00:00:00Z"],
    ["2030-01-01T00:00:00+05:30", "2030-01-01T00:00:00+05:30"],
  ];

  it.each(ACCEPT)("accepts %j -> %s", (input, expected) => {
    expect(coerceLaxExpiresAt(input)).toBe(expected);
  });

  const REJECT: readonly unknown[] = [
    " 1893456000", // speedate rejects surrounding whitespace
    "1_0", // no underscore grammar (unlike CPython int())
    "0x10",
    "1e10", // no exponent grammar
    "not-a-date",
    "2030-99-99T00:00:00+00:00", // tz-suffixed non-instant
    true,
    null,
    undefined,
    253_402_300_800_000, // 10000-01-01 in ms — "dates after 9999"
    -62_135_596_800_001, // before year 1
    1.5e18,
  ];

  it.each(REJECT.map((v) => [v] as const))("rejects %j", (input) => {
    expect(() => coerceLaxExpiresAt(input)).toThrow(ParamValidationError);
  });
});

describe("writer formatters — pydantic-JSON (Z) vs datetime.isoformat (+00:00)", () => {
  const CASES: readonly [string, string, string][] = [
    // [input, pydantic-JSON form, isoformat form]
    [
      "2030-01-01T00:00:00+00:00",
      "2030-01-01T00:00:00Z",
      "2030-01-01T00:00:00+00:00",
    ],
    [
      "2030-01-01T00:00:00Z",
      "2030-01-01T00:00:00Z",
      "2030-01-01T00:00:00+00:00",
    ],
    [
      "2030-01-01t00:00:00z",
      "2030-01-01T00:00:00Z",
      "2030-01-01T00:00:00+00:00",
    ],
    [
      "2030-01-01T00:00:00.500000+00:00",
      "2030-01-01T00:00:00.500000Z",
      "2030-01-01T00:00:00.500000+00:00",
    ],
    // Fraction canonicalization: pad/truncate to 6, drop when zero
    // (pydantic probe: microsecond=120 renders `.000120Z`).
    [
      "2030-01-01T00:00:00.5Z",
      "2030-01-01T00:00:00.500000Z",
      "2030-01-01T00:00:00.500000+00:00",
    ],
    [
      "2030-01-01T00:00:00.000000+00:00",
      "2030-01-01T00:00:00Z",
      "2030-01-01T00:00:00+00:00",
    ],
    // Non-zero offsets keep local components + canonical `±HH:MM`
    // (pydantic probe: `2030-01-01T00:00:00+05:30`).
    [
      "2030-01-01T00:00:00+05:30",
      "2030-01-01T00:00:00+05:30",
      "2030-01-01T00:00:00+05:30",
    ],
    [
      "2030-01-01T00:00:00+0530",
      "2030-01-01T00:00:00+05:30",
      "2030-01-01T00:00:00+05:30",
    ],
    [
      "2030-01-01T00:00:00-00:00",
      "2030-01-01T00:00:00Z",
      "2030-01-01T00:00:00+00:00",
    ],
    // Out-of-grammar text passes through verbatim (disclosed corner —
    // unreachable from validated models).
    ["whatever", "whatever", "whatever"],
  ];

  it.each(CASES)("%s", (input, zForm, isoForm) => {
    expect(pydanticJsonDatetimeText(input)).toBe(zForm);
    expect(pythonIsoformatDatetimeText(input)).toBe(isoForm);
  });
});
