/**
 * Shared plumbing for the Pydantic entity/param model ports
 * (phase2-design C5, packet P2-7).
 *
 * Every exported Pydantic model (124 classes across `types/entities/`
 * and `client/me.ts`) becomes a hand-written TS class extending
 * {@link EntityModel}. The base implements the exact
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
 * - **`toVectorPayload`** (rig-facing) — same walk but `$type`-tagged
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
 * The base class and the spec types are reachable from every public
 * entity class and so form part of the published declarations; the
 * decode helpers (`prepareInit`, `oneOf`, the module-private walkers)
 * are plumbing for the entity classes, the golden tests and the
 * conformance codecs only.
 */

import { orderedEntries } from "../../client/json-value.js";
import {
  coerceBool,
  coerceFloat,
  coerceInt,
  coerceInt64,
  coerceStr,
} from "../../coerce.js";
import { isPythonDict, setOwn } from "../../compat/python-dict.js";
import { ResponseValidationError } from "../../errors.js";
import { modelFail, requireIsoText } from "./decode-utils.js";

// The model-boundary failure lives in the leaf `decode-utils.ts` (shared
// with the result models); entity classes keep importing it from here,
// next to the base they extend.
export { modelFail } from "./decode-utils.js";
// TODO(Ω): shim — `workspace-members/lifecycle.ts` still imports
// `codepointLength` from here; repoint it to `compat/codepoint.ts` and
// delete this line.
export { cpLength as codepointLength } from "../../compat/codepoint.js";

/**
 * Lax scalar coercion kinds (R4.12) applied to non-null present values.
 *
 * `"int64"` is the `"int"` table without the double's 2^53 ceiling
 * ({@link coerceInt64}): the field materializes as a `number` when the
 * exact value is a safe integer and as a `bigint` otherwise. Reserved
 * for Python `int` fields whose live values exceed
 * `Number.MAX_SAFE_INTEGER` (lookup-table `data_group_id`s).
 */
export type EntityFieldKind = "int" | "int64" | "str" | "bool" | "float";

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
 * `K` is the set of attribute names the owning class declares (the keys
 * of its `XInit` constructor bag), so a spec whose `name` is not a
 * declared field fails to compile; the unparameterised form is the
 * class-agnostic view the rig and the response validator walk.
 */
export interface EntityFieldSpec<K extends string = string> {
  /** The Python attribute name (exact spelling — R3.6/R7.6). */
  readonly name: K;
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
  /**
   * Container shape for `nested` (absent = single nested value).
   *
   * `"ordered-dict"` (B8-MAPFIX, user ratification
   * `user-ratifications.md:14-22`) reconstructs into an
   * insertion-order-preserving `ReadonlyMap<string, Model>` (R4.8):
   * plain-object input reads the lossless layer's key-order sidecar
   * (`orderedEntries`), and `Map` input keeps its own order — the
   * Python-`dict`-order mirror for fields whose integer-like keys a
   * plain JS object cannot hold in insertion order (`MeResponse`'s
   * three container maps).
   */
  readonly container?: "list" | "dict" | "ordered-dict";
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
 * The declared field list of a class whose constructor bag is `F`: one
 * {@link EntityFieldSpec} per Python `model_fields` entry, each named by
 * a key of `F`. Every concrete class annotates its `fieldSpecs` static
 * with this so the runtime spec list and the `XInit` type cannot drift
 * apart on names.
 */
export type EntityFieldSpecs<F extends object> = ReadonlyArray<
  EntityFieldSpec<keyof F & string>
>;

/**
 * One Pydantic `@computed_field` port: appended to `toJSON()` /
 * `toVectorPayload()` output after the declared fields (the recorder
 * includes computed fields in expect position only), and DROPPED from
 * `fromDict` input (they never reach a constructor at decode time).
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
 * `F` is the class's constructor bag (`XInit`). `EntityModelStatics<XInit>`
 * is what `super(...)` and {@link prepareInit} take from a concrete class;
 * the unparameterised form (`F = never`) is the class-agnostic view for
 * heterogeneous tables (the rig's codec rows, nested-model thunks): its
 * field names are unconstrained and its constructor is deliberately
 * uncallable, since no bag type fits every class.
 */
export interface EntityModelStatics<F extends object = never> {
  /** The Python model name (also the `$type` tag where one exists). */
  readonly modelName: string;
  /** Pydantic `model_config.extra` (default `ignore`). */
  readonly extraPolicy: "ignore" | "allow" | "forbid";
  /** Declared fields in Python `model_fields` order. */
  readonly fieldSpecs: EntityFieldSpecs<F>;
  /** `@computed_field` ports (empty for all but `BusinessContext`). */
  readonly computedSpecs?: readonly ComputedFieldSpec[];
  /** The strict decode factory (present on every concrete class). */
  readonly fromDict: (raw: unknown) => EntityModel<F>;
  /** The public constructor over the attribute-name-keyed bag. */
  new (fields: F): EntityModel<F>;
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
      case "int": {
        return coerceInt(value, { kind: "response", field: path });
      }
      case "int64": {
        return coerceInt64(value, { kind: "response", field: path });
      }
      case "str": {
        return coerceStr(value, { kind: "response", field: path });
      }
      case "bool": {
        return coerceBool(value, { kind: "response", field: path });
      }
      case "float": {
        return coerceFloat(value, { kind: "response", field: path });
      }
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
    if (isPythonDict(item)) {
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
    if (!isPythonDict(value)) {
      return modelFail(path, "expected an object");
    }
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      setOwn(out, key, one(item, `${path}.${key}`));
    }
    return out;
  }
  if (spec.container === "ordered-dict") {
    // Python-dict-order container (see the EntityFieldSpec.container
    // doc): Map input keeps its order; plain-object input reads the
    // lossless key-order sidecar via `orderedEntries`.
    let entries: Array<[string, unknown]>;
    if (value instanceof Map) {
      entries = [...(value as ReadonlyMap<unknown, unknown>)].map(
        ([k, item]) => [String(k), item],
      );
    } else if (isPythonDict(value)) {
      entries = orderedEntries(value);
    } else {
      modelFail(path, "expected an object");
    }
    const out = new Map<string, unknown>();
    for (const [key, item] of entries) {
      out.set(key, one(item, `${path}.${key}`));
    }
    return out;
  }
  return one(value, path);
}

