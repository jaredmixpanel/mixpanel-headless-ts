// C8(d) literal-alias/enum lock (phase2-design C2): the hand-written
// packages/core/src/types/{literals,enums}.ts tables must stay in sync
// with the generated Python-side contract artifact
// conformance-runner/corpus/contract/literal-aliases.json.
//
// 1. Alias-name set equality: the TS registry keys exactly the
//    artifact's 38 distinct alias names (a new/renamed Python alias
//    fails here, telling you exactly which alias drifted).
// 2. Per-alias member SET equality (member order is contractual for
//    nothing — C2).
// 3. Enum-class set equality: names, kind (str/int), and exact
//    member-name → member-value records.
// 4. Runtime backstop for fast-check property #7 (C9): no duplicate
//    members in any TS tuple or artifact list (the compile-time
//    `satisfies` + coverage-proof types handle union⇄tuple drift).
//
// The artifact's `newtypes` section has no runtime artifact on the TS
// side (plain type aliases, phase2-design C2) — it is asserted for
// shape only so P2-4 inherits a verified list.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ENUM_TABLES,
  LITERAL_ALIAS_VALUES,
} from "../../packages/core/src/types/index.js";

/** The repo root (this file lives in conformance-runner/test). */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** Path of the synced Python-side contract artifact. */
const ARTIFACT_PATH = resolve(
  REPO_ROOT,
  "conformance-runner/corpus/contract/literal-aliases.json",
);

/** One enum entry of literal-aliases.json (P2-1 generator output). */
interface EnumArtifactEntry {
  readonly kind: "str" | "int";
  readonly members: Readonly<Record<string, string | number>>;
}

/** Parsed shape of literal-aliases.json (P2-1 generator output). */
interface LiteralAliasesArtifact {
  readonly generated_from: string;
  readonly literal_aliases: Readonly<Record<string, readonly string[]>>;
  readonly enums: Readonly<Record<string, EnumArtifactEntry>>;
  readonly newtypes: Readonly<Record<string, string>>;
}

const artifact = JSON.parse(
  readFileSync(ARTIFACT_PATH, "utf8"),
) as LiteralAliasesArtifact;

describe("C8(d) literal-alias lock", () => {
  it("artifact carries provenance and the measured cardinalities", () => {
    expect(artifact.generated_from).toMatch(/^[0-9a-f]{40}$/);
    expect(Object.keys(artifact.literal_aliases)).toHaveLength(38);
    expect(Object.keys(artifact.enums)).toHaveLength(8);
  });

  it("TS registry keys exactly the artifact's alias names", () => {
    const artifactNames = Object.keys(artifact.literal_aliases).sort();
    const tsNames = [...LITERAL_ALIAS_VALUES.keys()].sort();
    expect(tsNames).toEqual(artifactNames);
  });

  it("every alias's member set equals the artifact's", () => {
    for (const [name, artifactMembers] of Object.entries(
      artifact.literal_aliases,
    )) {
      const tsMembers = LITERAL_ALIAS_VALUES.get(name);
      expect(tsMembers, `alias ${name} missing from literals.ts`).toBeDefined();
      // Sorted-array comparison = set equality once the no-duplicates
      // invariant (below) holds on both sides.
      expect([...(tsMembers ?? [])].sort(), `alias ${name} drifted`).toEqual(
        [...artifactMembers].sort(),
      );
    }
  });

  it("no alias tuple or artifact list contains duplicates", () => {
    for (const [name, values] of LITERAL_ALIAS_VALUES) {
      expect(new Set(values).size, `duplicate member in TS ${name}`).toBe(
        values.length,
      );
    }
    for (const [name, values] of Object.entries(artifact.literal_aliases)) {
      expect(new Set(values).size, `duplicate member in artifact ${name}`).toBe(
        values.length,
      );
    }
  });
});

describe("C8(d) enum-class lock", () => {
  it("TS enum tables key exactly the artifact's enum class names", () => {
    const artifactNames = Object.keys(artifact.enums).sort();
    const tsNames = [...ENUM_TABLES.keys()].sort();
    expect(tsNames).toEqual(artifactNames);
  });

  it("every enum's kind and member record equal the artifact's", () => {
    for (const [name, entry] of Object.entries(artifact.enums)) {
      const tsEntry = ENUM_TABLES.get(name);
      expect(tsEntry, `enum ${name} missing from enums.ts`).toBeDefined();
      expect(tsEntry?.kind, `enum ${name} kind drifted`).toBe(entry.kind);
      // toEqual on plain objects is key-order-insensitive: exact
      // member-name set plus exact values.
      expect(tsEntry?.members, `enum ${name} members drifted`).toEqual(
        entry.members,
      );
    }
  });

  it("member value types match the declared kind", () => {
    for (const [name, entry] of ENUM_TABLES) {
      for (const [member, value] of Object.entries(entry.members)) {
        expect(
          typeof value,
          `enum ${name}.${member} value type vs kind ${entry.kind}`,
        ).toBe(entry.kind === "int" ? "number" : "string");
      }
    }
  });

  it("newtypes section matches the C2 list (compile-time-only on TS side)", () => {
    expect(artifact.newtypes).toEqual({
      AccountName: "str",
      ProjectId: "str",
      TargetName: "str",
      WorkspaceId: "int",
    });
  });
});
