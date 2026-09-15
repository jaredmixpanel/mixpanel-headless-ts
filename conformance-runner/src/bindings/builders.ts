/**
 * The `bookmark_builders.*` / `segfilter.*` / `expressions.*` /
 * `transforms.*` / `user_builders.*` / `bookmark_schema.*` bindings.
 *
 * Binding honesty: every binding calls the real ported public entry
 * point (`bookmarks/builders.ts`, `bookmarks/schema.ts`,
 * `query/{segfilter,expressions,transforms,user-builders}.ts`). The only
 * adaptations are kwarg plumbing (decoded kwargs pass through
 * UNCONVERTED and unchecked — the modules are carrier-aware and own
 * their guards; only codec-decoded `Filter` instances are asserted), the
 * `today`/`uuid`
 * determinism seams, the shared error wrap, and the recorder
 * output-codec twins: {@link toBuilderExpectOutput} (generic expect
 * encoding), `model_name` (the handle's `.name` or `null`),
 * `selector_str` (verbatim strings — pass through untouched), the
 * 2-element JSON array for the `extract_cohort_filter` tuple, the
 * `PyDatetime` wrap of `transform_event().event_time` iso text, and the
 * `validation_errors` encoder for `validate_with_pydantic`.
 *
 * The builtin-exception twins (`ValueError`/`OverflowError`/
 * `AttributeError`, `compat/python-builtins.ts`) are NOT
 * `MixpanelHeadlessError` descendants, so {@link runGuarded} rethrows
 * them raw; the oracle's `errorPayload` encodes their `constructor.name`,
 * matching oracle-py's bare-class encoding. No corpus vector reaches
 * them.
 *
 * Oracle note: oracle-ts serves every name registered here through the
 * same registry, so this registration IS the oracle surface.
 * `transforms.transform_event`,
 * `bookmark_schema.get_root_model_for_bookmark_type` and
 * `bookmark_schema.validate_with_pydantic` have zero corpus vectors but
 * are bound for the gate's mechanical `oracle.call` probe.
 */

import { Filter, FrequencyFilter } from "@mixpanel-headless/core";
import {
  BOOKMARK_MODEL_HANDLES,
  buildDateRange,
  buildFilterEntry,
  buildFilterSection,
  buildFlowCohortFilter,
  buildFlowPropertyFilter,
  buildFrequencyFilterEntry,
  buildGroupSection,
  buildSegfilterEntry,
  buildTimeSection,
  extractCohortFilter,
  filtersToSelector,
  filterToSelector,
  getRootModelForBookmarkType,
  normalizeOnExpression,
  transformEvent,
  transformProfile,
  validateWithPydantic,
  ValueError,
} from "@mixpanel-headless/core/internal";

import { type CodecRegistry, PyDatetime } from "../codecs.js";
import {
  isArrayOf,
  isInstanceOf,
  isPlainObject,
  isString,
} from "../internal/guards.js";
import {
  kwarg,
  kwargAs,
  optionalKwargAs,
  requireKwarg,
} from "../internal/kwargs.js";
import { JsonNumber, type JsonValue } from "../json-value.js";
import type { ImplementationRegistry } from "../runner.js";
import { CONTRACT_TAG_CODECS } from "../vector-codecs.js";
import {
  type BindingTable,
  encodeValidationErrors,
  guardCompat,
  registerTable,
  runGuarded,
} from "./shared.js";

/** Decoded `$type: Filter` positions. */
const isFilter = isInstanceOf(Filter);

/** Decoded `$type: Filter` list positions. */
const isFilterList = isArrayOf(isFilter);

/**
 * The rich (dataclass/model) `$type` tags whose members Python's EXPECT
 * encoder drops (`_encode_common(tagged_models=False)`), as opposed to
 * the built-in value tags (`datetime`, `date`, `bytes`, `SecretStr`,
 * `float`), which appear in expect encodings too. Derived from the
 * shared contract-codec table so this set can never drift from the
 * decode side.
 */
const RICH_MODEL_TAGS: ReadonlySet<string> = new Set(
  CONTRACT_TAG_CODECS.keys(),
);