/**
 * The per-class decode index: the alias-to-attribute map `fromDict`
 * resolves input keys through, the computed-field names it drops, and
 * the declared-name set the constructor uses to spot extras.
 */
interface ClassIndex {
  readonly keyToField: ReadonlyMap<string, string>;
  readonly computed: ReadonlySet<string>;
  readonly known: ReadonlySet<string>;
}

/**
 * {@link ClassIndex} per concrete class, built on first use. The specs
 * are `static readonly` and never change after module load, so the
 * index is derived once instead of on every decode/construction; a
 * WeakMap keyed by the class keeps it off the public statics and lets
 * ad-hoc test classes be collected.
 */
const CLASS_INDEX = new WeakMap<EntityModelStatics, ClassIndex>();

/**
 * Look up (or build and memoise) the decode index of one class.
 *
 * @param cls - The entity-model statics.
 * @returns The class's index.
 */
function classIndex(cls: EntityModelStatics): ClassIndex {
  const cached = CLASS_INDEX.get(cls);
  if (cached !== undefined) {
    return cached;
  }
  const keyToField = new Map<string, string>();
  const known = new Set<string>();
  for (const spec of cls.fieldSpecs) {
    known.add(spec.name);
    if (spec.nameAccepted !== false) {
      keyToField.set(spec.name, spec.name);
    }
    for (const alias of spec.aliases ?? []) {
      keyToField.set(alias, spec.name);
    }
  }
  const computed = new Set((cls.computedSpecs ?? []).map((c) => c.name));
  const index: ClassIndex = { keyToField, computed, known };
  CLASS_INDEX.set(cls, index);
  return index;
}

/**
 * Resolve a raw input mapping to a canonical field bag: alias keys map
 * to attribute names, computed-field keys are dropped, and unknown keys
 * follow the class `extra` policy. This is the `fromDict` half —
 * constructors receive attribute-name bags directly.
 *
 * The result is typed as the class's constructor bag `F` because the
 * constructor is the validator: this function only canonicalises KEYS,
 * and every value it forwards is checked (required, nullable, coerced,
 * reconstructed) by the constructor it feeds — the one place the
 * unvalidated-to-typed assertion lives.
 *
 * @param cls - The entity-model statics.
 * @param raw - The raw payload.
 * @returns The canonical bag ready for the constructor.
 * @throws ResponseValidationError - When `raw` is not a plain object,
 *   an alias collides, or an unknown key hits `extra='forbid'`.
 * @internal
 */
export function prepareInit<F extends object>(
  cls: EntityModelStatics<F>,
  raw: unknown,
): F {
  if (!isPythonDict(raw)) {
    return modelFail(cls.modelName, "expected a mapping payload");
  }
  const { keyToField, computed } = classIndex(cls);
  const bag: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === "$type" || computed.has(key)) {
      continue; // computed fields never reach a constructor at decode time
    }
    const field = keyToField.get(key);
    if (field === undefined) {
      // Unknown keys flow to the constructor, which applies the
      // per-class extra policy (forbid/allow/ignore) in one place.
      setOwn(bag, key, value);
      continue;
    }
    if (Object.hasOwn(bag, field) && field !== key) {
      // Pydantic: the alias wins over the attribute name when both are
      // present; later AliasChoices entries never override earlier hits.
      continue;
    }
    setOwn(bag, field, value);
  }
  return bag as F;
}

