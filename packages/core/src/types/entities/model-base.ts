/**
 * Shared plumbing for the Pydantic entity/param model ports
 * (phase2-design C5, packet P2-7).
 *
 * Each of the 125 exported Pydantic models becomes a hand-written TS
 * class extending {@link EntityModel}. The base implements the exact
 * behavioral mirror of the Python model boundary that Phase 2 locks:
 *
 * - **Construction** (`new Model(fields)`): required-field checks,
 *   defaults fired only on ABSENT keys (`default_factory` rule, R4.12),
 *   Pydantic-lax scalar coercion via `coerce.ts`, nested-model
 *   reconstruction, and the per-class `extra` policy
 *   (`ignore`/`allow`/`forbid`) exactly as `model_config` declares it.
 * - **`fromDict`** (strict decode seam): accepts the Pydantic
 *   validation-alias set per field (explicit `AliasChoices` /
 *   `alias_generator=to_camel` + `populate_by_name` ports — never a
 *   generic camelizer, R3.4) and routes through the constructor.
 * - **`toJSON`** — the recorder's `tagged_models=False` field walk:
 *   every declared field under its PYTHON attribute name, `null` for
 *   Python `None`, datetimes as iso text, computed fields appended
 *   (the shape entity wire vectors record under `expect.result`).
 * - **`toVectorPayload`** (`@internal`) — same walk but `$type`-tagged
 *   datetime leaves, byte-matching the recorded payloads for the C8(b)
 *   golden diff.
 *
 * Wire SERIALIZATION aliases (Pydantic `serialization_alias` /
 * `to_camel` output spelling) are carried on every {@link EntityFieldSpec}
 * as `wire` but are NOT consumed in Phase 2: request-body serialization
 * of the `*Params` models is a named C8 deferral locked by the Phase-3
 * B4/B6 wire vectors, and the entity clients that consume `wire` land
 * there.
 *
 * Validation failures throw {@link ResponseValidationError}: Pydantic
 * model-construction failures are the generic
 * `VALIDATION_ERROR`/`RESPONSE_VALIDATION_ERROR` boundary (R5.5, design
 * C4) and every Phase-2 construction site is a vector-decode/golden
 * seam; Phase-3 param seams may re-wrap.
 *
 * @internal Everything here is plumbing for the entity classes, the
 * C8 golden tests, and the conformance codecs — none of it is part of
 * the public package surface.
 */

import { coerceBool, coerceFloat, coerceInt, coerceStr } from "../../coerce.js";
import { ResponseValidationError } from "../../errors.js";

/**
 * Lax scalar coercion kinds (R4.12) applied to non-null present values.
 *
 * @internal
 */
export type EntityFieldKind = "int" | "str" | "bool" | "float";

/**
 * Options of {@link EntityModel.modelDumpExcludeNone} — the pydantic
 * `model_dump(...)` flags the B6 facade members pass (B6-W2).
 */
export interface ModelDumpOptions {
  /**
   * Pydantic `by_alias=True`: emit each declared field under its
   * serialization alias ({@link EntityFieldSpec.wire}) when one is
   * configured. Threads into nested models, exactly as pydantic does.
   */
  readonly byAlias?: boolean;
}

/**
 * One declared Python model field, in `model_fields` order.
 *
 * @internal
 */
