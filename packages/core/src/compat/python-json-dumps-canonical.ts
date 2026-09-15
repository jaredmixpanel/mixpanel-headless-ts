/**
 * CPython `json.dumps(value, sort_keys=True, separators=(",", ":"))` twin —
 * the **canonical form** the heads platform hashes into a QueryRef.
 *
 * Spec of record: `mixpanel-desktop-app/docs/specs/heads/`
 * `02-queryref-and-two-body-identity.md` §3.1 (Mixpanel arm), §3.3 (this
 * decision), §6.1 (the CPython fixture parity gate). The same spelling is
 * already produced Python-side by the desktop's Pyodide capture
 * (`renderer/sandbox/pyBootstrap.ts`), whose sha256 of these bytes is the
 * existing `params_hash`; this module is the second body of that identity.
 *
 * It differs from the default-argument {@link pythonJsonDumps} in four
 * ways, and shares everything else through `dumpsStyled`:
 *
 * 1. **`sort_keys=True`** — object keys sorted by Unicode **code point**.
 *    JS's default string compare uses UTF-16 code units, which inverts
 *    astral characters against BMP characters above U+D800 (U+FF5E sorts
 *    before U+1F600 in Python, after it in a naive JS `.sort()`).
 * 2. **compact separators** — `,` and `:` with no whitespace.
 * 3. the **numeric normalization rule** below.
 * 4. `ensure_ascii=True` is unchanged (lowercase `\uXXXX`, surrogate pairs
 *    for astral, the seven short escapes), as is CPython `repr` spelling
 *    for non-integral floats (`pythonFloatStr`).
 *
 * ## Numeric normalization rule
 *
 * **Any number whose value is integral renders as an integer**: `2.0` → `2`,
 * `1000000000000000.0` → `1000000000000000`, `-0.0` → `0`. Both bodies
 * apply it, so it is the defined canonical behaviour rather than a JS
 * limitation leaking into the identity. In TypeScript it is free (JS has
 * one number type); Python pre-normalizes with `float.is_integer()` → `int`
 * before `json.dumps`, which the fixture generator does and the desktop
 * capture adopts.
 *
 * The rule exists because the divergence it closes is **reachable, not
 * theoretical**: Python's bookmark builders emit `"filterValue"`
 * verbatim and `GroupBy.bucket_size` accepts a float, so
 * `Filter.greater_than("age", 1e15)` really does produce a `1e+15` float
 * inside params. One corpus builder vector
 * (`…test_validation_bypass_r2-testr2v4inffilterfixed-test_large_finite_value_passes`,
 * `filterValue: 1000000000000000.0`) is exactly that payload, and it is a
 * pinned fixture here for that reason.
 *
 * ## Refusals
 *
 * - **No `default=str` emulation.** CPython's `default` hook would render
 *   an unserializable value via `str()`; this twin throws instead, because
 *   a silently-`str()`-ed value is an identity two bodies would spell
 *   differently (spec §3.1 rule 6).
 *   `scripts/generate-canonical-fixtures.py` asserts the Python side never
 *   took the `default` branch for any fixture.
 * - **Non-finite numbers throw**, unlike the default twin's
 *   `allow_nan=True` spellings: `NaN` / `Infinity` are not JSON and cannot
 *   survive the parse→hash round-trip an identity depends on.
 * - **Numbers past `Number.MAX_SAFE_INTEGER` throw.** Beyond 2**53 a JS
 *   number no longer names one integer, and `String(1e22)` is `"1e+22"`
 *   while Python spells the digits. Carry such a value as a `bigint`,
 *   which renders as a bare digit run and is never refused.
 *
 * ## Scope
 *
 * This canonicalizer is for **plain JSON values** — objects, arrays,
 * strings, numbers, bigints, booleans, `null`. Rig-internal wrapper types
 * (the conformance `PyFloat` float-ness carrier, for one) are ordinary
 * objects to it and would serialize as their fields (`{"spelling":…}`);
 * unwrapping them is the rig's concern, not the identity's.
 */

import { dumpsStyled, type JsonDumpsStyle } from "./python-json-dumps.js";

/** `sort_keys=True, separators=(",", ":")` — the QueryRef payload spelling. */
const CANONICAL_STYLE: JsonDumpsStyle = {
  itemSeparator: ",",
  keySeparator: ":",
  sortKeys: true,
  rejectUnsafeNumbers: true,
};

/**
 * Serialize a value exactly as CPython
 * `json.dumps(value, sort_keys=True, separators=(",", ":"))` does.
 *
 * The result is the byte string whose sha256 is the QueryRef hash, so the
 * output is a wire contract: do not "improve" the spelling.
 *
 * @param value - The value to serialize (typically bookmark `params`).
 * @returns The canonical CPython-spelled JSON text.
 * @throws {@link TypeError} - For values Python's encoder rejects
 *   (`Object of type X is not JSON serializable`; there is deliberately no
 *   `default=str` fallback), for non-finite numbers, and for numbers past
 *   `Number.MAX_SAFE_INTEGER`.
 * @example
 * ```typescript
 * pythonJsonDumpsCanonical({ b: 1, a: [1, 2] });
 * // '{"a":[1,2],"b":1}'
 * pythonJsonDumpsCanonical({ "\u{1f600}": 1, "\u{ff5e}": 2 });
 * // '{"\\uff5e":2,"\\ud83d\\ude00":1}'  — code-point order, not UTF-16
 * ```
 */
export function pythonJsonDumpsCanonical(value: unknown): string {
  return dumpsStyled(value, CANONICAL_STYLE);
}
