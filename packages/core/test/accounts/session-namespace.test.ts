// Layer-3 translation of `tests/unit/test_session_namespace.py` (116
// lines, 6 tests) — B7-A1 packet §3.4 (`b7-packets.md`).
//
// Mechanism substitutions (header-cited per R10.2): the tmp-`$HOME`
// fixture becomes `makeEffects()`; Python's bare `ValueError` on the
// target guard asserts as the coded `ParamValidationError`
// (`WS1_TARGET_MUTUALLY_EXCLUSIVE`, packet Caution #14).

import { describe, expect, it } from "vitest";
import { createAccountsNamespace } from "../../src/accounts/namespace.js";
import { createSessionNamespace } from "../../src/accounts/session-namespace.js";
import { createTargetsNamespace } from "../../src/accounts/targets-namespace.js";
import { ParamValidationError } from "../../src/errors.js";
import { Secret } from "../../src/secret.js";
import { makeEffects, type EffectsBundle } from "./fake-auth-effects.js";

/** The `seeded` fixture (one SA account named `x`). */
async function seeded(): Promise<EffectsBundle> {
  const bundle = makeEffects();
  const accounts = createAccountsNamespace(bundle.effects);
  await accounts.add("x", {
    type: "service_account",
    region: "us",
    default_project: "3713224",
    username: "u",
    secret: new Secret("s"),
  });
  return bundle;
}

describe("TestShow (test_session_namespace.py:42)", () => {
  it("show() returns an ActiveSession matching [active]", async () => {
    const bundle = await seeded();
    bundle.config.setActive({ account: "x", workspace: 42 });
    const session = createSessionNamespace(bundle.effects);

    const result = session.show();

    expect(result.account).toBe("x");
    expect(result.workspace).toBe(42);
    // Project comes from the account's default_project.
    expect(bundle.config.getAccount("x").default_project).toBe("3713224");
  });
});

describe("TestUse (test_session_namespace.py:59)", () => {
  it("updating only the account axis preserves the others", async () => {
    const bundle = await seeded();
    bundle.config.setActive({ workspace: 42 });
    const accounts = createAccountsNamespace(bundle.effects);
    await accounts.add("other", {
      type: "oauth_browser",
      region: "us",
      default_project: "3713224",
    });
    const session = createSessionNamespace(bundle.effects);

    session.use({ account: "other" });

    const active = bundle.config.getActive();
    expect(active.account).toBe("other");
    expect(active.workspace).toBe(42);
    expect(bundle.config.getAccount("other").default_project).toBe("3713224");
  });

  it("updating only the project axis writes to the active account", async () => {
    const bundle = await seeded();
    bundle.config.setActive({ account: "x", workspace: 42 });
    const session = createSessionNamespace(bundle.effects);

    session.use({ project: "9999999" });

    const active = bundle.config.getActive();
    expect(active.account).toBe("x");
    expect(active.workspace).toBe(42);
    expect(bundle.config.getAccount("x").default_project).toBe("9999999");
  });

  it("updating only the workspace axis preserves the others", async () => {
    const bundle = await seeded();
    bundle.config.setActive({ account: "x" });
    const session = createSessionNamespace(bundle.effects);

    session.use({ workspace: 99 });

    const active = bundle.config.getActive();
    expect(active.account).toBe("x");
    expect(active.workspace).toBe(99);
    expect(bundle.config.getAccount("x").default_project).toBe("3713224");
  });

  it("target= applies the target's three axes (project to account)", async () => {
    const bundle = await seeded();
    const targets = createTargetsNamespace(bundle.effects);
    targets.add("ecom", { account: "x", project: "3018488", workspace: 42 });
    const session = createSessionNamespace(bundle.effects);

    session.use({ target: "ecom" });

    const active = bundle.config.getActive();
    expect(active.account).toBe("x");
    expect(active.workspace).toBe(42);
    expect(bundle.config.getAccount("x").default_project).toBe("3018488");
  });

  it("target= combined with any axis kwarg raises", async () => {
    const bundle = await seeded();
    const targets = createTargetsNamespace(bundle.effects);
    targets.add("ecom", { account: "x", project: "3018488" });
    const session = createSessionNamespace(bundle.effects);

    expect(() => session.use({ target: "ecom", account: "x" })).toThrow(
      ParamValidationError,
    );
    let caught: unknown = null;
    try {
      session.use({ target: "ecom", account: "x" });
    } catch (exc) {
      caught = exc;
    }
    expect((caught as ParamValidationError).code).toBe(
      "WS1_TARGET_MUTUALLY_EXCLUSIVE",
    );
  });
});
