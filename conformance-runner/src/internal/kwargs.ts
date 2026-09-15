/**
 * `InvocationContext.kwargs` accessors shared by every binding module.
 *
 * The runner hands each binding the decoded Python kwargs as an untyped
 * bag; these readers are the one place the bag is narrowed. A binding
 * that reads a kwarg by name states the type it expects (`kwarg` /
 * `optionalKwarg`), a binding that forwards the whole bag to a
 * dataclass constructor says so once (`kwargsAsFields`) instead of
 * casting at every site.
 */

import type { InvocationContext } from "../runner.js";
import type { Guard } from "./guards.js";

/**
 * Read a required kwarg, throwing a descriptive error when absent.
 *
 * @param context - The invocation context.
 * @param name - The Python kwarg name.
 * @returns The decoded kwarg value.
 * @throws Error - When the kwarg is missing from `call.input`.
 * @example
 * ```ts
 * const filter: unknown = requireKwarg(context, "filter");
 * // throws Error when call.input has no "filter" key
 * ```
 */
export function requireKwarg(
  context: InvocationContext,
  name: string,
): unknown {
  if (!Object.hasOwn(context.kwargs, name)) {
    throw new Error(
      `${context.api}: vector call.input is missing required kwarg ${JSON.stringify(name)}`,
    );
  }
  return context.kwargs[name];
}

/**
 * Read a required kwarg and check its decoded type.
 *
 * @param context - The invocation context.
 * @param name - The Python kwarg name.
 * @param guard - The expected shape.
 * @param expected - Human-readable type name for the error message.
 * @returns The narrowed value.
 * @throws Error - When the kwarg is missing from `call.input`.
 * @throws TypeError - When the kwarg fails `guard` (a corpus bug — the
 *   reference wrappers are typed).
 * @example
 * ```ts
 * const method = kwarg(context, "method", isString, "str");
 * const requests = kwarg(context, "requests", isArrayOf(isPlainObject), "list[dict]");
 * ```
 */
export function kwarg<T>(
  context: InvocationContext,
  name: string,
  guard: Guard<T>,
  expected: string,
): T {
  const value = requireKwarg(context, name);
  if (!guard(value)) {
    throw new TypeError(
      `${context.api} expects ${name}: ${expected} per the Python reference`,
    );
  }
  return value;
}

/**
 * Read an optional kwarg and check its decoded type when present.
 *
 * Absent stays absent (`undefined`) so the TS default applies exactly
 * like the Python kwonly default.
 *
 * @param context - The invocation context.
 * @param name - The Python kwarg name.
 * @param guard - The expected shape.
 * @param expected - Human-readable type name for the error message.
 * @returns The narrowed value, or `undefined` when absent.
 * @throws TypeError - When present but failing `guard`.
 * @example
 * ```ts
 * const limit = optionalKwarg(context, "limit", isNumber, "int");
 * // number when call.input carries "limit", otherwise undefined
 * ```
 */
export function optionalKwarg<T>(
  context: InvocationContext,
  name: string,
  guard: Guard<T>,
  expected: string,
): T | undefined {
  if (!Object.hasOwn(context.kwargs, name)) {
    return undefined;
  }
  return kwarg(context, name, guard, expected);
}

/**
 * Copy the present members of `call.input` into an options bag under
 * the same Python kwarg names (absent stays absent).
 *
 * @param context - The invocation context.
 * @param names - The kwarg names the method accepts.
 * @returns The options bag.
 * @example
 * ```ts
 * const options = kwargBag(context, ["from_date", "to_date", "unit"]);
 * // { from_date: "2026-01-01", unit: "day" } when to_date was not recorded
 * ```
 */
export function kwargBag(
  context: InvocationContext,
  names: readonly string[],
): Record<string, unknown> {
  const bag: Record<string, unknown> = {};
  for (const name of names) {
    if (Object.hasOwn(context.kwargs, name)) {
      bag[name] = context.kwargs[name];
    }
  }
  return bag;
}

/**
 * Hand the whole decoded kwarg bag to a dataclass constructor as its
 * field bag — the `Cls(**decoded)` replay.
 *
 * Deliberately unchecked: the constructor's own guards must fire on a
 * malformed bag exactly where Python's `__post_init__` does (the
 * guard-failure vectors depend on it), so no shape check belongs here —
 * the call site names the field type and this is the one cast.
 *
 * @param context - The invocation context.
 * @returns The bag typed as the constructor's field bag.
 * @example
 * ```typescript
 * new Filter(kwargsAsFields<FilterFields>(context));
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- F is the destination field type the call site names explicitly; nothing in the signature can constrain it (see doc)
export function kwargsAsFields<F>(context: InvocationContext): F {
  return context.kwargs as unknown as F;
}

/**
 * Extract the injected replay fetch from a wire invocation context.
 *
 * @param context - The invocation context.
 * @returns The `VectorFetch` seam.
 * @throws Error - When invoked without a fetch (a builder-kind vector
 *   reaching a wire binding is a corpus or registry bug).
 */
export function requireFetch(context: InvocationContext): typeof fetch {
  if (context.fetch === undefined) {
    throw new Error(
      `${context.api}: wire binding invoked without an injected fetch`,
    );
  }
  return context.fetch;
}

/**
 * Read a required kwarg and forward it under the type the library
 * entry point declares, without checking it.
 *
 * This is the typed twin of Python calling the real function with the
 * recorded kwargs: a value the corpus recorded as deliberately wrong
 * (an unknown `quantifier`, a bogus `operator`) must reach the library
 * so its guard raises — a binding-side check would turn a recorded
 * `ValidationError` into a rig `TypeError`. Use {@link kwarg} instead
 * wherever the binding itself interprets the value.
 *
 * @param context - The invocation context.
 * @param name - The Python kwarg name.
 * @returns The value, typed as the callee's parameter.
 * @throws Error - When the kwarg is missing from `call.input`.
 * @example
 * ```ts
 * const property = kwargAs<PropertySpec>(context, "property");
 * const date = kwargAs<string>(context, "date");
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- T is the callee's parameter type the call site names explicitly; the pass-through is unchecked by design (see doc)
export function kwargAs<T>(context: InvocationContext, name: string): T {
  return requireKwarg(context, name) as T;
}

/**
 * {@link kwargAs} for an optional kwarg: absent stays `undefined` so
 * the TS default applies exactly like the Python kwonly default.
 *
 * @param context - The invocation context.
 * @param name - The Python kwarg name.
 * @returns The value typed as the callee's parameter, or `undefined`.
 * @example
 * ```ts
 * const resourceType = optionalKwargAs<"events" | "people">(context, "resource_type");
 * // undefined when call.input omits it, so the TS default applies
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- T is the callee's parameter type the call site names explicitly; the pass-through is unchecked by design (see doc)
export function optionalKwargAs<T>(
  context: InvocationContext,
  name: string,
): T | undefined {
  return Object.hasOwn(context.kwargs, name)
    ? (context.kwargs[name] as T)
    : undefined;
}
