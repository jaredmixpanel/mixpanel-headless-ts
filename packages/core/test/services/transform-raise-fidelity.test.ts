// B5-ARB regression locks (arbiter-directed remediation of the B5 review
// pair, `docs/history/phase3/design/b5-review-resolution.md` findings FID-F1,
// FID-F2, FID-F4 and ASR-F6b — ADDITIVE, substitutes for no Python file;
// every expectation below is a live-CPython probe result recorded in the
// resolution document):
//
// - FID-F1: `_transform_funnel` / `_transform_retention` store RAW count /
//   size values and raise only lazily at the `+` / `>` / `/` operator
//   sites CPython has (`live_query.py:126-147`, `:196`); the pre-fix TS
//   coerced eagerly at read time and raised where CPython succeeds.
// - FID-F2: in-annotation (Discrepancy #8 `Any`-interior) CPython
//   `AttributeError` / `TypeError` raise-emulation at every dict-method /
//   `in` / iteration site of the live-query transforms; the pre-fix TS
//   silently succeeded (sometimes with wrong computed numbers).
// - FID-F4: `_STEP_PREFIX_RE`'s `(.+)` — Python `.` excludes ONLY `\n`;
//   JS `.` also excludes `\r`, U+2028 and U+2029.
// - ASR-F6b: `FunnelQueryResult.overall_conversion_rate` string arm is
//   CPython `float(str)` (R11.7 — `pythonFloat`, never `Number()`).

import { describe, expect, it } from "vitest";

import { AttributeError } from "../../src/query/python-builtins.js";
import { LiveQueryService } from "../../src/services/live-query.js";
import {
  extractFunnelStepsFromSeries,
  extractStepsFromDateData,
  parseTreeNode,
  transformActivityFeed,
  transformFlowResult,
  transformFunnel,
  transformNumericBucket,
  transformQueryResult,
  transformRetention,
  transformSavedReport,
  transformSegmentation,
} from "../../src/services/live-query-transforms.js";
import { FunnelQueryResult } from "../../src/types/results/query-engine.js";
import {
  type CannedResponse,
  createMockClient,
  makeSession,
} from "../../test-support/client-test-helpers.js";

/** Silent warning sink for the funnel-series transform. */
const noWarn = (): void => undefined;

/**
 * Build a LiveQueryService whose one wire call returns `json`.
 *
 * @param json - The canned 200 response body.
 * @returns The service under test.
 */
function serviceReturning(json: unknown): LiveQueryService {
  const { client } = createMockClient(makeSession(), (): CannedResponse => ({
    status: 200,
    json,
  }));
  return new LiveQueryService(client);
}

// ---------------------------------------------------------------------------
// FID-F1 — lazy operator-site coercion (CPython succeeds, stores raw)
// ---------------------------------------------------------------------------

