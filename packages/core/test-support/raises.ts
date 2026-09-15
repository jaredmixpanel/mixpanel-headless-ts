// `pytest.raises(...)` twins for the vitest suites.
//
// Each runs the body, hands back whatever it threw, and fails the test
// when nothing was thrown — so the assertions on the captured error sit
// after the call rather than inside a `catch` block (which is what
// `vitest/no-conditional-expect` forbids: an `expect` inside `catch`
// silently never runs when the body unexpectedly succeeds).
import { expect } from "vitest";

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
