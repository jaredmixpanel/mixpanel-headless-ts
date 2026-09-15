// Layer-3 translation of `tests/unit/test_042_edge_cases.py::
// TestAccountNameBoundaries` and
// `::TestOAuthTokenValidatorUnderCopy` — B7-A2 packet §2.4
// (B6 ledger `b6-packets.md:1032` inbound deferral).
//
// Mechanism substitutions (header-cited per R10.2 / packet §2.4):
// - Pydantic `ValidationError` at construction translates to the parse
//   factory's `ResponseValidationError` (the Phase-2 default boundary,
//   `auth/account.ts`).
// - `model_copy(update=..., deep=True)` translates to object spread —
//   the packet pin: copy does NOT re-validate; the TS twin pins
//   spread behavior over the frozen parse-once model.
// - `TypeAdapter(Account).validate_python(payload)` translates to
//   `parseAccount(payload)` (the discriminated-union re-validation
//   escape hatch).
import { describe, expect, it } from "vitest";

import {
  type OAuthTokenAccount,
  parseAccount,
} from "../../src/auth/account.js";
import { ResponseValidationError } from "../../src/errors.js";
import { Secret } from "../../src/secret.js";

describe("Account name boundaries", () => {
  // python: TestAccountNameBoundaries
  it("account name 64 chars passes", () => {
    // python: test_account_name_64_chars_passes
    const sa = parseAccount({
      type: "service_account",
      name: "a".repeat(64),
      region: "us",
      username: "u",
      secret: "s",
    });
    expect(sa.name).toHaveLength(64);
  });

  it("account name 65 chars fails", () => {
    // python: test_account_name_65_chars_fails
    expect(() =>
      parseAccount({
        type: "service_account",
        name: "a".repeat(65),
        region: "us",
        username: "u",
        secret: "s",
      }),
    ).toThrow(ResponseValidationError);
  });

  it.each([
    ["team space"], // space
    ["team.dot"], // dot
    ["team/slash"], // slash
    ["team\nnewline"], // newline
    ["team\x00null"], // null byte
    ["team\x7Fdel"], // DEL char
    ["teaméaccent"], // accented char
    ["team😀emoji"], // emoji
    ["team\ttab"], // tab
  ])("account name rejects exotic chars[%j]", (name) => {
    // python: test_account_name_rejects_exotic_chars
    // Pattern allows only [a-zA-Z0-9_-]; everything else raises.
    expect(() =>
      parseAccount({
        type: "service_account",
        name,
        region: "us",
        username: "u",
        secret: "s",
      }),
    ).toThrow(ResponseValidationError);
  });
});

describe("OAuth token validator under copy", () => {
  // python: TestOAuthTokenValidatorUnderCopy
  it("model copy setting both does not revalidate", () => {
    // python: test_model_copy_setting_both_does_not_revalidate
    // `model_copy(update=...)` bypasses the XOR validator (Pydantic
    // limitation); the TS twin: object spread over the parse-once
    // model never re-fires parseAccount's guard.
    const original = parseAccount({
      type: "oauth_token",
      name: "ci",
      region: "us",
      token: new Secret("inline-tok"),
    }) as OAuthTokenAccount;
    const bad: OAuthTokenAccount = { ...original, token_env: "MY_ENV" };
    // Both fields are now set — the XOR validator never re-fired.
    expect(bad.token).not.toBeNull();
    expect(bad.token).toBeDefined();
    expect(bad.token_env).toBe("MY_ENV");
  });

  it("validate python round trip enforces xor", () => {
    // python: test_validate_python_round_trip_enforces_xor
    // The escape hatch: round-tripping via the parse factory
    // re-validates (the TypeAdapter.validate_python twin).
    const original = parseAccount({
      type: "oauth_token",
      name: "ci",
      region: "us",
      token: new Secret("inline-tok"),
    }) as OAuthTokenAccount;
    const badPayload = { ...original, token_env: "MY_ENV" };
    expect(() => parseAccount(badPayload)).toThrow(ResponseValidationError);
  });
});
