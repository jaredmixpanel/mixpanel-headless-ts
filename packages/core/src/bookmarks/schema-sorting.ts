/**
 * Hand-rolled structural twin of the pydantic v2 sorting models in
 * `src/mixpanel_headless/_internal/bookmark_schema.py`, plus the
 * pydantic-error → `ValidationError` adapter that sits on top of them.
 *
 * Python ranges ported here (re-read before touching anything):
 * `bookmark_schema.py:61-316` (the adapter: `_DEFAULT_CODE_MAP`,
 * `_default_code_mapper`, `_sorting_code_mapper`, `validate_with_pydantic`,
 * `_translate_pydantic_error`, `_DISCRIMINATOR_TAGS`, `_loc_to_jsonpath`)
 * and `bookmark_schema.py:372-680` (the sorting models
 * `FlatLabelSortConfig`, `FlatValueSortConfig`, `SortByColumnsConfig`,
 * `SortByValueConfig`, `OldTableSortByValue`, the four discriminator
 * callables and `InsightsBookmarkSortConfig`).
 *
 * **R11.7 third-parser carve-out.** TS has no pydantic. The reference
 * semantics of this module are **pydantic-core in LAX mode** (the shared
 * `_BASE_CONFIG` sets only `populate_by_name` + `extra="forbid"`, so no
 * `strict=True`) — NOT CPython's `int()`/`str.strip()` and NOT JS's
 * `parseInt`/`String.trim()`. Every acceptance decision below is pinned to
 * measured probe evidence recorded in
 * `docs/history/phase3/notes/B2-M2-notes.md` §"CPython pydantic probe"
 * (scripts `throwaway/b2-m2/probe-sorting{,2}.py`,
 * `probe-int-grammar.py`, run 2026-08-15 against the support-branch
 * pydantic pin). The three load-bearing findings:
 *
 * 1. Error ORDER is model field-definition order, then `extra_forbidden`
 *    for unexpected keys in input insertion order (Caution §11: emission
 *    order is contract).
 * 2. Discriminated unions insert the variant `Tag` name into `loc`;
 *    {@link DISCRIMINATOR_TAGS} strips it back out.
 * 3. Lax coercion: `int` fields take bools, integral finite floats and
 *    a restricted numeric-string grammar; `str` fields take strings only;
 *    `list` fields take arrays only.
 *
 * **R10.8 ownership**: this file is the single TS home of the
 * `bookmark_schema` slice. Batch **B3-K1** (the full `bookmark_schema.py`
 * port) IMPORTS and GROWS this file — it must never re-implement the
 * sorting models, the code mappers or the loc→JSONPath renderer.
 *
 * **B3-K1 growth (2026-08-15)**: the model-description machinery below
 * (`FieldType` / `FieldSpec` / `ModelSpec` / `UnionSpec` /
 * {@link validateModel}) is now EXPORTED and generalised so
 * `bookmarks/schema.ts` can describe the non-sorting model tree with
 * the same one pydantic-core twin. Added kinds: `float`, `bool`,
 * `json`, `literalInt`, generic `list`/`dict`/`tuple`, nested `model`
 * (thunked, for the recursive `SubBehavior` / `Behavior` cycle) and
 * `plainUnion` (pydantic smart unions). Added model-level
 * `extra: "allow"` (FlowsBookmarkParams) and field-level `nullable`
 * (non-Optional fields WITH defaults, e.g. `forward: int = 0`, reject
 * explicit `null` — probe `fbp/collapse_repeated-null`). The old
 * `optionalStr` / `optionalInt` / `ignore` kinds folded into
 * `str` / `int` / `json` + `nullable`; the sorting specs below were
 * rewritten onto them with identical semantics.
 *
 * B3-K1 probe evidence: `docs/history/phase3/notes/B3-K1-notes.md` §Probe
 * (`throwaway/b3-k1/probe-{schema,grammar,detail,order,bool}.py`,
 * CPython + pydantic pin, run 2026-08-15).
 *
 * @module bookmarks/schema-sorting
 * @internal
 */

import { codepoints } from "../compat/codepoint.js";
// R10.8: the PyFloat-carrier duck check has exactly one implementation in
// the port (landed by B2 shard V1a). Importing it here keeps the sorting
// slice carrier-aware WITHOUT asking the (b′) binding to unwrap floats on
// the `params.sorting` path only — see the module note on float carriers
// below. `query/validation-shared.ts` imports nothing from `bookmarks/`,
// so this direction is acyclic.
import { isPythonDict } from "../compat/python-dict.js";
import { floatCarrierValue, isFloatCarrier } from "../compat/python-values.js";
import { PYTHON_NUMERIC_WHITESPACE } from "../compat/whitespace.gen.js";
import { ValidationError } from "../errors.js";
import { defined } from "../invariant.js";

// =============================================================================
// Pydantic error shape
// =============================================================================

/**
 * One entry of `pydantic.ValidationError.errors()` — the subset
 * `_translate_pydantic_error` reads (`bookmark_schema.py:223-254`).
 */
export interface PydanticErrorEntry {
  /** Pydantic error `type` string, e.g. `"missing"`, `"literal_error"`. */
  readonly type: string;
  /** Location tuple: field names, list indices and discriminator Tags. */
  readonly loc: ReadonlyArray<string | number>;
  /** Human-readable message (display-only, R5.4). */
  readonly msg: string;
}

/**
 * Path-aware code mapper: `(pydantic_error_type, loc) -> package_code`.
 *
 * Port of the `CodeMapper` alias (`bookmark_schema.py:98-107`).
 */
type CodeMapper = (
  errType: string,
  loc: ReadonlyArray<string | number>,
) => string;

// =============================================================================
// Adapter tables (bookmark_schema.py:71-167)
// =============================================================================

/**
 * Maps pydantic v2 `error['type']` strings to the package's stable
 * `B*` / `S*` codes. Port of `_DEFAULT_CODE_MAP`
 * (`bookmark_schema.py:71-95`) as a `ReadonlyMap` (R4.8).
 */
