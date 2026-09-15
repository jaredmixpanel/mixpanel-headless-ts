/**
 * Layer-3 translation of `tests/unit/test_discovery_pbt.py` (B5-S1,
 * packet §4) — ALL 5 classes: TestParseLexiconMetadataProperties :293,
 * TestParseLexiconPropertyProperties :388,
 * TestParseLexiconSchemaProperties :457,
 * TestParseBookmarkInfoProperties :526,
 * TestInferSubpropertiesInvariants :623.
 *
 * Hypothesis `@settings(max_examples=100)` → fast-check `numRuns: 100`
 * (the three un-settinged cases keep Hypothesis's own 100 default).
 *
 * Fidelity notes:
 * - `st.text()` draws the full Unicode range; the JS port uses
 *   `fc.string({ unit: "binary" })`, the B2 convention for "any
 *   code-point string" (`b2-review-resolution.md` ASSERT-F1).
 * - `st.floats(allow_nan=False, allow_infinity=False)` and
 *   `st.integers()` collapse to one `number` leaf in TS: the int/float
 *   distinction is erased by `json.loads`/`toNativeJson` alike at every
 *   position these strategies reach (the parsers are passthroughs).
 * - `iso_timestamps` (`st.datetimes().map(isoformat)`) becomes a
 *   generated `YYYY-MM-DDTHH:MM:SS[.ffffff]` string — the value is only
 *   ever compared for preservation, never parsed.
 * - `_subkeys` (`st.characters(categories=["L"])`) becomes an explicit
 *   letter alphabet spanning Latin/Greek/Cyrillic/CJK plus a non-BMP
 *   letter (𝒳, U+1D4B3) — strictly inside the Python category.
 * - `warnings.simplefilter("error")` (a warning FAILS the run) becomes
 *   a {@link WarningSink} that throws.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { sortedByCodepoint } from "../../src/compat/index.js";
import {
  inferSubproperties,
  parseBookmarkInfo,
  parseLexiconMetadata,
  parseLexiconProperty,
  parseLexiconSchema,
  type WarningSink,
} from "../../src/services/discovery.js";
import { BOOKMARK_TYPE_VALUES } from "../../src/types/literals.js";

// =============================================================================
// Strategies (test_discovery_pbt.py:32-285)
// =============================================================================

/** `st.text()` — any code-point string. */
const textArb = fc.string({ unit: "binary" });

/** `json_primitives` (`:37-43`). */
const jsonPrimitives: fc.Arbitrary<unknown> = fc.oneof(
  fc.constant(null),
  fc.boolean(),
  fc.integer(),
  fc.double({ noNaN: true, noDefaultInfinity: true }),
  textArb,
);

/** `json_values` — the recursive JSON tree (`:46-53`). */
const jsonValues: fc.Arbitrary<unknown> = fc.letrec<{ value: unknown }>(
  (tie) => ({
    value: fc.oneof(
      { depthSize: "small", withCrossShrink: true },
      jsonPrimitives,
      fc.array(tie("value"), { maxLength: 5 }),
      fc.dictionary(textArb, tie("value"), { maxKeys: 5 }),
    ),
  }),
).value;

/** `bookmark_types` (`:59`) — `get_args(BookmarkType)`. */
const bookmarkTypesArb = fc.constantFrom(...BOOKMARK_TYPE_VALUES);

/** `iso_timestamps` (`:62`). */
const isoTimestampsArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.integer({ min: 1, max: 9999 }),
    fc.integer({ min: 1, max: 12 }),
    fc.integer({ min: 1, max: 28 }),
    fc.integer({ min: 0, max: 23 }),
    fc.integer({ min: 0, max: 59 }),
    fc.integer({ min: 0, max: 59 }),
    fc.integer({ min: 0, max: 999999 }),
  )
  .map(([y, mo, d, h, mi, s, us]) => {
    const pad = (value: number, width: number): string =>
      String(value).padStart(width, "0");
    const head = `${pad(y, 4)}-${pad(mo, 2)}-${pad(d, 2)}T${pad(h, 2)}:${pad(
      mi,
      2,
    )}:${pad(s, 2)}`;
    return us === 0 ? head : `${head}.${pad(us, 6)}`;
  });