export interface EntityFieldSpec {
  /** The Python attribute name (exact spelling — R3.6/R7.6). */
  readonly name: string;
  /** True when the Python field has no default (`is_required()`). */
  readonly required?: boolean;
  /**
   * Default THUNK for absent keys. Fires ONLY on absence — an explicit
   * `null` stays `null` (R4.10/R4.12 `default_factory` rule). Omitted
   * for optional fields whose Python default is `None`.
   */
  readonly default?: () => unknown;
  /**
   * Accepted input keys BESIDES `name` (the Pydantic validation-alias
   * set: `AliasChoices` members, `to_camel` spellings). `name` itself
   * is accepted whenever Python does (`populate_by_name=True` or no
   * alias configured); classes with alias-only fields list every
   * accepted key here and set `nameAccepted: false`.
   */
  readonly aliases?: readonly string[];
  /**
   * False when Pydantic would REJECT the attribute name as an input
   * key (alias configured without `populate_by_name`). No Phase-2
   * model needs this today; present for spec completeness.
   */
  readonly nameAccepted?: boolean;
  /**
   * The wire serialization key (Pydantic `serialization_alias` /
   * generator output). Recorded for the Phase-3 B6 request-body
   * serializers; unused in Phase 2 (see module doc).
   */
  readonly wire?: string;
  /** Lax scalar coercion kind for non-null values (R4.12). */
  readonly kind?: EntityFieldKind;
  /**
   * True when the Python annotation admits `None` (`T | None`). An
   * explicit `null` for a NON-nullable field is rejected exactly as
   * Pydantic rejects `None` there.
   */
  readonly nullable?: boolean;
  /**
   * True for Python `datetime` fields: values decode to preserved
   * iso-8601 TEXT (accepting the runner's duck-typed `iso`-carrying
   * wrapper or a raw string) and re-tag as `$type: datetime` in
   * `toVectorPayload()`.
   */
  readonly datetime?: boolean;
  /**
   * Nested entity-model class (LAZY thunk — forward/cross-file refs).
   * Plain-object values reconstruct via the class `fromDict`; existing
   * instances pass through.
   */
  readonly nested?: () => EntityModelStatics;
  /** Container shape for `nested` (absent = single nested value). */
  readonly container?: "list" | "dict";
  /**
   * Pydantic `mode="before"` field-validator port — runs on the raw
   * present value before any other processing.
   */
  readonly before?: (value: unknown) => unknown;
  /**
   * Field-constraint port (Pydantic `Field(min_length=...)` etc.).
   * Throws {@link ResponseValidationError} on violation. String
   * lengths are CODEPOINT-counted (R11.6).
   */
  readonly check?: (value: unknown, path: string) => void;
}

/**
 * One Pydantic `@computed_field` port: appended to `toJSON()` /
 * `toVectorPayload()` output after the declared fields (the recorder
 * includes computed fields in expect position only), and DROPPED from
 * `fromDict` input (they never reach a constructor at decode time).
 *
 * @internal
 */
export interface ComputedFieldSpec {
  /** The Python computed-field name. */
  readonly name: string;
  /** Compute the value from the constructed instance. */
  readonly get: (instance: EntityModel) => unknown;
}

/**
 * The per-class static contract every entity model carries.
 *
 * @internal
 */
export interface EntityModelStatics {
  /** The Python model name (also the `$type` tag where one exists). */
  readonly modelName: string;
  /** Pydantic `model_config.extra` (default `ignore`). */
  readonly extraPolicy: "ignore" | "allow" | "forbid";
  /** Declared fields in Python `model_fields` order. */
  readonly fieldSpecs: readonly EntityFieldSpec[];
  /** `@computed_field` ports (empty for all but `BusinessContext`). */
  readonly computedSpecs?: readonly ComputedFieldSpec[];
  /** The strict decode factory (present on every concrete class). */
  readonly fromDict: (raw: unknown) => EntityModel;
  /** Constructable (the base processes the already-aliased bag). */
  new (fields: never): EntityModel;
}

/**
 * Raise the model-boundary validation error.
 *
 * @param path - `Model.field` style location.
 * @param message - What was violated (message text out of contract,
 *   R5.4).
 * @returns Never returns.
 * @throws ResponseValidationError - Always.
 * @internal
 */
export function modelFail(path: string, message: string): never {
  throw new ResponseValidationError(`${path}: ${message}`);
}

/**
 * Count Unicode codepoints (R11.6 — never UTF-16 units).
 *
 * @param text - The string to measure.
 * @returns The codepoint count.
 * @internal
 */
export function codepointLength(text: string): number {
  return [...text].length;
}

/**
 * Extract preserved iso text from a datetime-valued input: raw string,
 * or the runner's duck-typed `PyDatetime` wrapper (an object carrying a
 * string `iso` field — this module cannot import the runner class;
 * dependency direction is runner -> core).
 *
 * @param value - The decoded child value.
 * @param path - `Model.field` location for errors.
 * @returns The iso-8601 text.
 * @throws ResponseValidationError - When neither shape matches.
 * @internal
 */