/**
 * Re-encode one `codecs.encodeValue` product in Python's EXPECT
 * encoding.
 *
 * The runner's `diffReturnedValue` canonicalizes the binding's return
 * with NO rich-tag hook and the canonicalizer does not normalize
 * `$type: float` payloads, so builder bindings emit expect-position
 * encodings themselves: rich model tags are dropped (Python
 * `encode_expect_value` serializes dataclasses to their plain to-dict
 * shape — the `extract_cohort_filter` Filter outputs), and finite
 * `$type: float` payloads become raw `JsonNumber` tokens so float-ness
 * renders `18.0` exactly like the recorded expect token. Built-in tags
 * (`datetime`, `bytes`, ...) and non-finite float spellings stay
 * tagged, mirroring oracle-py `_encode_result` and oracle-ts
 * `toExpectEncoding` (whose own transform is idempotent over this one).
 *
 * @param value - A vector-JSON tree from {@link CodecRegistry.encodeValue}.
 * @returns The expect-encoded tree.
 */
function toBuilderExpectOutput(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map((item) => toBuilderExpectOutput(item));
  }
  if (isPlainObject(value)) {
    if (value["$type"] === "float") {
      const spelling = value["value"];
      if (
        typeof spelling === "string" &&
        !["NaN", "Infinity", "-Infinity"].includes(spelling)
      ) {
        return new JsonNumber(spelling);
      }
    }
    const out: Record<string, JsonValue> = {};
    for (const [key, member] of Object.entries(value)) {
      if (
        key === "$type" &&
        typeof member === "string" &&
        RICH_MODEL_TAGS.has(member)
      ) {
        continue;
      }
      out[key] = toBuilderExpectOutput(member);
    }
    return out;
  }
  return value;
}

/** The builder table (each binder runs under {@link runGuarded} + expect encoding). */
const BUILDER_BINDINGS: BindingTable = [
  // ----- bookmark_builders -----
  [
    "bookmark_builders.build_filter_entry",
    (context) => buildFilterEntry(kwarg(context, "f", isFilter, "Filter")),
  ],
  [
    "bookmark_builders.build_filter_section",
    (context) =>
      buildFilterSection(
        kwargAs<Parameters<typeof buildFilterSection>[0]>(context, "where"),
      ),
  ],
  [
    "bookmark_builders.build_frequency_filter_entry",
    (context) =>
      buildFrequencyFilterEntry(
        kwarg(context, "ff", isInstanceOf(FrequencyFilter), "FrequencyFilter"),
      ),
  ],
  [
    "bookmark_builders.build_group_section",
    (context) => {
      // Absent kwarg stays absent; the TS default (`?? null`) mirrors the
      // Python kwonly default `data_group_id=None`.
      const dataGroupId = optionalKwargAs<number | null>(
        context,
        "data_group_id",
      );
      return buildGroupSection(
        kwargAs<Parameters<typeof buildGroupSection>[0]>(context, "group_by"),
        dataGroupId === undefined ? {} : { data_group_id: dataGroupId },
      );
    },
  ],
  [
    "bookmark_builders.build_flow_property_filter",
    (context) =>
      buildFlowPropertyFilter(
        kwarg(context, "filters", isFilterList, "list[Filter]"),
      ),
  ],
  [
    "bookmark_builders.build_flow_cohort_filter",
    (context) =>
      buildFlowCohortFilter(
        kwargAs<Parameters<typeof buildFlowCohortFilter>[0]>(context, "where"),
      ),
  ],
  [
    "bookmark_builders.build_date_range",
    (context) =>
      buildDateRange({
        from_date: kwargAs<string | null>(context, "from_date"),
        to_date: kwargAs<string | null>(context, "to_date"),
        last: kwargAs<number>(context, "last"),
      }),
  ],
  [
    "bookmark_builders.build_time_section",
    (context) =>
      buildTimeSection({
        from_date: kwargAs<string | null>(context, "from_date"),
        to_date: kwargAs<string | null>(context, "to_date"),
        last: kwargAs<number>(context, "last"),
        unit: kwargAs<Parameters<typeof buildTimeSection>[0]["unit"]>(
          context,
          "unit",
        ),
        // Clock seam: the from-only branch fills `to_date` with today();
        // the runner/oracle shims freeze it at the record epoch.
        today: (): string => context.shims.today(),
      }),
  ],

  // ----- segfilter / expressions / transforms -----
  [
    "segfilter.build_segfilter_entry",
    (context) => buildSegfilterEntry(kwarg(context, "f", isFilter, "Filter")),
  ],
  [
    "expressions.normalize_on_expression",
    (context) => normalizeOnExpression(kwargAs<string>(context, "on")),
  ],
  [
    "transforms.transform_event",
    (context) => {
      const transformed = transformEvent(
        kwargAs<Readonly<Record<string, unknown>>>(context, "event"),
        // UUID seam: the deterministic counter stream
        // (`00000000-0000-4000-8000-{seq:012d}`), reset per vector/call on
        // both sides.
        { uuid: (): string => context.shims.uuid() },
      );
      return {
        ...transformed,
        // Python returns a datetime; the library twin returns Python
        // isoformat TEXT. Wrap it so encode emits
        // `{"$type": "datetime", "iso": ...}` byte-matching Python
        // `isoformat()`.
        event_time: new PyDatetime(transformed["event_time"] as string),
      };
    },
  ],
  [
    "transforms.transform_profile",
    (context) =>
      transformProfile(
        kwargAs<Readonly<Record<string, unknown>>>(context, "profile"),
      ),
  ],

  // ----- user_builders selector path -----
  // `selector_str` codec twin: the returned string is emitted VERBATIM
  // (strings pass through the expect walk untouched; no trimming, no
  // normalization).
  [
    "user_builders.filter_to_selector",
    (context) => filterToSelector(kwarg(context, "f", isFilter, "Filter")),
  ],
  [
    "user_builders.filters_to_selector",
    (context) =>
      filtersToSelector(
        kwarg(context, "filters", isFilterList, "list[Filter]"),
      ),
  ],
  // Tuple twin: a 2-element JSON array — element 0 the remaining Filters,
  // element 1 the first cohort Filter or null. The SAME decoded Filter
  // instances flow through (identity semantics); the expect walk
  // serializes them to their Python-spelled `_`-field dicts.
  [
    "user_builders.extract_cohort_filter",
    (context) =>
      extractCohortFilter(
        kwarg(context, "filters", isFilterList, "list[Filter]"),
      ),
  ],

  // ----- bookmark_schema -----
  // `model_name` output codec twin: the root model HANDLE serializes as
  // its Python class name, `None` as null.
  [
    "bookmark_schema.get_root_model_for_bookmark_type",
    (context) =>
      getRootModelForBookmarkType(kwargAs<string>(context, "bookmark_type"))
        ?.name ?? null,
  ],
];

