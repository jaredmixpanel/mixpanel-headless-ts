// Guard + factory tests for GroupBy (phase2-design C7, packet P2-5a):
// translated from tests/unit/test_query_types.py /
// test_bookmark_builders.py guard cases plus Risk #1 guard-order probes.
import { describe, expect, it } from "vitest";

import {
  type MixpanelHeadlessError,
  ParamValidationError,
} from "../../../src/errors.js";
import {
  CustomPropertyRef,
  ListItemGroupMode,
} from "../../../src/types/query-params/filter.js";
import { GroupBy } from "../../../src/types/query-params/group-by.js";

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
  } catch (error) {
    thrown = error;
  }
  expect(thrown, `expected ${code}`).toBeInstanceOf(ParamValidationError);
  expect((thrown as MixpanelHeadlessError).code).toBe(code);
}

describe("GroupBy guards (__post_init__ parity, source order)", () => {
  it("GB1_EMPTY_PROPERTY on blank string properties", () => {
    for (const property of ["", " ".repeat(3)]) {
      expectGuard(() => new GroupBy({ property }), "GB1_EMPTY_PROPERTY");
    }
  });

  it("V12_BUCKET_SIZE_POSITIVE on non-positive bucket sizes", () => {
    for (const bucketSize of [0, -5, -10]) {
      expectGuard(
        () => new GroupBy({ property: "price", bucket_size: bucketSize }),
        "V12_BUCKET_SIZE_POSITIVE",
      );
    }
  });

  it("V18_BUCKET_ORDER when bucket_min >= bucket_max", () => {
    expectGuard(
      () => new GroupBy({ property: "price", bucket_min: 10, bucket_max: 2 }),
      "V18_BUCKET_ORDER",
    );
    // Equality also violates the strictly-less contract.
    expectGuard(
      () => new GroupBy({ property: "price", bucket_min: 5, bucket_max: 5 }),
      "V18_BUCKET_ORDER",
    );
  });

  it("GB4_LIST_ITEM_BUCKETING when list-item mode meets any bucket field", () => {
    const mode = new ListItemGroupMode({ sub: "Brand", sub_type: "string" });
    expectGuard(
      () =>
        new GroupBy({
          property: "cart",
          bucket_size: 10,
          _list_item_mode: mode,
        }),
      "GB4_LIST_ITEM_BUCKETING",
    );
    expectGuard(
      () =>
        new GroupBy({ property: "cart", bucket_min: 1, _list_item_mode: mode }),
      "GB4_LIST_ITEM_BUCKETING",
    );
    expectGuard(
      () =>
        new GroupBy({
          property: "cart",
          bucket_max: 10,
          _list_item_mode: mode,
        }),
      "GB4_LIST_ITEM_BUCKETING",
    );
  });

  it("GB5_LIST_ITEM_PROPERTY_TYPE when list-item property is not a string", () => {
    expectGuard(
      () =>
        new GroupBy({
          property: new CustomPropertyRef({ id: 42 }),
          _list_item_mode: new ListItemGroupMode({
            sub: "Brand",
            sub_type: "string",
          }),
        }),
      "GB5_LIST_ITEM_PROPERTY_TYPE",
    );
  });

  it("guard order: GB1 wins over V12; V12 wins over V18; GB4 wins over GB5", () => {
    expectGuard(
      () => new GroupBy({ property: " ", bucket_size: 0 }),
      "GB1_EMPTY_PROPERTY",
    );
    expectGuard(
      () =>
        new GroupBy({
          property: "price",
          bucket_size: 0,
          bucket_min: 10,
          bucket_max: 2,
        }),
      "V12_BUCKET_SIZE_POSITIVE",
    );
    expectGuard(
      () =>
        new GroupBy({
          property: new CustomPropertyRef({ id: 7 }),
          bucket_size: 10,
          _list_item_mode: new ListItemGroupMode({
            sub: "Brand",
            sub_type: "string",
          }),
        }),
      "GB4_LIST_ITEM_BUCKETING",
    );
  });
});

describe("GroupBy construction", () => {
  it("applies the Python field defaults", () => {
    const groupBy = new GroupBy({ property: "country" });
    expect(groupBy.property_type).toBe("string");
    expect(groupBy.bucket_size).toBeNull();
    expect(groupBy.bucket_min).toBeNull();
    expect(groupBy.bucket_max).toBeNull();
    expect(groupBy._list_item_mode).toBeNull();
  });

  it("accepts numeric bucketing", () => {
    const groupBy = new GroupBy({
      property: "revenue",
      property_type: "number",
      bucket_size: 50,
      bucket_min: 0,
      bucket_max: 500,
    });
    expect(groupBy.bucket_size).toBe(50);
    // Fractional bucket sizes are legal (int | float in Python).
    expect(new GroupBy({ property: "p", bucket_size: 0.5 }).bucket_size).toBe(
      0.5,
    );
  });

  it("non-string property specs skip the GB1 blank check", () => {
    const groupBy = new GroupBy({ property: new CustomPropertyRef({ id: 1 }) });
    expect(groupBy.property).toBeInstanceOf(CustomPropertyRef);
  });

  it("listItem builds the discriminator with a default sub_type", () => {
    const groupBy = GroupBy.listItem("cart", "Brand");
    expect(groupBy._list_item_mode).toBeInstanceOf(ListItemGroupMode);
    expect(groupBy._list_item_mode?.sub).toBe("Brand");
    expect(groupBy._list_item_mode?.sub_type).toBe("string");
    expect(
      GroupBy.listItem("cart", "Price", { sub_type: "number" })._list_item_mode
        ?.sub_type,
    ).toBe("number");
  });

  it("listItem propagates the LG1 guard from ListItemGroupMode", () => {
    expectGuard(() => GroupBy.listItem("cart", " ".repeat(3)), "LG1_EMPTY_SUB");
  });
});