export function requireIsoText(value: unknown, path: string): string {
  if (typeof value === "string") {
    return value;
  }
  if (
    typeof value === "object" &&
    value !== null &&
    "iso" in value &&
    typeof (value as { iso: unknown }).iso === "string"
  ) {
    return (value as { iso: string }).iso;
  }
  return modelFail(path, `expected a datetime, got ${describeValue(value)}`);
}

/**
 * Describe a value's JSON kind for error messages.
 *
 * @param value - Any value.
 * @returns A short kind label.
 * @internal
 */
function describeValue(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  return typeof value;
}

/**
 * Whether a value is a plain object (candidate nested-model payload).
 *
 * @param value - Any value.
 * @returns True for non-null non-array objects.
 * @internal
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Apply one field's lax scalar coercion (R4.12 response-lax tables).
 *
 * @param kind - The declared scalar kind.
 * @param value - The non-null input value.
 * @param path - `Model.field` location threaded into coerce errors.
 * @returns The coerced scalar.
 * @throws ResponseValidationError - On uncoercible input (re-wrapped
 *   from the coerce module's error).
 * @internal
 */
function coerceScalar(
  kind: EntityFieldKind,
  value: unknown,
  path: string,
): unknown {
  try {
    switch (kind) {
      case "int":
        return coerceInt(value, { kind: "response", field: path });
      case "str":
        return coerceStr(value, { kind: "response", field: path });
      case "bool":
        return coerceBool(value, { kind: "response", field: path });
      case "float":
        return coerceFloat(value, { kind: "response", field: path });
    }
  } catch (error) {
    if (error instanceof ResponseValidationError) {
      throw error;
    }
    return modelFail(
      path,
      error instanceof Error ? error.message : "uncoercible",
    );
  }
}

/**
 * Reconstruct one nested-model field value.
 *
 * @param spec - The owning field spec (with `nested`, maybe
 *   `container`).
 * @param value - The non-null input value (instances pass through;
 *   plain objects decode via the nested class `fromDict`).
 * @param path - `Model.field` location for errors.
 * @returns The reconstructed value.
 * @throws ResponseValidationError - On shape mismatches.
 * @internal
 */
function reconstructNested(
  spec: EntityFieldSpec,
  value: unknown,
  path: string,
): unknown {
  const nested = (spec.nested as () => EntityModelStatics)();
  const one = (item: unknown, where: string): unknown => {
    if (item instanceof EntityModel) {
      return item;
    }
    if (isPlainObject(item)) {
      return nested.fromDict(item);
    }
    return modelFail(where, `expected a ${nested.modelName} payload`);
  };
  if (spec.container === "list") {
    if (!Array.isArray(value)) {
      return modelFail(path, "expected an array");
    }
    return value.map((item, index) => one(item, `${path}[${String(index)}]`));
  }
  if (spec.container === "dict") {
    if (!isPlainObject(value)) {
      return modelFail(path, "expected an object");
    }
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = one(item, `${path}.${key}`);
    }
    return out;
  }
  return one(value, path);
}

/**
 * Resolve a raw input mapping to a canonical field bag: alias keys map
 * to attribute names, computed-field keys are dropped, and unknown keys
 * follow the class `extra` policy. This is the `fromDict` half —
 * constructors receive attribute-name bags directly.
 *
 * @param cls - The entity-model statics.
 * @param raw - The raw payload.
 * @returns The canonical bag ready for the constructor.
 * @throws ResponseValidationError - When `raw` is not a plain object,
 *   an alias collides, or an unknown key hits `extra='forbid'`.
 * @internal
 */
export function prepareInit(
  cls: EntityModelStatics,
  raw: unknown,
): Record<string, unknown> {
  if (!isPlainObject(raw)) {
    return modelFail(cls.modelName, "expected a mapping payload");
  }
  const keyToField = new Map<string, string>();
  for (const spec of cls.fieldSpecs) {
    if (spec.nameAccepted !== false) {
      keyToField.set(spec.name, spec.name);
    }
    for (const alias of spec.aliases ?? []) {
      keyToField.set(alias, spec.name);
    }
  }
  const computed = new Set((cls.computedSpecs ?? []).map((c) => c.name));
  const bag: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === "$type" || computed.has(key)) {
      continue; // computed fields never reach a constructor at decode time
    }
    const field = keyToField.get(key);
    if (field === undefined) {
      // Unknown keys flow to the constructor, which applies the
      // per-class extra policy (forbid/allow/ignore) in one place.
      bag[key] = value;
      continue;
    }
    if (Object.hasOwn(bag, field) && field !== key) {
      // Pydantic: the alias wins over the attribute name when both are
      // present; later AliasChoices entries never override earlier hits.
      continue;
    }
    bag[field] = value;
  }
  return bag;
}