export const DEFAULT_CODE_MAP: ReadonlyMap<string, string> = new Map([
  // Missing required field
  ["missing", "B0_MISSING_FIELD"],
  // Extra (unexpected) field at a model with extra="forbid"
  ["extra_forbidden", "S3_UNKNOWN_FIELD"],
  // Wrong value at a Literal[...] / enum field
  ["literal_error", "B0_INVALID_LITERAL"],
  ["enum", "B0_INVALID_LITERAL"],
  // Wrong primitive type
  ["string_type", "B0_WRONG_TYPE"],
  ["int_type", "B0_WRONG_TYPE"],
  ["int_parsing", "B0_WRONG_TYPE"],
  ["bool_type", "B0_WRONG_TYPE"],
  ["bool_parsing", "B0_WRONG_TYPE"],
  ["float_type", "B0_WRONG_TYPE"],
  ["float_parsing", "B0_WRONG_TYPE"],
  ["list_type", "B0_WRONG_TYPE"],
  ["dict_type", "B0_WRONG_TYPE"],
  ["model_type", "B0_WRONG_TYPE"],
  // Discriminated-union failures
  ["union_tag_invalid", "B7_INVALID_BEHAVIOR_TYPE"],
  ["union_tag_not_found", "B7_INVALID_BEHAVIOR_TYPE"],
  // Custom validator failure
  ["value_error", "B0_VALIDATOR_ERROR"],
]);

/**
 * Default `CodeMapper` — ignores `loc`, falls back to
 * {@link DEFAULT_CODE_MAP}. Port of `_default_code_mapper`
 * (`bookmark_schema.py:110-121`).
 *
 * @param errType - Pydantic error `type`.
 * @param _loc - Unused by the default mapper (protocol requirement).
 * @returns A package error code, or `"VALIDATION_ERROR"`.
 */
export function defaultCodeMapper(
  errType: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the `CodeMapper` protocol fixes the arity (Python `_loc`)
  _loc: ReadonlyArray<string | number>,
): string {
  return DEFAULT_CODE_MAP.get(errType) ?? "VALIDATION_ERROR";
}

/**
 * Path-aware code mapper for sorting-block validation errors.
 *
 * Port of `_sorting_code_mapper` (`bookmark_schema.py:124-167`),
 * branch-for-branch in source order.
 *
 * @param errType - Pydantic error `type`.
 * @param loc - Pydantic `loc` tuple.
 * @returns An `S*` code when the path identifies a sorting-specific
 *   rule, otherwise the default mapping.
 */
export function sortingCodeMapper(
  errType: string,
  loc: ReadonlyArray<string | number>,
): string {
  const last = loc.length > 0 ? loc.at(-1) : null;
  // One switch over `errType` (source-order branches preserved); a case
  // that matches the type but not the path falls through to the default
  // mapping exactly as the Python if-chain does.
  switch (errType) {
    case "missing": {
      if (last === "colSortAttrs") {
        return "S2_MISSING_COL_SORT_ATTRS";
      }
      if (last === "sortBy") {
        return "S8_MISSING_SORT_BY";
      }
      if (last === "sortOrder") {
        return "S9_MISSING_SORT_ORDER";
      }
      break;
    }
    case "literal_error": {
      if (last === "sortBy") {
        return "S1_INVALID_SORT_BY";
      }
      if (last === "sortOrder") {
        return "S6_INVALID_SORT_ORDER";
      }
      break;
    }
    case "union_tag_invalid":
    case "union_tag_not_found": {
      return "S1_INVALID_SORT_BY";
    }
    case "extra_forbidden": {
      return "S3_UNKNOWN_FIELD";
    }
    case "list_type": {
      if (last === "colSortAttrs") {
        return "S7_NOT_A_LIST";
      }
      break;
    }
    case "dict_type":
    case "model_type": {
      return "S5_NOT_A_DICT";
    }
    default: {
      break;
    }
  }
  return DEFAULT_CODE_MAP.get(errType) ?? "VALIDATION_ERROR";
}

/**
 * Tag names that discriminated-union annotations insert into `loc`.
 *
 * Port of `_DISCRIMINATOR_TAGS` (`bookmark_schema.py:257-271`) —
 * including the two `ShowClause` tags, which belong to the B3-K1 half
 * of the module but are part of the same frozenset in Python.
 */
const DISCRIMINATOR_TAGS: ReadonlySet<string> = new Set([
  // FlatSortConfig (colSortAttrs[i])
  "FlatLabelSortConfig",
  "FlatValueSortConfig",
  // SortConfig (per-chart-type sort)
  "SortByColumnsConfig",
  "SortByValueConfig",
  // TableSortConfig (table chart only)
  "OldTableSortByValue",
  // ShowClause
  "FormulaShowClause",
  "BehaviorShowClause",
]);

/**
 * Convert a pydantic `loc` tuple to a dotted JSONPath string.
 *
 * Port of `_loc_to_jsonpath` (`bookmark_schema.py:274-315`).
 *
 * @param loc - Pydantic location tuple.
 * @param prefix - Optional dotted prefix (without trailing dot).
 * @returns A dotted JSONPath string.
 */
export function locToJsonPath(
  loc: ReadonlyArray<string | number>,
  prefix: string,
): string {
  const parts: string[] = [];
  if (prefix !== "") {
    parts.push(prefix);
  }
  for (const item of loc) {
    if (typeof item === "string" && DISCRIMINATOR_TAGS.has(item)) {
      continue;
    }
    if (typeof item === "number") {
      const last = parts.length - 1;
      if (last < 0) {
        parts.push(`[${String(item)}]`);
      } else {
        parts[last] = `${parts[last] ?? ""}[${String(item)}]`;
      }
    } else {
      parts.push(item);
    }
  }
  return parts.join(".");
}

/**
 * Convert one pydantic error entry to a package `ValidationError`.
 *
 * Port of `_translate_pydantic_error` (`bookmark_schema.py:223-250`).
 *
 * @param err - A single pydantic error entry.
 * @param codeMapper - Path-aware mapper to a package code.
 * @param pathPrefix - JSONPath prefix to prepend.
 * @returns The translated error.
 */
function translatePydanticError(
  err: PydanticErrorEntry,
  codeMapper: CodeMapper,
  pathPrefix: string,
): ValidationError {
  const path = locToJsonPath(err.loc, pathPrefix);
  const code = codeMapper(err.type, err.loc);
  return new ValidationError(path, err.msg, code);
}

// =============================================================================
// pydantic-core lax coercion primitives (probe-pinned)
// =============================================================================

