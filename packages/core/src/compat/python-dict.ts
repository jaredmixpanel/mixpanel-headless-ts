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
