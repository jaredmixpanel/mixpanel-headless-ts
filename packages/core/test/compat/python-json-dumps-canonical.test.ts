// Canonical `json.dumps` twin — heads spec 02 §3.1/§3.3
// (`mixpanel-desktop-app/docs/specs/heads/02-queryref-and-two-body-identity.md`).
//
// The contract under test is CPython
// `json.dumps(value, sort_keys=True, separators=(",", ":"))` with
// `ensure_ascii=True`, byte for byte, PLUS the numeric normalization rule
// (any integral number renders as an integer) and the two refusals the
// canonical form adds over the default twin: non-finite numbers and
// magnitudes past 2**53 throw rather than being spelled.
//
// Every expected string in the table below was produced by CPython 3.14 on
// 2026-09-03; the bulk table lives in `fixtures/canonical-fixtures.json`,
// emitted by `scripts/generate-canonical-fixtures.py` (re-run it and then
// `npm run fmt` — Prettier owns that file's formatting).
//
// Non-ASCII and control characters are written as braced `\u{...}` escapes on
// purpose: the expected values are byte contracts, and a raw astral or C0
// character in the source is one editor round-trip away from becoming a
// different byte sequence.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { pythonJsonDumps } from "../../src/compat/python-json-dumps.js";
import { pythonJsonDumpsCanonical } from "../../src/compat/python-json-dumps-canonical.js";
import fixtureTable from "./fixtures/canonical-fixtures.json" with { type: "json" };