/**
 * Strip pydantic-core's (Rust `str::trim`) whitespace set from both
 * ends of a string.
 *
 * Measured identical to {@link PYTHON_NUMERIC_WHITESPACE} — the pinned
 * CPython `str.isspace()` table minus `U+001C..U+001F` (notes §probe
 * finding 4). It is NOT `pythonStrip` (which strips `U+001C..U+001F`)
 * and NOT `String.trim()` (which strips `U+FEFF`); using either would
 * change accept/reject decisions, so the set is spelled out here by
 * codepoint rather than by regex (R11.7 bans `\s` grammars).
 *
 * @param text - String to trim.
 * @returns The trimmed string.
 */
function pydanticTrim(text: string): string {
  const cps = codepoints(text);
  let start = 0;
  let end = cps.length;
  while (start < end) {
    const cp = cps[start]?.codePointAt(0);
    if (cp === undefined || !PYTHON_NUMERIC_WHITESPACE.has(cp)) {
      break;
    }
    start += 1;
  }
  while (end > start) {
    const cp = cps[end - 1]?.codePointAt(0);
    if (cp === undefined || !PYTHON_NUMERIC_WHITESPACE.has(cp)) {
      break;
    }
    end -= 1;
  }
  return cps.slice(start, end).join("");
}

/**
 * pydantic-core's lax `str -> int` grammar (accept/reject only).
 *
 * Probe-pinned (notes §probe finding 4): trim, then
 * `[+-]? DIGITS(single underscores between digits) ( "." "0"+ )?`
 * with ASCII digits only. Accepts `"5"`, `"+5"`, `"05"`, `"1_0"`,
 * `"1_000.0"`, `"0.000"`, arbitrarily long digit runs; rejects
 * `"1__0"`, `"_1"`, `"1_"`, `"5."`, `".5"`, `"1e3"`, `"0x5"`,
 * `"10.01"`, `"1.0_0"`, non-ASCII digits and the empty string.
 *
 * No numeric value is produced — the model result is discarded, only
 * the error stream matters — so the R4.5 2^53 policy never applies
 * (CPython accepts arbitrary-precision ints here).
 *
 * @param text - The candidate string.
 * @returns True when pydantic-core would parse it as an int.
 */
function pydanticIntFromString(text: string): boolean {
  // ASCII-only digit grammar; `\d` without the `u` flag is ASCII 0-9,
  // which is exactly pydantic-core's accepted digit set.
  return /^[+-]?[0-9]+(?:_[0-9]+)*(?:\.0+)?$/.test(pydanticTrim(text));
}

/**
 * ASCII-only lowercase fold (R11.7: no locale-sensitive
 * `toLowerCase`, no `/i` regex flag whose Unicode folding differs
 * from pydantic-core's `eq_ignore_ascii_case`).
 *
 * @param text - Input string.
 * @returns `text` with `A-Z` folded to `a-z`, everything else verbatim.
 */
function asciiLower(text: string): string {
  let out = "";
  for (const ch of text) {
    // Single-code-point strings compare by code point here: only the
    // ASCII range "A".."Z" folds (a Python `str.lower()` twin would be
    // wrong — this is the ASCII-only fold pydantic-core applies).
    out += ch >= "A" && ch <= "Z" ? ch.toLowerCase() : ch;
  }
  return out;
}

/**
 * True when every `_` in `text` sits strictly between two ASCII
 * digits — pydantic-core's numeric-underscore rule (probe finding:
 * `1_0` / `1_0.5` / `1.0_0` accepted, `1__0` / `_1` / `1_` rejected).
 *
 * @param text - Candidate numeric string (already trimmed).
 * @returns True when the underscore placement is legal.
 */
function underscoresWellPlaced(text: string): boolean {
  const digits = "0123456789";
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== "_") {
      continue;
    }
    const prev = text[i - 1] ?? "";
    const next = text[i + 1] ?? "";
    if (!digits.includes(prev) || !digits.includes(next)) {
      return false;
    }
  }
  return true;
}

/**
 * pydantic-core's lax `str -> float` grammar (accept/reject only).
 *
 * Probe-pinned (`throwaway/b3-k1/probe-grammar.py`): trim with
 * {@link pydanticTrim}, then either a signed `inf`/`infinity`/`nan`
 * word (ASCII case-insensitive) or a decimal literal with an optional
 * fraction and exponent, single underscores allowed between digits.
 * Accepts `"5."`, `".5"`, `"1e3"`, `"1_000.0"` and an NBSP-led
 * `"\u00a05"`; rejects `"0x5"`, `"1,000"`, `""`, a FEFF-led
 * `"\ufeff5"`, an Arabic-Indic digit `"\u0665"`, and `"1__0"`.
 *
 * @param text - The candidate string.
 * @returns True when pydantic-core would parse it as a float.
 */
function pydanticFloatFromString(text: string): boolean {
  const trimmed = pydanticTrim(text);
  const word = asciiLower(
    trimmed.startsWith("+") || trimmed.startsWith("-")
      ? trimmed.slice(1)
      : trimmed,
  );
  if (word === "inf" || word === "infinity" || word === "nan") {
    return true;
  }
  if (!underscoresWellPlaced(trimmed)) {
    return false;
  }
  const cleaned = trimmed.replaceAll("_", "");
  // ASCII digit grammar only — `\d` without `u` is exactly 0-9.
  return /^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/.test(
    cleaned,
  );
}

/**
 * pydantic-core's lax `str -> bool` vocabulary.
 *
 * Probe-pinned: ASCII case-insensitive membership, and — unlike the
 * numeric parsers — **no trimming** (`" true "` is rejected).
 */
const PYDANTIC_BOOL_STRINGS: ReadonlySet<string> = new Set([
  "0",
  "off",
  "f",
  "false",
  "n",
  "no",
  "1",
  "on",
  "t",
  "true",
  "y",
  "yes",
]);

/**
 * `2**63` — pydantic-core converts a float to an integer through Rust's
 * `i64`, so an INTEGRAL float at or beyond this magnitude does not
 * reach the int/bool coercion paths at all (probe `probe-bool2.py`:
 * `4.6e18 -> bool_parsing / int OK` but `9.223372036854776e18 ->
 * bool_type / int_parsing_size`). Python `int`s have no such ceiling —
 * `2**70` validates fine on an `int` field — so the guard is keyed on
 * float-ness, never on magnitude alone.
 */
