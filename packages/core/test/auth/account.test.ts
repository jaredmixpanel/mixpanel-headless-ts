// The Account discriminated union, its parse factory and free functions.
// The parse guards replicate the Pydantic invariants of
// `_internal/auth/account.py`: extra='forbid', name pattern/length,
// digits-only default_project, exactly-one-of token/token_env,
// discriminator dispatch. TS unit tests; no Python suite is mirrored.

import { describe, expect, it } from "vitest";

import {
  type Account,
  accountAuthHeader,
  isLongLived,
  type OAuthTokenAccount,
  parseAccount,
  type TokenResolver,
} from "../../src/auth/account.js";
import {
  ParamTypeError,
  ParamValidationError,
  ResponseValidationError,
} from "../../src/errors.js";
import { Secret } from "../../src/secret.js";

/** A minimal valid service-account payload (Python docstring example). */
const SA_PAYLOAD = {
  type: "service_account",
  name: "team",
  region: "us",
  username: "sa.user",
  secret: "hunter2",
} as const;

/** A resolver returning fixed tokens for both OAuth variants. */
const FAKE_RESOLVER: TokenResolver = {
  /**
   * Return a fixed browser token.
   *
   * @returns The literal `browser-token`.
   */
  getBrowserToken: () => Promise.resolve("browser-token"),
  /**
   * Return a fixed static token.
   *
   * @returns The literal `static-token`.
   */
  getStaticToken: () => Promise.resolve("static-token"),
};

describe("parseAccount — variant dispatch", () => {
  it("parses a service account and wraps the raw secret string", () => {
    const account = parseAccount(SA_PAYLOAD);
    expect(account.type).toBe("service_account");
    if (account.type !== "service_account") {
      throw new Error("unreachable");
    }
    expect(account.name).toBe("team");
    expect(account.region).toBe("us");
    expect(account.username).toBe("sa.user");
    expect(account.secret).toBeInstanceOf(Secret);
    expect(account.secret.reveal()).toBe("hunter2");
    // default_project omitted -> key ABSENT (absent-vs-null).
    expect(Object.hasOwn(account, "default_project")).toBe(false);
  });

  it("parses an oauth_browser account (no credential fields)", () => {
    const account = parseAccount({
      type: "oauth_browser",
      name: "me",
      region: "eu",
      default_project: "3713224",
    });
    expect(account.type).toBe("oauth_browser");
    expect(account.default_project).toBe("3713224");
  });

  it("parses oauth_token with inline token XOR token_env", () => {
    const inline = parseAccount({
      type: "oauth_token",
      name: "ci",
      region: "us",
      token: "xyz",
    }) as OAuthTokenAccount;
    expect(inline.token).toBeInstanceOf(Secret);
    expect(inline.token?.reveal()).toBe("xyz");
    const env = parseAccount({
      type: "oauth_token",
      name: "agent",
      region: "in",
      token_env: "MP_OAUTH_TOKEN",
    }) as OAuthTokenAccount;
    expect(env.token_env).toBe("MP_OAUTH_TOKEN");
  });

  it("passes an existing Secret instance through unwrapped", () => {
    const secret = new Secret("s3cr3t");
    const account = parseAccount({ ...SA_PAYLOAD, secret });
    if (account.type !== "service_account") {
      throw new Error("unreachable");
    }
    expect(account.secret).toBe(secret);
  });

  it("rejects unknown/missing discriminators", () => {
    expect(() => parseAccount({ ...SA_PAYLOAD, type: "sso" })).toThrow(
      ResponseValidationError,
    );
    expect(() => parseAccount({ name: "x", region: "us" })).toThrow(
      ResponseValidationError,
    );
    expect(() => parseAccount(null)).toThrow(ResponseValidationError);
    expect(() => parseAccount([SA_PAYLOAD])).toThrow(ResponseValidationError);
  });
});

