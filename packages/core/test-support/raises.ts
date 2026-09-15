// `pytest.raises(...)` twins for the vitest suites: each runs the body,
// hands back whatever it threw and fails the test when nothing was thrown,
// so assertions on the captured error sit after the call rather than inside
// a `catch` (where `vitest/no-conditional-expect` would flag them and an
// unexpected success would silently skip them).
import { expect } from "vitest";

import { ParamValidationError } from "../src/errors.js";

/**
 * Run `body` and return what it threw.
 *
 * @param body - The call expected to throw synchronously.
 * @param what - Failure text when nothing is thrown.
 * @returns The thrown value, for `toBeInstanceOf` / `.code` assertions.
 */
export function expectThrows(
  body: () => unknown,
  what = "expected a throw",
): unknown {
  try {
    body();
  } catch (error) {
    return error;
  }
  return expect.unreachable(what);
}

/**
 * Await `body` (a promise, or a thunk producing one — the thunk form
 * covers `for await` consumption of a stream) and return its rejection.
 *
 * @param body - The promise or async thunk expected to reject.
 * @param what - Failure text when the body settles successfully.
 * @returns The rejection value, for `toBeInstanceOf` / `.code` assertions.
 */
export async function expectRejects(
  body: Promise<unknown> | (() => Promise<unknown>),
  what = "expected a rejection",
): Promise<unknown> {
  try {
    await (typeof body === "function" ? body() : body);
  } catch (error) {
    return error;
  }
  return expect.unreachable(what);
}

/**
 * Assert that `thunk` throws a `ParamValidationError` carrying `code`
 * (the `pytest.raises(ParamValidationError)` + `exc.code` pair the
 * query-param guard suites repeat).
 *
 * @param thunk - The call expected to throw.
 * @param code - The expected error code.
 */
export function expectGuard(thunk: () => unknown, code: string): void {
  const thrown = expectThrows(thunk, `expected ${code}`);
  expect(thrown, `expected ${code}`).toBeInstanceOf(ParamValidationError);
  expect((thrown as ParamValidationError).code).toBe(code);
}