/** A dictionary strategy whose keys exclude `"com.mixpanel"`. */
const otherDataArb = (maxKeys: number): fc.Arbitrary<Record<string, unknown>> =>
  fc.dictionary(
    textArb.filter((s) => s !== "com.mixpanel"),
    jsonValues,
    { maxKeys },
  );

/** `com_mixpanel_headless()` (`:70-103`) — every field optional. */
const comMixpanelArb: fc.Arbitrary<Record<string, unknown>> = fc
  .record({
    $source: fc.option(textArb, { nil: undefined }),
    displayName: fc.option(textArb, { nil: undefined }),
    tags: fc.option(fc.array(textArb, { maxLength: 5 }), { nil: undefined }),
    hidden: fc.option(fc.boolean(), { nil: undefined }),
    dropped: fc.option(fc.boolean(), { nil: undefined }),
    contacts: fc.option(fc.array(textArb, { maxLength: 5 }), {
      nil: undefined,
    }),
    teamContacts: fc.option(fc.array(textArb, { maxLength: 5 }), {
      nil: undefined,
    }),
  })
  .map((draw) => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(draw)) {
      if (value !== undefined) {
        out[key] = value;
      }
    }
    return out;
  });

/** `valid_lexicon_metadata_input()` (`:140-158`). */
const validLexiconMetadataInputArb: fc.Arbitrary<Record<string, unknown>> = fc
  .tuple(comMixpanelArb, textArb, otherDataArb(3))
  .map(([mpData, fallbackName, otherData]) => {
    const mp = { ...mpData };
    // Ensure at least one field is present.
    if (Object.keys(mp).length === 0) {
      mp["displayName"] = fallbackName;
    }
    return { "com.mixpanel": mp, ...otherData };
  });

/** `lexicon_metadata_input()` (`:106-137`) — the four-way choice. */
const lexiconMetadataInputArb: fc.Arbitrary<Record<string, unknown> | null> =
  fc.oneof(
    fc.constant(null),
    fc.constant<Record<string, unknown>>({}),
    otherDataArb(5),
    validLexiconMetadataInputArb,
  );

/** `lexicon_property_input()` (`:161-200`). */
const lexiconPropertyInputArb: fc.Arbitrary<Record<string, unknown>> = fc
  .tuple(
    fc.option(
      fc.constantFrom(
        "string",
        "number",
        "boolean",
        "array",
        "object",
        "integer",
        "null",
      ),
      { nil: undefined },
    ),
    fc.option(textArb, { nil: undefined }),
    fc.option(validLexiconMetadataInputArb, { nil: undefined }),
    fc.dictionary(
      textArb.filter(
        (s) => s !== "type" && s !== "description" && s !== "metadata",
      ),
      jsonValues,
      { maxKeys: 3 },
    ),
  )
  .map(([type, description, metadata, extra]) => {
    const result: Record<string, unknown> = {};
    if (type !== undefined) {
      result["type"] = type;
    }
    if (description !== undefined) {
      result["description"] = description;
    }
    if (metadata !== undefined) {
      result["metadata"] = metadata;
    }
    return { ...result, ...extra };
  });

/** `lexicon_schema_input()` (`:203-241`). */
const lexiconSchemaInputArb: fc.Arbitrary<Record<string, unknown>> = fc
  .tuple(
    fc.string({ unit: "binary", minLength: 1 }),
    textArb,
    fc.option(textArb, { nil: undefined }),
    fc.array(
      fc.tuple(
        fc.string({ unit: "binary", minLength: 1 }),
        lexiconPropertyInputArb,
      ),
      { maxLength: 5 },
    ),
    fc.option(validLexiconMetadataInputArb, { nil: undefined }),
  )
  .map(([entityType, name, description, propEntries, metadata]) => {
    const schemaJson: Record<string, unknown> = {};
    if (description !== undefined) {
      schemaJson["description"] = description;
    }
    const properties: Record<string, unknown> = Object.fromEntries(propEntries);
    schemaJson["properties"] = properties;
    if (metadata !== undefined) {
      schemaJson["metadata"] = metadata;
    }
    return { entityType, name, schemaJson };
  });

