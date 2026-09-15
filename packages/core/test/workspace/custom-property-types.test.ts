// Translated custom-property type + validation tests (B5-S2, packet
// §3): assertion-for-assertion port of tests/test_custom_property_types.py
// — 11 of its 12 classes: TestPropertyInput :50,
// TestInlineCustomProperty :101, TestInlineCustomPropertyNumeric :140,
// TestCustomPropertyRef :173, TestTypeWidening :227,
// TestCustomPropertyValidationCP1 :304, …CP2 :326, …CP3 :356,
// …CP4 :370, …CP5 :388, …CP6 :419, TestCustomPropertyValidationValid
// :436, …FilterPosition :457, …MeasurementPosition :469,
// …FunnelRetention :480.
//
// HEADER EXCLUSION:
// - `TestImmutability` :194 asserts
//   `pytest.raises(dataclasses.FrozenInstanceError)` on attribute
//   assignment for all three types. The TS ports use `readonly` fields,
//   which is COMPILE-TIME only — rulebook R4.6 explicitly forbids
//   `Object.freeze` — so there is no runtime error to observe and the
//   class has no TS analog. The immutability the Python test protects
//   (nobody mutates these value objects) is enforced by `tsc` at every
//   call site instead.
//
// OVERLAP NOTE (packet §3, "UNLESS an assert is already locked verbatim
// by a Phase-2 types test"): `test/types/query-params/filter.test.ts:432`
// ("property-spec helper types") already locks THREE of the
// construction asserts (PropertyInput defaults, CustomPropertyRef.id,
// InlineCustomProperty defaults + the numeric factory). The classes are
// translated in FULL here anyway — the Python classes carry cases the
// Phase-2 describe does not (explicit types, the 5-way type
// parametrize, the user resource_type, full construction, single-input
// numeric, large ids), and duplicating three cheap asserts is safer for
// R10.2 completeness than a partial exclusion.

import { describe, expect, it } from "vitest";

import { BookmarkValidationError } from "../../src/errors.js";
import {
  CustomPropertyRef,
  Filter,
  InlineCustomProperty,
  PropertyInput,
} from "../../src/types/query-params/filter.js";
import { GroupBy } from "../../src/types/query-params/group-by.js";
import { Metric } from "../../src/types/query-params/metric.js";
import { makeStubWorkspace } from "../../test-support/workspace-test-helpers.js";

// ===========================================================================
// T001: PropertyInput construction
// ===========================================================================

describe("TestPropertyInput", () => {
  it("can be constructed with just a name", () => {
    const pi = new PropertyInput({ name: "price" });
    expect(pi.name).toBe("price");
    expect(pi.type).toBe("string");
    expect(pi.resource_type).toBe("event");
  });

  it("accepts an explicit number type", () => {
    const pi = new PropertyInput({ name: "amount", type: "number" });
    expect(pi.name).toBe("amount");
    expect(pi.type).toBe("number");
    expect(pi.resource_type).toBe("event");
  });

  it("accepts a user resource_type", () => {
    const pi = new PropertyInput({ name: "email", resource_type: "user" });
    expect(pi.name).toBe("email");
    expect(pi.type).toBe("string");
    expect(pi.resource_type).toBe("user");
  });

  for (const propType of [
    "string",
    "number",
    "boolean",
    "datetime",
    "list",
  ] as const) {
    it(`accepts the '${propType}' property type`, () => {
      const pi = new PropertyInput({ name: "prop", type: propType });
      expect(pi.type).toBe(propType);
    });
  }

  it("accepts all fields set explicitly", () => {
    const pi = new PropertyInput({
      name: "revenue",
      type: "number",
      resource_type: "user",
    });
    expect(pi.name).toBe("revenue");
    expect(pi.type).toBe("number");
    expect(pi.resource_type).toBe("user");
  });
});

// ===========================================================================
// T002: InlineCustomProperty construction
// ===========================================================================

describe("TestInlineCustomProperty", () => {
  it("can be constructed with a formula plus a single input", () => {
    const icp = new InlineCustomProperty({
      formula: "A",
      inputs: { A: new PropertyInput({ name: "price" }) },
    });
    expect(icp.formula).toBe("A");
    expect(Object.keys(icp.inputs)).toHaveLength(1);
    expect(icp.inputs["A"]!.name).toBe("price");
    expect(icp.property_type).toBeNull();
    expect(icp.resource_type).toBe("events");
  });

  it("accepts all fields explicitly", () => {
    const icp = new InlineCustomProperty({
      formula: "A * B",
      inputs: {
        A: new PropertyInput({ name: "price", type: "number" }),
        B: new PropertyInput({ name: "quantity", type: "number" }),
      },
      property_type: "number",
      resource_type: "people",
    });
    expect(icp.formula).toBe("A * B");
    expect(Object.keys(icp.inputs)).toHaveLength(2);
    expect(icp.property_type).toBe("number");
    expect(icp.resource_type).toBe("people");
  });
});

