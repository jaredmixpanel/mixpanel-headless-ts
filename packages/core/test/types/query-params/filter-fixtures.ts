// Shared fixtures for the query-param guard suites: the legal guard-code
// domain and the exact `{class, code}` guard assertion. TS-only test support.
import { expect } from "vitest";

import {
  CODED_GUARD_REGISTRY,
  CODED_GUARD_TWIN_CODES,
  type MixpanelHeadlessError,
} from "../../../src/errors.js";

/** Every code a query-param guard may legally raise (the guard-totality domain). */
export const LEGAL_CODES: ReadonlySet<string> = new Set([
  ...CODED_GUARD_REGISTRY,
  ...CODED_GUARD_TWIN_CODES,
]);

/**
 * Assert a thunk throws the exact guard `{class, code}` pair.
 *
 * @param thunk - The construction under test.
 * @param cls - Expected error class.
 * @param code - Expected registry code.
 */
export function expectGuard(
  thunk: () => unknown,
  cls: typeof MixpanelHeadlessError,
  code: string,
): void {
  let thrown: unknown;
  try {
    thunk();
  } catch (error) {
    thrown = error;
  }
  expect(thrown, `expected ${code}`).toBeInstanceOf(cls);
  expect((thrown as MixpanelHeadlessError).code).toBe(code);
  expect(LEGAL_CODES.has(code), `${code} in registry/twins`).toBe(true);
}
