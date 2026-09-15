/**
 * Response-model validation for App API payloads: the pydantic-v2-shaped
 * error list (`{type, loc, msg, input}`, `include_url=False`) that
 * `ResponseValidationError` (`RESPONSE_VALIDATION_ERROR`) carries in
 * `details.errors`, collected over the entity-model field specs with the
 * same lax-JSON coercion `EntityModel` applies. The `type: "missing"` rows
 * are locked byte-exactly by the `list_workspaces` vectors. Divergence:
 * the other pydantic `type`/`msg` strings are transcribed from pydantic
 * 2.x, not vector-verified; structure and error class/code are locked.
 *
 * @see mixpanel_headless._internal.response_validation
 */

import {
  coerceBool,
  coerceFloat,
  coerceInt,
  coerceInt64,
  coerceStr,
} from "../coerce.js";
import { isPythonDict } from "../compat/python-dict.js";
import { ResponseValidationError } from "../errors.js";
import type {
  EntityFieldKind,
  EntityFieldSpec,
  EntityModel,
  EntityModelStatics,
} from "../types/entities/model-base.js";

/** One pydantic-v2-shaped validation error (`errors(include_url=False)`). */
interface PydanticStyleError {
  /** The pydantic error type tag (e.g. `"missing"`, `"int_parsing"`). */
  readonly type: string;
  /** Location tuple — the field path from the model root. */
  readonly loc: ReadonlyArray<string | number>;
  /** Human-readable message (pydantic wording). */
  readonly msg: string;
  /** The offending input (the whole payload for `missing`). */
  readonly input: unknown;
}

/** The concrete model classes this seam validates against. */
export interface ResponseModelClass<
  T extends EntityModel,
> extends EntityModelStatics {
  /** The strict decode factory returning the concrete type. */
  readonly fromDict: (raw: unknown) => T;
}

/**
 * Classify one present, non-null field value against its lax-coercion
 * kind, returning a pydantic-style error on failure.
 *
 * @param kind - The field's scalar kind.
 * @param value - The raw present value.
 * @param loc - The error location tuple.
 * @returns The error entry, or `null` when the value coerces.
 */
function classifyKindError(
  kind: EntityFieldKind,
  value: unknown,
  loc: ReadonlyArray<string | number>,
): PydanticStyleError | null {
  const attempt = (fn: () => unknown): boolean => {
    try {
      fn();
      return true;
    } catch {
      return false;
    }
  };
  switch (kind) {
    case "int":
    case "int64": {
      // Same pydantic `int` error family; only the acceptance differs.
      const coerce = kind === "int" ? coerceInt : coerceInt64;
      if (attempt(() => coerce(value))) {
        return null;
      }
      if (typeof value === "string") {
        return {
          type: "int_parsing",
          loc,
          msg: "Input should be a valid integer, unable to parse string as an integer",
          input: value,
        };
      }
      if (typeof value === "number") {
        return {
          type: "int_from_float",
          loc,
          msg: "Input should be a valid integer, got a number with a fractional part",
          input: value,
        };
      }
      return {
        type: "int_type",
        loc,
        msg: "Input should be a valid integer",
        input: value,
      };
    }
    case "str": {
      if (attempt(() => coerceStr(value))) {
        return null;
      }
      return {
        type: "string_type",
        loc,
        msg: "Input should be a valid string",
        input: value,
      };
    }
    case "bool": {
      if (attempt(() => coerceBool(value))) {
        return null;
      }
      if (typeof value === "string" || typeof value === "number") {
        return {
          type: "bool_parsing",
          loc,
          msg: "Input should be a valid boolean, unable to interpret input",
          input: value,
        };
      }
      return {
        type: "bool_type",
        loc,
        msg: "Input should be a valid boolean",
        input: value,
      };
    }
    case "float": {
      if (attempt(() => coerceFloat(value))) {
        return null;
      }
      if (typeof value === "string") {
        return {
          type: "float_parsing",
          loc,
          msg: "Input should be a valid number, unable to parse string as a number",
          input: value,
        };
      }
      return {
        type: "float_type",
        loc,
        msg: "Input should be a valid number",
        input: value,
      };
    }
  }
}

/**
 * Build the pydantic "null where not allowed" error for a kinded field.
 *
 * @param kind - The field's scalar kind (drives the `*_type` tag).
 * @param loc - The error location tuple.
 * @returns The error entry.
 */
function nullNotAllowedError(
  kind: EntityFieldKind | undefined,
  loc: ReadonlyArray<string | number>,
): PydanticStyleError {
  switch (kind) {
    case "int":
    case "int64": {
      return {
        type: "int_type",
        loc,
        msg: "Input should be a valid integer",
        input: null,
      };
    }
    case "str": {
      return {
        type: "string_type",
        loc,
        msg: "Input should be a valid string",
        input: null,
      };
    }
    case "bool": {
      return {
        type: "bool_type",
        loc,
        msg: "Input should be a valid boolean",
        input: null,
      };
    }
    case "float": {
      return {
        type: "float_type",
        loc,
        msg: "Input should be a valid number",
        input: null,
      };
    }
    case undefined: {
      // No scalar kind declared — a nested-model field.
      return {
        type: "model_type",
        loc,
        msg: "Input should be a valid dictionary or instance",
        input: null,
      };
    }
  }
}

/**
 * Return the payload key pydantic would bind to `spec` — the attribute
 * name when accepted, otherwise the first present validation alias.
 *
 * @param payload - The raw payload.
 * @param spec - The field spec.
 * @returns The matched key, or `null` when the field is absent.
 */