const I64_LIMIT = 2 ** 63;

/**
 * Numeric view of a value for pydantic's lax scalar coercions: plain
 * JS numbers stand for Python `int`s, PyFloat carriers for Python
 * `float`s, and both classify by VALUE (probe: `2` and `2.0` both
 * reach the same accept/reject decision on every field kind K1 owns).
 * Booleans are excluded — pydantic handles `bool` before `int`.
 *
 * @param value - Candidate value.
 * @returns The numeric value, or `undefined` when not numeric.
 */
function numericValue(value: unknown): number | undefined {
  if (isFloatCarrier(value)) {
    return floatCarrierValue(value);
  }
  return typeof value === "number" ? value : undefined;
}

/**
 * True when a numeric value stands for a Python `float` rather than a
 * Python `int`.
 *
 * Contract rule (P2 codec convention): Python floats cross the wire as
 * PyFloat carriers, so a BARE JS number is a Python `int` — unless it
 * is non-integral, which no Python `int` can be. This is the only
 * place the int/float distinction changes an outcome (`int` fields:
 * Python ints are arbitrary-precision and always fit, floats blow up
 * past `i64`).
 *
 * @param value - The original (possibly carrier-wrapped) value.
 * @param numeric - Its numeric view.
 * @returns True for Python-float semantics.
 */
function isPydanticFloat(value: unknown, numeric: number): boolean {
  return isFloatCarrier(value) || !Number.isInteger(numeric);
}

// =============================================================================
// Model description tables (bookmark_schema.py:390-680)
// =============================================================================

/**
 * A field's declared type, in pydantic-lax terms.
 *
 * `model` carries a THUNK because the Python model tree is cyclic
 * (`SubBehavior.behaviors: list[SubBehavior]`,
 * `FormulaShowClause.referencedMetrics: list[BehaviorShowClause]`) —
 * a direct reference would hit the TS temporal dead zone.
 */
export type FieldType =
  /** `Literal["a", "b"]` over strings — exact, case-sensitive. */
  | { readonly kind: "literal"; readonly values: readonly string[] }
  /** `Literal[0, 1, …]` over ints — Python equality, so `True`/`1.0` match `1`. */
  | { readonly kind: "literalInt"; readonly values: readonly number[] }
  /** `str`. */
  | { readonly kind: "str" }
  /** `int`. */
  | { readonly kind: "int" }
  /** `float`. */
  | { readonly kind: "float" }
  /** `bool`. */
  | { readonly kind: "bool" }
  /** `JsonValue` / `Any` — accepted verbatim, never reported. */
  | { readonly kind: "json" }
  /** `list[T]`. */
  | { readonly kind: "list"; readonly item: FieldType }
  /** `dict[str, T]`. */
  | { readonly kind: "dict"; readonly value: FieldType }
  /** `tuple[A, B]` — fixed arity. */
  | { readonly kind: "tuple"; readonly items: readonly FieldType[] }
  /** A nested `BaseModel` (thunked for recursive trees). */
  | { readonly kind: "model"; readonly model: () => ModelSpec }
  /** `Annotated[A | B, Discriminator(...)]`. */
  | { readonly kind: "union"; readonly union: UnionSpec }
  /** A plain `A | B` smart union. */
  | {
      readonly kind: "plainUnion";
      readonly members: readonly PlainUnionMember[];
    };

/** One member of a plain (non-discriminated) pydantic union. */
interface PlainUnionMember {
  /** Name pydantic appends to `loc` (`"int"`, `"CustomMultiAttribution"`, …). */
  readonly name: string;
  /** The member's declared type. */
  readonly type: FieldType;
}

/** One model field, in class-body declaration order. */
interface FieldSpec {
  /** Wire key (alias when the model declares one). */
  readonly key: string;
  /** Alternate key accepted because `populate_by_name=True`. */
  readonly altKey?: string;
  /** Declared type. */
  readonly type: FieldType;
  /** Whether pydantic reports `missing` when the key is absent. */
  readonly required: boolean;
  /**
   * Whether an explicit `null` is accepted (`X | None` in the
   * annotation). Defaults to `!required`, which is right for every
   * `X | None = None` field; set it to `false` for the non-Optional
   * fields that merely carry a DEFAULT (`forward: int = 0`,
   * `conv_first_step: bool = False`) — those reject `null` with the
   * field's own type error (probe `fbp/collapse_repeated-null`).
   */
  readonly nullable?: boolean;
}

/** A pydantic `BaseModel`. */
export interface ModelSpec {
  /** Class name (also the `Tag` name in discriminated unions). */
  readonly name: string;
  /** Fields in class-body declaration order (= error emission order). */
  readonly fields: readonly FieldSpec[];
  /**
   * `model_config.extra`. Defaults to `"forbid"` (`_BASE_CONFIG`);
   * only `FlowsBookmarkParams` declares `"allow"`
   * (`bookmark_schema.py:1514`, pinned by
   * `test_flows_bookmark_params_currently_allows_extras`).
   */
  readonly extra?: "forbid" | "allow";
}

/** A `Discriminator(callable) + Tag(...)` union. */
export interface UnionSpec {
  /** Port of the Python discriminator callable. */
  readonly discriminate: (value: unknown) => string;
  /** Tag name → variant model. */
  readonly variants: ReadonlyMap<string, ModelSpec>;
}

/**
 * A named structural validator for one model — the TS stand-in for a
 * pydantic model CLASS.
 *
 * `validate_with_pydantic(model_cls, …)` takes a class; TS has none,
 * so the port passes this handle around instead. `.name` is what the
 * conformance `model_name` output codec serialises for
 * `get_root_model_for_bookmark_type`, and what B6-W3's dispatch keys
 * on; `.validate` is what {@link validateWithPydantic} consumes.
 */
export interface RootModelHandle {
  /** The Python class name. */
  readonly name: string;
  /** Structural validator: raw value → pydantic error stream. */
  readonly validate: (raw: unknown) => PydanticErrorEntry[];
}

/**
 * Wrap a {@link ModelSpec} as a {@link RootModelHandle}.
 *
 * @param spec - The model description.
 * @returns A handle whose `validate` runs the model at `loc = ()`.
 */
