// Type-level contract of the row-shaped result surface: Python's `.df`
// becomes `toRows()`, and every query-engine result hands back the same
// readonly `Row` array so consumers can write one table renderer.
import { describe, expectTypeOf, it } from "vitest";

import type {
  FlowQueryResult,
  FunnelQueryResult,
  QueryResult,
  RetentionQueryResult,
  UserQueryResult,
} from "../../../src/types/results/query-engine.js";
import type { Row } from "../../../src/types/results/result-base.js";

describe("Row", () => {
  it("is the open dict a DataFrame row flattens to", () => {
    expectTypeOf<Row>().toEqualTypeOf<Record<string, unknown>>();
  });
});

describe("toRows()", () => {
  it("every query-engine result returns `readonly Row[]`", () => {
    expectTypeOf<QueryResult["toRows"]>().returns.toEqualTypeOf<
      readonly Row[]
    >();
    expectTypeOf<FunnelQueryResult["toRows"]>().returns.toEqualTypeOf<
      readonly Row[]
    >();
    expectTypeOf<RetentionQueryResult["toRows"]>().returns.toEqualTypeOf<
      readonly Row[]
    >();
    expectTypeOf<FlowQueryResult["toRows"]>().returns.toEqualTypeOf<
      readonly Row[]
    >();
    expectTypeOf<UserQueryResult["toRows"]>().returns.toEqualTypeOf<
      readonly Row[]
    >();
  });

  it("the array is readonly — callers copy before mutating", () => {
    expectTypeOf<ReturnType<QueryResult["toRows"]>>().not.toHaveProperty(
      "push",
    );
  });
});
