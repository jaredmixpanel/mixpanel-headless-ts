// fast-check property #2 (phase2-design C9): Account-union
// exhaustiveness. For arbitrary VALID variant payloads, `parseAccount`
// narrows to exactly one `type` and the canonical switch handles it —
// the property instruments a visited-arm set and asserts the `never`
// default arm is unreachable.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  ACCOUNT_TYPE_VALUES,
  isLongLived,
  parseAccount,
  type Account,
  type AccountType,
} from "../../src/auth/account.js";
import { ResponseValidationError } from "../../src/errors.js";

/** Characters allowed by the Python name pattern `^[a-zA-Z0-9_-]+$`. */
const NAME_ALPHABET =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-";

/** Arbitrary valid account name (1-64 chars from the allowed set). */
const nameArb = fc
  .array(fc.integer({ min: 0, max: NAME_ALPHABET.length - 1 }), {
    minLength: 1,
    maxLength: 64,
  })
  .map((indexes) => indexes.map((i) => NAME_ALPHABET[i] ?? "a").join(""));

/** Arbitrary region literal. */
const regionArb = fc.constantFrom("us", "eu", "in");

/** Arbitrary digits-only project id, explicit null, or ABSENT. */
const defaultProjectArb = fc.oneof(
  fc.constant(undefined),
  fc.constant(null),
  fc
    .array(fc.integer({ min: 0, max: 9 }), { minLength: 1, maxLength: 12 })
    .map((digits) => digits.join("")),
);

/** Base fields shared by every variant payload. */
const baseArb = fc.record({
  name: nameArb,
  region: regionArb,
  default_project: defaultProjectArb,
});

/**
 * Drop `undefined`-valued keys so "absent" really means absent (the
 * parse factories distinguish absent from explicit null, R3.9).
 *
 * @param record - A candidate payload with possible undefined values.
 * @returns The same payload without the undefined-valued keys.
 */
function dropAbsent(
  record: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined),
  );
}

/** Arbitrary VALID payload for any of the three variants. */
const validPayloadArb = fc.oneof(
  fc
    .tuple(baseArb, fc.string({ minLength: 1 }), fc.string())
    .map(([base, username, secret]) =>
      dropAbsent({ ...base, type: "service_account", username, secret }),
    ),
  baseArb.map((base) => dropAbsent({ ...base, type: "oauth_browser" })),
  fc
    .tuple(baseArb, fc.boolean(), fc.string({ minLength: 1 }))
    .map(([base, inline, credential]) =>
      dropAbsent({
        ...base,
        type: "oauth_token",
        ...(inline ? { token: credential } : { token_env: credential }),
      }),
    ),
);

describe("fast-check #2 — Account union exhaustiveness", () => {
  it("parseAccount narrows every valid payload to exactly one arm", () => {
    fc.assert(
      fc.property(validPayloadArb, (payload) => {
        const account = parseAccount(payload);
        const visited: AccountType[] = [];
        switch (account.type) {
          case "service_account":
            visited.push(account.type);
            break;
          case "oauth_browser":
            visited.push(account.type);
            break;
          case "oauth_token":
            visited.push(account.type);
            break;
          default: {
            const exhaustive: never = account;
            throw new Error(
              `unreachable arm visited: ${JSON.stringify(exhaustive)}`,
            );
          }
        }
        // Exactly one arm ran, it matches the payload discriminator,
        // and it is one of the three declared variants.
        expect(visited).toHaveLength(1);
        expect(visited[0]).toBe(payload["type"]);
        expect(ACCOUNT_TYPE_VALUES).toContain(visited[0]);
        // The free functions accept every narrowed variant (their own
        // never-default arms did not fire).
        expect(typeof isLongLived(account)).toBe("boolean");
      }),
      { numRuns: 200 },
    );
  });

  it("rejects any payload whose discriminator is not a declared variant", () => {
    const badTypeArb = fc
      .string()
      .filter(
        (value) => !(ACCOUNT_TYPE_VALUES as readonly string[]).includes(value),
      );
    fc.assert(
      fc.property(baseArb, badTypeArb, (base, type) => {
        expect(() => parseAccount(dropAbsent({ ...base, type }))).toThrow(
          ResponseValidationError,
        );
      }),
      { numRuns: 100 },
    );
  });

  it("round-trips the discriminator: parse output is assignable to Account", () => {
    fc.assert(
      fc.property(validPayloadArb, (payload) => {
        const account: Account = parseAccount(payload);
        expect(account.name).toBe(payload["name"]);
        expect(account.region).toBe(payload["region"]);
      }),
      { numRuns: 100 },
    );
  });
});