describe("FID-F1: transformFunnel stores raw counts, raises lazily", () => {
  it("zero-then-None counts SUCCEED like CPython (guards short-circuit)", () => {
    // CPython: [('A', 0, 1.0), ('B', None, 0.0)], overall 0.0
    const result = transformFunnel(
      {
        data: {
          d: {
            steps: [
              { event: "A", count: 0 },
              { event: "B", count: null },
            ],
          },
        },
      },
      1,
      "a",
      "b",
    );
    expect(
      result.steps.map((s) => [s.event, s.count, s.conversion_rate]),
    ).toStrictEqual([
      ["A", 0, 1.0],
      ["B", null, 0.0],
    ]);
    expect(result.conversion_rate).toBe(0.0);
  });

  it("str counts across two dates CONCATENATE at the + site, then the overall > raises", () => {
    // CPython: "x" + "y" -> "xy"; then steps[0].count > 0 -> TypeError
    // "'>' not supported between instances of 'str' and 'int'"
    expect(() =>
      transformFunnel(
        {
          data: {
            d1: { steps: [{ count: "x" }] },
            d2: { steps: [{ count: "y" }] },
          },
        },
        1,
        "a",
        "b",
      ),
    ).toThrow(/'>' not supported between instances of 'str' and 'int'/);
  });

  it("str first-step count raises at the prev_count > 0 comparison", () => {
    // CPython: TypeError '>' not supported between instances of 'str' and 'int'
    expect(() =>
      transformFunnel(
        { data: { d: { steps: [{ count: "s" }, { count: 3 }] } } },
        1,
        "a",
        "b",
      ),
    ).toThrow(/'>' not supported between instances of 'str' and 'int'/);
  });

  it("None + int aggregation raises CPython's + TypeError with operand order", () => {
    // CPython: unsupported operand type(s) for +: 'NoneType' and 'int'
    expect(() =>
      transformFunnel(
        {
          data: {
            d1: { steps: [{ count: null }] },
            d2: { steps: [{ count: 3 }] },
          },
        },
        1,
        "a",
        "b",
      ),
    ).toThrow(/unsupported operand type\(s\) for \+: 'NoneType' and 'int'/);
  });

  it("int + None aggregation flips the operand order in the message", () => {
    expect(() =>
      transformFunnel(
        {
          data: {
            d1: { steps: [{ count: 3 }] },
            d2: { steps: [{ count: null }] },
          },
        },
        1,
        "a",
        "b",
      ),
    ).toThrow(/unsupported operand type\(s\) for \+: 'int' and 'NoneType'/);
  });

  it("bool counts flow through untouched (True stays True, True/True = 1.0)", () => {
    // CPython: [(True, 1.0), (True, 1.0)]
    const result = transformFunnel(
      { data: { d: { steps: [{ count: true }, { count: true }] } } },
      1,
      "a",
      "b",
    );
    expect(result.steps.map((s) => [s.count, s.conversion_rate])).toStrictEqual(
      [
        [true, 1.0],
        [true, 1.0],
      ],
    );
  });

  it("list counts concatenate at + then raise at the overall list > int", () => {
    // CPython: [1] + [2] ok, then '>' not supported ... 'list' and 'int'
    expect(() =>
      transformFunnel(
        {
          data: {
            d1: { steps: [{ count: [1] }] },
            d2: { steps: [{ count: [2] }] },
          },
        },
        1,
        "a",
        "b",
      ),
    ).toThrow(/'>' not supported between instances of 'list' and 'int'/);
  });
});

describe("FID-F1: transformRetention stores raw size, raises lazily", () => {
  it("str size with EMPTY counts succeeds (no comparison ever runs)", () => {
    // CPython: CohortInfo(size="5", retention=[])
    const result = transformRetention(
      { d: { first: "5", counts: [] } },
      "b",
      "r",
      "f",
      "t",
      "day",
    );
    expect(result.cohorts.map((c) => [c.size, c.retention])).toStrictEqual([
      ["5", []],
    ]);
  });

  it("None size with empty counts succeeds", () => {
    // CPython: CohortInfo(size=None, retention=[])
    const result = transformRetention(
      { d: { first: null, counts: [] } },
      "b",
      "r",
      "f",
      "t",
      "day",
    );
    expect(result.cohorts.map((c) => [c.size, c.retention])).toStrictEqual([
      [null, []],
    ]);
  });

  it("str size with non-empty counts raises at the > comparison", () => {
    // CPython: TypeError '>' not supported between instances of 'str' and 'int'
    expect(() =>
      transformRetention(
        { d: { first: "5", counts: [1] } },
        "b",
        "r",
        "f",
        "t",
        "day",
      ),
    ).toThrow(/'>' not supported between instances of 'str' and 'int'/);
  });

  it("dict counts iterate KEYS like Python (size 0 -> all-0.0)", () => {
    // CPython: [(0, [0.0])]
    const result = transformRetention(
      { d: { first: 0, counts: { a: 1 } } },
      "b",
      "r",
      "f",
      "t",
      "day",
    );
    expect(result.cohorts.map((c) => [c.size, c.retention])).toStrictEqual([
      [0, [0.0]],
    ]);
  });

  it("dict counts with size > 0 raise at the str / int division", () => {
    // CPython: unsupported operand type(s) for /: 'str' and 'int'
    expect(() =>
      transformRetention(
        { d: { first: 2, counts: { a: 1 } } },
        "b",
        "r",
        "f",
        "t",
        "day",
      ),
    ).toThrow(/unsupported operand type\(s\) for \/: 'str' and 'int'/);
  });

  it("bool size True divides as 1 and is stored raw", () => {
    // CPython: [(True, [1.0])]
    const result = transformRetention(
      { d: { first: true, counts: [1] } },
      "b",
      "r",
      "f",
      "t",
      "day",
    );
    expect(result.cohorts.map((c) => [c.size, c.retention])).toStrictEqual([
      [true, [1.0]],
    ]);
  });
});

