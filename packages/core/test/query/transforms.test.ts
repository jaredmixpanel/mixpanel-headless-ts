// `transformProfile`, `transformEvent` and `dictKeyText` from
// `_internal/transforms`. `transformProfile` mirrors the two `TestTransformProfile*`
// classes of `tests/test_query_user_structural.py`; `transformEvent` has no
// Python unit test, so its cases (marked TS-only) are locked by the module
// docstring example and by CPython `datetime.fromtimestamp` probes.
import { describe, expect, it } from "vitest";

import { OverflowError, ValueError } from "../../src/compat/python-builtins.js";
import {
  RESERVED_EVENT_KEYS,
  RESERVED_PROFILE_KEYS,
  transformEvent,
  transformProfile,
} from "../../src/query/transforms.js";

/** Deterministic uuid seam for the TS-only `transformEvent` cases. */
function fixedUuid(): string {
  return "00000000-0000-4000-8000-000000000000";
}

// --- transformProfile (TestTransformProfileMissingDistinctId, TestTransformProfileCompletelyEmpty) ---

describe("transformProfile", () => {
  it("T5.03: profile without $distinct_id gets empty string as distinct_id", () => {
    const raw = { $properties: { plan: "free" } };
    const result = transformProfile(raw);

    expect(result["distinct_id"]).toBe("");
    expect(result["last_seen"]).toBeNull();
    expect(result["properties"]).toStrictEqual({ plan: "free" });
  });

  it("T5.04: empty dict produces a valid normalized profile with defaults", () => {
    const result = transformProfile({});

    expect(result["distinct_id"]).toBe("");
    expect(result["last_seen"]).toBeNull();
    expect(result["properties"]).toStrictEqual({});
  });

  // TS-only (no Python source test; locked by the transforms.py docstring)
  it("promotes $last_seen out of $properties and keeps the rest", () => {
    const raw = {
      $distinct_id: "user123",
      $properties: {
        $last_seen: "2024-01-15T10:30:00",
        plan: "premium",
        email: "alice@example.com",
      },
    };
    const result = transformProfile(raw);

    expect(result).toStrictEqual({
      distinct_id: "user123",
      last_seen: "2024-01-15T10:30:00",
      properties: { plan: "premium", email: "alice@example.com" },
    });
  });

  // TS-only — the shallow-copy contract: the caller's
  // `$properties` dict must not lose its `$last_seen` key.
  it("does not mutate the caller's $properties dict", () => {
    const properties: Record<string, unknown> = {
      $last_seen: "2024-01-15T10:30:00",
      plan: "premium",
    };
    const raw = { $distinct_id: "u", $properties: properties };

    transformProfile(raw);

    expect(properties).toStrictEqual({
      $last_seen: "2024-01-15T10:30:00",
      plan: "premium",
    });
  });

  // TS-only — `RESERVED_PROFILE_KEYS` is exported for parity
  // (`transforms.py`).
  it("exports the reserved profile key set", () => {
    expect([...RESERVED_PROFILE_KEYS]).toStrictEqual(["$last_seen"]);
  });
});

// --- transformEvent (TS-only: docstring + CPython probe locked) ---

