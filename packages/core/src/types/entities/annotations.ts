/**
 * Annotation family + annotation CRUD params.
 *
 * Hand-written ports of the Pydantic models in Python's `types.py`:
 * the Python classes are the source of record and the vendored
 * schema4api types are a compile-time cross-check only. Field names
 * keep their Python spelling; required-ness, defaults, nullability and
 * lax coercion follow each class's `fieldSpecs` (see `model-base.ts`).
 *
 * @see mixpanel_headless.types
 */

import { cpLength } from "../../compat/codepoint.js";
import {
  type EntityFieldSpecs,
  EntityModel,
  modelFail,
  prepareInit,
} from "./model-base.js";

/**
 * Constructor input for {@link AnnotationUser} — absent keys take the Python
 * defaults; `undefined` counts as absent.
 */
export interface AnnotationUserInit {
  /** User ID. */
  readonly id: number;
  /** First name. */
  readonly first_name: string;
  /** Last name. */
  readonly last_name: string;
}

/**
 * Nested user info for annotation creator.
 *
 * @remarks Pydantic `extra='allow'`: unknown keys are kept on `__extras`.
 * @example
 * ```ts
 * const annotationUser = AnnotationUser.fromDict({
 *   id: 42,
 *   first_name: "Ana",
 *   last_name: "Lopez",
 * });
 * annotationUser.id; // 42
 * ```
 * @see mixpanel_headless.types.AnnotationUser
 */
export class AnnotationUser extends EntityModel<AnnotationUserInit> {
  /** The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "AnnotationUser";

  /** Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /**
   * Declared fields in Python `model_fields` order.
   *
   * @internal
   */
  static readonly fieldSpecs: EntityFieldSpecs<AnnotationUserInit> = [
    { name: "id", required: true, kind: "int" },
    { name: "first_name", required: true, kind: "str" },
    { name: "last_name", required: true, kind: "str" },
  ];

  /** User ID. */
  declare readonly id: number;
  /** First name. */
  declare readonly first_name: string;
  /** Last name. */
  declare readonly last_name: string;

  /**
   * Construct a validated AnnotationUser (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws {@link ResponseValidationError} - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: AnnotationUserInit) {
    super(AnnotationUser, fields);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws {@link ResponseValidationError} - On shape violations.
   */
  static fromDict(raw: unknown): AnnotationUser {
    return new AnnotationUser(prepareInit(AnnotationUser, raw));
  }
}

/**
 * Constructor input for {@link AnnotationTag} — absent keys take the Python
 * defaults; `undefined` counts as absent.
 */
export interface AnnotationTagInit {
  /** Tag ID. */
  readonly id: number;
  /** Tag name. */
  readonly name: string;
  /** Project ID. */
  readonly project_id?: number | null | undefined;
  /** Whether tag has annotations. */
  readonly has_annotations?: boolean | null | undefined;
}

/**
 * Annotation tag for categorization.
 *
 * @remarks Pydantic `extra='allow'`: unknown keys are kept on `__extras`.
 * @example
 * ```ts
 * const annotationTag = AnnotationTag.fromDict({
 *   id: 42,
 *   name: "release",
 *   has_annotations: true,
 * });
 * annotationTag.id; // 42
 * ```
 * @see mixpanel_headless.types.AnnotationTag
 */
export class AnnotationTag extends EntityModel<AnnotationTagInit> {
  /** The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "AnnotationTag";

  /** Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /**
   * Declared fields in Python `model_fields` order.
   *
   * @internal
   */
  static readonly fieldSpecs: EntityFieldSpecs<AnnotationTagInit> = [
    { name: "id", required: true, kind: "int" },
    { name: "name", required: true, kind: "str" },
    { name: "project_id", kind: "int", nullable: true },
    { name: "has_annotations", kind: "bool", nullable: true },
  ];

  /** Tag ID. */
  declare readonly id: number;
  /** Tag name. */
  declare readonly name: string;
  /** Project ID. */
  declare readonly project_id: number | null;
  /** Whether tag has annotations. */
  declare readonly has_annotations: boolean | null;

  /**
   * Construct a validated AnnotationTag (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws {@link ResponseValidationError} - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: AnnotationTagInit) {
    super(AnnotationTag, fields);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws {@link ResponseValidationError} - On shape violations.
   */
  static fromDict(raw: unknown): AnnotationTag {
    return new AnnotationTag(prepareInit(AnnotationTag, raw));
  }
}