describe("parseAccount — Pydantic invariants (coded guards)", () => {
  it("enforces extra='forbid' per variant", () => {
    expect(() => parseAccount({ ...SA_PAYLOAD, surprise: 1 })).toThrow(
      ResponseValidationError,
    );
    // `username` is NOT a declared oauth_browser field.
    expect(() =>
      parseAccount({
        type: "oauth_browser",
        name: "me",
        region: "us",
        username: "sa.user",
      }),
    ).toThrow(ResponseValidationError);
  });

  it("enforces the name pattern ^[a-zA-Z0-9_-]+$ and 1-64 length", () => {
    for (const bad of ["", "has space", "Ü", "a".repeat(65), "dot.name"]) {
      expect(() => parseAccount({ ...SA_PAYLOAD, name: bad })).toThrow(
        ResponseValidationError,
      );
    }
    const max = parseAccount({ ...SA_PAYLOAD, name: "a".repeat(64) });
    expect(max.name).toHaveLength(64);
    expect(() => parseAccount({ ...SA_PAYLOAD, name: 42 })).toThrow(
      ResponseValidationError,
    );
  });

  it("enforces region membership", () => {
    expect(() => parseAccount({ ...SA_PAYLOAD, region: "ap" })).toThrow(
      ResponseValidationError,
    );
  });

  it("enforces digits-only default_project, preserving explicit null", () => {
    expect(() =>
      parseAccount({ ...SA_PAYLOAD, default_project: "12a" }),
    ).toThrow(ResponseValidationError);
    expect(() => parseAccount({ ...SA_PAYLOAD, default_project: "" })).toThrow(
      ResponseValidationError,
    );
    const withNull = parseAccount({ ...SA_PAYLOAD, default_project: null });
    expect(withNull.default_project).toBeNull();
    const withId = parseAccount({ ...SA_PAYLOAD, default_project: "3018488" });
    expect(withId.default_project).toBe("3018488");
  });

  it("requires a non-empty username and a secret for service accounts", () => {
    expect(() => parseAccount({ ...SA_PAYLOAD, username: "" })).toThrow(
      ResponseValidationError,
    );
    const noSecret: Record<string, unknown> = { ...SA_PAYLOAD };
    delete noSecret["secret"];
    expect(() => parseAccount(noSecret)).toThrow(ResponseValidationError);
  });

  it("enforces exactly-one-of token/token_env (both null counts as unset)", () => {
    const base = { type: "oauth_token", name: "ci", region: "us" };
    expect(() => parseAccount(base)).toThrow(ResponseValidationError);
    expect(() => parseAccount({ ...base, token: "x", token_env: "E" })).toThrow(
      ResponseValidationError,
    );
    // Python checks `is not None` — explicit nulls count as unset.
    expect(() =>
      parseAccount({ ...base, token: null, token_env: null }),
    ).toThrow(ResponseValidationError);
    const ok = parseAccount({ ...base, token: null, token_env: "E" });
    expect(ok.type).toBe("oauth_token");
  });

  it("throws ParamValidationError at the 'param' boundary", () => {
    expect(() =>
      parseAccount({ ...SA_PAYLOAD, name: "" }, { boundary: "param" }),
    ).toThrow(ParamValidationError);
    let caught: unknown;
    try {
      parseAccount({ ...SA_PAYLOAD, name: "" }, { boundary: "param" });
    } catch (error) {
      caught = error;
    }
    expect((caught as ParamValidationError).code).toBe("VALIDATION_ERROR");
  });

  it("uses the generic RESPONSE_VALIDATION_ERROR code by default", () => {
    let caught: unknown;
    try {
      parseAccount({ ...SA_PAYLOAD, extra_key: true });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ResponseValidationError);
    expect((caught as ResponseValidationError).code).toBe(
      "RESPONSE_VALIDATION_ERROR",
    );
  });
});

describe("accountAuthHeader / isLongLived (exhaustive free functions)", () => {
  it("builds the Basic header exactly as Python's docstring example", async () => {
    const account = parseAccount(SA_PAYLOAD);
    // ServiceAccount ignores the resolver (signature parity with Python).
    await expect(accountAuthHeader(account, {})).resolves.toBe(
      "Basic c2EudXNlcjpodW50ZXIy",
    );
  });

  it("UTF-8 encodes non-ASCII credentials before base64", async () => {
    const account = parseAccount({
      ...SA_PAYLOAD,
      username: "sa.ünïcode",
      secret: "påss",
    });
    // Python: base64.b64encode("sa.ünïcode:påss".encode()).decode()
    await expect(accountAuthHeader(account, {})).resolves.toBe(
      "Basic c2Euw7xuw69jb2RlOnDDpXNz",
    );
  });

  it("builds Bearer headers through the resolver for OAuth variants", async () => {
    const browser = parseAccount({
      type: "oauth_browser",
      name: "me",
      region: "us",
    });
    await expect(
      accountAuthHeader(browser, { tokenResolver: FAKE_RESOLVER }),
    ).resolves.toBe("Bearer browser-token");
    const token = parseAccount({
      type: "oauth_token",
      name: "ci",
      region: "us",
      token: "xyz",
    });
    await expect(
      accountAuthHeader(token, { tokenResolver: FAKE_RESOLVER }),
    ).resolves.toBe("Bearer static-token");
  });

  it("requires a resolver for OAuth variants (Python TypeError twin)", async () => {
    const browser = parseAccount({
      type: "oauth_browser",
      name: "me",
      region: "us",
    });
    await expect(accountAuthHeader(browser, {})).rejects.toThrow(
      ParamTypeError,
    );
  });

  it("reports long-lived-ness per variant", () => {
    expect(isLongLived(parseAccount(SA_PAYLOAD))).toBe(true);
    expect(
      isLongLived(
        parseAccount({ type: "oauth_browser", name: "m", region: "us" }),
      ),
    ).toBe(true);
    expect(
      isLongLived(
        parseAccount({
          type: "oauth_token",
          name: "c",
          region: "us",
          token: "t",
        }),
      ),
    ).toBe(false);
  });

  it("narrows exhaustively at compile time (never default)", () => {
    /**
     * Compile-time exhaustiveness canary: adding a 4th Account variant
     * makes the `never` assignment below a type error and breaks the
     * build.
     *
     * @param account - Any account variant.
     * @returns The discriminator value.
     */
    function discriminate(account: Account): string {
      switch (account.type) {
        case "service_account": {
          return account.type;
        }
        case "oauth_browser": {
          return account.type;
        }
        case "oauth_token": {
          return account.type;
        }
        default: {
          const exhaustive: never = account;
          return exhaustive;
        }
      }
    }
    expect(discriminate(parseAccount(SA_PAYLOAD))).toBe("service_account");
  });
});