/**
 * Base class of every entity-model port. Subclasses `declare` their
 * readonly fields; this constructor validates and assigns them.
 *
 * @internal Concrete entity classes are public; the base is plumbing.
 */
export abstract class EntityModel {
  /**
   * Pydantic `extra='allow'` spillover: unknown input keys retained on
   * the instance (mirroring `__pydantic_extra__`) but EXCLUDED from
   * `toJSON()`/`toVectorPayload()` — the recorder walks `model_fields`
   * only, so extras never appear in vector payloads.
   *
   * @internal
   */
  readonly __extras: Readonly<Record<string, unknown>>;

  /**
   * Validate and assign one canonical field bag.
   *
   * @param cls - The concrete class statics (field specs, extra
   *   policy).
   * @param fields - Attribute-name-keyed input values (from a caller
   *   or `prepareInit`). `undefined` values count as ABSENT (R4.10).
   * @throws ResponseValidationError - On missing required fields,
   *   unknown keys under `extra='forbid'`, failed coercion, nested
   *   reconstruction failures, or constraint violations.
   */
  protected constructor(
    cls: EntityModelStatics,
    fields: Readonly<Record<string, unknown>>,
  ) {
    const known = new Set(cls.fieldSpecs.map((spec) => spec.name));
    const extras: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (known.has(key) || value === undefined) {
        continue;
      }
      if (cls.extraPolicy === "forbid") {
        modelFail(cls.modelName, `unknown field ${JSON.stringify(key)}`);
      }
      if (cls.extraPolicy === "allow") {
        extras[key] = value;
      }
    }
    const out: Record<string, unknown> = {};
    for (const spec of cls.fieldSpecs) {
      const path = `${cls.modelName}.${spec.name}`;
      const present =
        Object.hasOwn(fields, spec.name) && fields[spec.name] !== undefined;
      if (!present) {
        if (spec.required === true) {
          modelFail(path, "field required");
        }
        // Defaults fire ONLY on absence; Python `None` defaults land
        // as `null` (the attribute always materializes, like Pydantic).
        out[spec.name] = spec.default === undefined ? null : spec.default();
        continue;
      }
      let value: unknown = fields[spec.name];
      if (spec.before !== undefined) {
        value = spec.before(value);
      }
      if (value === null && spec.nullable !== true) {
        modelFail(path, "field is not nullable");
      }
      if (value !== null && value !== undefined) {
        if (spec.kind !== undefined) {
          value = coerceScalar(spec.kind, value, path);
        }
        if (spec.datetime === true) {
          value = requireIsoText(value, path);
        }
        if (spec.nested !== undefined) {
          value = reconstructNested(spec, value, path);
        }
      } else {
        value = null;
      }
      if (spec.check !== undefined) {
        spec.check(value, path);
      }
      out[spec.name] = value;
    }
    Object.assign(this, out);
    this.__extras = extras;
    this.afterValidate();
  }

  /**
   * Pydantic `model_validator(mode="after")` port hook — subclasses
   * with a Python after-validator override this; the base is a no-op.
   *
   * @throws ResponseValidationError - Subclasses throw on violations.
   */
  protected afterValidate(): void {
    // Default: no model-level validator.
  }

  /**
   * The concrete class statics for this instance.
   *
   * @returns The statics carried on `this.constructor`.
   * @internal
   */
  private statics(): EntityModelStatics {
    return this.constructor as unknown as EntityModelStatics;
  }

  /**
   * Serialize the recorder's `tagged_models=False` field walk: every
   * declared field under its Python attribute name (`null` for
   * `None`), nested models recursing, datetimes as ISO TEXT, computed
   * fields appended after the declared walk.
   *
   * @returns The plain to-dict shape entity vectors record under
   *   `expect.result`.
   */
  toJSON(): Record<string, unknown> {
    return this.walk("json");
  }

  /**
   * Serialize the golden/codec payload form: identical to
   * {@link toJSON} except datetime fields re-tag as
   * `{$type: "datetime", iso}` exactly as the recorder emits them.
   *
   * @returns The vector-payload shape (C8b golden diff input).
   * @internal
   */
  toVectorPayload(): Record<string, unknown> {
    return this.walk("vector");
  }

  /**
   * Pydantic `model_dump(exclude_none=True)` — the request-body dump
   * every entity-CRUD facade member performs on its params model
   * (e.g. `create_dashboard`, `workspace.py:4564`; `create_cohort`,
   * `:5643`). W1-D4: ONE implementation for all of B6 (R10.8) — a
   * shard re-deriving it is a review finding.
   *
   * Semantics measured against pydantic v2 (2026-08-16):
   *
   * - declared fields, EXTRAS and computed fields all take part;
   * - any of them whose value is `None`/absent is DROPPED;
   * - nested models recurse (their own `None` fields drop too);
   * - lists map element-wise (no element is dropped);
   * - plain dict values KEEP their `None`s — `exclude_none` reaches
   *   model fields, not mapping entries;
   * - datetimes render as ISO text, exactly as {@link toJSON} does.
   *
   * {@link toJSON} is NOT a substitute: it keeps `None` as `null`, and
   * absent-vs-null is vector-observable (R3.5).
   *
   * B6-W2 extension (`b6-packets.md` §4; 21 `by_alias=True` dump sites
   * in `workspace.py`, e.g. `finalize_blueprint` :4985,
   * `create_rca_dashboard` :5022, `update_report_link` :5109): passing
   * `byAlias` emits each declared field under its
   * {@link EntityFieldSpec.wire} serialization key when one is
   * configured, RECURSIVELY (pydantic threads `by_alias` into nested
   * models). Extras and computed fields have no alias and keep their
   * own key.
   *
   * @param options - `byAlias` mirrors pydantic's `by_alias=True`.
   * @returns The exclude-none mapping.
   *
   * @example
   * ```typescript
   * new BusinessContext({ level: "project", content: "" })
   *   .modelDumpExcludeNone();
   * // { level: "project", content: "", is_empty: true, character_count: 0 }
   * ```
   */
  modelDumpExcludeNone(
    options: ModelDumpOptions = {},
  ): Record<string, unknown> {
    return this.dumpFields(options.byAlias === true, true);
  }

  /**
   * Pydantic `model_dump()` — the PLAIN request-body dump, keeping
   * `None` values as `null`. B6-W8 (`b6-packets.md` §10) added it for
   * the two facade sites that dump WITHOUT `exclude_none`:
   * `update_anomaly` (`workspace.py:9169`) and
   * `bulk_update_anomalies` (`:9198`), both
   * `params.model_dump(by_alias=True)`.
   *
   * Same walk as {@link modelDumpExcludeNone} — declared fields,
   * extras and computed fields, nested models recursing, `byAlias`
   * threading into nested models — except that nothing is dropped:
   * a `None` field emits `null` under its key.
   *
   * {@link toJSON} is NOT a substitute: it walks `model_fields` only
   * (no extras) and never applies serialization aliases, because it
   * mirrors the RECORDER's payload shape rather than pydantic's dump.
   *
   * @param options - `byAlias` mirrors pydantic's `by_alias=True`.
   * @returns The dump mapping.
   *
   * @example
   * ```typescript
   * new UpdateAnomalyParams({ id: 1, status: "open", anomaly_class: "Event" })
   *   .modelDump({ byAlias: true });
   * // { id: 1, status: "open", anomalyClass: "Event" }
   * ```
   */
  modelDump(options: ModelDumpOptions = {}): Record<string, unknown> {
    return this.dumpFields(options.byAlias === true, false);
  }

  /**
   * Shared walk behind {@link modelDumpExcludeNone} and
   * {@link modelDump}.
   *
   * @param byAlias - Emit serialization aliases for declared fields.
   * @param excludeNone - Drop `None`/absent values (pydantic
   *   `exclude_none=True`).
   * @returns The dump mapping.
   * @internal
   */
  private dumpFields(
    byAlias: boolean,
    excludeNone: boolean,
  ): Record<string, unknown> {
    const cls = this.statics();
    const out: Record<string, unknown> = {};
    const self = this as unknown as Readonly<Record<string, unknown>>;
    const skip = (value: unknown): boolean =>
      excludeNone && (value === null || value === undefined);
    for (const spec of cls.fieldSpecs) {
      const value = self[spec.name];
      if (skip(value)) {
        continue;
      }
      const key = byAlias ? (spec.wire ?? spec.name) : spec.name;
      out[key] =
        spec.datetime === true && typeof value === "string"
          ? value
          : dumpValue(value, byAlias, excludeNone);
    }
    for (const [key, value] of Object.entries(this.__extras)) {
      if (skip(value)) {
        continue;
      }
      out[key] = dumpValue(value, byAlias, excludeNone);
    }
    for (const computed of cls.computedSpecs ?? []) {
      const value = computed.get(this);
      if (skip(value)) {
        continue;
      }
      out[computed.name] = dumpValue(value, byAlias, excludeNone);
    }
    return out;
  }

  /**
   * Shared serializer behind {@link toJSON}/{@link toVectorPayload}.
   *
   * @param mode - Datetime rendering mode.
   * @returns The serialized mapping.
   * @internal
   */
  private walk(mode: "json" | "vector"): Record<string, unknown> {
    const cls = this.statics();
    const out: Record<string, unknown> = {};
    const self = this as unknown as Readonly<Record<string, unknown>>;
    for (const spec of cls.fieldSpecs) {
      const value = self[spec.name];
      if (spec.datetime === true && typeof value === "string") {
        out[spec.name] =
          mode === "vector" ? { $type: "datetime", iso: value } : value;
        continue;
      }
      out[spec.name] = serializeValue(value, mode);
    }
    for (const computed of cls.computedSpecs ?? []) {
      out[computed.name] = computed.get(this);
    }
    return out;
  }
}

