// Layer-3 translation of `tests/unit/test_targets_namespace.py` (158
// lines, 15 tests) — B7-A1 packet §3.4 (`b7-packets.md`).
//
// Mechanism substitutions (header-cited per R10.2): the tmp-`$HOME`
// fixture becomes `makeEffects()`; Pydantic `ValidationError` on
// direct `Target(...)` construction asserts as the entity-model's
// `ResponseValidationError`.

import { describe, expect, it } from "vitest";

import { createAccountsNamespace } from "../../src/accounts/namespace.js";
import { createTargetsNamespace } from "../../src/accounts/targets-namespace.js";
import { ConfigError, ResponseValidationError } from "../../src/errors.js";
import { Secret } from "../../src/secret.js";
import { Target } from "../../src/types/entities/accounts.js";
import { type EffectsBundle, makeEffects } from "./fake-auth-effects.js";

/** The `cm` fixture (one SA account named `x`). */
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

describe("TestAdd (test_targets_namespace.py:42)", () => {
  it("adding without workspace persists account+project only", async () => {
    const bundle = await seeded();
    const targets = createTargetsNamespace(bundle.effects);

    const t = targets.add("ecom", { account: "x", project: "3018488" });

    expect(t).toBeInstanceOf(Target);
    expect(t.workspace).toBeNull();
  });

  it("adding with workspace persists all three fields", async () => {
    const bundle = await seeded();
    const targets = createTargetsNamespace(bundle.effects);

    const t = targets.add("ecom", {
      account: "x",
      project: "3018488",
      workspace: 42,
    });

    expect(t.workspace).toBe(42);
  });

  it("referencing a missing account raises ConfigError", async () => {
    const bundle = await seeded();
    const targets = createTargetsNamespace(bundle.effects);

    expect(() =>
      targets.add("ecom", { account: "ghost", project: "3018488" }),
    ).toThrow(ConfigError);
  });
});

describe("TestTargetWorkspaceValidation (test_targets_namespace.py:62)", () => {
  it("Target(workspace=0) raises at construction", () => {
    expect(
      () =>
        new Target({
          name: "t",
          account: "x",
          project: "3018488",
          workspace: 0,
        }),
    ).toThrow(ResponseValidationError);
  });

  it("Target(workspace=-5) raises at construction", () => {
    expect(
      () =>
        new Target({
          name: "t",
          account: "x",
          project: "3018488",
          workspace: -5,
        }),
    ).toThrow(ResponseValidationError);
  });

  it("Target(workspace=42) succeeds", () => {
    const t = new Target({
      name: "t",
      account: "x",
      project: "3018488",
      workspace: 42,
    });
    expect(t.workspace).toBe(42);
  });

  it("Target(workspace=null) succeeds (lazy-resolve later)", () => {
    const t = new Target({
      name: "t",
      account: "x",
      project: "3018488",
      workspace: null,
    });
    expect(t.workspace).toBeNull();
  });

  it("targets.add(workspace=0) raises before persisting", async () => {
    const bundle = await seeded();
    const targets = createTargetsNamespace(bundle.effects);

    expect(() =>
      targets.add("ecom", { account: "x", project: "3018488", workspace: 0 }),
    ).toThrow(ConfigError);
    expect(targets.list()).toEqual([]);
  });
});

describe("TestList (test_targets_namespace.py:98)", () => {
  it("no targets → empty list", async () => {
    const bundle = await seeded();
    const targets = createTargetsNamespace(bundle.effects);
    expect(targets.list()).toEqual([]);
  });

  it("all registered targets appear sorted by name", async () => {
    const bundle = await seeded();
    const targets = createTargetsNamespace(bundle.effects);
    targets.add("b", { account: "x", project: "1" });
    targets.add("a", { account: "x", project: "2" });

    expect(targets.list().map((t) => t.name)).toEqual(["a", "b"]);
  });
});

describe("TestUse (test_targets_namespace.py:113)", () => {
  it("use writes account+workspace to [active] and project to account", async () => {
    const bundle = await seeded();
    const targets = createTargetsNamespace(bundle.effects);
    targets.add("ecom", { account: "x", project: "3018488", workspace: 42 });

    targets.use("ecom");

    const active = bundle.config.getActive();
    expect(active.account).toBe("x");
    expect(active.workspace).toBe(42);
    expect(bundle.config.getAccount("x").default_project).toBe("3018488");
  });

  it("use('ghost') raises ConfigError", async () => {
    const bundle = await seeded();
    const targets = createTargetsNamespace(bundle.effects);

    expect(() => targets.use("ghost")).toThrow(ConfigError);
  });
});

describe("TestRemove (test_targets_namespace.py:136)", () => {
  it("remove deletes the target", async () => {
    const bundle = await seeded();
    const targets = createTargetsNamespace(bundle.effects);
    targets.add("ecom", { account: "x", project: "3018488" });

    targets.remove("ecom");

    expect(targets.list()).toEqual([]);
  });

  it("removing a non-existent target raises", async () => {
    const bundle = await seeded();
    const targets = createTargetsNamespace(bundle.effects);

    expect(() => targets.remove("ghost")).toThrow(ConfigError);
  });
});

describe("TestShow (test_targets_namespace.py:151)", () => {
  it("show returns the matching Target", async () => {
    const bundle = await seeded();
    const targets = createTargetsNamespace(bundle.effects);
    targets.add("ecom", { account: "x", project: "3018488" });

    expect(targets.show("ecom").name).toBe("ecom");
  });
});