export function modelHandle(spec: ModelSpec): RootModelHandle {
  return {
    name: spec.name,
    validate: (raw: unknown): PydanticErrorEntry[] => {
      const out: PydanticErrorEntry[] = [];
      validateModel(raw, spec, [], out);
      return out;
    },
  };
}

/** Mirrors sorting.py `SortOrder`. */
export const SORT_ORDER_LITERAL = ["asc", "desc"] as const;

/** Mirrors sorting.py `FlatLabelSortConfig` (`bookmark_schema.py:390-401`). */
const FLAT_LABEL_SORT_CONFIG: ModelSpec = {
  name: "FlatLabelSortConfig",
  fields: [
    {
      key: "sortBy",
      type: { kind: "literal", values: ["label"] },
      required: true,
    },
    {
      key: "sortOrder",
      type: { kind: "literal", values: SORT_ORDER_LITERAL },
      required: true,
    },
    { key: "valueField", type: { kind: "str" }, required: false },
    { key: "viewNLimit", type: { kind: "int" }, required: false },
  ],
};

/** Mirrors sorting.py `FlatValueSortConfig` (`bookmark_schema.py:404-422`). */
const FLAT_VALUE_SORT_CONFIG: ModelSpec = {
  name: "FlatValueSortConfig",
  fields: [
    {
      key: "sortBy",
      type: { kind: "literal", values: ["value", "liftComparisonValue"] },
      required: true,
    },
    {
      key: "sortOrder",
      type: { kind: "literal", values: SORT_ORDER_LITERAL },
      required: true,
    },
    { key: "valueField", type: { kind: "str" }, required: false },
    { key: "viewNLimit", type: { kind: "int" }, required: false },
  ],
};

/**
 * Discriminator callable for `FlatSortConfig` (`colSortAttrs[i]`).
 *
 * Port of `_flat_sort_discriminator` (`bookmark_schema.py:425-444`).
 *
 * @param value - The candidate value.
 * @returns The `Tag` name of the selected variant.
 */
function flatSortDiscriminator(value: unknown): string {
  const sortBy =
    isPythonDict(value) && Object.hasOwn(value, "sortBy")
      ? value["sortBy"]
      : undefined;
  if (sortBy === "label") {
    return "FlatLabelSortConfig";
  }
  return "FlatValueSortConfig";
}

/** Mirrors sorting.py `FlatSortConfig` (`bookmark_schema.py:448-452`). */
const FLAT_SORT_CONFIG: UnionSpec = {
  discriminate: flatSortDiscriminator,
  variants: new Map([
    ["FlatLabelSortConfig", FLAT_LABEL_SORT_CONFIG],
    ["FlatValueSortConfig", FLAT_VALUE_SORT_CONFIG],
  ]),
};

/** Mirrors sorting.py `SortByColumnsConfig` (`bookmark_schema.py:455-474`). */
const SORT_BY_COLUMNS_CONFIG: ModelSpec = {
  name: "SortByColumnsConfig",
  fields: [
    {
      key: "sortBy",
      type: { kind: "literal", values: ["column"] },
      required: true,
    },
    { key: "valueField", type: { kind: "str" }, required: false },
    {
      key: "colSortAttrs",
      type: { kind: "list", item: { kind: "union", union: FLAT_SORT_CONFIG } },
      required: true,
    },
    // Tolerated legacy fields (`Ignore[JsonValue]` in source).
    { key: "sortOrder", type: { kind: "json" }, required: false },
    { key: "viewNLimit", type: { kind: "json" }, required: false },
  ],
};

/** Mirrors sorting.py `SortByValueConfig` (`bookmark_schema.py:477-497`). */
const SORT_BY_VALUE_CONFIG: ModelSpec = {
  name: "SortByValueConfig",
  fields: [
    {
      key: "sortBy",
      type: { kind: "literal", values: ["value", "liftComparisonValue"] },
      required: true,
    },
    {
      key: "sortOrder",
      type: { kind: "literal", values: SORT_ORDER_LITERAL },
      required: false,
    },
    { key: "valueField", type: { kind: "str" }, required: false },
    {
      key: "colSortAttrs",
      type: { kind: "list", item: { kind: "union", union: FLAT_SORT_CONFIG } },
      required: true,
    },
    { key: "viewNLimit", type: { kind: "int" }, required: false },
  ],
};

/**
 * Discriminator callable for `SortConfig` (per-chart-type sort).
 *
 * Port of `_sort_config_discriminator` (`bookmark_schema.py:500-519`).
 *
 * @param value - The candidate value.
 * @returns The `Tag` name of the selected variant.
 */
function sortConfigDiscriminator(value: unknown): string {
  const sortBy =
    isPythonDict(value) && Object.hasOwn(value, "sortBy")
      ? value["sortBy"]
      : undefined;
  if (sortBy === "column") {
    return "SortByColumnsConfig";
  }
  return "SortByValueConfig";
}

/** Mirrors sorting.py `SortConfig` (`bookmark_schema.py:523-527`). */
const SORT_CONFIG: UnionSpec = {
  discriminate: sortConfigDiscriminator,
  variants: new Map([
    ["SortByColumnsConfig", SORT_BY_COLUMNS_CONFIG],
    ["SortByValueConfig", SORT_BY_VALUE_CONFIG],
  ]),
};

/** Mirrors sorting.py `OldTableSortByValue` (`bookmark_schema.py:530-544`). */
const OLD_TABLE_SORT_BY_VALUE: ModelSpec = {
  name: "OldTableSortByValue",
  fields: [
    {
      key: "sortBy",
      type: { kind: "literal", values: ["value"] },
      required: true,
    },
    {
      key: "sortOrder",
      type: { kind: "literal", values: SORT_ORDER_LITERAL },
      required: true,
    },
    {
      key: "sortColumn",
      type: { kind: "literal", values: ["Linear", "sum", "value"] },
      required: true,
    },
    {
      key: "colSortAttrs",
      type: { kind: "list", item: { kind: "union", union: FLAT_SORT_CONFIG } },
      required: true,
    },
  ],
};

/**
 * Discriminator callable for the line-chart `FlatOrColumnSortConfig`.
 *
 * Port of `_flat_or_column_sort_discriminator`
 * (`bookmark_schema.py:547-592`).
 *
 * @param value - The candidate value.
 * @returns The `Tag` name of the selected variant.
 */