describe("pythonJsonDumpsCanonical — CPython oracle table", () => {
  const oracle: [string, unknown, string][] = [
    [
      "sorts nested object keys and uses compact separators",
      { b: { z: 1, a: [1, 2, { k: null }] }, a: true },
      '{"a":true,"b":{"a":[1,2,{"k":null}],"z":1}}',
    ],
    [
      // The whole point of the code-point sort: JS default `.sort()` orders
      // these as Z, a, U+1F600, U+FF5E because it compares UTF-16 code UNITS
      // and the astral char's high surrogate (0xD83D) is below 0xFF5E.
      // CPython compares code POINTS, so U+FF5E precedes U+1F600.
      "sorts astral-plane keys by code point, not UTF-16 code unit",
      { "\u{ff5e}": 1, "\u{1f600}": 2, a: 3, Z: 4 },
      '{"Z":4,"a":3,"\\uff5e":1,"\\ud83d\\ude00":2}',
    ],
    [
      "escapes control characters, non-ASCII and astral chars (ensure_ascii)",
      {
        ctl: "\t\n\u{22}\u{5c}\u{1}",
        nonascii: "caf\u{e9}",
        astral: "\u{1d4b3}\u{1f600}",
      },
      '{"astral":"\\ud835\\udcb3\\ud83d\\ude00","ctl":"\\t\\n\\"\\\\\\u0001","nonascii":"caf\\u00e9"}',
    ],
    [
      "spells integers as bare digits and floats through pythonFloatStr",
      { i: 1, f: 1.5, tiny: 1e-7, big: 9007199254740991, neg: -3 },
      '{"big":9007199254740991,"f":1.5,"i":1,"neg":-3,"tiny":1e-07}',
    ],
    [
      "renders empty containers and the empty string",
      { o: {}, a: [], s: "" },
      '{"a":[],"o":{},"s":""}',
    ],
    ["renders a bare null", null, "null"],
    ["renders a bare true", true, "true"],
    ["renders a top-level array compactly", [1, "a", false], '[1,"a",false]'],
  ];

  for (const [name, value, expected] of oracle) {
    it(name, () => {
      expect(pythonJsonDumpsCanonical(value)).toBe(expected);
    });
  }

  it("spells bigints as bare digit runs (beyond IEEE-754 exactness)", () => {
    expect(pythonJsonDumpsCanonical({ n: 10n ** 22n })).toBe(
      '{"n":10000000000000000000000}',
    );
  });

  it("normalizes every integral number to an integer spelling", () => {
    // The numeric normalization rule: both bodies pre-normalize an
    // integral float to an int, so JS's inability to tell 2 from 2.0
    // stops being a divergence and becomes the defined behaviour.
    expect(pythonJsonDumpsCanonical({ v: 2 })).toBe('{"v":2}');
    expect(pythonJsonDumpsCanonical({ v: 1e15 })).toBe(
      '{"v":1000000000000000}',
    );
  });

  it("renders negative zero as 0, not -0", () => {
    // `String(-0)` is already "0", but this is a contract, not a
    // coincidence: Python's pre-pass does `int(-0.0)` == 0.
    expect(pythonJsonDumpsCanonical({ v: -0 })).toBe('{"v":0}');
    expect(pythonJsonDumpsCanonical([-0, 0])).toBe("[0,0]");
  });

  it("refuses non-finite numbers (they have no JSON identity)", () => {
    // The default-argument twin keeps CPython's allow_nan=True spelling;
    // the canonical form is a hash payload that must survive a JSON
    // round-trip, and NaN/Infinity do not.
    for (const bad of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]) {
      expect(() => pythonJsonDumpsCanonical({ v: bad })).toThrow(TypeError);
      expect(() => pythonJsonDumpsCanonical({ v: bad })).toThrow(
        /Out of range float values are not JSON compliant/,
      );
    }
    // ...but the default twin is untouched by that refusal.
    expect(pythonJsonDumps([Number.NaN, Number.POSITIVE_INFINITY])).toBe(
      "[NaN, Infinity]",
    );
  });

  it("refuses numbers past MAX_SAFE_INTEGER instead of spelling them wrong", () => {
    // `String(1e22)` is "1e+22" while Python spells the digits, and past
    // 2**53 a JS number no longer identifies one integer. Bigints are the
    // supported way to carry such a value and are NOT refused.
    expect(() => pythonJsonDumpsCanonical({ v: 1e22 })).toThrow(TypeError);
    expect(() => pythonJsonDumpsCanonical({ v: 1e22 })).toThrow(
      /exceeds Number.MAX_SAFE_INTEGER/,
    );
    expect(() => pythonJsonDumpsCanonical({ v: -(2 ** 53) })).toThrow(
      TypeError,
    );
    expect(pythonJsonDumpsCanonical({ v: Number.MAX_SAFE_INTEGER })).toBe(
      '{"v":9007199254740991}',
    );
    expect(pythonJsonDumpsCanonical({ v: 10n ** 22n })).toBe(
      '{"v":10000000000000000000000}',
    );
  });

  it("throws the CPython TypeError shape for unserializable values", () => {
    expect(() => pythonJsonDumpsCanonical(undefined)).toThrow(TypeError);
    expect(() => pythonJsonDumpsCanonical({ f: () => 1 })).toThrow(
      "Object of type function is not JSON serializable",
    );
  });

  it("is independent of key insertion order", () => {
    const a = { z: 1, a: 2, m: 3 };
    const b = { m: 3, z: 1, a: 2 };
    expect(pythonJsonDumpsCanonical(a)).toBe(pythonJsonDumpsCanonical(b));
  });

  it("is reachable from the compat and package barrels", async () => {
    // Spec §3.3 ships this in the vendored browser bundle, so both
    // barrel lines are part of the contract, not a convenience.
    const compat = await import("../../src/compat/index.js");
    const barrel = await import("../../src/index.js");
    expect(compat.pythonJsonDumpsCanonical).toBe(pythonJsonDumpsCanonical);
    expect(barrel.pythonJsonDumpsCanonical).toBe(pythonJsonDumpsCanonical);
  });

  it("leaves the default-argument twin's spelling untouched", () => {
    // Regression guard for the shared-encoder refactor: `pythonJsonDumps`
    // must keep `", "` / `": "` separators and insertion-order keys.
    expect(pythonJsonDumps({ b: 1, a: [1, 2] })).toBe('{"b": 1, "a": [1, 2]}');
  });
});

