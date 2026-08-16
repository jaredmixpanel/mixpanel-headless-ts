/**
 * Twins of the CPython builtin exceptions that ported pure functions
 * can reach on IN-ANNOTATION input (ratified Discrepancy #8: values
 * inside `Any` / `dict[str, Any]` interiors are in-annotation, so their
 * raises are contract).
 *
 * Internal module — deliberately NOT re-exported from the package
 * barrel or from `compat/index.ts`: these classes exist so the
 * conformance/oracle bridges can compare a bare Python exception class
 * name, not as an API consumers catch. Library consumers catch the
 * `MixpanelHeadlessError` hierarchy (`errors.ts`); the two twins here
 * only fire where Python itself raises a bare builtin.
 *
 * **Why real classes with these exact names** (b3-packets.md §K3
 * Cautions #9, R5.5): the oracle bridge encodes a thrown error as
 * `thrown.constructor.name` (`differential/oracle/server.ts:956`) and
 * the conformance runner compares the bare class (`oracle-protocol.md`
 * §"builtin classes"). CPython's `TypeError` already has a native JS
 * namesake (the `requireHashable` precedent, `validation-shared.ts:313`,
 * throws the native one); `ValueError`, `OverflowError` and
 * `AttributeError` do not, so they are minted here — once (R10.8) —
 * rather than approximated by `RangeError`, whose name would diff.
 *
 * Message text is out of contract (R5.4); the strings below copy
 * CPython's wording for debuggability only.
 *
 * @module query/python-builtins
 * @internal
 */

/**
 * Twin of CPython's `ValueError`.
 *
 * Reached today by `segfilter._convert_date_format`'s 3-way unpack
 * (`segfilter.py:121`) and by `transforms.transform_event`'s
 * `datetime.fromtimestamp` on a NaN or out-of-`datetime`-range
 * timestamp.
 */
export class ValueError extends Error {
  /**
   * Create the twin.
   *
   * @param message - CPython's message text (out of contract, R5.4).
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
 */
export class OverflowError extends Error {
  /**
   * Create the twin.
   *
   * @param message - CPython's message text (out of contract, R5.4).
   */
  constructor(message: string) {
    super(message);
    this.name = "OverflowError";
  }
}

/**
 * Twin of CPython's `AttributeError`.
 *
 * Reached by `segfilter._build_datetime_filter`'s range branch when an
 * element of the two-date list is not a `str`: Python evaluates
 * `date_str.split("-")` and fails with
 * `'int' object has no attribute 'split'` (`segfilter.py:121,247`).
 */
export class AttributeError extends Error {
  /**
   * Create the twin.
   *
   * @param message - CPython's message text (out of contract, R5.4).
   */
  constructor(message: string) {
    super(message);
    this.name = "AttributeError";
  }
}
