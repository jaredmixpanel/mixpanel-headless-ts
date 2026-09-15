// Every emptiness guard under src/types must use `pythonStrip` (CPython
// `str.strip()` whitespace, pinned in whitespace.gen.ts), never JS `trim()`:
// U+001C..U+001F and U+0085 are Python-only blanks (must be REJECTED), U+FEFF
// is JS-only blank (must be ACCEPTED); the strip check precedes the
// control-char check, so a U+001C-only event raises EV1, never EV2. Additive.
import { describe, expect, it } from "vitest";

import { ResponseValidationError } from "../../../src/errors.js";
import { CreateCustomEventParams } from "../../../src/types/entities/data-governance.js";
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
import { expectGuard } from "../../../test-support/raises.js";

/**
 * Python-blank / JS-trim-nonblank strings: each is `""` under CPython
 * `str.strip()` but non-empty under JS `.trim()` — the divergence class
 * the fresh-seed fuzz caught (seed 52794688, types.RetentionEvent).
 */
const PY_ONLY_BLANKS = [
  "\u0085",
  "\x1C",
  "\x1D",
  "\x1E",
  "\x1F",
  " \t\u0085\n",
];

/** JS-blank / Python-nonblank string (the inverse direction). */
const BOM = "\uFEFF";

describe("pythonStrip emptiness guards (differential divergence class)", () => {
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
    expectGuard(() => validateEventName("\x1C", "X"), "EV1_EMPTY_EVENT");
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
    expect(valid.alternatives).toStrictEqual([BOM]);
  });
});
