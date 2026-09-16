// EntityModel base semantics every entity class inherits: defaults only on
// absent keys, null vs absent, extra policies, validation-alias acceptance,
// lax coercion, nested reconstruction, model_dump identity passthrough and
// the hand-ported Python field validators. TS-only unit tests (no Python
// twin); the Pydantic behaviors they pin were measured against pydantic v2.
import { describe, expect, it } from "vitest";

import { ResponseValidationError } from "../../../src/errors.js";
import {
  AccountTestResult,
  Target,
} from "../../../src/types/entities/accounts.js";
import { CreateAnnotationParams } from "../../../src/types/entities/annotations.js";
import {
  BUSINESS_CONTEXT_MAX_CHARS,
  BusinessContext,
} from "../../../src/types/entities/business-context.js";
import { CursorPagination } from "../../../src/types/entities/common.js";
import { Dashboard } from "../../../src/types/entities/dashboards.js";
import {
  CreateCustomEventParams,
  CreateCustomPropertyParams,
  CustomProperty,
} from "../../../src/types/entities/data-governance.js";
import {
  BulkEventUpdate,
  EventDefinition,
} from "../../../src/types/entities/lexicon.js";
import {
  BulkCreateSchemasParams,
  EventDeletionRequest,
  SchemaEntry,
} from "../../../src/types/entities/schemas.js";

