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
 * `self.maybe_scoped_path(...)` over the client's current pin — read at
 * call time, so a `use()` swap re-scopes the next request.
 *
 * @param core - The shared client internals seam.
 * @param domainPath - The path under the project / workspace prefix.
 * @returns The scoped App API path.
 */
export function scopedPath(core: ClientCore, domainPath: string): string {
  return maybeScopedPath(domainPath, {
    projectId: core.projectId(),
    workspaceId: core.workspaceId(),
  });
}

/**
 * Python truthiness for optional strings (`if where:` guards).
 *
 * @param value - The optional string.
 * @returns Whether Python would take the branch.
 */
export function truthyStr(value: string | null | undefined): value is string {
  return value !== undefined && value !== null && value !== "";
}

/**
 * Python truthiness for optional lists (`if ids:` guards).
 *
 * @param value - The optional list.
 * @returns Whether Python would take the branch.
 */
export function truthyList(
  value: readonly unknown[] | null | undefined,
): boolean {
  return value !== undefined && value !== null && value.length > 0;
}

/**
 * Absent-or-None check (`is not None` guards).
 *
 * @param value - The optional value.
 * @returns Whether a value is present.
 */
export function isSet<T>(value: T | null | undefined): value is T {
  return value !== undefined && value !== null;
}

/**
 * Python `type(x).__name__` over a parsed wire value or its native
 * (`json.loads`) product — message text only, out of contract.
 *
 * @param value - The value.
 * @returns The CPython type name.
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
 * Hand an unvalidated API value to a result field.
 *
 * The Python parsers and transforms are pure passthroughs — they never
 * validate — so re-typing here (rather than running a guard) is what
 * keeps the TS behaviour identical: a malformed row builds a malformed
 * result object in both languages instead of raising in one.
 *
 * @param value - The raw API value.
 * @returns The same value at the declared field type.
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- a deliberate cast-in-disguise: T is inferred from the declared field type at each call site (see the docstring)
export function passthrough<T>(value: unknown): T {
  return value as T;
}
