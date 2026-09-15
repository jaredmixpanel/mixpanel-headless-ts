/**
 * Raw-token-aware Python `str()` rendering for the oracle.
 *
 * The runner's binding recovers the float-vs-int distinction for the
 * top-level `compat.python_str` argument from the raw JSON token
 * (`bindings.ts` / `InvocationContext.rawInput`). The fuzz harness goes
 * further: it draws nested containers (`[18.0]`, `{"k": 1e2}`), where the
 * decoded JS values (`[18]`, `{k: 100}`) have already lost float-ness,
 * and dicts whose integer-like keys plain JS objects would reorder. This
 * module renders Python `str()` directly over the ordered lossless
 * {@link RawValue} tree instead, delegating every leaf to the ported
 * compat semantics (`pythonStr` / `pythonRepr` / `pythonFloatStr`) so no
 * Python semantics are re-derived here — only the structural container
 * assembly (`[a, b]` / `{'k': v}`), which is defined by the JSON tree
 * shape itself.
 */

import { JsonNumber } from "@mixpanel-headless/conformance-runner";
import { pythonFloatStr, pythonRepr, pythonStr } from "@mixpanel-headless/core";

import { RawObject, type RawValue } from "./raw-json.js";

/**
 * Render a raw JSON value exactly as Python `str(json.loads(...))` would.
 *
 * Top-level strings pass through verbatim (Python `str` of a `str` adds
 * no quotes); every other value renders via {@link pythonReprRaw}.
 *
 * @param value - The undecoded argument value (verbatim number tokens,
 *   ordered object members).
 * @returns The CPython `str()` rendering.
 * @example
 * ```typescript
 * pythonStrRaw(parseRawJson("[18.0, 2]")); // "[18.0, 2]"
 * pythonStrRaw(parseRawJson('{"1": null, "0": true}')); // "{'1': None, '0': True}"
 * ```
 */
export function pythonStrRaw(value: RawValue): string {
  if (typeof value === "string") {
    return pythonStr(value);
  }
  return pythonReprRaw(value);
}

/**
 * Render a raw JSON value exactly as Python `repr(json.loads(...))` would.
 *
 * Number tokens branch on their own shape — integer tokens render as
 * Python `int` via exact `BigInt` digits, fraction/exponent tokens as
 * Python `float` via `pythonFloatStr` over the correctly-rounded double
 * (both `json.loads` and this path round the token to the nearest double,
 * so the renderings agree bit-for-bit). Object members render in
 * insertion order, matching Python dict semantics.
 *
 * @param value - The undecoded value.
 * @returns The CPython `repr()` rendering.
 */
function pythonReprRaw(value: RawValue): string {
  if (value instanceof JsonNumber) {
    if (value.isIntegerToken()) {
      return BigInt(value.raw).toString();
    }
    return pythonFloatStr(value.toNumber());
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => pythonReprRaw(item)).join(", ")}]`;
  }
  if (value instanceof RawObject) {
    const members = value.entries.map(
      ([key, member]) => `${pythonRepr(key)}: ${pythonReprRaw(member)}`,
    );
    return `{${members.join(", ")}}`;
  }
  // string / boolean / null — leaf semantics live in the ported compat.
  return pythonRepr(value);
}
