/**
 * Plumbing every binding module shares: the `expect.error` adapter for
 * core exceptions, the two guard wrappers, the `validation_errors`
 * output codec and the `[name, binder]` table registrar.
 */

import {
  BookmarkValidationError,
  MixpanelHeadlessError,
  ValidationError,
} from "@mixpanel-headless/core";

import type { CodecRegistry } from "../codecs.js";
import type { ExpectErrorConvertible } from "../internal/guards.js";
import type { JsonValue } from "../json-value.js";
import type { ImplementationRegistry, InvocationContext } from "../runner.js";

/** One bound entry point, before the module's output/error wrapping. */
export type Binder = (context: InvocationContext) => unknown;

/**
 * A binding module's registrations: Python dotted api name → binder.
 *
 * @remarks
 * Tables are introduced by a line comment rather than a doc block: the
 * jsdoc lint rules attribute a doc block on the table constant to every
 * arrow binder inside it and then demand `@param`/`@returns` on each.
 */
export type BindingTable = ReadonlyArray<readonly [string, Binder]>;

/**
 * A ported-library error re-thrown in vector `expect.error` form.
 *
 * Core exceptions cannot implement the runner's
 * {@link ExpectErrorConvertible} themselves (the runner depends on
 * core, never the reverse), so the binding layer wraps any
 * thrown `MixpanelHeadlessError` into this adapter; the runner then
 * diffs `{class, code}` structurally (messages stripped).
 *
 * @example
 * ```ts
 * try {
 *   return zfill(value, width);
 * } catch (error) {
 *   if (error instanceof MixpanelHeadlessError) {
 *     throw new CoreLibraryError(error); // runner diffs toExpectError()
 *   }
 *   throw error;
 * }
 * ```
 */
export class CoreLibraryError extends Error implements ExpectErrorConvertible {
  /** The original core exception. */
  readonly original: MixpanelHeadlessError;

  /**
   * Wrap a core exception.
   *
   * @param original - The thrown `MixpanelHeadlessError`.
   */
  constructor(original: MixpanelHeadlessError) {
    super(original.message, { cause: original });
    this.name = "CoreLibraryError";
    this.original = original;
  }

  /**
   * Encode this error as a vector `expect.error` value.
   *
   * @returns `{class, code}` — the Python exception class name (TS class
   *   names equal the Python ones by construction) and the registry code.
   *   `BookmarkValidationError` additionally carries its `errors[]`
   *   `{path, code, severity}` triples so the facade bypass/build
   *   vectors' `expect.error` comparisons see them.
   */
  toExpectError(): JsonValue {
    if (this.original instanceof BookmarkValidationError) {
      return {
        class: this.original.name,
        code: this.original.code,
        errors: this.original.errors.map((err) => ({
          path: err.path,
          code: err.code,
          severity: err.severity,
        })),
      };
    }
    return { class: this.original.name, code: this.original.code };
  }
}

/**
 * Invoke a library entry point, wrapping coded core errors for the
 * runner and leaving the value as returned (compat/validator outputs
 * are primitives, string arrays, `JsonNumber`s or `ValidationError[]`).
 *
 * @param invoke - Thunk performing the real library call.
 * @returns The thunk's value.
 * @throws CoreLibraryError - When the call raises a core exception.
 * @throws unknown - Anything else, unchanged (a runner/infra bug).
 */
export function guardCompat<T>(invoke: () => T): T {
  try {
    return invoke();
  } catch (error) {
    if (error instanceof MixpanelHeadlessError) {
      throw new CoreLibraryError(error);
    }
    throw error;
  }
}

/**
 * Invoke a core entry point and encode its product for the runner.
 *
 * @param codecs - The codec registry (rich-tag encoders included).
 * @param invoke - Thunk performing the real library call.
 * @returns The vector-JSON encoding of the returned instance.
 * @throws CoreLibraryError - When the call raises a core exception.
 * @throws unknown - Anything else, unchanged (a runner/infra bug).
 * @example
 * ```ts
 * const encoded = runGuarded(codecs, () =>
 *   new Filter(kwargsAsFields<FilterFields>(context)),
 * );
 * ```
 */
export function runGuarded(
  codecs: CodecRegistry,
  invoke: () => unknown,
): JsonValue {
  return guardCompat(() => codecs.encodeValue(invoke()));
}

/**
 * Encode a validator's return exactly like the Python recorder's
 * `validation_errors` output codec
 * (`conformance.record.codecs._encode_validation_errors`): one
 * `{path, code, severity}` object per error, emission order preserved.
 * `message`/`suggestion`/`fix` never enter the encoding — the runner's
 * `diffReturnedValue` does not strip advisory keys from
 * `expect.output`, so serializing them would fail every vector.
 *
 * @param returned - The validator's return value.
 * @returns The structural `[{path, code, severity}]` encoding.
 * @throws TypeError - When the value is not `ValidationError[]` (a
 *   binding wiring bug, mirroring Python's `UnencodableValueError`).
 */
export function encodeValidationErrors(returned: unknown): JsonValue {
  if (
    !Array.isArray(returned) ||
    returned.some((item) => !(item instanceof ValidationError))
  ) {
    throw new TypeError(
      "validation_errors encoding expects ValidationError[] from the validator",
    );
  }
  return returned.map((item: ValidationError) => ({
    path: item.path,
    code: item.code,
    severity: item.severity,
  }));
}

/**
 * Register every `[api, binder]` row of a table, each wrapped by the
 * module's output/error adapter.
 *
 * @param implementations - The registry to extend.
 * @param table - The module's bindings.
 * @param wrap - Adapter applied around each binder (output encoding +
 *   error wrapping); identity when the binder already returns
 *   vector-JSON.
 * @example
 * ```ts
 * registerTable(
 *   implementations,
 *   COMPAT_BINDINGS,
 *   (binder) => (context) => guardCompat(() => binder(context)),
 * );
 * ```
 */
export function registerTable(
  implementations: ImplementationRegistry,
  table: BindingTable,
  wrap: (binder: Binder) => Binder = (binder) => binder,
): void {
  for (const [api, binder] of table) {
    implementations.register(api, wrap(binder));
  }
}
