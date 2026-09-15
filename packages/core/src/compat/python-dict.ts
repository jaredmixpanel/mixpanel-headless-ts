/**
 * `isinstance(x, dict)` discrimination and the one safe way to write a
 * JSON-derived key into a plain object.
 *
 * A leaf module so that low-level modules (`types/entities/model-base.ts`)
 * can import the dict guard without pulling in `query/validation-shared.ts`,
 * which sits above the entity models; that module re-exports it for its
 * existing importers. Compat imports nothing above itself.
 */

/**
 * Decide whether a value is a Python dict — the one `isinstance` dict
 * discrimination for the ported value domain.
 *
 * Python's `isinstance(x, dict)` is false for floats and for class
 * instances. In the ported value domain a dict is exactly a plain
 * object: prototype `Object.prototype` (JSON/codec decode output,
 * object literals) or `null` (`Object.create(null)` records). Class
 * instances — reconstructed core types (`Filter`, …) and the rig's
 * `PyFloat` carrier, which is a class instance too — are excluded by
 * prototype, so a consumer dict that happens to carry a `spelling`
 * key still classifies as a dict, exactly as in Python.
 *
 * Not to be confused with `client/internals.ts` `isPlainRecord`, the
 * JSON-shape guard for parsed wire payloads (it admits class
 * instances) — one named guard per discrimination semantics.
 *
 * @param value - Candidate value.
 * @returns True when Python's `isinstance(value, dict)` would hold.
 * @example
 * ```ts
 * isPythonDict({ a: 1 }); // true
 * isPythonDict(Object.create(null)); // true
 * isPythonDict([1, 2]); // false
 * isPythonDict(new Filter({ name: "plan" })); // false — a class instance
 * ```
 */
export function isPythonDict(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Store `value` under `key` as an own, enumerable data property of
 * `record` — the TS analogue of Python `d[key] = value` for records
 * built from JSON-derived keys.
 *
 * A plain `record[key] = value` on an `Object.prototype`-backed object
 * is not a data write when `key === "__proto__"`: it hits the inherited
 * accessor, which silently re-parents the object (or ignores a
 * non-object value) and the key never shows up in `Object.keys` /
 * `Object.entries`. `JSON.parse` and the lossless parser do produce an
 * own `"__proto__"` key for `{"__proto__": …}` input, exactly as a
 * Python dict does, so parsers that copy such a mapping key-by-key
 * must go through this helper or lose the entry.
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
 * @example
 * ```ts
 * const record: Record<string, unknown> = {};
 * setOwn(record, "__proto__", 1);
 * Object.keys(record); // ["__proto__"] — a plain assignment would have re-parented it
 * ```
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
