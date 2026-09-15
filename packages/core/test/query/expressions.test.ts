// `normalizeOnExpression` — translation of
// `tests/unit/_internal/test_expressions.py`; `pytest.mark.parametrize` becomes
// `it.each`. The escaped expectations are transcribed from the PYTHON literal
// (Python `'properties["my\\"property"]'` is the 20-character string
// `properties["my\"property"]`): a mis-transcribed backslash would silently pass.
import { describe, expect, it } from "vitest";

import { normalizeOnExpression } from "../../src/query/expressions.js";

describe("normalizeOnExpression", () => {
  // Category 1: Bare property names that need wrapping

  it.each([
    ["Source", 'properties["Source"]'],
    ["Screen Name", 'properties["Screen Name"]'],
    ["$os", 'properties["$os"]'],
    ["$browser", 'properties["$browser"]'],
  ])("wraps bare property name %s", (bareName, expected) => {
    expect(normalizeOnExpression(bareName)).toBe(expected);
  });

  it.each([
    "foo[0]", // Contains [ but not an accessor
    "properties_count", // Starts with "properties" but isn't accessor
    "user_id", // Contains "user" but isn't accessor
    "event_type", // Contains "event" but isn't accessor
  ])("wraps name with misleading substring %s", (trickyName) => {
    expect(normalizeOnExpression(trickyName)).toBe(
      `properties["${trickyName}"]`,
    );
  });

  // Category 2: Already-valid expressions (pass through unchanged)

  it.each([
    'properties["Source"]',
    'user["email"]',
    'event["name"]',
    'properties["Screen"] == "Home"',
    'properties["Type"] + " from " + properties["Source"]',
    'properties["Screen"] in ["Home", "Events"]',
    'defined(properties["Type"])',
    'if(properties["x"], "yes", "no")',
    'properties["x"] + user["y"]', // Mixed accessors
  ])("passes through valid expression %s", (expression) => {
    expect(normalizeOnExpression(expression)).toBe(expression);
  });

  // Category 3: Edge cases

  it("wraps the empty string (API will handle the error)", () => {
    expect(normalizeOnExpression("")).toBe('properties[""]');
  });

  it("wraps a whitespace-only string (API will handle the error)", () => {
    expect(normalizeOnExpression("  ")).toBe('properties["  "]');
  });

  it("wraps unicode property names correctly", () => {
    expect(normalizeOnExpression("日本語")).toBe('properties["日本語"]');
    expect(normalizeOnExpression("émoji🎉")).toBe('properties["émoji🎉"]');
  });

  // Category 5: Special character escaping

  it.each([
    ['my"property', String.raw`properties["my\"property"]`],
    ['"quoted"', String.raw`properties["\"quoted\""]`],
    ['a"b"c', String.raw`properties["a\"b\"c"]`],
    ['say "hello"', String.raw`properties["say \"hello\""]`],
  ])("escapes double quotes in %s", (nameWithQuotes, expected) => {
    expect(normalizeOnExpression(nameWithQuotes)).toBe(expected);
  });

  it("handles a backslash before a quote", () => {
    // Python source literal: `'path\\to\\"file'` == path\to\"file
    const result = normalizeOnExpression(String.raw`path\to\"file`);
    // Python expectation literal: `'properties["path\\\\to\\\\\\"file"]'`
    // == properties["path\\to\\\"file"]
    expect(result).toBe(String.raw`properties["path\\to\\\"file"]`);
  });

  // Category 4: Idempotency

  it("is idempotent for bare names", () => {
    const once = normalizeOnExpression("Source");
    const twice = normalizeOnExpression(once);
    expect(once).toBe('properties["Source"]');
    expect(twice).toBe(once);
  });

  it("is idempotent for expressions", () => {
    const expr = 'properties["Type"] == "Event"';
    const once = normalizeOnExpression(expr);
    const twice = normalizeOnExpression(once);
    expect(once).toBe(expr);
    expect(twice).toBe(once);
  });
});