// ===========================================================================
// T003: InlineCustomProperty.numeric()
// ===========================================================================

describe("TestInlineCustomPropertyNumeric", () => {
  it("creates an all-number property with multiple inputs", () => {
    const icp = InlineCustomProperty.numeric("A * B", {
      A: "price",
      B: "quantity",
    });
    expect(icp.formula).toBe("A * B");
    expect(Object.keys(icp.inputs)).toHaveLength(2);
    expect(icp.inputs["A"]!.name).toBe("price");
    expect(icp.inputs["A"]!.type).toBe("number");
    expect(icp.inputs["A"]!.resource_type).toBe("event");
    expect(icp.inputs["B"]!.name).toBe("quantity");
    expect(icp.inputs["B"]!.type).toBe("number");
    expect(icp.property_type).toBe("number");
    expect(icp.resource_type).toBe("events");
  });

  it("works with a single input", () => {
    const icp = InlineCustomProperty.numeric("A", { A: "revenue" });
    expect(icp.formula).toBe("A");
    expect(Object.keys(icp.inputs)).toHaveLength(1);
    expect(icp.inputs["A"]!.name).toBe("revenue");
    expect(icp.inputs["A"]!.type).toBe("number");
    expect(icp.property_type).toBe("number");
  });
});

// ===========================================================================
// T004: CustomPropertyRef construction
// ===========================================================================

describe("TestCustomPropertyRef", () => {
  it("stores the given integer id", () => {
    expect(new CustomPropertyRef({ id: 42 }).id).toBe(42);
  });

  it("handles large ids", () => {
    expect(new CustomPropertyRef({ id: 999999 }).id).toBe(999999);
  });
});

// ===========================================================================
// Type widening backward compatibility
// ===========================================================================

describe("TestTypeWidening", () => {
  it("Metric.property still accepts a plain string", () => {
    const m = new Metric({
      event: "Purchase",
      math: "average",
      property: "amount",
    });
    expect(m.property).toBe("amount");
  });

  it("Metric.property accepts a CustomPropertyRef", () => {
    const m = new Metric({
      event: "Purchase",
      math: "average",
      property: new CustomPropertyRef({ id: 42 }),
    });
    expect(m.property).toBeInstanceOf(CustomPropertyRef);
    expect((m.property as CustomPropertyRef).id).toBe(42);
  });

  it("Metric.property accepts an InlineCustomProperty", () => {
    const icp = InlineCustomProperty.numeric("A * B", { A: "price", B: "qty" });
    const m = new Metric({
      event: "Purchase",
      math: "average",
      property: icp,
    });
    expect(m.property).toBeInstanceOf(InlineCustomProperty);
  });

  it("GroupBy.property still accepts a plain string", () => {
    expect(new GroupBy({ property: "country" }).property).toBe("country");
  });

  it("GroupBy.property accepts a CustomPropertyRef", () => {
    const g = new GroupBy({
      property: new CustomPropertyRef({ id: 42 }),
      property_type: "number",
    });
    expect(g.property).toBeInstanceOf(CustomPropertyRef);
  });

  it("GroupBy.property accepts an InlineCustomProperty", () => {
    const icp = InlineCustomProperty.numeric("A", { A: "revenue" });
    const g = new GroupBy({ property: icp, property_type: "number" });
    expect(g.property).toBeInstanceOf(InlineCustomProperty);
  });

  it("Filter.equals accepts a CustomPropertyRef", () => {
    const f = Filter.equals(new CustomPropertyRef({ id: 42 }), "Enterprise");
    expect(f._property).toBeInstanceOf(CustomPropertyRef);
  });

  it("Filter.greater_than accepts an InlineCustomProperty", () => {
    const icp = InlineCustomProperty.numeric("A * B", { A: "price", B: "qty" });
    const f = Filter.greaterThan(icp, 100);
    expect(f._property).toBeInstanceOf(InlineCustomProperty);
  });

  it("Filter.is_set accepts a CustomPropertyRef", () => {
    const f = Filter.isSet(new CustomPropertyRef({ id: 42 }));
    expect(f._property).toBeInstanceOf(CustomPropertyRef);
  });
});

// ===========================================================================
// T047-T056: fail-fast validation (CP1-CP6)
// ===========================================================================

