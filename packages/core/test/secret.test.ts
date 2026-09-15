// Secret wrapper tests (R4.6) including fast-check property #1 from
// phase2-design C9: for arbitrary strings s, no stringification /
// serialization / enumeration surface of `new Secret(s)` contains s,
// and `reveal()` returns s exactly.
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { Secret } from "../src/secret.js";

/** Pydantic's exact redaction literal (ten asterisks). */
const MASK = "**********";

/** The Node inspect hook symbol (registered via Symbol.for, R9.1). */
const INSPECT = Symbol.for("nodejs.util.inspect.custom");

/**
 * Collect every stringification surface that renders ONLY the secret
 * (safe for substring checks — no container syntax that could falsely
 * match one-character raw values like `"k"` or `"["`).
 *
 * @param secret - The wrapped secret under test.
 * @returns All pure renders that must equal / contain only the mask.
 */
function pureRenders(secret: Secret): string[] {
  const inspectFn = (secret as unknown as Record<symbol, () => string>)[
    INSPECT
  ];
  if (inspectFn === undefined) {
    throw new Error("inspect hook missing");
  }
  return [
    String(secret),
    `${secret}`,
    secret.toString(),
    inspectFn.call(secret),
  ];
}

describe("Secret", () => {
  it("reveal() returns the exact wrapped value", () => {
    expect(new Secret("hunter2").reveal()).toBe("hunter2");
    expect(new Secret("").reveal()).toBe("");
    expect(new Secret("𝒳-emoji-🔑").reveal()).toBe("𝒳-emoji-🔑");
  });

  it("renders the exact ten-asterisk Pydantic mask everywhere", () => {
    const s = new Secret("sk-live-abc123");
    expect(String(s)).toBe(MASK);
    expect(s.toJSON()).toBe(MASK);
    expect(JSON.stringify(s)).toBe(`"${MASK}"`);
    expect(JSON.stringify({ token: s })).toBe(`{"token":"${MASK}"}`);
    expect(MASK).toHaveLength(10);
  });

  it("has no own enumerable properties (spread/keys/entries leak nothing)", () => {
    const s = new Secret("value");
    expect(Object.keys(s)).toEqual([]);
    expect(Object.entries(s)).toEqual([]);
    expect({ ...(s as object) }).toEqual({}); // deliberate: spreading a Secret leaks nothing
  });

  it("property #1: Secret never leaks the wrapped value on any surface", () => {
    fc.assert(
      fc.property(fc.string(), (raw) => {
        const secret = new Secret(raw);
        expect(secret.reveal()).toBe(raw);
        // Substring checks on the PURE renders (no container syntax).
        // Containment is only meaningful when the raw value is not itself
        // a substring of the mask (design C9 carve-out: s === mask; the
        // empty string / single '*' are contained in every mask render).
        if (raw.length > 0 && !MASK.includes(raw)) {
          for (const rendered of pureRenders(secret)) {
            expect(rendered).not.toContain(raw);
          }
        }
        // Container/enumeration surfaces: exact-shape equality (immune to
        // structural-character false positives), so the secret cannot
        // appear anywhere in them regardless of raw's content.
        expect(JSON.stringify(secret)).toBe(`"${MASK}"`);
        expect(JSON.stringify({ k: secret })).toBe(`{"k":"${MASK}"}`);
        expect(JSON.stringify([secret])).toBe(`["${MASK}"]`);
        expect(Object.keys(secret)).toEqual([]);
        expect(Object.entries(secret)).toEqual([]);
        expect(Object.getOwnPropertyNames(secret)).toEqual([]);
        expect({ ...(secret as object) }).toEqual({}); // deliberate: spreading a Secret leaks nothing
        expect(String(secret)).toBe(MASK);
      }),
    );
  });

  it("property #1 (JSON-escaped payloads): serialized bags never leak", () => {
    // Strings needing JSON escaping (quotes, backslashes, control chars)
    // must not appear even in escaped form: compare the PARSED bag value.
    fc.assert(
      fc.property(fc.string(), (raw) => {
        const bag = JSON.parse(
          JSON.stringify({ k: new Secret(raw) }),
        ) as Record<string, unknown>;
        expect(bag["k"]).toBe(MASK);
      }),
    );
  });
});