describe("EntityModel construction semantics", () => {
  it("fires defaults ONLY on absent keys; explicit null stays null", () => {
    const dashboard = new Dashboard({ id: 1, title: "t" });
    expect(dashboard.description).toBeNull(); // Python default None
    expect(dashboard.is_private).toBe(false); // non-null default
    const explicit = new Dashboard({ id: 1, title: "t", description: null });
    expect(explicit.description).toBeNull();
  });

  it("treats undefined as ABSENT", () => {
    const dashboard = new Dashboard({
      id: 1,
      title: "t",
      is_private: undefined,
    });
    expect(dashboard.is_private).toBe(false);
  });

  it("rejects a missing required field", () => {
    expect(() => Dashboard.fromDict({ title: "no id" })).toThrow(
      ResponseValidationError,
    );
  });

  it("rejects explicit null for a NON-nullable field", () => {
    expect(() => Dashboard.fromDict({ id: 1, title: null })).toThrow(
      ResponseValidationError,
    );
  });

  it("applies Pydantic-lax scalar coercion via coerce.ts", () => {
    const dashboard = Dashboard.fromDict({ id: "42", title: "t" });
    expect(dashboard.id).toBe(42);
    expect(() => Dashboard.fromDict({ id: 1.5, title: "t" })).toThrow(
      ResponseValidationError,
    );
  });

  it("extra='forbid' rejects unknown keys (Target)", () => {
    expect(() =>
      Target.fromDict({
        name: "t",
        account: "a",
        project: "123",
        surprise: 1,
      }),
    ).toThrow(ResponseValidationError);
  });

  it("extra='allow' retains extras but excludes them from toJSON()", () => {
    const context = BusinessContext.fromDict({
      level: "project",
      content: "hi",
      organization_id: null,
      project_id: "1",
      novel_server_key: "kept",
    });
    expect(context.__extras["novel_server_key"]).toBe("kept");
    expect(Object.keys(context.toJSON())).not.toContain("novel_server_key");
  });

  it("keeps a JSON-derived __proto__ key as an own extra (no re-parenting)", () => {
    // JSON.parse yields an OWN "__proto__" key, exactly like a Python
    // dict; copying it with a plain `record[key] = value` would hit the
    // inherited accessor and silently re-parent the extras bag instead.
    const raw: unknown = JSON.parse(
      '{"level":"project","content":"hi","__proto__":{"polluted":true}}',
    );
    const context = BusinessContext.fromDict(raw);
    expect(Object.hasOwn(context.__extras, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(context.__extras)).toBe(Object.prototype);
    expect(Object.hasOwn(context.modelDump(), "__proto__")).toBe(true);
    expect(
      (context.modelDump() as { polluted?: unknown }).polluted,
    ).toBeUndefined();
  });

  it("extra='ignore' (Pydantic default) drops unknown keys silently", () => {
    const pagination = CursorPagination.fromDict({
      page_size: 10,
      next_cursor: null,
      previous_cursor: null,
      dropped_key: true,
    });
    expect(pagination.__extras).toStrictEqual({});
    expect(Object.keys(pagination.toJSON())).toStrictEqual([
      "page_size",
      "next_cursor",
      "previous_cursor",
    ]);
  });

  it("accepts the to_camel validation alias AND the attribute name", () => {
    const byAlias = EventDefinition.fromDict({
      id: 1,
      name: "E",
      displayName: "The E",
    });
    expect(byAlias.display_name).toBe("The E");
    const byName = EventDefinition.fromDict({
      id: 1,
      name: "E",
      display_name: "The E",
    });
    expect(byName.display_name).toBe("The E");
  });

  it("accepts every AliasChoices spelling (BulkEventUpdate.display_name)", () => {
    const snake = BulkEventUpdate.fromDict({
      name: "E",
      display_name: "d",
    });
    expect(snake.display_name).toBe("d");
    const camel = BulkEventUpdate.fromDict({
      name: "E",
      displayName: "d",
    });
    expect(camel.display_name).toBe("d");
  });

  it("accepts a camel validation alias on a wire-shaped id (CustomProperty)", () => {
    const property = CustomProperty.fromDict({
      customPropertyId: 7,
      name: "n",
      resourceType: "events",
    });
    expect(property.custom_property_id).toBe(7);
    expect(property.resource_type).toBe("events");
  });

  it("reconstructs nested models from plain payloads and keeps instances", () => {
    const fromPlain = BulkCreateSchemasParams.fromDict({
      entries: [
        {
          entity_type: "event",
          name: "Login",
          version: null,
          schema_definition: {},
        },
      ],
    });
    expect(fromPlain.entries[0]).toBeInstanceOf(SchemaEntry);
    const entry = new SchemaEntry({
      entity_type: "event",
      name: "Login",
      schema_definition: {},
    });
    const fromInstance = new BulkCreateSchemasParams({ entries: [entry] });
    expect(fromInstance.entries[0]).toBe(entry);
  });
});

describe("model_dump identity passthrough", () => {
  // Pydantic v2 `model_dump` keeps arbitrary (non-dict, non-list,
  // non-model) objects inside `dict[str, Any]` fields BY IDENTITY
  // (`out['d']['k'] is c`, with and without `exclude_none`). The pre-fix
  // clone-anything walk decomposed a `Uint8Array` into index keys.

  /** An arbitrary consumer class (the pydantic probe's `C()`). */
  class Opaque {
    /** Probe field. */
    readonly k = 1;
  }

  it("passes custom-class members of dict fields through by reference", () => {
    const instance = new Opaque();
    const params = CreateCustomPropertyParams.fromDict({
      name: "p",
      resource_type: "events",
      behavior: { k: instance },
    });

    const excludeNone = params.modelDumpExcludeNone();
    expect((excludeNone["behavior"] as Record<string, unknown>)["k"]).toBe(
      instance,
    );
    const plain = params.modelDump();
    expect((plain["behavior"] as Record<string, unknown>)["k"]).toBe(instance);
  });

  it("does NOT decompose a Uint8Array into index keys (regression)", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const params = CreateCustomPropertyParams.fromDict({
      name: "p",
      resource_type: "events",
      behavior: { payload: bytes },
    });

    const dumped = params.modelDumpExcludeNone();
    expect((dumped["behavior"] as Record<string, unknown>)["payload"]).toBe(
      bytes,
    );
  });
});

