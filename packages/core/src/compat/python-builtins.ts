/**
 * Twins of the CPython builtin exceptions that ported pure functions can
 * reach on in-annotation input (values inside `Any` / `dict[str, Any]`
 * interiors are in-annotation, so their raises are contract).
 *
 * Internal: re-exported from the `compat` sub-barrel for in-package use,
 * deliberately not from the public package barrel. They exist so the
 * conformance and oracle bridges can compare a bare Python exception class
 * name, not as something consumers catch; consumers catch the
 * `MixpanelHeadlessError` hierarchy (`errors.ts`).
 *
 * Why real classes with these exact names: the oracle bridge encodes a
 * thrown error as `thrown.constructor.name` and the conformance runner
 * compares the bare class. CPython's `TypeError` already has a native JS
 * namesake (`requireHashable` throws the native one); `ValueError`,
 * `OverflowError`, `KeyError`, `AttributeError` and `RuntimeError` do not,
 * so they are minted here once rather than approximated by `RangeError`,
 * whose name would diff. Message text is not contract; the strings copy
 * CPython's wording for debuggability only.
 *
 * @internal
 */

/**
 * Twin of CPython's `ValueError`.
 *
 * Reached today by `segfilter._convert_date_format`'s 3-way unpack
 * and by `transforms.transform_event`'s
 * `datetime.fromtimestamp` on a NaN or out-of-`datetime`-range
 * timestamp.
 *
 * @example
 * ```ts
 * throw new ValueError("not enough values to unpack (expected 3, got 2)");
 * ```
 */
export class ValueError extends Error {
  /**
   * Create the twin.
   *
   * @param message - CPython's message text; not part of the contract.
   */
  constructor(message: string) {
    super(message);
    this.name = "ValueError";
  }
}

/**
 * Twin of CPython's `OverflowError`.
 *
 * Reached by `datetime.fromtimestamp` when the timestamp cannot be
 * represented in the platform `time_t` (probe: `±inf` and magnitudes at
 * or beyond 2^63 seconds).
 *
 * @example
 * ```ts
 * throw new OverflowError("int too large to convert to float");
 * ```
 */
export class OverflowError extends Error {
  /**
   * Create the twin.
   *
   * @param message - CPython's message text; not part of the contract.
   */
  constructor(message: string) {
    super(message);
    this.name = "OverflowError";
  }
}

/**
 * Twin of CPython's `KeyError`.
 *
 * Reached by the discovery parsers, which subscript required API
 * keys directly (`_parse_lexicon_schema`'s `data["entityType"]`,
 * `_parse_bookmark_info`'s six required fields, `list_funnels`'s
 * `f["funnel_id"]`, `list_cohorts`'s `c["id"]`, `list_top_events`'s
 * `e["amount"]`) with no validation in front of them.
 *
 * Also reached by `types/query-params/cohort.ts` `has_property`'s
 * operator-map lookup. That site once had a module-local duplicate of
 * this class; two same-named classes collide in the bundled oracle
 * (esbuild renames one binding to `KeyError2` and the bridge compares
 * `constructor.name`), which the differential fuzz caught as a live
 * divergence — so there is exactly one `KeyError` class.
 *
 * @example
 * ```ts
 * const err = new KeyError("entityType");
 * err.name; // "KeyError"
 * err.message; // '"entityType"'
 * ```
 */
export class KeyError extends Error {
  /**
   * Create the twin.
   *
   * @param key - The missing key (CPython's message is `repr(key)`;
   *   the text is not part of the contract).
   */
  constructor(key: string) {
    super(JSON.stringify(key));
    this.name = "KeyError";
  }
}

/**
 * Twin of CPython's `AttributeError`.
 *
 * Reached by `segfilter._build_datetime_filter`'s range branch when an
 * element of the two-date list is not a `str`: Python evaluates
 * `date_str.split("-")` and fails with
 * `'int' object has no attribute 'split'`.
 *
 * @example
 * ```ts
 * throw new AttributeError("'int' object has no attribute 'split'");
 * ```
 */
export class AttributeError extends Error {
  /**
   * Create the twin.
   *
   * @param message - CPython's message text; not part of the contract.
   */
  constructor(message: string) {
    super(message);
    this.name = "AttributeError";
  }
}

/**
 * Twin of CPython's `RuntimeError`.
 *
 * `validate_user_args`'s U24 guard catches
 * `(ValueError, TypeError, RuntimeError)` around
 * `CohortDefinition.to_dict()`, and
 * `test_workspace_query_user_integration.py` patches `to_dict`
 * to raise a `RuntimeError` specifically. Without this twin the TS
 * catch could not name the third arm.
 *
 * @example
 * ```ts
 * try {
 *   definition.toDict();
 * } catch (err) {
 *   if (err instanceof RuntimeError) {
 *     // the third arm of Python's `except (ValueError, TypeError, RuntimeError)`
 *   }
 * }
 * ```
 */
export class RuntimeError extends Error {
  /**
   * Create the twin.
   *
   * @param message - CPython's message text; not part of the contract.
   */
  constructor(message: string) {
    super(message);
    this.name = "RuntimeError";
  }
}
