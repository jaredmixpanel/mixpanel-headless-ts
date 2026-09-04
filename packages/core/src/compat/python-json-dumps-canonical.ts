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
 * It differs from the default-argument {@link pythonJsonDumps} in exactly
 * three ways, and shares everything else through `dumpsStyled`:
 *
 * 1. **`sort_keys=True`** — object keys sorted by Unicode **code point**.
 *    JS's default string compare uses UTF-16 code units, which inverts
 *    astral characters against BMP characters above U+D800 (U+FF5E sorts
 *    BEFORE U+1F600 in Python, AFTER it in a naive JS `.sort()`).
 * 2. **compact separators** — `,` and `:` with no whitespace.
 * 3. nothing else: `ensure_ascii=True` (lowercase `\uXXXX`, surrogate
 *    pairs for astral, the seven short escapes), `allow_nan=True`
 *    (`NaN`/`Infinity`/`-Infinity`), integers as bare digit runs, floats
 *    via CPython `repr` (`pythonFloatStr`).
 *
 * **No `default=str` emulation.** CPython's `default` hook would render an
 * unserializable value via `str()`; this twin throws instead, because a
 * silently-`str()`-ed value is an identity that two bodies would spell
 * differently (spec §3.1 rule 6). `scripts/generate-canonical-fixtures.py`
 * asserts the Python side never took the `default` branch for any fixture.
 *
 * **Representability caveat (the one thing JS cannot mirror).** Python
 * distinguishes `1` from `1.0`; JS does not — `Number.isInteger(1.0)` is
 * `true`, so an integral Python float would canonicalize here as `1`, not
 * `1.0`. Bookmark params never carry one (spec §3.1 rule 4: `buildParams`
 * already matches Python's int-vs-float-ness, proven by the 1,785 builder
 * vectors), and the fixture generator refuses any input that would depend
 * on the distinction rather than papering over it. Integers wider than
 * `Number.MAX_SAFE_INTEGER` must be passed as `bigint` for the same
 * reason: `String(1e22)` is `"1e+22"`, while Python spells the digits.
 */

import { dumpsStyled, type JsonDumpsStyle } from "./python-json-dumps.js";

/** `sort_keys=True, separators=(",", ":")` — the QueryRef payload spelling. */
const CANONICAL_STYLE: JsonDumpsStyle = {
  itemSeparator: ",",
  keySeparator: ":",
  sortKeys: true,
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
 * @throws TypeError - For values Python's encoder rejects
 *   (`Object of type X is not JSON serializable`); there is deliberately
 *   no `default=str` fallback.
 *
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