/**
 * Base class of every entity-model port. Subclasses `declare` their
 * readonly fields; this constructor validates and assigns them.
 *
 * `F` is the subclass's constructor bag (`XInit`): it types the
 * `super(cls, fields)` call and ties the class statics to the same key
 * set. It does not shape the instance — every subclass declares its
 * materialised fields explicitly, because the instance type differs
 * from the bag (defaults applied, nested payloads reconstructed into
 * model instances).
 *
 * @remarks Concrete entity classes are public; the base is plumbing.
 */
export abstract class EntityModel<F extends object = never> {
  /**
   * Pydantic `extra='allow'` spillover: unknown input keys retained on
   * the instance (mirroring `__pydantic_extra__`) but EXCLUDED from
   * `toJSON()`/`toVectorPayload()` — the recorder walks `model_fields`
   * only, so extras never appear in vector payloads.
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
  protected constructor(cls: EntityModelStatics<F>, fields: F) {
    // The bag is walked as a string-keyed record: `F` is an interface
    // type (no index signature), so this widening is the one place the
    // typed bag meets the spec-driven walk.
    const bag = fields as Readonly<Record<string, unknown>>;
    const { known } = classIndex(cls);
    const extras: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(bag)) {
      if (known.has(key) || value === undefined) {
        continue;
      }
      if (cls.extraPolicy === "forbid") {
        modelFail(cls.modelName, `unknown field ${JSON.stringify(key)}`);
      } else if (cls.extraPolicy === "allow") {
        setOwn(extras, key, value);
      }
    }
    const out: Record<string, unknown> = {};
    for (const spec of cls.fieldSpecs) {
      const path = `${cls.modelName}.${spec.name}`;
      const present =
        Object.hasOwn(bag, spec.name) && bag[spec.name] !== undefined;
      if (!present) {
        if (spec.required === true) {
          modelFail(path, "field required");
        }
        // Defaults fire ONLY on absence; Python `None` defaults land
        // as `null` (the attribute always materializes, like Pydantic).
        out[spec.name] = spec.default === undefined ? null : spec.default();
        continue;
      }
      let value: unknown = bag[spec.name];
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
      setOwn(out, key, dumpValue(value, byAlias, excludeNone));
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
  values: ReadonlyArray<string | number>,
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
  if (value instanceof Map) {
    // Ordered-dict container fields dump like plain dict fields:
    // entries keep their `None` values (pydantic `exclude_none`
    // reaches model fields, not mapping entries) and values recurse.
    const out: Record<string, unknown> = {};
    for (const [key, item] of value as ReadonlyMap<unknown, unknown>) {
      setOwn(
        out,
        String(key),
        item === undefined ? null : dumpValue(item, byAlias, excludeNone),
      );
    }
    return out;
  }
  if (Array.isArray(value)) {
    return value.map((item) => dumpValue(item, byAlias, excludeNone));
  }
  if (isPythonDict(value)) {
    // Pydantic keeps `None` VALUES inside plain dict fields
    // (measured 2026-08-16) — only model fields are excluded.
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      setOwn(
        out,
        key,
        item === undefined ? null : dumpValue(item, byAlias, excludeNone),
      );
    }
    return out;
  }
  // Non-record instances pass through BY REFERENCE — pydantic v2
  // `model_dump` keeps arbitrary objects inside `dict[str, Any]`
  // fields by identity (measured 2026-08-16: `out['d']['k'] is c` for
  // a custom-class member, with and without `exclude_none`). The
  // previous clone-anything walk stripped class behavior (e.g. a
  // `Uint8Array` decomposed into index keys) — B6-BIND fidelity fix.
  return value;
}

// The dump walk's dict discrimination is `isPythonDict` (imported from
// the leaf `compat/python-dict.ts`): class instances are NOT plain —
// they pass through {@link dumpValue} by reference, mirroring
// pydantic's identity passthrough. The BIND commit's local
// `isPlainRecordValue` twin was removed at the B6 arbiter pass
// (`b6-review-resolution.md` Finding D — watchlist #13, import-only).

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
  if (value instanceof Map) {
    // Ordered-dict container fields serialize back to a plain record —
    // the recorder shape. A plain JS object cannot represent
    // out-of-order integer-like keys, so THIS is the one boundary
    // where key order narrows to JS enumeration order; the in-memory
    // Map keeps the Python order for every consumer (B8-MAPFIX).
    const out: Record<string, unknown> = {};
    for (const [key, item] of value as ReadonlyMap<unknown, unknown>) {
      setOwn(out, String(key), serializeValue(item, mode));
    }
    return out;
  }
  if (Array.isArray(value)) {
    return value.map((item) => serializeValue(item, mode));
  }
  if (isPythonDict(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      setOwn(out, key, serializeValue(item, mode));
    }
    return out;
  }
  return value ?? null;
}
