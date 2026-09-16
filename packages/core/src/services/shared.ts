/**
 * Helpers shared across the service and wire-method modules: the
 * Python-truthiness guards the `MixpanelAPIClient` ports apply to
 * optional kwargs, `type(x).__name__` for message text, `dict.get`, the
 * scoped-path builder every entity factory uses, and the untyped
 * passthrough the result parsers rely on.
 *
 * Wire-shape guards specific to the entity CRUD factories
 * (`expectRecordResult`, `joinIds`, …) stay in `entities/shared.ts`.
 *
 * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.maybe_scoped_path
 */

import type { ClientCore } from "../client/core.js";
import { JsonNumber } from "../client/json-value.js";
import { maybeScopedPath } from "../client/scope.js";

/**
 * Build the App API path for `domainPath` under the client's current
 * project or workspace pin.
 *
 * @remarks
 * The pin is read at call time, so a `use()` swap re-scopes the next
 * request without rebuilding the method factories.
 * @param core - The shared client internals seam.
 * @param domainPath - The path under the project / workspace prefix.
 * @returns `/workspaces/{wid}/{domainPath}` when a workspace is pinned,
 *   otherwise `/projects/{pid}/{domainPath}`.
 * @example
 * ```typescript
 * scopedPath(core, "dashboards/");
 * // "/projects/12345/dashboards/" (no workspace pinned)
 * ```
 * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.maybe_scoped_path
 */
export function scopedPath(core: ClientCore, domainPath: string): string {
  return maybeScopedPath(domainPath, {
    projectId: core.projectId(),
    workspaceId: core.workspaceId(),
  });
}

/**
 * Return whether Python would take an `if value:` branch for an optional
 * string.
 *
 * @param value - The optional string.
 * @returns `true` for a non-empty string; `false` for `""`, `null` and
 *   `undefined`.
 * @example
 * ```typescript
 * truthyStr("where"); // true
 * truthyStr(""); // false
 * ```
 */
export function truthyStr(value: string | null | undefined): value is string {
  return value !== undefined && value !== null && value !== "";
}

/**
 * Return whether Python would take an `if value:` branch for an optional
 * list.
 *
 * @param value - The optional list.
 * @returns `true` for a non-empty list; `false` for `[]`, `null` and
 *   `undefined`.
 * @example
 * ```typescript
 * truthyList([1]); // true
 * truthyList([]); // false
 * ```
 */
export function truthyList(
  value: readonly unknown[] | null | undefined,
): boolean {
  return value !== undefined && value !== null && value.length > 0;
}

/**
 * Return whether an optional value is present (Python `is not None`).
 *
 * @param value - The optional value.
 * @returns `true` unless the value is `null` or `undefined`; `0`, `""`
 *   and `false` count as present.
 * @example
 * ```typescript
 * isSet(0); // true
 * isSet(null); // false
 * ```
 */
export function isSet<T>(value: T | null | undefined): value is T {
  return value !== undefined && value !== null;
}

/**
 * Return CPython's `type(x).__name__` for a parsed wire value or its
 * native (`json.loads`) product.
 *
 * @remarks
 * Used only in error-message text, which is outside the port's
 * contract; any non-array object reports `"dict"`.
 * @param value - The value.
 * @returns The CPython type name.
 * @example
 * ```typescript
 * pythonTypeNameOf(null); // "NoneType"
 * pythonTypeNameOf([1, 2]); // "list"
 * ```
 */
export function pythonTypeNameOf(value: unknown): string {
  if (value === null) {
    return "NoneType";
  }
  if (typeof value === "boolean") {
    return "bool";
  }
  if (typeof value === "string") {
    return "str";
  }
  if (typeof value === "bigint") {
    return "int";
  }
  if (value instanceof JsonNumber) {
    return value.isIntegerToken() ? "int" : "float";
  }
  if (typeof value === "number") {
    return Number.isInteger(value) ? "int" : "float";
  }
  if (Array.isArray(value)) {
    return "list";
  }
  return "dict";
}

/**
 * Hand an unvalidated API value to a result field at its declared type.
 *
 * @remarks
 * The Python parsers and transforms are pure passthroughs — they never
 * validate — so re-typing here (rather than running a guard) is what
 * keeps the TS behavior identical: a malformed row builds a malformed
 * result object in both languages instead of raising in one.
 * @param value - The raw API value.
 * @returns The same value at the declared field type.
 * @example
 * ```typescript
 * const name: string = passthrough(row["name"]);
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- a deliberate cast-in-disguise: T is inferred from the declared field type at each call site (see the docstring)
export function passthrough<T>(value: unknown): T {
  return value as T;
}