// ---------------------------------------------------------------------------
// FID-F2 — AttributeError / TypeError raise-emulation at read sites
// ---------------------------------------------------------------------------

describe("FID-F2: transformSegmentation raise sites", () => {
  it("list data raises AttributeError 'list' ... 'get'", () => {
    expect(() =>
      transformSegmentation({ data: [1, 2] }, "e", "f", "t", "day", null),
    ).toThrow(AttributeError);
    expect(() =>
      transformSegmentation({ data: [1, 2] }, "e", "f", "t", "day", null),
    ).toThrow(/'list' object has no attribute 'get'/);
  });

  it("list segment values raise AttributeError 'list' ... 'values' (NOT total=3)", () => {
    expect(() =>
      transformSegmentation(
        { data: { values: { seg: [1, 2] } } },
        "e",
        "f",
        "t",
        "day",
        null,
      ),
    ).toThrow(/'list' object has no attribute 'values'/);
  });

  it("str values member raises AttributeError 'str' ... 'values'", () => {
    expect(() =>
      transformSegmentation(
        { data: { values: "xy" } },
        "e",
        "f",
        "t",
        "day",
        null,
      ),
    ).toThrow(/'str' object has no attribute 'values'/);
  });

  it("sum raises lazily: bad count in the FIRST segment wins over a later non-dict", () => {
    // CPython: TypeError unsupported operand type(s) for +: 'int' and 'str'
    // (raised before segment "b"'s .values() AttributeError is reached)
    expect(() =>
      transformSegmentation(
        { data: { values: { a: { k: "bad" }, b: 5 } } },
        "e",
        "f",
        "t",
        "day",
        null,
      ),
    ).toThrow(/unsupported operand type\(s\) for \+: 'int' and 'str'/);
  });
});

describe("FID-F2: extractStepsFromDateData Python `in` + .get semantics", () => {
  it("a str containing 'steps' passes the substring test then raises at .get", () => {
    // CPython: AttributeError 'str' object has no attribute 'get'
    expect(() => extractStepsFromDateData("my steps here")).toThrow(
      /'str' object has no attribute 'get'/,
    );
  });

  it("an int raises CPython's membership TypeError", () => {
    // CPython 3.14: argument of type 'int' is not a container or iterable
    expect(() => extractStepsFromDateData(7)).toThrow(
      /argument of type 'int' is not a container or iterable/,
    );
  });

  it("a list WITHOUT the literal member falls through to []", () => {
    expect(extractStepsFromDateData(["a"])).toStrictEqual([]);
  });

  it("a list CONTAINING 'steps' passes membership then raises at .get", () => {
    expect(() => extractStepsFromDateData(["steps"])).toThrow(
      /'list' object has no attribute 'get'/,
    );
  });
});

