/**
 * `isinstance(x, dict)` discrimination (rulebook watchlist #13 `[ST2]`).
 *
 * Extracted here (a LEAF pythonCompat module) at the B6 arbiter pass
 * (`b6-review-resolution.md` Finding D — third recurrence of the
 * dict-guard re-derivation family, R10.4 threshold met): the guard's
 * original home, `query/validation-shared.ts`, transitively imports the
 * entity models, so low-level modules like
 * `types/entities/model-base.ts` could not import it without an
 * evaluation cycle. `validation-shared.ts` re-exports it, so every
 * existing import path keeps working; NEW consumers import from
 * `compat` (any layer may — compat imports nothing above itself).
 */

/**
 * TS analogue of Python `isinstance(value, dict)` — the ONE dict
 * discrimination for the ported value domain (B2 arbiter fix F1,
 * `b2-review-resolution.md` 2026-08-15).
 *
 * Python's `isinstance(x, dict)` is False for floats and for class
 * instances. In the ported value domain a dict is exactly a PLAIN
 * object: prototype `Object.prototype` (JSON/codec decode output,
 * object literals) or `null` (`Object.create(null)` records). Class
 * instances — reconstructed core types (`Filter`, …) AND the rig's
 * `PyFloat` carrier, which is a class instance too — are excluded by
 * prototype, so a consumer dict that happens to carry a `spelling`
 * key still classifies as a dict, exactly as in Python (arbiter
 * probe record in `b2-review-resolution.md`).
 *
 * NOT to be confused with `client/internals.ts` `isPlainRecord`, the
 * JSON-shape guard for PARSED WIRE payloads (it admits class
 * instances) — one named guard per discrimination semantics.
 *
 * @param value - Candidate value.
 * @returns True when Python's `isinstance(value, dict)` would hold.
 */
export function isPythonDict(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Store `value` under `key` as an OWN, enumerable data property of
 * `record` — the TS analogue of Python `d[key] = value` for records
 * built from JSON-derived keys.
 *
 * A plain `record[key] = value` on an `Object.prototype`-backed object
 * is NOT a data write when `key === "__proto__"`: it hits the inherited
 * accessor, which silently re-parents the object (or ignores a
 * non-object value) and the key never shows up in `Object.keys` /
 * `Object.entries`. `JSON.parse` and the lossless parser do produce an
 * own `"__proto__"` key for `{"__proto__": …}` input, exactly as a
 * Python dict does, so parsers that copy such a mapping key-by-key
 * must go through this helper or lose the entry
 * (`discovery.pbt.test.ts` "preserves the property count" caught it).
 * Every other key takes the ordinary assignment fast path — only
 * `__proto__` is an accessor on `Object.prototype`; the rest
 * (`constructor`, `toString`, …) are data properties that a plain
 * assignment shadows correctly.
 *
 * The record keeps its prototype, so it remains a plain object for
 * `isPythonDict`, `toStrictEqual` and the codecs.
 *
 * @param record - The target record (plain object).
 * @param key - The key to write.
 * @param value - The value to store.
 */
export function setOwn<T>(
  record: Record<string, T>,
  key: string,
  value: T,
): void {
  if (key === "__proto__") {
    Object.defineProperty(record, key, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  } else {
    record[key] = value;
  }
}