function flatOrColumnSortDiscriminator(value: unknown): string {
  let sortBy: unknown;
  let hasCols: boolean;
  if (isPythonDict(value)) {
    sortBy = Object.hasOwn(value, "sortBy") ? value["sortBy"] : undefined;
    const cols = Object.hasOwn(value, "colSortAttrs")
      ? value["colSortAttrs"]
      : undefined;
    hasCols = cols !== undefined && cols !== null;
  } else {
    sortBy = undefined;
    hasCols = false;
  }
  if (sortBy === "column") {
    return "SortByColumnsConfig";
  }
  if (sortBy === "label") {
    return "FlatLabelSortConfig";
  }
  if (hasCols) {
    return "SortByValueConfig";
  }
  return "FlatValueSortConfig";
}

/** Mirrors sorting.py `FlatOrColumnSortConfig` (`bookmark_schema.py:600-606`). */
const FLAT_OR_COLUMN_SORT_CONFIG: UnionSpec = {
  discriminate: flatOrColumnSortDiscriminator,
  variants: new Map([
    ["FlatLabelSortConfig", FLAT_LABEL_SORT_CONFIG],
    ["FlatValueSortConfig", FLAT_VALUE_SORT_CONFIG],
    ["SortByColumnsConfig", SORT_BY_COLUMNS_CONFIG],
    ["SortByValueConfig", SORT_BY_VALUE_CONFIG],
  ]),
};

/**
 * Discriminator callable for `InsightsBookmarkSortConfig.table`.
 *
 * Port of `_table_sort_discriminator` (`bookmark_schema.py:609-635`).
 * Note the asymmetry with the other discriminators: `sortColumn` is
 * tested with `in` (key PRESENCE, `null` included), not `is not None`.
 *
 * @param value - The candidate value.
 * @returns The `Tag` name of the selected variant.
 */
function tableSortDiscriminator(value: unknown): string {
  let sortBy: unknown;
  let hasSortColumn: boolean;
  if (isPythonDict(value)) {
    sortBy = Object.hasOwn(value, "sortBy") ? value["sortBy"] : undefined;
    hasSortColumn = Object.hasOwn(value, "sortColumn");
  } else {
    sortBy = undefined;
    hasSortColumn = false;
  }
  if (sortBy === "column") {
    return "SortByColumnsConfig";
  }
  if (hasSortColumn) {
    return "OldTableSortByValue";
  }
  return "SortByValueConfig";
}

/** Mirrors sorting.py `TableSortConfig` (`bookmark_schema.py:640-645`). */
const TABLE_SORT_CONFIG: UnionSpec = {
  discriminate: tableSortDiscriminator,
  variants: new Map([
    ["SortByColumnsConfig", SORT_BY_COLUMNS_CONFIG],
    ["SortByValueConfig", SORT_BY_VALUE_CONFIG],
    ["OldTableSortByValue", OLD_TABLE_SORT_BY_VALUE],
  ]),
};

/**
 * Mirrors sorting.py `InsightsBookmarkSortConfig`
 * (`bookmark_schema.py:648-679`). Field order below IS the error
 * emission order; the kebab-case keys come from the model's
 * `alias_generator`, the snake_case ones from `populate_by_name=True`.
 */
export const INSIGHTS_BOOKMARK_SORT_CONFIG: ModelSpec = {
  name: "InsightsBookmarkSortConfig",
  fields: [
    {
      key: "bar",
      type: { kind: "union", union: SORT_CONFIG },
      required: false,
    },
    {
      key: "table",
      type: { kind: "union", union: TABLE_SORT_CONFIG },
      required: false,
    },
    {
      key: "line",
      type: { kind: "union", union: FLAT_OR_COLUMN_SORT_CONFIG },
      required: false,
    },
    {
      key: "insights-metric",
      altKey: "insights_metric",
      type: { kind: "union", union: SORT_CONFIG },
      required: false,
    },
    {
      key: "pie",
      type: { kind: "union", union: SORT_CONFIG },
      required: false,
    },
    {
      key: "retention-curve",
      altKey: "retention_curve",
      type: { kind: "union", union: SORT_CONFIG },
      required: false,
    },
    {
      key: "funnel-steps",
      altKey: "funnel_steps",
      type: { kind: "union", union: SORT_CONFIG },
      required: false,
    },
  ],
};

// =============================================================================
// The structural validator
// =============================================================================

/**
 * Validate one value against a field's declared type.
 *
 * @param value - The input value (already known to be present).
 * @param type - The declared field type.
 * @param loc - `loc` prefix for emitted errors (includes the field key).
 * @param out - Error sink, appended in emission order.
 */