describe("FID-F2: remaining transform read sites", () => {
  it("transformFunnel: a non-dict step raises AttributeError at step.get", () => {
    expect(() =>
      transformFunnel({ data: { d: { steps: [5] } } }, 1, "a", "b"),
    ).toThrow(/'int' object has no attribute 'get'/);
  });

  it("extractFunnelStepsFromSeries: a non-dict metric raises in _get_val", () => {
    // CPython: AttributeError 'int' object has no attribute 'get'
    expect(() =>
      extractFunnelStepsFromSeries(
        { F: { count: { "1. A": { all: 1 } }, avg_time: 3 } },
        noWarn,
      ),
    ).toThrow(/'int' object has no attribute 'get'/);
  });

  it("transformQueryResult: a JSON-null date_range raises AttributeError", () => {
    // CPython: AttributeError 'NoneType' object has no attribute 'get'
    expect(() =>
      transformQueryResult({ series: [], date_range: null }, {}),
    ).toThrow(/'NoneType' object has no attribute 'get'/);
  });

  it("transformActivityFeed: dict raw_events iterates keys then raises at .get", () => {
    // CPython: for event in {'a': 1} iterates 'a'; 'a'.get -> AttributeError
    expect(() =>
      transformActivityFeed(
        { results: { events: { a: 1 } } },
        ["u"],
        null,
        null,
      ),
    ).toThrow(/'str' object has no attribute 'get'/);
  });

  it("transformActivityFeed: int raw_events raises the iteration TypeError", () => {
    // CPython: TypeError 'int' object is not iterable
    expect(() =>
      transformActivityFeed({ results: { events: 7 } }, ["u"], null, null),
    ).toThrow(/'int' object is not iterable/);
  });

  it("transformActivityFeed: non-dict results raises at results.get", () => {
    expect(() =>
      transformActivityFeed({ results: "xx" }, ["u"], null, null),
    ).toThrow(/'str' object has no attribute 'get'/);
  });

  it("transformActivityFeed: non-dict properties raises at props.get('time')", () => {
    expect(() =>
      transformActivityFeed(
        { results: { events: [{ event: "e", properties: 5 }] } },
        ["u"],
        null,
        null,
      ),
    ).toThrow(/'int' object has no attribute 'get'/);
  });

  it("transformFlowResult: a truthy non-dict root raises inside parseTreeNode", () => {
    expect(() =>
      transformFlowResult({ trees: [{ root: 5 }] }, {}, "tree"),
    ).toThrow(/'int' object has no attribute 'get'/);
  });

  it("transformFlowResult: a non-dict tree entry raises at tree_dict.get", () => {
    expect(() => transformFlowResult({ trees: [5] }, {}, "tree")).toThrow(
      /'int' object has no attribute 'get'/,
    );
  });

  it("parseTreeNode: children parse BEFORE the step dict is read (CPython order)", () => {
    // CPython: step='s5' assigned raw; the child recursion raises first?
    // No — {'x': 1} is a fine child; the raise is at step.get:
    // AttributeError 'str' object has no attribute 'get'
    expect(() => parseTreeNode({ step: "s5", children: [{ x: 1 }] })).toThrow(
      /'str' object has no attribute 'get'/,
    );
  });

  it("transformNumericBucket: non-dict data raises at data.get('values')", () => {
    expect(() =>
      transformNumericBucket({ data: [1] }, "e", "f", "t", "o", "day"),
    ).toThrow(/'list' object has no attribute 'get'/);
  });

  it("transformSavedReport funnels: truthy non-dict data raises at data.keys()", () => {
    // CPython: AttributeError 'list' object has no attribute 'keys'
    expect(() => transformSavedReport({ data: [1, 2] }, 1, "funnels")).toThrow(
      /'list' object has no attribute 'keys'/,
    );
  });

  it("transformSavedReport funnels: FALSY non-dict data short-circuits to '' (no raise)", () => {
    // CPython: truthiness first — {'data': 0} -> ('', series=0)
    const result = transformSavedReport({ data: 0 }, 1, "funnels");
    expect(result.from_date).toBe("");
    expect(result.series).toBe(0);
  });

  it("transformSavedReport insights: JSON-null date_range raises AttributeError", () => {
    expect(() =>
      transformSavedReport({ date_range: null }, 1, "insights"),
    ).toThrow(/'NoneType' object has no attribute 'get'/);
  });
});

describe("FID-F2: LiveQueryService dataValues (event_counts/property_counts)", () => {
  it("eventCounts: a str data member raises AttributeError, not silent {}", async () => {
    // CPython: raw.get('data', {}).get(...) -> AttributeError 'str' ... 'get'
    const live = serviceReturning({ data: "xx" });
    await expect(
      live.eventCounts(["E"], "2024-01-01", "2024-01-02"),
    ).rejects.toThrow(AttributeError);
    await expect(
      live.eventCounts(["E"], "2024-01-01", "2024-01-02"),
    ).rejects.toThrow(/'str' object has no attribute 'get'/);
  });

  it("propertyCounts: a JSON-null data member raises AttributeError 'NoneType'", async () => {
    const live = serviceReturning({ data: null });
    await expect(
      live.propertyCounts("E", "p", "2024-01-01", "2024-01-02"),
    ).rejects.toThrow(/'NoneType' object has no attribute 'get'/);
  });
});

// ---------------------------------------------------------------------------
// FID-F4 — STEP_PREFIX_RE: Python `.` excludes only `\n`
// ---------------------------------------------------------------------------