/** `bookmark_info_input()` (`:244-285`). */
const bookmarkInfoInputArb: fc.Arbitrary<Record<string, unknown>> = fc
  .tuple(
    fc.integer(),
    textArb,
    bookmarkTypesArb,
    fc.integer(),
    isoTimestampsArb,
    isoTimestampsArb,
    fc.option(fc.integer(), { nil: undefined }),
    fc.option(fc.integer(), { nil: undefined }),
    fc.option(textArb, { nil: undefined }),
    fc.option(fc.integer(), { nil: undefined }),
    fc.option(textArb, { nil: undefined }),
  )
  .map(
    ([
      id,
      name,
      type,
      projectId,
      created,
      modified,
      workspaceId,
      dashboardId,
      description,
      creatorId,
      creatorName,
    ]) => {
      const result: Record<string, unknown> = {
        id,
        name,
        type,
        project_id: projectId,
        created,
        modified,
      };
      if (workspaceId !== undefined) {
        result["workspace_id"] = workspaceId;
      }
      if (dashboardId !== undefined) {
        result["dashboard_id"] = dashboardId;
      }
      if (description !== undefined) {
        result["description"] = description;
      }
      if (creatorId !== undefined) {
        result["creator_id"] = creatorId;
      }
      if (creatorName !== undefined) {
        result["creator_name"] = creatorName;
      }
      return result;
    },
  );

/** A sink that FAILS the run on any warning (`simplefilter("error")`). */
const throwingSink: WarningSink = (message) => {
  throw new Error(`unexpected UserWarning: ${message}`);
};

// =============================================================================
// _parse_lexicon_metadata properties
// =============================================================================

describe("TestParseLexiconMetadataProperties", () => {
  it("returns null iff the input lacks valid com.mixpanel", () => {
    fc.assert(
      fc.property(lexiconMetadataInputArb, (data) => {
        const result = parseLexiconMetadata(data);
        const mp = data === null ? undefined : data["com.mixpanel"];
        const shouldBeNone =
          data === null ||
          Object.keys(data).length === 0 ||
          !Object.hasOwn(data, "com.mixpanel") ||
          Object.keys(mp as Record<string, unknown>).length === 0;
        expect(result === null, `shouldBeNone=${String(shouldBeNone)}`).toBe(
          shouldBeNone,
        );
      }),
      { numRuns: 100 },
    );
  });

  it("applies the correct defaults for missing fields", () => {
    fc.assert(
      fc.property(validLexiconMetadataInputArb, (data) => {
        const result = parseLexiconMetadata(data);
        expect(result).not.toBeNull();
        const mp = data["com.mixpanel"] as Record<string, unknown>;
        expect(result?.tags).toStrictEqual(
          Object.hasOwn(mp, "tags") ? mp["tags"] : [],
        );
        expect(result?.hidden).toStrictEqual(
          Object.hasOwn(mp, "hidden") ? mp["hidden"] : false,
        );
        expect(result?.dropped).toStrictEqual(
          Object.hasOwn(mp, "dropped") ? mp["dropped"] : false,
        );
        expect(result?.contacts).toStrictEqual(
          Object.hasOwn(mp, "contacts") ? mp["contacts"] : [],
        );
        expect(result?.team_contacts).toStrictEqual(
          Object.hasOwn(mp, "teamContacts") ? mp["teamContacts"] : [],
        );
      }),
      { numRuns: 100 },
    );
  });

  it("preserves field values when present", () => {
    fc.assert(
      fc.property(validLexiconMetadataInputArb, (data) => {
        const result = parseLexiconMetadata(data);
        expect(result).not.toBeNull();
        const mp = data["com.mixpanel"] as Record<string, unknown>;
        const fields = [
          ["$source", result?.source],
          ["displayName", result?.display_name],
          ["tags", result?.tags],
          ["hidden", result?.hidden],
          ["dropped", result?.dropped],
        ] as const;
        // Every field the input carries is preserved verbatim.
        const present = fields.filter(([key]) => Object.hasOwn(mp, key));
        for (const [raw, parsed] of present) {
          expect(parsed).toStrictEqual(mp[raw]);
        }
      }),
      { numRuns: 100 },
    );
  });
});