/**
 * Build a membership `check` for `Literal`/Enum-typed fields (Pydantic
 * rejects non-member values; `null` is handled by the `nullable` flag
 * and skipped here).
 *
 * @param values - The allowed member values.
 * @returns A field `check` thunk.
 * @internal
 */
export function oneOf(
  values: readonly (string | number)[],
): (value: unknown, path: string) => void {
  const allowed = new Set<unknown>(values);
  return (value, path) => {
    if (value === null || allowed.has(value)) {
      return;
    }
    modelFail(path, `expected one of ${values.map(String).join(", ")}`);
  };
}

/**
 * Serialize one value for {@link EntityModel.modelDumpExcludeNone} /
 * {@link EntityModel.modelDump} (nested models recurse with the SAME
 * exclusion setting, exactly as pydantic threads `exclude_none`; lists
 * map element-wise; plain dicts keep their `None` values; scalars pass
 * through).
 *
 * @param value - The stored value.
 * @param byAlias - Emit serialization aliases inside nested models.
 * @param excludeNone - Whether nested models drop their `None` fields.
 * @returns The dumped value.
 * @internal
 */
function dumpValue(
  value: unknown,
  byAlias: boolean,
  excludeNone: boolean,
): unknown {
  if (value instanceof EntityModel) {
    return excludeNone
      ? value.modelDumpExcludeNone({ byAlias })
      : value.modelDump({ byAlias });
  }
  if (Array.isArray(value)) {
    return value.map((item) => dumpValue(item, byAlias, excludeNone));
  }
  if (isPlainObject(value)) {
    // Pydantic keeps `None` VALUES inside plain dict fields
    // (measured 2026-08-16) — only model fields are excluded.
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] =
        item === undefined ? null : dumpValue(item, byAlias, excludeNone);
    }
    return out;
  }
  return value;
}

/**
 * Serialize one field value for {@link EntityModel.toJSON} /
 * {@link EntityModel.toVectorPayload}.
 *
 * @param value - The value to serialize.
 * @param mode - Datetime rendering mode.
 * @returns The serialized value.
 * @internal
 */
function serializeValue(value: unknown, mode: "json" | "vector"): unknown {
  if (value instanceof EntityModel) {
    return mode === "vector" ? value.toVectorPayload() : value.toJSON();
  }
  if (Array.isArray(value)) {
    return value.map((item) => serializeValue(item, mode));
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = serializeValue(item, mode);
    }
    return out;
  }
  return value ?? null;
}