// eslint-disable-next-line complexity, max-lines-per-function -- branch-for-branch port of one Python function (see the docblock); splitting it would scatter the guard order the corpus pins
function validateFieldValue(
  value: unknown,
  type: FieldType,
  loc: ReadonlyArray<string | number>,
  out: PydanticErrorEntry[],
): void {
  switch (type.kind) {
    case "json": {
      // `JsonValue` / `Any` / `Ignore[JsonValue]` — accepted at parse
      // time, never reported (probe `sections/behavior-ignore-filter-junk`,
      // `jsonvalue/*`: dicts, lists, scalars, NaN and Infinity all pass).
      return;
    }
    case "literal": {
      if (typeof value === "string" && type.values.includes(value)) {
        return;
      }
      out.push({
        type: "literal_error",
        loc,
        msg: literalMessage(type.values.map((v) => `'${v}'`)),
      });
      return;
    }
    case "literalInt": {
      // Python equality decides membership, so `True`/`False` match
      // `1`/`0` and `1.0` matches `1`; strings never coerce
      // (probe `lit-int/*`).
      const numeric =
        typeof value === "boolean" ? Number(value) : numericValue(value);
      if (numeric !== undefined && type.values.includes(numeric)) {
        return;
      }
      out.push({
        type: "literal_error",
        loc,
        msg: literalMessage(type.values.map(String)),
      });
      return;
    }
    case "str": {
      if (typeof value === "string") {
        return;
      }
      out.push({
        type: "string_type",
        loc,
        msg: "Input should be a valid string",
      });
      return;
    }
    case "int": {
      if (typeof value === "boolean") {
        return;
      }
      // A PyFloat carrier IS a Python float here (Caution §8). pydantic
      // treats ints and floats uniformly on an `int` field except for the
      // fractional/non-finite branches, so classify by numeric value and
      // never by JS type — that keeps the binding free of a sorting-only
      // unwrap rule (which would collide with B18B's `isinstance(int)`
      // check on the SAME params dict).
      const numeric = numericValue(value);
      if (numeric !== undefined) {
        if (!Number.isFinite(numeric)) {
          out.push({
            type: "finite_number",
            loc,
            msg: "Input should be a finite number",
          });
        } else if (isPydanticFloat(value, numeric)) {
          if (Math.abs(numeric) >= I64_LIMIT) {
            out.push({
              type: "int_parsing_size",
              loc,
              msg: "Unable to parse input string as an integer, exceeded maximum size",
            });
          } else if (!Number.isInteger(numeric)) {
            out.push({
              type: "int_from_float",
              loc,
              msg: "Input should be a valid integer, got a number with a fractional part",
            });
          }
        }
        return;
      }
      if (typeof value === "string") {
        if (!pydanticIntFromString(value)) {
          out.push({
            type: "int_parsing",
            loc,
            msg: "Input should be a valid integer, unable to parse string as an integer",
          });
        }
        return;
      }
      out.push({
        type: "int_type",
        loc,
        msg: "Input should be a valid integer",
      });
      return;
    }
    case "float": {
      // Every finite AND non-finite number is accepted, ints included
      // (probe `lax/float/*`: `inf`, `nan`, `True` all pass).
      if (typeof value === "boolean" || numericValue(value) !== undefined) {
        return;
      }
      if (typeof value === "string") {
        if (!pydanticFloatFromString(value)) {
          out.push({
            type: "float_parsing",
            loc,
            msg: "Input should be a valid number, unable to parse string as a number",
          });
        }
        return;
      }
      out.push({
        type: "float_type",
        loc,
        msg: "Input should be a valid number",
      });
      return;
    }
    case "bool": {
      if (typeof value === "boolean") {
        return;
      }
      const numeric = numericValue(value);
      if (numeric !== undefined) {
        // Probe `probe-bool.py` / `probe-bool2.py`: value-based, NOT
        // type-based — `0`/`1`/`0.0`/`1.0`/`-0.0` pass; other INTEGRAL
        // numbers inside the i64 window give `bool_parsing`; everything
        // else (fractional, inf, nan, |v| >= 2**63 whether int or
        // float) gives `bool_type`.
        if (numeric === 0 || numeric === 1) {
          return;
        }
        out.push(
          Number.isInteger(numeric) && Math.abs(numeric) < I64_LIMIT
            ? {
                type: "bool_parsing",
                loc,
                msg: "Input should be a valid boolean, unable to interpret input",
              }
            : {
                type: "bool_type",
                loc,
                msg: "Input should be a valid boolean",
              },
        );
        return;
      }
      if (typeof value === "string") {
        // No trimming here — probe: `" true "` is rejected.
        if (!PYDANTIC_BOOL_STRINGS.has(asciiLower(value))) {
          out.push({
            type: "bool_parsing",
            loc,
            msg: "Input should be a valid boolean, unable to interpret input",
          });
        }
        return;
      }
      out.push({
        type: "bool_type",
        loc,
        msg: "Input should be a valid boolean",
      });
      return;
    }
    case "list": {
      if (!Array.isArray(value)) {
        out.push({
          type: "list_type",
          loc,
          msg: "Input should be a valid list",
        });
        return;
      }
      for (const [index, item] of value.entries()) {
        validateFieldValue(item, type.item, [...loc, index], out);
      }
      return;
    }
    case "dict": {
      if (!isPythonDict(value)) {
        out.push({
          type: "dict_type",
          loc,
          msg: "Input should be a valid dictionary",
        });
        return;
      }
      for (const [key, value_] of Object.entries(value)) {
        validateFieldValue(value_, type.value, [...loc, key], out);
      }
      return;
    }
    case "tuple": {
      // Probe `tuple/*`: a non-list element gives `tuple_type`, a short
      // element gives one `missing` per absent slot, a long one gives a
      // single `too_long` at the tuple's own loc.
      if (!Array.isArray(value)) {
        out.push({
          type: "tuple_type",
          loc,
          msg: "Input should be a valid tuple",
        });
        return;
      }
      if (value.length > type.items.length) {
        out.push({
          type: "too_long",
          loc,
          msg: `Tuple should have at most ${String(type.items.length)} items after validation, not ${String(value.length)}`,
        });
        return;
      }
      for (const [index, itemType] of type.items.entries()) {
        if (index >= value.length) {
          out.push({
            type: "missing",
            loc: [...loc, index],
            msg: "Field required",
          });
          continue;
        }
        validateFieldValue(value[index], itemType, [...loc, index], out);
      }
      return;
    }
    case "model": {
      validateModel(value, type.model(), loc, out);
      return;
    }
    case "union": {
      validateUnion(value, type.union, loc, out);
      return;
    }
    case "plainUnion": {
      // pydantic smart union: the first member that validates wins and
      // silences everything; when none does, EVERY member's errors are
      // emitted in declaration order, each tagged with the member name
      // (probe `sections/meas-multiattr-bad-type`, `nesteddict/*`).
      const collected: PydanticErrorEntry[] = [];
      for (const member of type.members) {
        const memberErrors: PydanticErrorEntry[] = [];
        validateFieldValue(
          value,
          member.type,
          [...loc, member.name],
          memberErrors,
        );
        if (memberErrors.length === 0) {
          return;
        }
        collected.push(...memberErrors);
      }
      out.push(...collected);
      return;
    }
  }
}

/**
 * Render pydantic's `literal_error` message for a value set
 * (display-only, R5.4 — reproduced for parity of the ported message
 * text only).
 *
 * @param quoted - The literal's admitted values, already rendered
 *   (string literals arrive single-quoted, int literals bare).
 * @returns The message pydantic emits.
 */
function literalMessage(quoted: readonly string[]): string {
  const last = defined(quoted.at(-1), "literal alternative");
  const rendered =
    quoted.length === 1 ? last : `${quoted.slice(0, -1).join(", ")} or ${last}`;
  return `Input should be ${rendered}`;
}

/**
 * Validate a value against a discriminated union: run the
 * discriminator, push its `Tag` onto `loc`, validate the variant.
 *
 * @param value - The input value.
 * @param union - The union spec.
 * @param loc - `loc` prefix (without the Tag).
 * @param out - Error sink.
 */