/**
 * `bookmark_schema.validate_with_pydantic` — mirror of the Python
 * name-resolving adapter (`conformance.record.adapters.validate_with_pydantic`):
 * resolve the model NAME over the fixed five-entry map and forward with
 * the DEFAULT code mapper. Output is the `validation_errors` encoding,
 * not the builder expect encoding.
 */
const VALIDATE_WITH_PYDANTIC: BindingTable = [
  [
    "bookmark_schema.validate_with_pydantic",
    (context) => {
      const modelName = kwarg(context, "model", isString, "str");
      const handle = BOOKMARK_MODEL_HANDLES.get(modelName);
      if (handle === undefined) {
        // Twin of the Python adapter's unknown-name ValueError (the fuzz
        // strategies draw the five mapped names only).
        throw new ValueError(
          `unknown bookmark_schema model ${JSON.stringify(modelName)}`,
        );
      }
      const prefix = optionalKwargAs<string>(context, "path_prefix");
      return validateWithPydantic(
        handle.validate,
        requireKwarg(context, "value"),
        prefix === undefined ? {} : { path_prefix: prefix },
      );
    },
  ],
];

/**
 * Register the builder bindings.
 *
 * @param implementations - The registry to extend.
 * @param codecs - The codec registry used to encode returned values.
 */
export function registerBuilderBindings(
  implementations: ImplementationRegistry,
  codecs: CodecRegistry,
): void {
  registerTable(
    implementations,
    BUILDER_BINDINGS,
    (binder) => (context) =>
      toBuilderExpectOutput(runGuarded(codecs, () => binder(context))),
  );
  registerTable(
    implementations,
    VALIDATE_WITH_PYDANTIC,
    (binder) => (context) =>
      encodeValidationErrors(guardCompat(() => binder(context))),
  );
}