function matchedKey(
  payload: Readonly<Record<string, unknown>>,
  spec: EntityFieldSpec,
): string | null {
  const candidates: string[] = [];
  if (spec.nameAccepted !== false) {
    candidates.push(spec.name);
  }
  candidates.push(...(spec.aliases ?? []));
  for (const key of candidates) {
    if (Object.hasOwn(payload, key) && payload[key] !== undefined) {
      return key;
    }
  }
  return null;
}

/**
 * Return the `loc` pydantic reports for an absent field: the validation
 * alias when one is configured, else the attribute name.
 *
 * @param spec - The field spec.
 * @returns The `loc` element.
 */
function aliasLoc(spec: EntityFieldSpec): string {
  return spec.aliases?.[0] ?? spec.name;
}

/**
 * Collect pydantic-v2-shaped errors for one payload against a model's
 * field specs (the `model_validate` failure list, in `model_fields`
 * order — exactly the order pydantic reports).
 *
 * @param cls - The entity-model statics.
 * @param payload - The raw payload.
 * @returns The error list (empty when the payload validates).
 */
function collectModelErrors(
  cls: EntityModelStatics,
  payload: unknown,
): PydanticStyleError[] {
  if (!isPythonDict(payload)) {
    return [
      {
        type: "model_type",
        loc: [],
        msg: `Input should be a valid dictionary or instance of ${cls.modelName}`,
        input: payload,
      },
    ];
  }
  const errors: PydanticStyleError[] = [];
  for (const spec of cls.fieldSpecs) {
    // Pydantic accepts the attribute name and every validation alias
    // (`populate_by_name=True` + `AliasChoices`), and reports the alias
    // in `loc` for an aliased field: `Bookmark.model_validate({"id":1,
    // "name":"A"})` yields `loc == ["type"]`, and both `type=` and
    // `bookmark_type=` are accepted.
    const matched = matchedKey(payload, spec);
    const loc = [matched ?? aliasLoc(spec)] as const;
    if (matched === null) {
      if (spec.required === true) {
        errors.push({
          type: "missing",
          loc,
          msg: "Field required",
          input: payload,
        });
      }
      continue;
    }
    const value = payload[matched];
    if (value === null) {
      if (spec.nullable !== true) {
        errors.push(nullNotAllowedError(spec.kind, loc));
      }
      continue;
    }
    if (spec.kind !== undefined) {
      const error = classifyKindError(spec.kind, value, loc);
      if (error !== null) {
        errors.push(error);
      }
    }
    // Nested-model / constraint failures surface through the model
    // constructor below; no current consumer carries them, and the
    // pydantic list shape for those rows is not corpus-locked.
  }
  return errors;
}

/**
 * Validate an API response payload against an entity response model.
 *
 * @param model - The response model class to validate against.
 * @param payload - The raw (already JSON-decoded, native-valued)
 *   response payload.
 * @param options - Carries `endpoint`, the calling method name used for
 *   the error message and debugging context.
 * @returns The validated model instance.
 * @throws {@link ResponseValidationError} - The payload does not conform
 *   to the model (code `RESPONSE_VALIDATION_ERROR`); the pydantic-style
 *   error list is carried in `details.errors` and the model name in
 *   `details.model`.
 * @example
 * ```typescript
 * const ws = validateResponseModel(PublicWorkspace, raw, {
 *   endpoint: "list_workspaces",
 * });
 * ```
 * @see mixpanel_headless._internal.response_validation.validate_response_model
 */
export function validateResponseModel<T extends EntityModel>(
  model: ResponseModelClass<T>,
  payload: unknown,
  options: { readonly endpoint: string },
): T {
  const errors = collectModelErrors(model, payload);
  if (errors.length > 0) {
    throw new ResponseValidationError(
      `${options.endpoint}: API response failed ${model.modelName} validation`,
      "RESPONSE_VALIDATION_ERROR",
      {
        model: model.modelName,
        errors: errors.map((e) => ({
          type: e.type,
          loc: [...e.loc],
          msg: e.msg,
          input: e.input,
        })),
      },
    );
  }
  try {
    return model.fromDict(payload);
  } catch (error) {
    if (error instanceof ResponseValidationError) {
      // A failure the collector's spec walk did not classify (nested
      // model / constraint checks). Wrap with the module's message and
      // details shape; the underlying error rides on `cause`.
      throw new ResponseValidationError(
        `${options.endpoint}: API response failed ${model.modelName} validation`,
        "RESPONSE_VALIDATION_ERROR",
        { model: model.modelName, errors: [] },
        { cause: error },
      );
    }
    throw error;
  }
}

/**
 * Validate a sequence of API response payloads against a response model.
 *
 * @param model - The response model class to validate against.
 * @param payloads - Iterable of raw payload items.
 * @param options - Carries `endpoint` (see
 *   {@link validateResponseModel}).
 * @returns List of validated model instances, in input order.
 * @throws {@link ResponseValidationError} - Any item does not conform
 *   (raised at the first failing item, exactly like the Python
 *   comprehension).
 * @example
 * ```typescript
 * const workspaces = validateResponseModels(PublicWorkspace, rows, {
 *   endpoint: "list_workspaces",
 * });
 * ```
 * @see mixpanel_headless._internal.response_validation.validate_response_models
 */
export function validateResponseModels<T extends EntityModel>(
  model: ResponseModelClass<T>,
  payloads: Iterable<unknown>,
  options: { readonly endpoint: string },
): T[] {
  const out: T[] = Array.from(payloads, (payload) =>
    validateResponseModel(model, payload, options),
  );
  return out;
}