/** One row of `fixtures/canonical-fixtures.json`. */
interface CanonicalFixture {
  /** Fixture id — an authored slug, or the corpus vector id. */
  readonly name: string;
  /** `"hand"` (authored in the generator) or `"corpus"` (builder vector). */
  readonly source: string;
  /** True when the numeric normalization rule changed this row's bytes. */
  readonly normalized: boolean;
  /** The value CPython canonicalized, after the normalization pre-pass. */
  readonly params: unknown;
  /** CPython's `json.dumps(params, sort_keys=True, separators=(",",":"))`. */
  readonly canonical: string;
  /** sha256 of the UTF-8 bytes of `canonical`, 64 lowercase hex. */
  readonly sha256: string;
}

const fixtures = (fixtureTable as unknown as { fixtures: CanonicalFixture[] })
  .fixtures;

/**
 * Look one fixture up by name.
 *
 * @param name - The fixture id.
 * @returns The row.
 * @throws Error - When the name is absent (a renamed fixture must fail
 *   loudly, not silently skip the assertion that cites it).
 */
function fixture(name: string): CanonicalFixture {
  const found = fixtures.find((f) => f.name === name);
  if (found === undefined) {
    throw new Error(`fixture "${name}" is missing — regenerate the table`);
  }
  return found;
}

/**
 * sha256 of a string's UTF-8 bytes, as 64 lowercase hex — the QueryRef
 * hash (spec §3.1). Web Crypto, so the test stays inside the core purity
 * boundary (no `node:crypto`).
 *
 * @param text - The canonical string to hash.
 * @returns The hex digest.
 */
async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

describe("pythonJsonDumpsCanonical — CPython fixture parity (spec §6.1)", () => {
  it("has a non-trivial table drawn from both input sets", () => {
    // A silently-emptied fixture file would make every assertion below
    // vacuous, so pin the shape of the table itself.
    expect(fixtures.length).toBeGreaterThan(20);
    expect(fixtures.some((f) => f.source === "hand")).toBe(true);
    expect(fixtures.some((f) => f.source === "corpus")).toBe(true);
    expect(new Set(fixtures.map((f) => f.name)).size).toBe(fixtures.length);
  });

  it.each(fixtures.map((f) => [f.name, f] as const))(
    "%s — canonical string matches CPython byte for byte",
    (_name, fixture) => {
      expect(pythonJsonDumpsCanonical(fixture.params)).toBe(fixture.canonical);
    },
  );

  it.each(fixtures.map((f) => [f.name, f] as const))(
    "%s — sha256 of the canonical bytes matches CPython",
    async (_name, fixture) => {
      expect(fixture.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(await sha256Hex(pythonJsonDumpsCanonical(fixture.params))).toBe(
        fixture.sha256,
      );
    },
  );

  it("pins the rows that exercise the numeric normalization rule", () => {
    // Anti-inert guard. Stride sampling is how the integral-float case
    // fell out of the table the first time; these three rows must exist
    // AND must be the ones whose bytes the rule changed.
    const normalizedNames = fixtures
      .filter((f) => f.normalized)
      .map((f) => f.name)
      .sort();
    expect(normalizedNames).toStrictEqual(
      [
        "bookmarks/workspace.build_params/" +
          "test_validation_bypass_r2-testr2v4inffilterfixed-" +
          "test_large_finite_value_passes",
        "filter-value-integral-float",
        "integral-floats-normalize-to-ints",
      ].sort(),
    );
  });

  it("pins the real build_params payload that carries an integral float", () => {
    // `Filter.greater_than("age", 1e15)` — CPython would spell the raw
    // float `1e+15`; the rule makes both bodies spell the digits.
    const row = fixture(
      "bookmarks/workspace.build_params/" +
        "test_validation_bypass_r2-testr2v4inffilterfixed-" +
        "test_large_finite_value_passes",
    );
    expect(row.canonical).toContain('"filterValue":1000000000000000');
    expect(row.canonical).not.toContain("1e+15");
    expect(row.canonical).not.toContain("1000000000000000.0");
  });

  it("gives a JS number 2 the same identity as Python's 2.0", async () => {
    // The cross-body claim in one assertion: the fixture below was
    // generated from Python FLOATS (2.0, -0.0, 1e15, ...); the object
    // here is plain JS numbers. Same canonical bytes, same hash.
    const row = fixture("integral-floats-normalize-to-ints");
    const fromJs = {
      two: 2,
      neg_zero: -0,
      pos_zero: 0,
      e15: 1e15,
      neg_two: -2,
      max_safe_as_float: Number.MAX_SAFE_INTEGER - 1,
    };
    expect(pythonJsonDumpsCanonical(fromJs)).toBe(row.canonical);
    expect(await sha256Hex(pythonJsonDumpsCanonical(fromJs))).toBe(row.sha256);
  });

  it("escapes every non-ASCII byte out of the canonical form", () => {
    // `ensure_ascii=True` in one assertion: the identity's bytes are pure
    // printable ASCII, so no transport can renormalize them.
    for (const fixture of fixtures) {
      expect(fixture.canonical).toMatch(/^[\x20-\x7e]*$/);
    }
  });
});

/**
 * Rebuild every object in a value with its keys in reversed insertion
 * order, leaving the data identical.
 *
 * @param value - The value to rebuild.
 * @returns A structurally equal value with inverted key insertion order.
 */
function reverseKeyOrder(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(reverseKeyOrder);
  }
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, member] of Object.entries(value).reverse()) {
      out[key] = reverseKeyOrder(member);
    }
    return out;
  }
  return value;
}