describe("TestCustomPropertyValidationCP1", () => {
  it("CustomPropertyRef(0) in group_by raises", async () => {
    await expect(
      makeStubWorkspace().buildParams("Purchase", {
        group_by: new GroupBy({
          property: new CustomPropertyRef({ id: 0 }),
          property_type: "number",
        }),
      }),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeStubWorkspace().buildParams("Purchase", {
        group_by: new GroupBy({
          property: new CustomPropertyRef({ id: 0 }),
          property_type: "number",
        }),
      }),
    ).rejects.toThrow(/positive integer/);
  });

  it("CustomPropertyRef(-1) raises", async () => {
    await expect(
      makeStubWorkspace().buildParams("Purchase", {
        group_by: new GroupBy({
          property: new CustomPropertyRef({ id: -1 }),
          property_type: "number",
        }),
      }),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeStubWorkspace().buildParams("Purchase", {
        group_by: new GroupBy({
          property: new CustomPropertyRef({ id: -1 }),
          property_type: "number",
        }),
      }),
    ).rejects.toThrow(/positive integer/);
  });
});

describe("TestCustomPropertyValidationCP2", () => {
  it("an empty formula raises", async () => {
    const icp = new InlineCustomProperty({
      formula: "",
      inputs: { A: new PropertyInput({ name: "price" }) },
    });
    await expect(
      makeStubWorkspace().buildParams("Purchase", {
        group_by: new GroupBy({ property: icp, property_type: "string" }),
      }),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeStubWorkspace().buildParams("Purchase", {
        group_by: new GroupBy({ property: icp, property_type: "string" }),
      }),
    ).rejects.toThrow(/non-empty/);
  });

  it("a whitespace-only formula raises", async () => {
    const icp = new InlineCustomProperty({
      formula: " ".repeat(3),
      inputs: { A: new PropertyInput({ name: "price" }) },
    });
    await expect(
      makeStubWorkspace().buildParams("Purchase", {
        group_by: new GroupBy({ property: icp, property_type: "string" }),
      }),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeStubWorkspace().buildParams("Purchase", {
        group_by: new GroupBy({ property: icp, property_type: "string" }),
      }),
    ).rejects.toThrow(/non-empty/);
  });
});

describe("TestCustomPropertyValidationCP3", () => {
  it("an empty inputs dict raises", async () => {
    const icp = new InlineCustomProperty({ formula: "A", inputs: {} });
    await expect(
      makeStubWorkspace().buildParams("Purchase", {
        group_by: new GroupBy({ property: icp, property_type: "string" }),
      }),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeStubWorkspace().buildParams("Purchase", {
        group_by: new GroupBy({ property: icp, property_type: "string" }),
      }),
    ).rejects.toThrow(/at least one input/);
  });
});

describe("TestCustomPropertyValidationCP4", () => {
  for (const key of ["a", "AB", "1", "aa"]) {
    it(`the input key '${key}' raises`, async () => {
      const icp = new InlineCustomProperty({
        formula: "A",
        inputs: { [key]: new PropertyInput({ name: "price" }) },
      });
      await expect(
        makeStubWorkspace().buildParams("Purchase", {
          group_by: new GroupBy({ property: icp, property_type: "string" }),
        }),
      ).rejects.toBeInstanceOf(BookmarkValidationError);
      await expect(
        makeStubWorkspace().buildParams("Purchase", {
          group_by: new GroupBy({ property: icp, property_type: "string" }),
        }),
      ).rejects.toThrow(/uppercase/);
    });
  }
});

describe("TestCustomPropertyValidationCP5", () => {
  it("a formula longer than 20,000 chars raises", async () => {
    const icp = new InlineCustomProperty({
      formula: "A".repeat(20001),
      inputs: { A: new PropertyInput({ name: "price" }) },
    });
    await expect(
      makeStubWorkspace().buildParams("Purchase", {
        group_by: new GroupBy({ property: icp, property_type: "string" }),
      }),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeStubWorkspace().buildParams("Purchase", {
        group_by: new GroupBy({ property: icp, property_type: "string" }),
      }),
    ).rejects.toThrow(/20,000/);
  });

  it("a formula at exactly 20,000 chars passes", async () => {
    const icp = new InlineCustomProperty({
      formula: "A".repeat(20000),
      inputs: { A: new PropertyInput({ name: "price" }) },
    });
    const params = await makeStubWorkspace().buildParams("Purchase", {
      group_by: new GroupBy({ property: icp, property_type: "string" }),
    });
    expect(Object.hasOwn(params, "sections")).toBe(true);
  });
});

