/**
 * Response-model validation seam for App API payloads — TS port of
 * `mixpanel_headless/_internal/response_validation.py` (whole module).
 *
 * Ownership note (recorded in `context/phase3/notes/B4-C1-notes.md`):
 * the playbook's B5 row lists `response_validation.py`, but B4-C1's
 * `list_workspaces` is the first consumer, so the module ports HERE and
 * B5 imports it (R10.8 — one implementation, by name).
 *
 * Python wraps `pydantic.ValidationError` into the domain
 * `ResponseValidationError` (code `RESPONSE_VALIDATION_ERROR`) carrying
 * pydantic's structured error list in `details.errors`. The TS twin
 * collects a pydantic-v2-shaped error list (`{type, loc, msg, input}`,
 * `include_url=False`) over the entity-model field specs, mirroring the
 * lax-JSON validation the Phase-2 `EntityModel`/`coerce.ts` machinery
 * applies.
 *
 * Corpus lock: the `type: "missing"` rows are locked byte-exactly by the
 * `api_client.list_workspaces` ResponseValidationError vectors. The
 * non-missing rows follow the pydantic-v2 JSON-mode tables (verified
 * against pydantic 2.x wording).
 * TODO(port): non-missing pydantic `type`/`msg` rows are not yet
 * corpus-locked — if a later batch records vectors exercising them,
 * re-verify the wording against that pin (R10.3 disclosure; the
 * structure and error CLASS/code are locked either way).
 */

import { coerceBool, coerceFloat, coerceInt, coerceStr } from "../coerce.js";
import { ResponseValidationError } from "../errors.js";
import { isPythonDict } from "../query/validation-shared.js";
import type {
  EntityFieldKind,
  EntityModel,
  EntityModelStatics,
} from "../types/entities/model-base.js";

/** One pydantic-v2-shaped validation error (`errors(include_url=False)`). */
export interface PydanticStyleError {
  /** The pydantic error type tag (e.g. `"missing"`, `"int_parsing"`). */
  readonly type: string;
  /** Location tuple — the field path from the model root. */
  readonly loc: readonly (string | number)[];
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
  loc: readonly (string | number)[],
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
    case "int": {
      if (attempt(() => coerceInt(value))) {
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
 * The pydantic "null where not allowed" error for a kinded field.
 *
 * @param kind - The field's scalar kind (drives the `*_type` tag).
 * @param loc - The error location tuple.
 * @returns The error entry.
 */
function nullNotAllowedError(
  kind: EntityFieldKind | undefined,
  loc: readonly (string | number)[],
): PydanticStyleError {
  switch (kind) {
    case "int":
      return {
        type: "int_type",
        loc,
        msg: "Input should be a valid integer",
        input: null,
      };
    case "str":
      return {
        type: "string_type",
        loc,
        msg: "Input should be a valid string",
        input: null,
      };
    case "bool":
      return {
        type: "bool_type",
        loc,
        msg: "Input should be a valid boolean",
        input: null,
      };
    case "float":
      return {
        type: "float_type",
        loc,
        msg: "Input should be a valid number",
        input: null,
      };
    default:
      return {
        type: "model_type",
        loc,
        msg: "Input should be a valid dictionary or instance",
        input: null,
      };
  }
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
    const loc = [spec.name] as const;
    const present =
      Object.hasOwn(payload, spec.name) && payload[spec.name] !== undefined;
    if (!present) {
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
    const value = payload[spec.name];
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
    // constructor below; no Phase-2 C1 consumer carries them, and the
    // pydantic list shape for those rows is not yet corpus-locked.
  }
  return errors;
}

/**
 * Validate an API response payload against an entity response model —
 * TS port of `validate_response_model` (`response_validation.py`).
 *
 * @param model - The response model class to validate against.
 * @param payload - The raw (already JSON-decoded, native-valued)
 *   response payload.
 * @param options - Carries `endpoint`, the calling method name used for
 *   the error message and debugging context.
 * @returns The validated model instance.
 * @throws ResponseValidationError - The payload does not conform to the
 *   model (code `RESPONSE_VALIDATION_ERROR`); the pydantic-style error
 *   list is carried in `details.errors` and the model name in
 *   `details.model`.
 *
 * @example
 * ```typescript
 * const ws = validateResponseModel(PublicWorkspace, raw, {
 *   endpoint: "list_workspaces",
 * });
 * ```
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
  } catch (cause) {
    if (cause instanceof ResponseValidationError) {
      // A failure the collector's spec walk did not classify (nested
      // model / constraint checks). Wrap with the module's message and
      // details shape; the underlying error rides on `cause`.
      throw new ResponseValidationError(
        `${options.endpoint}: API response failed ${model.modelName} validation`,
        "RESPONSE_VALIDATION_ERROR",
        { model: model.modelName, errors: [] },
        { cause },
      );
    }
    throw cause;
  }
}

/**
 * Validate a sequence of API response payloads against a response model
 * — TS port of `validate_response_models` (`response_validation.py`).
 *
 * @param model - The response model class to validate against.
 * @param payloads - Iterable of raw payload items.
 * @param options - Carries `endpoint` (see
 *   {@link validateResponseModel}).
 * @returns List of validated model instances, in input order.
 * @throws ResponseValidationError - Any item does not conform (raised
 *   at the FIRST failing item, exactly like the Python comprehension).
 */
export function validateResponseModels<T extends EntityModel>(
  model: ResponseModelClass<T>,
  payloads: Iterable<unknown>,
  options: { readonly endpoint: string },
): T[] {
  const out: T[] = [];
  for (const payload of payloads) {
    out.push(validateResponseModel(model, payload, options));
  }
  return out;
}