/** JSON-safe values, weighted towards the characters that break naive twins. */
const jsonValue = fc.letrec<{ node: unknown }>((tie) => ({
  node: fc.oneof(
    { depthSize: "small", withCrossShrink: true },
    fc.constant(null),
    fc.boolean(),
    fc.integer({ min: -1_000_000, max: 1_000_000 }),
    // Bounded to the safe range: the canonicalizer REFUSES non-finite
    // numbers and magnitudes past 2**53, so generating them would be
    // testing the refusal, which the oracle table already does.
    fc.double({
      noNaN: true,
      noDefaultInfinity: true,
      min: -Number.MAX_SAFE_INTEGER,
      max: Number.MAX_SAFE_INTEGER,
    }),
    fc.string({ unit: "grapheme" }),
    fc.array(tie("node"), { maxLength: 4 }),
    fc.dictionary(fc.string({ unit: "grapheme" }), tie("node"), {
      maxKeys: 5,
    }),
  ),
})).node;

describe("pythonJsonDumpsCanonical — properties (spec §6.4)", () => {
  it("is independent of key insertion order at every depth", () => {
    fc.assert(
      fc.property(jsonValue, (value) => {
        expect(pythonJsonDumpsCanonical(reverseKeyOrder(value))).toBe(
          pythonJsonDumpsCanonical(value),
        );
      }),
    );
  });

  it("is idempotent through parse -> canonical", () => {
    fc.assert(
      fc.property(jsonValue, (value) => {
        const once = pythonJsonDumpsCanonical(value);
        expect(pythonJsonDumpsCanonical(JSON.parse(once))).toBe(once);
      }),
    );
  });

  it("emits only printable ASCII", () => {
    fc.assert(
      fc.property(jsonValue, (value) => {
        expect(pythonJsonDumpsCanonical(value)).toMatch(/^[\x20-\x7e]*$/);
      }),
    );
  });

  it("never emits whitespace around separators", () => {
    fc.assert(
      fc.property(
        fc.dictionary(fc.string({ unit: "grapheme" }), jsonValue, {
          minKeys: 2,
          maxKeys: 5,
        }),
        (value) => {
          // Any `", "` / `": "` must be INSIDE a string literal; outside
          // one the canonical form is compact. Stripping every string
          // literal leaves only structure, which must be whitespace-free.
          const structure = pythonJsonDumpsCanonical(value).replace(
            /"(?:[^"\\]|\\.)*"/g,
            "",
          );
          expect(structure).not.toMatch(/\s/);
        },
      ),
    );
  });
});
