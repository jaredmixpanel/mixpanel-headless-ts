/**
 * Business-context models + BUSINESS_CONTEXT_MAX_CHARS.
 *
 * Hand-written ports of the Pydantic entity models (phase2-design C5,
 * packet P2-7): the PYTHON models are the source of record; vendored
 * schema4api types are a compile-time cross-check only. Field names
 * keep their exact Python spelling (R3.6/R7.6); optionality follows
 * R3.9/R4.10 via the model-base materialization rules.
 */

import { cpLength } from "../../compat/codepoint.js";
import {
  type ComputedFieldSpec,
  type EntityFieldSpecs,
  EntityModel,
  oneOf,
  prepareInit,
} from "./model-base.js";

/**
 * Maximum characters accepted for business-context content (mirror of
 * Python `mixpanel_headless.BUSINESS_CONTEXT_MAX_CHARS`). The write
 * path (`Workspace.set_business_context`, Phase 3 B6) enforces it and
 * raises `BusinessContextValidationError` beyond it; compare
 * {@link BusinessContext} `character_count` against this for headroom.
 */
export const BUSINESS_CONTEXT_MAX_CHARS = 50_000;

/**
 * Constructor input for {@link BusinessContext} — absent keys take the Python
 * defaults; `undefined` counts as absent (R4.10).
 */
export interface BusinessContextInit {
  /** Which scope this context belongs to. */
  readonly level: "organization" | "project";
  /** Markdown content. Empty string when no context is set. */
  readonly content: string;
  /** Owning organization ID (set when ``level="organization"``). */
  readonly organization_id?: number | null | undefined;
  /** Owning project ID (set when ``level="project"``). */
  readonly project_id?: string | null | undefined;
}

/**
 * Business context content at a single scope.
 *
 * Mirror of Python `mixpanel_headless.types.BusinessContext` (types.py:12163;
 * model_config: frozen=True, extra='allow').
 */
export class BusinessContext extends EntityModel<BusinessContextInit> {
  /** The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "BusinessContext";

  /** Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /** Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: EntityFieldSpecs<BusinessContextInit> = [
    {
      name: "level",
      required: true,
      check: oneOf(["organization", "project"]),
    },
    { name: "content", required: true, kind: "str" },
    { name: "organization_id", kind: "int", nullable: true },
    { name: "project_id", kind: "str", nullable: true },
  ];

  /**
   * Ports of the two Python `@computed_field` properties —
   * appended to `toJSON()`/`toVectorPayload()` after the declared
   * fields (the recorder includes computed fields in expect position)
   * and dropped from `fromDict` input.
   */
  static readonly computedSpecs: readonly ComputedFieldSpec[] = [
    {
      name: "is_empty",
      get: (instance) => (instance as BusinessContext).content === "",
    },
    {
      name: "character_count",
      get: (instance) => cpLength((instance as BusinessContext).content),
    },
  ];

  /** Which scope this context belongs to. */
  declare readonly level: "organization" | "project";
  /** Markdown content. Empty string when no context is set. */
  declare readonly content: string;
  /** Owning organization ID (set when ``level="organization"``). */
  declare readonly organization_id: number | null;
  /** Owning project ID (set when ``level="project"``). */
  declare readonly project_id: string | null;

  /**
   * Whether no context is set at this scope (Python `@computed_field`
   * `is_empty`) — the ACCESSOR twin of the {@link computedSpecs}
   * entry, added by B6-W1 because callers read it as a property
   * (`test_workspace_business_context.py:166`), not only through
   * `toJSON()`.
   */
  get is_empty(): boolean {
    return this.content === "";
  }

  /**
   * Content length in CODEPOINTS (Python `@computed_field`
   * `character_count`); see {@link is_empty} for the accessor note.
   */
  get character_count(): number {
    return cpLength(this.content);
  }

  /**
   * Construct a validated BusinessContext (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: BusinessContextInit) {
    super(BusinessContext, fields);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws ResponseValidationError - On shape violations.
   */
  static fromDict(raw: unknown): BusinessContext {
    return new BusinessContext(prepareInit(BusinessContext, raw));
  }
}

/**
 * Constructor input for {@link BusinessContextChain} — absent keys take the Python
 * defaults; `undefined` counts as absent (R4.10).
 */
export interface BusinessContextChainInit {
  /** Organization-level context (``level="organization"``). */
  readonly organization: BusinessContext | Readonly<Record<string, unknown>>;
  /** Project-level context (``level="project"``). */
  readonly project: BusinessContext | Readonly<Record<string, unknown>>;
}

/**
 * Both organization and project business context returned together.
 *
 * Mirror of Python `mixpanel_headless.types.BusinessContextChain` (types.py:12240;
 * model_config: frozen=True, extra='ignore').
 */
export class BusinessContextChain extends EntityModel<BusinessContextChainInit> {
  /** The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "BusinessContextChain";

  /** Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "ignore" as const;

  /** Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: EntityFieldSpecs<BusinessContextChainInit> = [
    { name: "organization", required: true, nested: () => BusinessContext },
    { name: "project", required: true, nested: () => BusinessContext },
  ];

  /** Organization-level context (``level="organization"``). */
  declare readonly organization: BusinessContext;
  /** Project-level context (``level="project"``). */
  declare readonly project: BusinessContext;

  /**
   * Construct a validated BusinessContextChain (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: BusinessContextChainInit) {
    super(BusinessContextChain, fields);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws ResponseValidationError - On shape violations.
   */
  static fromDict(raw: unknown): BusinessContextChain {
    return new BusinessContextChain(prepareInit(BusinessContextChain, raw));
  }
}