describe("hand-ported Python validators", () => {
  it("AccountTestResult: ok=True implies error is None (and vice versa)", () => {
    expect(() =>
      AccountTestResult.fromDict({ account_name: "a", ok: true, error: "e" }),
    ).toThrow(ResponseValidationError);
    expect(() =>
      AccountTestResult.fromDict({ account_name: "a", ok: false }),
    ).toThrow(ResponseValidationError);
    expect(() =>
      AccountTestResult.fromDict({
        account_name: "a",
        ok: true,
        error_code: "X",
      }),
    ).toThrow(ResponseValidationError);
    const failure = AccountTestResult.fromDict({
      account_name: "a",
      ok: false,
      error: "boom",
    });
    expect(failure.ok).toBe(false);
  });

  it("CreateCustomPropertyParams: formula/behavior mutual-exclusion rules", () => {
    const base = { name: "p", resource_type: "events" };
    expect(() =>
      CreateCustomPropertyParams.fromDict({
        ...base,
        display_formula: "f",
        behavior: { a: 1 },
      }),
    ).toThrow(ResponseValidationError);
    expect(() =>
      CreateCustomPropertyParams.fromDict({
        ...base,
        behavior: { a: 1 },
        composed_properties: {},
      }),
    ).toThrow(ResponseValidationError);
    expect(() =>
      CreateCustomPropertyParams.fromDict({ ...base, display_formula: "f" }),
    ).toThrow(ResponseValidationError);
    expect(() => CreateCustomPropertyParams.fromDict({ ...base })).toThrow(
      ResponseValidationError,
    );
    const valid = CreateCustomPropertyParams.fromDict({
      ...base,
      behavior: { a: 1 },
    });
    expect(valid.behavior).toStrictEqual({ a: 1 });
  });

  it("CreateCustomEventParams: alternatives are non-empty, non-blank, unique", () => {
    expect(() =>
      CreateCustomEventParams.fromDict({ name: "e", alternatives: [] }),
    ).toThrow(ResponseValidationError);
    expect(() =>
      CreateCustomEventParams.fromDict({ name: "e", alternatives: ["  "] }),
    ).toThrow(ResponseValidationError);
    expect(() =>
      CreateCustomEventParams.fromDict({
        name: "e",
        alternatives: ["a", "a"],
      }),
    ).toThrow(ResponseValidationError);
    const valid = CreateCustomEventParams.fromDict({
      name: "e",
      alternatives: ["a", "b"],
    });
    expect(valid.alternatives).toStrictEqual(["a", "b"]);
  });

  it("EventDeletionRequest: filters=[] coerces to null; non-empty wraps", () => {
    const base = {
      id: 1,
      event_name: "E",
      from_date: "2026-01-01",
      to_date: "2026-01-02",
      status: "Submitted",
      deleted_events_count: 0,
      created: "2026-01-01",
      requesting_user: {},
    };
    const empty = EventDeletionRequest.fromDict({ ...base, filters: [] });
    expect(empty.filters).toBeNull();
    const wrapped = EventDeletionRequest.fromDict({
      ...base,
      filters: [{ a: 1 }],
    });
    expect(wrapped.filters).toStrictEqual({ items: [{ a: 1 }] });
  });

  it("BusinessContext: computed fields appear in toJSON() and count codepoints", () => {
    const context = BusinessContext.fromDict({
      level: "project",
      content: "\u{1D4B3}", // one astral codepoint (two UTF-16 units)
    });
    const json = context.toJSON();
    expect(json["is_empty"]).toBe(false);
    expect(json["character_count"]).toBe(1); // len('𝒳') == 1 in Python
    expect(Object.keys(json)).toStrictEqual([
      "level",
      "content",
      "organization_id",
      "project_id",
      "is_empty",
      "character_count",
    ]);
    expect(BUSINESS_CONTEXT_MAX_CHARS).toBe(50_000);
  });

  it("CreateAnnotationParams: description max_length is codepoint-counted", () => {
    const astral = "\u{1D4B3}".repeat(512); // 512 codepoints, 1024 UTF-16 units
    const params = CreateAnnotationParams.fromDict({
      date: "2026-01-01 00:00:00",
      description: astral,
    });
    expect(params.description).toBe(astral);
    expect(() =>
      CreateAnnotationParams.fromDict({
        date: "2026-01-01 00:00:00",
        description: "a".repeat(513),
      }),
    ).toThrow(ResponseValidationError);
  });

  it("Target: digits-only project and positive workspace", () => {
    expect(() =>
      Target.fromDict({ name: "t", account: "a", project: "abc" }),
    ).toThrow(ResponseValidationError);
    expect(() =>
      Target.fromDict({
        name: "t",
        account: "a",
        project: "123",
        workspace: 0,
      }),
    ).toThrow(ResponseValidationError);
    const valid = Target.fromDict({
      name: "t",
      account: "a",
      project: "123",
      workspace: 7,
    });
    expect(valid.workspace).toBe(7);
  });
});
