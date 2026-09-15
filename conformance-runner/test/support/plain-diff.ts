/**
 * Shared golden-diff helper for the C8(b) tests (P2-6 result goldens
 * pioneered the algorithm inline; P2-7 factors it here for the entity
 * goldens — P2-8 may re-home the result-golden copy).
 *
 * Diffs a re-encoded TS field walk against the ORIGINAL raw vector
 * payload subtree. Structure and key sets must match exactly; numbers
 * compare BY VALUE across token spellings (live TS outputs carry no
 * int/float token distinction — see canonical.ts `renderNativeNumber`;
 * tagged float SPELLING fidelity is locked separately by the C8(a)
 * sweep).
 */
import { expect } from "vitest";

import { JsonNumber, type JsonValue } from "../../src/json-value.js";

/**
 * Whether a raw payload node is a `$type`-tagged object of one tag.
 *
 * @param value - Raw payload node.
 * @param tag - The tag name.
 * @returns True on a match.
 */
function isTagged(value: JsonValue, tag: string): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof JsonNumber) &&
    value["$type"] === tag
  );
}

/**
 * Unwrap the runner's lossless `PyFloat` duck-shape (an object with a
 * string `spelling`) to a native number; other values pass through.
 *
 * @param value - A serialized-walk output node.
 * @returns The numeric value or the input unchanged.
 */
function unwrapFloat(value: unknown): unknown {
  if (
    typeof value === "object" &&
    value !== null &&
    "spelling" in value &&
    typeof (value as { spelling: unknown }).spelling === "string"
  ) {
    return Number((value as { spelling: string }).spelling);
  }
  return value;
}

/**
 * Diff a serialized field walk against the raw payload node.
 *
 * @param actual - The `toVectorPayload()` output node.
 * @param expected - The raw vector payload node (JsonNumber tokens).
 * @param path - JSON path for failure messages.
 */
export function diffPlainPayload(
  actual: unknown,
  expected: JsonValue,
  path: string,
): void {
  if (expected instanceof JsonNumber) {
    const value = unwrapFloat(actual);
    expect(typeof value, path).toBe("number");
    expect(value, path).toBe(expected.toNumber());
    return;
  }
  if (isTagged(expected, "float")) {
    const tagged = expected as Readonly<Record<string, JsonValue>>;
    const value = unwrapFloat(actual);
    expect(typeof value, path).toBe("number");
    expect(value, path).toBe(Number(tagged["value"] as string));
    return;
  }
  if (isTagged(expected, "datetime")) {
    // The serialized walk re-tags datetimes with the preserved iso text.
    const tagged = expected as Readonly<Record<string, JsonValue>>;
    expect(actual, path).toEqual({
      $type: "datetime",
      iso: tagged["iso"] as string,
    });
    return;
  }
  if (expected === null || typeof expected !== "object") {
    expect(actual, path).toBe(expected);
    return;
  }
  if (Array.isArray(expected)) {
    expect(Array.isArray(actual), path).toBe(true);
    const actualArray = actual as readonly unknown[];
    expect(actualArray, path).toHaveLength(expected.length);
    for (const [index, item] of expected.entries()) {
      diffPlainPayload(actualArray[index], item, `${path}[${String(index)}]`);
    }
    return;
  }
  expect(typeof actual === "object" && actual !== null, path).toBe(true);
  const actualRecord = actual as Readonly<Record<string, unknown>>;
  expect(Object.keys(actualRecord).sort(), path).toEqual(
    Object.keys(expected).sort(),
  );
  for (const [key, item] of Object.entries(expected)) {
    diffPlainPayload(actualRecord[key], item, `${path}.${key}`);
  }
}
