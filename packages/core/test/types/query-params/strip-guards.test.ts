// Regression tests for the B0-gate attempt-1 differential divergence
// (conformance/differential/oracle/RUN.md, 2026-08-15 entry; shrunken
// repro 2026-08-15-types-RetentionEvent.json): every emptiness guard in
// packages/core/src/types/** must use `pythonStrip` (CPython
// `str.strip()` whitespace set, pinned whitespace.gen.ts), NOT JS
// `String.trim()`. The two sets differ in both directions:
//   - Python-only blanks: U+001C..U+001F, U+0085 (str.strip() removes,
//     .trim() keeps) — these inputs must be REJECTED as blank;
//   - JS-only blank: U+FEFF (BOM; .trim() removes, str.strip() keeps)
//     — a FEFF-only input is NON-blank in Python and must be ACCEPTED.
// Guard order is also locked: the strip-emptiness check precedes the
// control-char check (Python source order), so a U+001C-only event
// raises EV1_EMPTY_EVENT, never EV2_CONTROL_CHAR_EVENT.
// Python counterparts: types.py:9116, 9153, 7129, 10162, 8309, 8231,
// 8707, 8720, 8953, 8392, 9532, 9644, 4921, and _safe_int (:10548 —
// covered in flow-query-result.test.ts).
import { describe, expect, it } from "vitest";
import {
  MixpanelHeadlessError,
  ParamValidationError,
  ResponseValidationError,
} from "../../../src/errors.js";
import { CohortCriteria } from "../../../src/types/query-params/cohort.js";
import {
  Filter,
  ListItemGroupMode,
} from "../../../src/types/query-params/filter.js";
import {
  FrequencyBreakdown,
  FrequencyFilter,
} from "../../../src/types/query-params/frequency.js";
import { HoldingConstant } from "../../../src/types/query-params/funnel.js";
import { GroupBy } from "../../../src/types/query-params/group-by.js";
import {
  validateCohortArgs,
  validateEventName,
} from "../../../src/types/query-params/guards.js";
import { Formula } from "../../../src/types/query-params/metric.js";
import { RetentionEvent } from "../../../src/types/query-params/retention.js";
import { CreateCustomEventParams } from "../../../src/types/entities/data-governance.js";

/**
 * Python-blank / JS-trim-nonblank strings: each is `""` under CPython
 * `str.strip()` but non-empty under JS `.trim()` — the divergence class
 * the fresh-seed fuzz caught (seed 52794688, types.RetentionEvent).
 */
const PY_ONLY_BLANKS = [
  "\u0085",
  "\x1c",
  "\x1d",
  "\x1e",
  "\x1f",
  " \t\u0085\n",
];

/** JS-blank / Python-nonblank string (the inverse direction). */
const BOM = "\ufeff";

/**
 * Assert a thunk throws the exact guard `{class, code}` pair.
 *
 * @param thunk - The construction under test.
 * @param code - Expected registry code.
 */
function expectGuard(thunk: () => unknown, code: string): void {
  let thrown: unknown;
  try {
    thunk();
  } catch (cause) {
    thrown = cause;
  }
  expect(thrown, `expected ${code}`).toBeInstanceOf(ParamValidationError);
  expect((thrown as MixpanelHeadlessError).code).toBe(code);
}