/**
 * Constructor input for {@link Annotation} — absent keys take the Python
 * defaults; `undefined` counts as absent.
 */
export interface AnnotationInit {
  /** Annotation ID. */
  readonly id: number;
  /** Project ID. */
  readonly project_id: number;
  /** Annotation date (`%Y-%m-%d %H:%M:%S` format). */
  readonly date: string;
  /** Annotation text. */
  readonly description: string;
  /** Creator user info. */
  readonly user?:
    AnnotationUser | Readonly<Record<string, unknown>> | null | undefined;
  /** Associated tags. */
  readonly tags?:
    | ReadonlyArray<AnnotationTag | Readonly<Record<string, unknown>>>
    | undefined;
}

/**
 * Response model for a timeline annotation.
 *
 * @remarks Pydantic `extra='allow'`: unknown keys are kept on `__extras`.
 * @example
 * ```ts
 * const annotation = Annotation.fromDict({
 *   id: 42,
 *   project_id: 123456,
 *   date: "2026-01-15",
 *   description: "Weekly overview",
 * });
 * annotation.id; // 42
 * ```
 * @see mixpanel_headless.types.Annotation
 */
export class Annotation extends EntityModel<AnnotationInit> {
  /** The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "Annotation";

  /** Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /**
   * Declared fields in Python `model_fields` order.
   *
   * @internal
   */
  static readonly fieldSpecs: EntityFieldSpecs<AnnotationInit> = [
    { name: "id", required: true, kind: "int" },
    { name: "project_id", required: true, kind: "int" },
    { name: "date", required: true, kind: "str" },
    { name: "description", required: true, kind: "str" },
    { name: "user", nullable: true, nested: () => AnnotationUser },
    {
      name: "tags",
      default: () => [],
      nested: () => AnnotationTag,
      container: "list",
    },
  ];

  /** Annotation ID. */
  declare readonly id: number;
  /** Project ID. */
  declare readonly project_id: number;
  /** Annotation date (`%Y-%m-%d %H:%M:%S` format). */
  declare readonly date: string;
  /** Annotation text. */
  declare readonly description: string;
  /** Creator user info. */
  declare readonly user: AnnotationUser | null;
  /** Associated tags. */
  declare readonly tags: readonly AnnotationTag[];

  /**
   * Construct a validated Annotation (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws {@link ResponseValidationError} - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: AnnotationInit) {
    super(Annotation, fields);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws {@link ResponseValidationError} - On shape violations.
   */
  static fromDict(raw: unknown): Annotation {
    return new Annotation(prepareInit(Annotation, raw));
  }
}

/**
 * Constructor input for {@link CreateAnnotationParams} — absent keys take the Python
 * defaults; `undefined` counts as absent.
 */
export interface CreateAnnotationParamsInit {
  /** Date string in `%Y-%m-%d %H:%M:%S` format. */
  readonly date: string;
  /** Annotation text (max 512 characters). */
  readonly description: string;
  /** Tag IDs to associate. */
  readonly tags?: readonly number[] | null | undefined;
  /** Creator user ID. */
  readonly user_id?: number | null | undefined;
}

/**
 * Parameters for creating a new annotation.
 *
 * @remarks Pydantic `extra='ignore'`: unknown keys are dropped.
 * @example
 * ```ts
 * const params = new CreateAnnotationParams({
 *   date: "2026-01-15",
 *   description: "Weekly overview",
 * });
 * params.date; // "2026-01-15"
 * ```
 * @see mixpanel_headless.types.CreateAnnotationParams
 */
export class CreateAnnotationParams extends EntityModel<CreateAnnotationParamsInit> {
  /** The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "CreateAnnotationParams";

  /** Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "ignore" as const;

  /**
   * Declared fields in Python `model_fields` order.
   *
   * @internal
   */
  static readonly fieldSpecs: EntityFieldSpecs<CreateAnnotationParamsInit> = [
    { name: "date", required: true, kind: "str" },
    {
      name: "description",
      required: true,
      kind: "str",
      // Python: Field(max_length=512) — codepoint-counted.
      check: (value: unknown, path: string): void => {
        if (typeof value === "string" && cpLength(value) > 512) {
          modelFail(path, "max_length 512");
        }
      },
    },
    { name: "tags", nullable: true },
    { name: "user_id", kind: "int", nullable: true },
  ];