describe("transformEvent", () => {
  // TS-only — module docstring example (`transforms.py`).
  it("normalizes the docstring example", () => {
    const raw = {
      event: "Sign Up",
      properties: {
        distinct_id: "user123",
        time: 1704067200,
        $insert_id: "abc123",
        plan: "premium",
      },
    };
    const result = transformEvent(raw, { uuid: fixedUuid });

    expect(result).toStrictEqual({
      event_name: "Sign Up",
      event_time: "2024-01-01T00:00:00+00:00",
      distinct_id: "user123",
      insert_id: "abc123",
      properties: { plan: "premium" },
    });
  });

  // TS-only — every `.pop(..., default)` default at once
  // (`transforms.py`).
  it("applies every default for an empty event dict", () => {
    const result = transformEvent({}, { uuid: fixedUuid });

    expect(result).toStrictEqual({
      event_name: "",
      event_time: "1970-01-01T00:00:00+00:00",
      distinct_id: "",
      insert_id: "00000000-0000-4000-8000-000000000000",
      properties: {},
    });
  });

  // TS-only — `$insert_id: None` takes the uuid branch
  // (`transforms.py`); an EXPLICIT null, not just an absent key.
  it("fills insert_id when $insert_id is present but null", () => {
    const result = transformEvent(
      { event: "E", properties: { $insert_id: null, time: 0 } },
      { uuid: fixedUuid },
    );

    expect(result["insert_id"]).toBe("00000000-0000-4000-8000-000000000000");
  });

  // TS-only — the caller's properties dict is shallow-copied
  // (`transforms.py`).
  it("does not mutate the caller's properties dict", () => {
    const properties: Record<string, unknown> = {
      distinct_id: "u",
      time: 5,
      $insert_id: "i",
      plan: "pro",
    };

    transformEvent({ event: "E", properties }, { uuid: fixedUuid });

    expect(properties).toStrictEqual({
      distinct_id: "u",
      time: 5,
      $insert_id: "i",
      plan: "pro",
    });
  });

  // TS-only — probe: integral seconds render with NO fractional part.
  it.each([
    [0, "1970-01-01T00:00:00+00:00"],
    [1, "1970-01-01T00:00:01+00:00"],
    [-1, "1969-12-31T23:59:59+00:00"],
    [18.0, "1970-01-01T00:00:18+00:00"],
    [1704067200, "2024-01-01T00:00:00+00:00"],
    [1000000000, "2001-09-09T01:46:40+00:00"],
    [-1000000000, "1938-04-24T22:13:20+00:00"],
    [253402300799, "9999-12-31T23:59:59+00:00"],
    [-62135596800, "0001-01-01T00:00:00+00:00"],
  ])("renders integral timestamp %s as %s", (time, expected) => {
    const result = transformEvent(
      { event: "E", properties: { time } },
      { uuid: fixedUuid },
    );
    expect(result["event_time"]).toBe(expected);
  });

  // TS-only — probe: fractional seconds render six-digit microseconds, and
  // the µs rounding is CPython's round-HALF-EVEN (`Math.round` would
  // give `1.5e-6 -> 2` but also `2.5e-6 -> 3`, and `-0.5 -> -0`).
  it.each([
    [1.5, "1970-01-01T00:00:01.500000+00:00"],
    [-1.5, "1969-12-31T23:59:58.500000+00:00"],
    [-0.5, "1969-12-31T23:59:59.500000+00:00"],
    [0.5, "1970-01-01T00:00:00.500000+00:00"],
    [1.0000005, "1970-01-01T00:00:01.000001+00:00"],
    [0.1 + 0.2, "1970-01-01T00:00:00.300000+00:00"],
    [1.9999995, "1970-01-01T00:00:01.999999+00:00"],
    [2.9999995, "1970-01-01T00:00:02.999999+00:00"],
    [-1.0000005, "1969-12-31T23:59:58.999999+00:00"],
    [1699999999.9999995, "2023-11-14T22:13:20+00:00"],
    [5e-7, "1970-01-01T00:00:00+00:00"],
    [1.5e-6, "1970-01-01T00:00:00.000002+00:00"],
    [2.5e-6, "1970-01-01T00:00:00.000002+00:00"],
    [-5e-7, "1970-01-01T00:00:00+00:00"],
    [-1.5e-6, "1969-12-31T23:59:59.999998+00:00"],
  ])("renders fractional timestamp %s as %s", (time, expected) => {
    const result = transformEvent(
      { event: "E", properties: { time } },
      { uuid: fixedUuid },
    );
    expect(result["event_time"]).toBe(expected);
  });

  // TS-only — `bool` IS an `int` in Python, and
  // `fromtimestamp(True)` is one second past the epoch (probe).
  it.each([
    [true, "1970-01-01T00:00:01+00:00"],
    [false, "1970-01-01T00:00:00+00:00"],
  ])("accepts boolean timestamp %s", (time, expected) => {
    const result = transformEvent(
      { event: "E", properties: { time } },
      { uuid: fixedUuid },
    );
    expect(result["event_time"]).toBe(expected);
  });

  // TS-only — probe: `fromtimestamp` rejects non-numeric input with
  // TypeError ("argument must be int or float, not str").
  it.each([["x"], [null], [[1]], [{ a: 1 }]])(
    "raises TypeError for non-numeric time %s",
    (time) => {
      expect(() =>
        transformEvent(
          { event: "E", properties: { time } },
          {
            uuid: fixedUuid,
          },
        ),
      ).toThrow(TypeError);
    },
  );

  // TS-only — probe: NaN is a ValueError, non-finite is an OverflowError,
  // and a year outside 1..9999 is a ValueError.
  it("raises ValueError for a NaN timestamp", () => {
    expect(() =>
      transformEvent({ properties: { time: Number.NaN } }, { uuid: fixedUuid }),
    ).toThrow(ValueError);
  });

  it.each([[Number.POSITIVE_INFINITY], [Number.NEGATIVE_INFINITY]])(
    "raises OverflowError for a non-finite timestamp %s",
    (time) => {
      expect(() =>
        transformEvent({ properties: { time } }, { uuid: fixedUuid }),
      ).toThrow(OverflowError);
    },
  );

  it.each([[253402300800], [-62135596801], [1e12]])(
    "raises ValueError for out-of-range timestamp %s",
    (time) => {
      expect(() =>
        transformEvent({ properties: { time } }, { uuid: fixedUuid }),
      ).toThrow(ValueError);
    },
  );

  // TS-only — non-BMP keys/values survive the properties passthrough
  // (differential-fuzz edge item).
  it("preserves non-BMP event names and property keys", () => {
    const result = transformEvent(
      { event: "𝒳", properties: { time: 0, "𝒳key": "𝒳value" } },
      { uuid: fixedUuid },
    );

    expect(result["event_name"]).toBe("𝒳");
    expect(result["properties"]).toStrictEqual({ "𝒳key": "𝒳value" });
  });

  // TS-only — `RESERVED_EVENT_KEYS` is exported for parity
  // (`transforms.py`).
  it("exports the reserved event key set", () => {
    expect([...RESERVED_EVENT_KEYS].sort()).toStrictEqual([
      "$insert_id",
      "distinct_id",
      "time",
    ]);
  });

  // TS-only — the library default uuid seam is a real UUID v4 string
  // (`crypto.randomUUID()`); the binding overrides it with
  // `context.shims.uuid`.
  it("defaults to a generated uuid when no seam is injected", () => {
    const result = transformEvent({ properties: { time: 0 } });

    expect(result["insert_id"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

// --- dictKeyText float-carrier pair keys ---

/**
 * Structural twin of the rig's `PyFloat` carrier (the library cannot
 * import rig code) — a CLASS instance with a string `spelling` field,
 * matching the `validation-dict-fidelity.test.ts` precedent. Float
 * keys reach `dictKeyText` only through the pathological
 * `dict(iterable-of-pairs)` properties branch.
 */
class PyFloatStub {
  /** The canonical CPython float spelling. */
  readonly spelling: string;

  /**
   * Wrap a spelling.
   *
   * @param spelling - Canonical CPython `repr(float)` output.
   */
  constructor(spelling: string) {
    this.spelling = spelling;
  }
}

describe("dictKeyText — float-carrier pair keys use the json.dumps spelling", () => {
  // TS-only — CPython 3.14.6 reference: transform_event with properties
  // [(18.0, 1), (1e16, 2), (-0.0, 3)] keeps the FLOAT keys, and
  // json.dumps spells them "18.0" / "1e+16" / "-0.0" (float.__repr__).
  // The pre-fix `String(floatCarrierValue(key))` rendered "18" /
  // "10000000000000000" / "0".
  it("transformEvent renders carrier keys via pythonFloatStr, not String()", () => {
    const result = transformEvent(
      {
        event: "e",
        distinct_id: "d",
        properties: [
          [new PyFloatStub("18.0"), 1],
          [new PyFloatStub("1e+16"), 2],
          [new PyFloatStub("-0.0"), 3],
        ],
      },
      { uuid: fixedUuid },
    );

    expect(result["properties"]).toStrictEqual({
      "18.0": 1,
      "1e+16": 2,
      "-0.0": 3,
    });
  });

  // TS-only — same policy through transform_profile:
  // transform_profile({"$distinct_id": "u", "$properties":
  // [(2.5, "x")]}) → {"distinct_id": "u", "last_seen": null,
  // "properties": {"2.5": "x"}} (oracle-py reference, same probe).
  it("transformProfile renders a fractional carrier key faithfully", () => {
    const result = transformProfile({
      $distinct_id: "u",
      $properties: [[new PyFloatStub("2.5"), "x"]],
    });

    expect(result).toStrictEqual({
      distinct_id: "u",
      last_seen: null,
      properties: { "2.5": "x" },
    });
  });
});