describe("FID-F4: STEP_PREFIX_RE dot semantics", () => {
  it("matches step names containing U+000D CR (CPython dot semantics)", () => {
    // CPython: _STEP_PREFIX_RE.match('1. a\rb').group(2) == 'a\rb'
    const steps = extractFunnelStepsFromSeries(
      { F: { count: { "1. a\rb": { all: 7 } } } },
      noWarn,
    );
    expect(steps.map((s) => s["event"])).toStrictEqual(["a\rb"]);
  });

  it("matches step names containing U+2028 LINE SEPARATOR (CPython dot semantics)", () => {
    const steps = extractFunnelStepsFromSeries(
      { F: { count: { "1. a b": { all: 7 } } } },
      noWarn,
    );
    expect(steps.map((s) => s["event"])).toStrictEqual(["a b"]);
  });

  it("still refuses \\n inside the captured name (Python `.`)", () => {
    // CPython: no match -> the whole name is the event, sort key 2**31
    const steps = extractFunnelStepsFromSeries(
      { F: { count: { "1. a\nb": { all: 7 } } } },
      noWarn,
    );
    expect(steps.map((s) => s["event"])).toStrictEqual(["1. a\nb"]);
  });
});

// ---------------------------------------------------------------------------
// ASR-F6b — overall_conversion_rate string arm is CPython float(str)
// ---------------------------------------------------------------------------

describe("ASR-F6b: FunnelQueryResult.overall_conversion_rate float(str) arm", () => {
  it("parses CPython float spellings Number() refuses ('inf')", () => {
    const result = new FunnelQueryResult({
      computed_at: "",
      from_date: "",
      to_date: "",
      steps_data: [{ overall_conv_ratio: "inf" }],
    });
    expect(result.overall_conversion_rate).toBe(Infinity);
  });

  it("raises on the empty string exactly where CPython float('') raises", () => {
    const result = new FunnelQueryResult({
      computed_at: "",
      from_date: "",
      to_date: "",
      steps_data: [{ overall_conv_ratio: "" }],
    });
    expect(() => result.overall_conversion_rate).toThrow(
      /could not convert string to float/,
    );
  });

  it("keeps plain numeric strings working ('0.25')", () => {
    const result = new FunnelQueryResult({
      computed_at: "",
      from_date: "",
      to_date: "",
      steps_data: [{ overall_conv_ratio: "0.25" }],
    });
    expect(result.overall_conversion_rate).toBe(0.25);
  });
});

// ---------------------------------------------------------------------------
// B6-GATE — overall_conversion_rate NON-string ladder is CPython float(x)
// (B5-notes.md outbound ledger item 5: the ASR-F6b remediation fixed the
// string arm only; the non-string arm awaited the `pythonFloatCoerce`
// compat twin. CPython probes recorded in B6-notes.md.)
// ---------------------------------------------------------------------------

describe("B6-GATE: FunnelQueryResult.overall_conversion_rate float(x) non-string ladder", () => {
  /**
   * Build a single-step result whose last step carries `value`.
   *
   * @param value - The `overall_conv_ratio` payload value under test.
   * @returns The result instance.
   */
  function resultWith(value: unknown): FunnelQueryResult {
    return new FunnelQueryResult({
      computed_at: "",
      from_date: "",
      to_date: "",
      steps_data: [{ overall_conv_ratio: value }],
    });
  }

  it("coerces booleans exactly as CPython (float(True) is 1.0)", () => {
    expect(resultWith(true).overall_conversion_rate).toBe(1.0);
    expect(resultWith(false).overall_conversion_rate).toBe(0.0);
  });

  it("raises TypeError on None exactly where CPython float(None) raises", () => {
    expect(() => resultWith(null).overall_conversion_rate).toThrow(TypeError);
    expect(() => resultWith(null).overall_conversion_rate).toThrow(
      "float() argument must be a string or a real number, not 'NoneType'",
    );
  });

  it("raises TypeError on a list exactly where CPython float([]) raises", () => {
    expect(() => resultWith([]).overall_conversion_rate).toThrow(
      "float() argument must be a string or a real number, not 'list'",
    );
  });

  it("raises TypeError on a dict exactly where CPython float({}) raises", () => {
    expect(() => resultWith({}).overall_conversion_rate).toThrow(
      "float() argument must be a string or a real number, not 'dict'",
    );
  });

  it("keeps the spelling-wrapper arm working (rig float tags)", () => {
    expect(resultWith({ spelling: "18.0" }).overall_conversion_rate).toBe(18);
  });
});