function validateUnion(
  value: unknown,
  union: UnionSpec,
  loc: ReadonlyArray<string | number>,
  out: PydanticErrorEntry[],
): void {
  const tag = union.discriminate(value);
  const model = union.variants.get(tag);
  /* istanbul ignore next -- every discriminator returns a declared Tag */
  if (model === undefined) {
    throw new Error(`schema-sorting: unknown discriminator tag ${tag}`);
  }
  validateModel(value, model, [...loc, tag], out);
}

/**
 * Validate a value against a model.
 *
 * Emission order (probe finding 1, re-confirmed at B3-K1 by
 * `order/do-multiple`): declared fields in class-body order, then —
 * for `extra="forbid"` models only — unexpected keys in input
 * insertion order.
 *
 * Alias handling under `populate_by_name=True`: the ALIAS wins when
 * both spellings are present, and the Python-name key then falls
 * through to the extras pass (probe `alias/fsstc-both`,
 * `alias/both-_idx-and-idx`, `alias/steps-both-from`).
 *
 * @param value - The input value.
 * @param model - The model spec.
 * @param loc - `loc` prefix for this model (Tag included when the model
 *   was reached through a discriminated union).
 * @param out - Error sink.
 */
function validateModel(
  value: unknown,
  model: ModelSpec,
  loc: ReadonlyArray<string | number>,
  out: PydanticErrorEntry[],
): void {
  if (!isPythonDict(value)) {
    out.push({
      type: "model_type",
      loc,
      msg: `Input should be a valid dictionary or instance of ${model.name}`,
    });
    return;
  }
  const consumed = new Set<string>();
  for (const field of model.fields) {
    let key: string | undefined;
    if (Object.hasOwn(value, field.key)) {
      key = field.key;
    } else if (
      field.altKey !== undefined &&
      Object.hasOwn(value, field.altKey)
    ) {
      key = field.altKey;
    }
    if (key === undefined) {
      if (field.required) {
        out.push({
          type: "missing",
          loc: [...loc, field.key],
          msg: "Field required",
        });
      }
      continue;
    }
    consumed.add(key);
    const raw = value[key];
    if (raw === null && (field.nullable ?? !field.required)) {
      // `X | None = None` — an explicit null hits the Optional branch.
      continue;
    }
    validateFieldValue(raw, field.type, [...loc, key], out);
  }
  if (model.extra === "allow") {
    return;
  }
  for (const key of Object.keys(value)) {
    if (!consumed.has(key)) {
      out.push({
        type: "extra_forbidden",
        loc: [...loc, key],
        msg: "Extra inputs are not permitted",
      });
    }
  }
}

/**
 * Run `InsightsBookmarkSortConfig.model_validate(raw)` and return the
 * pydantic error stream it would raise (empty when valid).
 *
 * NOTE (documented JS/Python divergence, harmless for every real chart
 * type): `Object.keys` orders integer-like keys first, while a Python
 * dict is purely insertion-ordered. Only reachable with numeric-string
 * chart-type keys, which `validate_sorting_block` filters out as
 * `S4_UNKNOWN_CHART_TYPE` before this validator ever sees them.
 *
 * @param raw - The value at `params['sorting']` (already chart-type
 *   pre-filtered by the caller).
 * @returns Pydantic error entries in emission order.
 */
export function validateInsightsBookmarkSortConfig(
  raw: unknown,
): PydanticErrorEntry[] {
  const out: PydanticErrorEntry[] = [];
  validateModel(raw, INSIGHTS_BOOKMARK_SORT_CONFIG, [], out);
  return out;
}

// =============================================================================
// Model handles (B3-K1) — the TS stand-ins for the pydantic classes
// =============================================================================

/** Handle for `FlatLabelSortConfig`. */
export const FLAT_LABEL_SORT_CONFIG_MODEL: RootModelHandle = modelHandle(
  FLAT_LABEL_SORT_CONFIG,
);

/** Handle for `FlatValueSortConfig`. */
export const FLAT_VALUE_SORT_CONFIG_MODEL: RootModelHandle = modelHandle(
  FLAT_VALUE_SORT_CONFIG,
);

/** Handle for `SortByColumnsConfig`. */
export const SORT_BY_COLUMNS_CONFIG_MODEL: RootModelHandle = modelHandle(
  SORT_BY_COLUMNS_CONFIG,
);

/** Handle for `SortByValueConfig`. */
export const SORT_BY_VALUE_CONFIG_MODEL: RootModelHandle =
  modelHandle(SORT_BY_VALUE_CONFIG);

/**
 * Handle for `InsightsBookmarkSortConfig` — the model the (b′) binder
 * resolves for the `"InsightsBookmarkSortConfig"` adapter name.
 */
export const INSIGHTS_BOOKMARK_SORT_CONFIG_MODEL: RootModelHandle = modelHandle(
  INSIGHTS_BOOKMARK_SORT_CONFIG,
);

/**
 * Options for {@link validateWithPydantic} (Python kwonly args, R3.9).
 */
export interface ValidateWithPydanticOptions {
  /** Path-aware mapper from `(err_type, loc)` to a package code. */
  readonly code_mapper?: CodeMapper;
  /** JSONPath-like prefix prepended to every error's `path`. */
  readonly path_prefix?: string;
}

/**
 * Validate `raw` against a model and translate pydantic's errors.
 *
 * Port of `validate_with_pydantic` (`bookmark_schema.py:170-220`),
 * specialised to the model set this file owns: the `model_cls`
 * positional becomes the structural validator function, because TS has
 * no pydantic model objects.
 *
 * @param validator - The structural validator for the model.
 * @param raw - The raw value to validate.
 * @param options - `code_mapper` / `path_prefix` (both kwonly in Python).
 * @returns Empty list if validation passed, one `ValidationError` per
 *   pydantic error otherwise.
 */
export function validateWithPydantic(
  validator: (raw: unknown) => PydanticErrorEntry[],
  raw: unknown,
  options: ValidateWithPydanticOptions = {},
): ValidationError[] {
  const mapper = options.code_mapper ?? defaultCodeMapper;
  const prefix = options.path_prefix ?? "";
  return validator(raw).map((err) =>
    translatePydanticError(err, mapper, prefix),
  );
}