// =============================================================================
// _parse_lexicon_property properties
// =============================================================================

describe("TestParseLexiconPropertyProperties", () => {
  it("always returns a valid LexiconProperty", () => {
    fc.assert(
      fc.property(lexiconPropertyInputArb, (data) => {
        const result = parseLexiconProperty(data);
        expect(result).not.toBeNull();
        expect("type" in result).toBe(true);
        expect("description" in result).toBe(true);
        expect("metadata" in result).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("defaults the type to 'string' when unspecified", () => {
    fc.assert(
      fc.property(lexiconPropertyInputArb, (data) => {
        const result = parseLexiconProperty(data);
        expect(result.type).toStrictEqual(
          Object.hasOwn(data, "type") ? data["type"] : "string",
        );
      }),
      { numRuns: 100 },
    );
  });

  it("preserves the description when present", () => {
    fc.assert(
      fc.property(lexiconPropertyInputArb, (data) => {
        const result = parseLexiconProperty(data);
        expect(result.description).toStrictEqual(
          Object.hasOwn(data, "description") ? data["description"] : null,
        );
      }),
      { numRuns: 100 },
    );
  });
});

// =============================================================================
// _parse_lexicon_schema properties
// =============================================================================

describe("TestParseLexiconSchemaProperties", () => {
  it("preserves entity_type exactly", () => {
    fc.assert(
      fc.property(lexiconSchemaInputArb, (data) => {
        expect(parseLexiconSchema(data).entity_type).toStrictEqual(
          data["entityType"],
        );
      }),
      { numRuns: 100 },
    );
  });

  it("preserves name exactly", () => {
    fc.assert(
      fc.property(lexiconSchemaInputArb, (data) => {
        expect(parseLexiconSchema(data).name).toStrictEqual(data["name"]);
      }),
      { numRuns: 100 },
    );
  });

  it("preserves the property count", () => {
    fc.assert(
      fc.property(lexiconSchemaInputArb, (data) => {
        const schemaJson = data["schemaJson"] as Record<string, unknown>;
        const expected = Object.keys(schemaJson["properties"] ?? {}).length;
        expect(
          Object.keys(parseLexiconSchema(data).schema_json.properties),
        ).toHaveLength(expected);
      }),
      { numRuns: 100 },
    );
  });

  // Deterministic twin of the fast-check shrink above: a decoded
  // `"__proto__"` property name is an ordinary dict key in Python, and
  // `JSON.parse` keeps it as an own key too. Copying it with a plain
  // `record[key] = …` on a `{}` literal would hit the inherited
  // accessor instead and drop the entry (seeds -316969922 / 2012938764).
  it('keeps a JSON-decoded "__proto__" property as an own key', () => {
    const data = JSON.parse(
      '{"entityType":"event","name":"e","schemaJson":' +
        '{"properties":{"__proto__":{"type":"number"},"a":{}}}}',
    ) as Record<string, unknown>;
    const { properties } = parseLexiconSchema(data).schema_json;
    expect(Object.getPrototypeOf(properties)).toBe(Object.prototype);
    expect(
      Object.entries(properties).map(([key, prop]) => [key, prop.type]),
    ).toEqual([
      ["__proto__", "number"],
      ["a", "string"],
    ]);
  });
});

// =============================================================================
// _parse_bookmark_info properties
// =============================================================================

describe("TestParseBookmarkInfoProperties", () => {
  it("preserves the required fields exactly", () => {
    fc.assert(
      fc.property(bookmarkInfoInputArb, (data) => {
        const result = parseBookmarkInfo(data);
        expect(result.id).toStrictEqual(data["id"]);
        expect(result.name).toStrictEqual(data["name"]);
        expect(result.type).toStrictEqual(data["type"]);
        expect(result.project_id).toStrictEqual(data["project_id"]);
        expect(result.created).toStrictEqual(data["created"]);
        expect(result.modified).toStrictEqual(data["modified"]);
      }),
      { numRuns: 100 },
    );
  });

  it("handles the optional fields correctly", () => {
    fc.assert(
      fc.property(bookmarkInfoInputArb, (data) => {
        const result = parseBookmarkInfo(data);
        for (const [field, value] of [
          ["workspace_id", result.workspace_id],
          ["dashboard_id", result.dashboard_id],
          ["description", result.description],
          ["creator_id", result.creator_id],
          ["creator_name", result.creator_name],
        ] as const) {
          expect(value).toStrictEqual(
            Object.hasOwn(data, field) ? data[field] : null,
          );
        }
      }),
      { numRuns: 100 },
    );
  });
});

// =============================================================================
// Subproperty inference invariants
// =============================================================================

/**
 * `_subkeys` (`:620`) — `st.characters(categories=["L"])`, 1..10 chars.
 * JS has no category generator; the alphabet below spans Latin, Greek,
 * Cyrillic, CJK and a non-BMP mathematical letter, all category L.
 */
const subkeyArb = fc
  .array(
    fc.constantFrom(
      "a",
      "B",
      "z",
      "é",
      "ß",
      "α",
      "Ж",
      "漢",
      "ｱ",
      String.fromCodePoint(0x1d4b3),
    ),
    { minLength: 1, maxLength: 10 },
  )
  .map((chars) => chars.join(""));

/** A dictionary of subkeys → values, 1..4 entries. */
function subkeyDict<T>(
  values: fc.Arbitrary<T>,
): fc.Arbitrary<Record<string, T>> {
  return fc.dictionary(subkeyArb, values, { minKeys: 1, maxKeys: 4 });
}

/** ISO-shape pre-filter mirror (`_DATE_PATTERN.match(s) is None`). */
const DATE_SHAPE =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

describe("TestInferSubpropertiesInvariants", () => {
  it("reports always-non-ISO string values as 'string'", () => {
    fc.assert(
      fc.property(
        fc.array(
          subkeyDict(
            fc
              .string({ unit: "binary", minLength: 1, maxLength: 20 })
              .filter((s) => !DATE_SHAPE.test(s)),
          ),
          { minLength: 1, maxLength: 10 },
        ),
        (rows) => {
          const raw = rows.map((row) => JSON.stringify(row));
          const subs = inferSubproperties(raw, throwingSink);
          for (const sp of subs) {
            expect(sp.type).toBe("string");
          }
          // Names are alphabetically sorted. Python's `sorted(names)`
          // is CODE-POINT order; a bare JS `.sort()` here would compare
          // UTF-16 units and invert e.g. ["ｱa", "𝒳"] (R11.5).
          const names = subs.map((sp) => sp.name);
          expect(names).toStrictEqual(sortedByCodepoint(names));
          // Sample values are distinct and capped at 5
          for (const sp of subs) {
            expect(new Set(sp.sample_values).size).toBe(
              sp.sample_values.length,
            );
            expect(sp.sample_values.length).toBeLessThanOrEqual(5);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("reports always-int values as 'number'", () => {
    fc.assert(
      fc.property(
        fc.array(subkeyDict(fc.integer({ min: -(10 ** 9), max: 10 ** 9 })), {
          minLength: 1,
          maxLength: 10,
        }),
        (rows) => {
          const raw = rows.map((row) => JSON.stringify(row));
          for (const sp of inferSubproperties(raw, throwingSink)) {
            expect(sp.type).toBe("number");
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("reports always-bool values as 'boolean'", () => {
    fc.assert(
      fc.property(
        fc.array(subkeyDict(fc.boolean()), { minLength: 1, maxLength: 10 }),
        (rows) => {
          const raw = rows.map((row) => JSON.stringify(row));
          for (const sp of inferSubproperties(raw, throwingSink)) {
            expect(sp.type).toBe("boolean");
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
