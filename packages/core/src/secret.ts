/**
 * Secret wrapper, the port of Pydantic's `SecretStr`.
 *
 * Every serialization/stringification surface renders the fixed Pydantic
 * redaction literal (`'**********'`, exactly ten asterisks) so that any
 * string that does leak into a serialized bag diffs identically against
 * Python's output. The wrapped value is only reachable through the explicit
 * {@link Secret.reveal} call.
 *
 * The backing store is an ECMAScript `#private` field: invisible to
 * `JSON.stringify`, `Object.keys`, spread, and structured logging. The Node
 * inspect hook is registered via `Symbol.for` so this module stays free of
 * `node:*` imports — browsers simply never look the symbol up.
 */

/** Pydantic's exact redaction literal: ten asterisks. */
const REDACTION = "**********";

/** Node's `util.inspect` hook key, via `Symbol.for` (no `node:util`). */
const INSPECT_CUSTOM: unique symbol = Symbol.for("nodejs.util.inspect.custom");

/**
 * Opaque wrapper around a sensitive string (service-account secrets, OAuth
 * bearer/refresh tokens).
 *
 * Mirrors Pydantic `SecretStr`: construction stores the raw value privately;
 * `toString()`/`toJSON()`/inspect all render `'**********'`; the raw value
 * is available only via {@link reveal}. No runtime freeze is applied.
 *
 * Example:
 * ```ts
 * const s = new Secret("hunter2");
 * String(s);          // "**********"
 * JSON.stringify(s);  // "\"**********\""
 * s.reveal();         // "hunter2"
 * ```
 */
export class Secret {
  /** The wrapped sensitive value — unreachable except via {@link reveal}. */
  readonly #value: string;

  /**
   * Wrap a sensitive string.
   *
   * @param value - The raw secret to protect.
   */
  constructor(value: string) {
    this.#value = value;
  }

  /**
   * Return the raw wrapped value.
   *
   * This is the ONLY accessor that exposes the secret; call sites must be
   * deliberate (auth-header construction, codec encode).
   *
   * @returns The raw secret string exactly as constructed.
   */
  reveal(): string {
    return this.#value;
  }

  /**
   * Render the redaction mask for string contexts.
   *
   * @returns The literal `'**********'` (never the wrapped value).
   */
  toString(): string {
    return REDACTION;
  }

  /**
   * Render the redaction mask for `JSON.stringify`.
   *
   * @returns The literal `'**********'` (never the wrapped value).
   */
  toJSON(): string {
    return REDACTION;
  }
}

// Render the redaction mask for Node's `util.inspect` / `console.log`.
// Registered via `Symbol.for('nodejs.util.inspect.custom')` so no
// `node:util` import is needed; non-Node runtimes ignore it.
// Installed on the prototype (with a class method's attributes) rather
// than declared in the class body: `isolatedDeclarations` only accepts
// well-known `Symbol.*` computed names, and the method was never part of
// the emitted declaration anyway. Returns the literal `'**********'`.
Object.defineProperty(Secret.prototype, INSPECT_CUSTOM, {
  value: function inspect(this: Secret): string {
    return REDACTION;
  },
  writable: true,
  enumerable: false,
  configurable: true,
});