describe("pythonStrip emptiness guards (RUN.md 2026-08-15 divergence class)", () => {
  it("EV1_EMPTY_EVENT: validateEventName rejects Python-only blanks (the repro class)", () => {
    for (const event of PY_ONLY_BLANKS) {
      expectGuard(() => validateEventName(event, "X"), "EV1_EMPTY_EVENT");
      // The shrunken-repro construction path itself:
      expectGuard(() => new RetentionEvent({ event }), "EV1_EMPTY_EVENT");
    }
  });

  it("EV1 precedes EV2 for control-char blanks (Python guard order)", () => {
    // U+001C..1F are BOTH in CONTROL_CHAR_RE and Python-blank; Python
    // raises EV1 because the strip-emptiness guard runs first.
    expectGuard(() => validateEventName("\x1c", "X"), "EV1_EMPTY_EVENT");
  });

  it("validateEventName accepts a U+FEFF-only event (Python keeps the BOM)", () => {
    expect(() => validateEventName(BOM, "X")).not.toThrow();
    expect(new RetentionEvent({ event: BOM }).event).toBe(BOM);
  });

  it("CF2_COHORT_NAME_EMPTY: validateCohortArgs blank-name guard", () => {
    for (const name of PY_ONLY_BLANKS) {
      expectGuard(
        () => validateCohortArgs(5, name, "CF"),
        "CF2_COHORT_NAME_EMPTY",
      );
    }
    expect(() => validateCohortArgs(5, BOM, "CF")).not.toThrow();
  });

  it("FM1_EMPTY_EXPRESSION: Formula.expression", () => {
    for (const expression of PY_ONLY_BLANKS) {
      expectGuard(() => new Formula({ expression }), "FM1_EMPTY_EXPRESSION");
    }
    expect(new Formula({ expression: BOM }).expression).toBe(BOM);
  });

  it("HC1_EMPTY_PROPERTY: HoldingConstant.property", () => {
    for (const property of PY_ONLY_BLANKS) {
      expectGuard(
        () => new HoldingConstant({ property }),
        "HC1_EMPTY_PROPERTY",
      );
    }
    expect(new HoldingConstant({ property: BOM }).property).toBe(BOM);
  });

  it("LG1_EMPTY_SUB: ListItemGroupMode.sub", () => {
    for (const sub of PY_ONLY_BLANKS) {
      expectGuard(
        () => new ListItemGroupMode({ sub, sub_type: "string" }),
        "LG1_EMPTY_SUB",
      );
    }
    expect(new ListItemGroupMode({ sub: BOM, sub_type: "string" }).sub).toBe(
      BOM,
    );
  });

  it("LC5_EMPTY_KWARG_KEY: Filter.listContains equals keys", () => {
    for (const key of PY_ONLY_BLANKS) {
      expectGuard(
        () => Filter.listContains("items", [], { equals: { [key]: "v" } }),
        "LC5_EMPTY_KWARG_KEY",
      );
    }
    expect(() =>
      Filter.listContains("items", [], { equals: { [BOM]: "v" } }),
    ).not.toThrow();
  });

  it("CD4_EMPTY_EVENT: CohortCriteria.didEvent", () => {
    for (const event of PY_ONLY_BLANKS) {
      expectGuard(() => CohortCriteria.didEvent(event), "CD4_EMPTY_EVENT");
    }
    expect(() =>
      CohortCriteria.didEvent(BOM, { at_least: 1, within_days: 30 }),
    ).not.toThrow();
  });

  it("CA2_EMPTY_AGGREGATION_PROPERTY: CohortCriteria.didEvent aggregation_property", () => {
    for (const prop of PY_ONLY_BLANKS) {
      expectGuard(
        () =>
          CohortCriteria.didEvent("Signup", {
            aggregation: "total",
            aggregation_property: prop,
          }),
        "CA2_EMPTY_AGGREGATION_PROPERTY",
      );
    }
    expect(() =>
      CohortCriteria.didEvent("Signup", {
        at_least: 1,
        within_days: 30,
        aggregation: "total",
        aggregation_property: BOM,
      }),
    ).not.toThrow();
  });

  it("CD7_EMPTY_PROPERTY: CohortCriteria.hasProperty", () => {
    for (const property of PY_ONLY_BLANKS) {
      expectGuard(
        () => CohortCriteria.hasProperty(property, "v"),
        "CD7_EMPTY_PROPERTY",
      );
    }
    expect(() => CohortCriteria.hasProperty(BOM, "v")).not.toThrow();
  });

  it("GB1_EMPTY_PROPERTY: GroupBy.property", () => {
    for (const property of PY_ONLY_BLANKS) {
      expectGuard(() => new GroupBy({ property }), "GB1_EMPTY_PROPERTY");
    }
    expect(new GroupBy({ property: BOM }).property).toBe(BOM);
  });

  it("FB1_EMPTY_EVENT: FrequencyBreakdown.event", () => {
    for (const event of PY_ONLY_BLANKS) {
      expectGuard(() => new FrequencyBreakdown({ event }), "FB1_EMPTY_EVENT");
    }
    expect(new FrequencyBreakdown({ event: BOM }).event).toBe(BOM);
  });

  it("FF1_EMPTY_EVENT: FrequencyFilter.event", () => {
    for (const event of PY_ONLY_BLANKS) {
      expectGuard(
        () => new FrequencyFilter({ event, value: 1 }),
        "FF1_EMPTY_EVENT",
      );
    }
    expect(new FrequencyFilter({ event: BOM, value: 1 }).event).toBe(BOM);
  });

  it("CreateCustomEventParams.alternatives: strip-based blank rejection", () => {
    for (const alt of PY_ONLY_BLANKS) {
      expect(() =>
        CreateCustomEventParams.fromDict({ name: "e", alternatives: [alt] }),
      ).toThrow(ResponseValidationError);
    }
    const valid = CreateCustomEventParams.fromDict({
      name: "e",
      alternatives: [BOM],
    });
    expect(valid.alternatives).toEqual([BOM]);
  });
});