  /** Date string in `%Y-%m-%d %H:%M:%S` format. */
  declare readonly date: string;
  /** Annotation text (max 512 characters). */
  declare readonly description: string;
  /** Tag IDs to associate. */
  declare readonly tags: readonly number[] | null;
  /** Creator user ID. */
  declare readonly user_id: number | null;

  /**
   * Construct a validated CreateAnnotationParams (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws {@link ResponseValidationError} - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: CreateAnnotationParamsInit) {
    super(CreateAnnotationParams, fields);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws {@link ResponseValidationError} - On shape violations.
   */
  static fromDict(raw: unknown): CreateAnnotationParams {
    return new CreateAnnotationParams(prepareInit(CreateAnnotationParams, raw));
  }
}

/**
 * Constructor input for {@link UpdateAnnotationParams} — absent keys take the Python
 * defaults; `undefined` counts as absent.
 */
export interface UpdateAnnotationParamsInit {
  /** New description (max 512 characters). */
  readonly description?: string | null | undefined;
  /** New tag IDs. */
  readonly tags?: readonly number[] | null | undefined;
}

/**
 * Parameters for updating an annotation (PATCH semantics).
 *
 * @remarks Pydantic `extra='ignore'`: unknown keys are dropped.
 * @example
 * ```ts
 * const params = new UpdateAnnotationParams({
 *   description: "Weekly overview",
 * });
 * params.description; // "Weekly overview"
 * ```
 * @see mixpanel_headless.types.UpdateAnnotationParams
 */
export class UpdateAnnotationParams extends EntityModel<UpdateAnnotationParamsInit> {
  /** The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "UpdateAnnotationParams";

  /** Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "ignore" as const;

  /**
   * Declared fields in Python `model_fields` order.
   *
   * @internal
   */
  static readonly fieldSpecs: EntityFieldSpecs<UpdateAnnotationParamsInit> = [
    {
      name: "description",
      kind: "str",
      nullable: true,
      // Python: Field(default=None, max_length=512) — codepoint-counted.
      check: (value: unknown, path: string): void => {
        if (typeof value === "string" && cpLength(value) > 512) {
          modelFail(path, "max_length 512");
        }
      },
    },
    { name: "tags", nullable: true },
  ];

  /** New description (max 512 characters). */
  declare readonly description: string | null;
  /** New tag IDs. */
  declare readonly tags: readonly number[] | null;

  /**
   * Construct a validated UpdateAnnotationParams (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws {@link ResponseValidationError} - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: UpdateAnnotationParamsInit) {
    super(UpdateAnnotationParams, fields);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws {@link ResponseValidationError} - On shape violations.
   */
  static fromDict(raw: unknown): UpdateAnnotationParams {
    return new UpdateAnnotationParams(prepareInit(UpdateAnnotationParams, raw));
  }
}

/**
 * Constructor input for {@link CreateAnnotationTagParams} — absent keys take the Python
 * defaults; `undefined` counts as absent.
 */
export interface CreateAnnotationTagParamsInit {
  /** Tag name. */
  readonly name: string;
}

/**
 * Parameters for creating an annotation tag.
 *
 * @remarks Pydantic `extra='ignore'`: unknown keys are dropped.
 * @example
 * ```ts
 * const params = new CreateAnnotationTagParams({ name: "release" });
 * params.name; // "release"
 * ```
 * @see mixpanel_headless.types.CreateAnnotationTagParams
 */
export class CreateAnnotationTagParams extends EntityModel<CreateAnnotationTagParamsInit> {
  /** The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "CreateAnnotationTagParams";

  /** Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "ignore" as const;

  /**
   * Declared fields in Python `model_fields` order.
   *
   * @internal
   */
  static readonly fieldSpecs: EntityFieldSpecs<CreateAnnotationTagParamsInit> =
    [{ name: "name", required: true, kind: "str" }];

  /** Tag name. */
  declare readonly name: string;

  /**
   * Construct a validated CreateAnnotationTagParams (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws {@link ResponseValidationError} - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: CreateAnnotationTagParamsInit) {
    super(CreateAnnotationTagParams, fields);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws {@link ResponseValidationError} - On shape violations.
   */
  static fromDict(raw: unknown): CreateAnnotationTagParams {
    return new CreateAnnotationTagParams(
      prepareInit(CreateAnnotationTagParams, raw),
    );
  }
}