describe("TestCustomPropertyValidationCP6", () => {
  it("an empty PropertyInput.name raises", async () => {
    const icp = new InlineCustomProperty({
      formula: "A",
      inputs: { A: new PropertyInput({ name: "" }) },
    });
    await expect(
      makeStubWorkspace().buildParams("Purchase", {
        group_by: new GroupBy({ property: icp, property_type: "string" }),
      }),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeStubWorkspace().buildParams("Purchase", {
        group_by: new GroupBy({ property: icp, property_type: "string" }),
      }),
    ).rejects.toThrow(/empty property name/);
  });
});

describe("TestCustomPropertyValidationValid", () => {
  it("a valid InlineCustomProperty passes", async () => {
    const icp = InlineCustomProperty.numeric("A * B", {
      A: "price",
      B: "quantity",
    });
    await expect(
      makeStubWorkspace().buildParams("Purchase", {
        group_by: new GroupBy({ property: icp, property_type: "number" }),
      }),
    ).resolves.toBeDefined();
  });

  it("a valid CustomPropertyRef passes", async () => {
    await expect(
      makeStubWorkspace().buildParams("Purchase", {
        group_by: new GroupBy({
          property: new CustomPropertyRef({ id: 42 }),
          property_type: "number",
        }),
      }),
    ).resolves.toBeDefined();
  });
});

describe("TestCustomPropertyValidationFilterPosition", () => {
  it("CustomPropertyRef(0) in the filter raises", async () => {
    await expect(
      makeStubWorkspace().buildParams("Purchase", {
        where: Filter.greaterThan(new CustomPropertyRef({ id: 0 }), 100),
      }),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeStubWorkspace().buildParams("Purchase", {
        where: Filter.greaterThan(new CustomPropertyRef({ id: 0 }), 100),
      }),
    ).rejects.toThrow(/positive integer/);
  });
});

describe("TestCustomPropertyValidationMeasurementPosition", () => {
  it("CustomPropertyRef(0) in Metric.property raises", async () => {
    await expect(
      makeStubWorkspace().buildParams(
        new Metric({
          event: "Purchase",
          math: "average",
          property: new CustomPropertyRef({ id: 0 }),
        }),
      ),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeStubWorkspace().buildParams(
        new Metric({
          event: "Purchase",
          math: "average",
          property: new CustomPropertyRef({ id: 0 }),
        }),
      ),
    ).rejects.toThrow(/positive integer/);
  });
});

describe("TestCustomPropertyValidationFunnelRetention", () => {
  it("CustomPropertyRef(0) in funnel group_by raises", async () => {
    await expect(
      makeStubWorkspace().buildFunnelParams(["Signup", "Purchase"], {
        group_by: new GroupBy({
          property: new CustomPropertyRef({ id: 0 }),
          property_type: "number",
        }),
      }),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeStubWorkspace().buildFunnelParams(["Signup", "Purchase"], {
        group_by: new GroupBy({
          property: new CustomPropertyRef({ id: 0 }),
          property_type: "number",
        }),
      }),
    ).rejects.toThrow(/positive integer/);
  });

  it("CustomPropertyRef(0) in retention group_by raises", async () => {
    await expect(
      makeStubWorkspace().buildRetentionParams("Signup", "Login", {
        group_by: new GroupBy({
          property: new CustomPropertyRef({ id: 0 }),
          property_type: "number",
        }),
      }),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeStubWorkspace().buildRetentionParams("Signup", "Login", {
        group_by: new GroupBy({
          property: new CustomPropertyRef({ id: 0 }),
          property_type: "number",
        }),
      }),
    ).rejects.toThrow(/positive integer/);
  });

  it("CustomPropertyRef(0) in funnel where raises", async () => {
    await expect(
      makeStubWorkspace().buildFunnelParams(["Signup", "Purchase"], {
        where: Filter.greaterThan(new CustomPropertyRef({ id: 0 }), 100),
      }),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeStubWorkspace().buildFunnelParams(["Signup", "Purchase"], {
        where: Filter.greaterThan(new CustomPropertyRef({ id: 0 }), 100),
      }),
    ).rejects.toThrow(/positive integer/);
  });

  it("CustomPropertyRef(0) in retention where raises", async () => {
    await expect(
      makeStubWorkspace().buildRetentionParams("Signup", "Login", {
        where: Filter.greaterThan(new CustomPropertyRef({ id: 0 }), 100),
      }),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeStubWorkspace().buildRetentionParams("Signup", "Login", {
        where: Filter.greaterThan(new CustomPropertyRef({ id: 0 }), 100),
      }),
    ).rejects.toThrow(/positive integer/);
  });
});
