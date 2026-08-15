/**
 * Contract-layer `$type` tag codecs (phase2-design C7 item 1).
 *
 * One {@link ContractTagCodec} entry per Phase-2 rich tag: `decode`
 * reconstructs the REAL core instance through its constructor/factory
 * (guards FIRE on decode — a vector carrying an invalid payload is a
 * vector bug and must fail loudly, mirroring Python's
 * `_decode_dataclass`/`_decode_model`), and `encode` performs the
 * field-level walk of Python `_encode_common(tagged_models=True)`: ALL
 * declared fields, `$type` first, `null` for Python `None`.
 *
 * The table is wired into the conformance runner by
 * `conformance-runner/src/bindings.ts::registerContractCodecs` — this
 * module stays free of runner imports (dependency direction: runner ->
 * core, never the reverse), so the child-codec callbacks are typed
 * structurally (`unknown`) and datetime children are duck-typed on their
 * `iso` field rather than on the runner's `PyDatetime` class.
 *
 * P2-4 seeds the table with `OAuthTokens` (the one auth-model corpus
 * tag); P2-5a..c, P2-6, and P2-7 extend it with the query-param, result,
 * and entity tags.
 *
 * @internal Exported for the conformance binding — NOT part of the
 * public package surface (excluded from the barrel).
 */

import { parseOAuthTokens, OAuthTokens } from "../auth/token.js";
import { Secret } from "../secret.js";
import {
  CohortBreakdown,
  CohortCriteria,
  CohortDefinition,
} from "./query-params/cohort.js";
import {
  CustomPropertyRef,
  Filter,
  InlineCustomProperty,
  ListItemGroupMode,
  PropertyInput,
  type FilterFields,
} from "./query-params/filter.js";
import { FlowStep, type FlowStepFields } from "./query-params/flow.js";
import {
  FrequencyBreakdown,
  FrequencyFilter,
  type FrequencyBreakdownFields,
  type FrequencyFilterFields,
} from "./query-params/frequency.js";
import {
  Exclusion,
  FunnelStep,
  HoldingConstant,
  type ExclusionFields,
  type FunnelStepFields,
  type HoldingConstantFields,
} from "./query-params/funnel.js";
import {
  RetentionEvent,
  type RetentionEventFields,
} from "./query-params/retention.js";
import { GroupBy, type GroupByFields } from "./query-params/group-by.js";
import {
  CohortMetric,
  Formula,
  Metric,
  TimeComparison,
  type MetricFields,
} from "./query-params/metric.js";

/**
 * One registered rich-tag codec (phase2-design C7 `TagCodec`).
 *
 * @internal
 */
export interface ContractTagCodec {
  /**
   * Reconstruct the real core instance from a tagged payload.
   *
   * @param payload - The tagged object (`$type` included).
   * @param decodeChild - Recursive decoder for nested field values.
   * @returns The reconstructed instance.
   */
  readonly decode: (
    payload: Readonly<Record<string, unknown>>,
    decodeChild: (value: unknown) => unknown,
  ) => unknown;

  /**
   * Anti-vacuity probe + encode-dispatch predicate: whether a live value
   * is an instance of this tag's core class (C8a — a decode-to-plain-
   * object codec must be impossible to register).
   *
   * @param value - A live TS value.
   * @returns True when {@link encode} can serialize it.
   */
  readonly matches: (value: unknown) => boolean;

  /**
   * Serialize a core instance back to its tagged vector-JSON shape.
   *
   * @param instance - A value for which {@link matches} returned true.
   * @param encodeChild - Recursive encoder for nested field values.
   * @returns The tagged object (`$type` first, all declared fields).
   */
  readonly encode: (
    instance: unknown,
    encodeChild: (value: unknown) => unknown,
  ) => Readonly<Record<string, unknown>>;
}

/**
 * Extract the ISO text from a decoded datetime child.
 *
 * The runner decodes `$type: datetime` payloads to its lossless
 * `PyDatetime` wrapper (an object with a string `iso` field); this module
 * cannot import that class, so it duck-types the shape. A raw string
 * passes through (already-decoded callers).
 *
 * @param value - The decoded child value.
 * @param field - Field name for error messages.
 * @returns The ISO-8601 text.
 * @throws Error - When the value is neither an iso-carrying object nor a
 *   string (a malformed vector payload — must fail loudly).
 */
function requireIsoText(value: unknown, field: string): string {
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
  throw new Error(
    `OAuthTokens.${field} must decode to a datetime (got ${typeof value})`,
  );
}

/**
 * Reject payload keys outside the declared field set (mirror of Python
 * `_decode_model`'s unknown-field guard — the CODEC is strict even where
 * the Pydantic model ignores extras).
 *
 * @param payload - The tagged payload.
 * @param fields - Declared field names (without `$type`).
 * @param tag - The `$type` name for error messages.
 * @throws Error - When unknown fields are present.
 */
function rejectUnknownFields(
  payload: Readonly<Record<string, unknown>>,
  fields: ReadonlySet<string>,
  tag: string,
): void {
  const extra = Object.keys(payload)
    .filter((key) => key !== "$type" && !fields.has(key))
    .sort();
  if (extra.length > 0) {
    throw new Error(`unknown fields ${JSON.stringify(extra)} for $type ${tag}`);
  }
}

/** Declared `OAuthTokens` fields, in Python `model_fields` order. */
const OAUTH_TOKENS_FIELDS: readonly string[] = [
  "access_token",
  "refresh_token",
  "expires_at",
  "scope",
  "token_type",
];

/** The `OAuthTokens` tag codec (phase2-design C4/C7). */
const oauthTokensCodec: ContractTagCodec = {
  decode: (payload, decodeChild) => {
    rejectUnknownFields(payload, new Set(OAUTH_TOKENS_FIELDS), "OAuthTokens");
    const decoded: Record<string, unknown> = {};
    for (const field of OAUTH_TOKENS_FIELDS) {
      if (Object.hasOwn(payload, field)) {
        decoded[field] = decodeChild(payload[field]);
      }
    }
    if (Object.hasOwn(decoded, "expires_at")) {
      decoded["expires_at"] = requireIsoText(
        decoded["expires_at"],
        "expires_at",
      );
    }
    return parseOAuthTokens(decoded);
  },
  matches: (value) => value instanceof OAuthTokens,
  encode: (instance, encodeChild) => {
    const tokens = instance as OAuthTokens;
    // Field-level walk, ALL declared fields, $type first (mirror of
    // Python `_encode_common(tagged_models=True)`): `refresh_token`
    // emits `null` when unset, `expires_at` re-tags the preserved iso
    // text byte-for-byte.
    return {
      $type: "OAuthTokens",
      access_token: encodeChild(tokens.access_token),
      refresh_token:
        tokens.refresh_token === null
          ? null
          : encodeChild(tokens.refresh_token),
      expires_at: { $type: "datetime", iso: tokens.expires_at },
      scope: tokens.scope,
      token_type: tokens.token_type,
    };
  },
};

/**
 * One row of the generic dataclass-codec table (mirror of Python
 * `_decode_dataclass` / the dataclass arm of `_encode_common`).
 *
 * @internal
 */
interface DataclassCodecSpec {
  /** Declared field names, in Python `dataclasses.fields` order. */
  readonly fields: readonly string[];
  /** Field names REQUIRED by the Python constructor (no default). */
  readonly required: readonly string[];
  /**
   * Construct the real instance from decoded present-field values
   * (constructor guards fire here, mirroring `_decode_dataclass`).
   */
  readonly construct: (bag: Readonly<Record<string, unknown>>) => unknown;
  /** The C8(a) anti-vacuity `instanceof` probe. */
  readonly matches: (value: unknown) => boolean;
}

/**
 * Build a {@link ContractTagCodec} from a dataclass spec — the TS twin
 * of Python's generic dataclass codec path: unknown payload fields are
 * rejected, absent fields fall back to the constructor defaults,
 * present fields decode recursively, and encode walks ALL declared
 * fields in declaration order with `$type` first.
 *
 * @param tag - The `$type` name exactly as vectors carry it.
 * @param spec - The dataclass codec row.
 * @returns The assembled codec entry.
 */
function dataclassCodec(
  tag: string,
  spec: DataclassCodecSpec,
): ContractTagCodec {
  const fieldSet = new Set(spec.fields);
  return {
    decode: (payload, decodeChild) => {
      rejectUnknownFields(payload, fieldSet, tag);
      const bag: Record<string, unknown> = {};
      for (const field of spec.fields) {
        if (Object.hasOwn(payload, field)) {
          bag[field] = decodeChild(payload[field]);
        }
      }
      for (const field of spec.required) {
        if (!Object.hasOwn(bag, field)) {
          throw new Error(
            `missing required field ${JSON.stringify(field)} for $type ${tag}`,
          );
        }
      }
      return spec.construct(bag);
    },
    matches: spec.matches,
    encode: (instance, encodeChild) => {
      const record = instance as Readonly<Record<string, unknown>>;
      const out: Record<string, unknown> = { $type: tag };
      for (const field of spec.fields) {
        out[field] = encodeChild(record[field]);
      }
      return out;
    },
  };
}

/**
 * The `CohortDefinition` codec — mirror of Python
 * `_decode_cohort_definition` (`init=False`: reconstruction goes
 * through the `allOf`/`anyOf` statics; the stored operators are exactly
 * `"or"` and `"and"`, any other value is undecodable). Encode uses the
 * generic declared-field walk.
 */
const cohortDefinitionCodec: ContractTagCodec = {
  decode: (payload, decodeChild) => {
    const rawCriteria = Object.hasOwn(payload, "_criteria")
      ? payload["_criteria"]
      : [];
    if (!Array.isArray(rawCriteria)) {
      throw new Error("CohortDefinition._criteria must be an array");
    }
    const criteria = rawCriteria.map((item) =>
      decodeChild(item),
    ) as ReadonlyArray<CohortCriteria | CohortDefinition>;
    const operator = payload["_operator"];
    if (operator === "or") {
      return CohortDefinition.anyOf(...criteria);
    }
    if (operator === "and") {
      return CohortDefinition.allOf(...criteria);
    }
    throw new Error(
      `unknown CohortDefinition operator ${JSON.stringify(operator)} in vector input`,
    );
  },
  matches: (value) => value instanceof CohortDefinition,
  encode: (instance, encodeChild) => {
    const definition = instance as CohortDefinition;
    return {
      $type: "CohortDefinition",
      _criteria: encodeChild(definition._criteria),
      _operator: definition._operator,
    };
  },
};

/**
 * The P2-5a/P2-5b/P2-5c dataclass codec rows (field lists in Python
 * `dataclasses.fields` order).
 */
const DATACLASS_CODECS: ReadonlyArray<readonly [string, DataclassCodecSpec]> = [
  [
    "Filter",
    {
      fields: [
        "_property",
        "_operator",
        "_value",
        "_property_type",
        "_resource_type",
        "_date_unit",
        "_list_item_filters",
        "_list_item_quantifier",
      ],
      required: ["_property", "_operator", "_value"],
      construct: (bag) => new Filter(bag as unknown as FilterFields),
      matches: (value) => value instanceof Filter,
    },
  ],
  [
    "ListItemGroupMode",
    {
      fields: ["sub", "sub_type"],
      required: ["sub", "sub_type"],
      construct: (bag) =>
        new ListItemGroupMode(
          bag as unknown as ConstructorParameters<typeof ListItemGroupMode>[0],
        ),
      matches: (value) => value instanceof ListItemGroupMode,
    },
  ],
  [
    "PropertyInput",
    {
      fields: ["name", "type", "resource_type"],
      required: ["name"],
      construct: (bag) =>
        new PropertyInput(
          bag as unknown as ConstructorParameters<typeof PropertyInput>[0],
        ),
      matches: (value) => value instanceof PropertyInput,
    },
  ],
  [
    "InlineCustomProperty",
    {
      fields: ["formula", "inputs", "property_type", "resource_type"],
      required: ["formula", "inputs"],
      construct: (bag) =>
        new InlineCustomProperty(
          bag as unknown as ConstructorParameters<
            typeof InlineCustomProperty
          >[0],
        ),
      matches: (value) => value instanceof InlineCustomProperty,
    },
  ],
  [
    "CustomPropertyRef",
    {
      fields: ["id"],
      required: ["id"],
      construct: (bag) =>
        new CustomPropertyRef(
          bag as unknown as ConstructorParameters<typeof CustomPropertyRef>[0],
        ),
      matches: (value) => value instanceof CustomPropertyRef,
    },
  ],
  [
    "GroupBy",
    {
      fields: [
        "property",
        "property_type",
        "bucket_size",
        "bucket_min",
        "bucket_max",
        "_list_item_mode",
      ],
      required: ["property"],
      construct: (bag) => new GroupBy(bag as unknown as GroupByFields),
      matches: (value) => value instanceof GroupBy,
    },
  ],
  [
    "Metric",
    {
      fields: [
        "event",
        "math",
        "property",
        "per_user",
        "percentile_value",
        "filters",
        "filters_combinator",
        "segment_method",
      ],
      required: ["event"],
      construct: (bag) => new Metric(bag as unknown as MetricFields),
      matches: (value) => value instanceof Metric,
    },
  ],
  [
    "CohortMetric",
    {
      fields: ["cohort", "name"],
      required: ["cohort"],
      construct: (bag) =>
        new CohortMetric(
          bag as unknown as ConstructorParameters<typeof CohortMetric>[0],
        ),
      matches: (value) => value instanceof CohortMetric,
    },
  ],
  [
    "Formula",
    {
      fields: ["expression", "label"],
      required: ["expression"],
      construct: (bag) =>
        new Formula(bag as unknown as ConstructorParameters<typeof Formula>[0]),
      matches: (value) => value instanceof Formula,
    },
  ],
  [
    "TimeComparison",
    {
      fields: ["type", "unit", "date"],
      required: ["type"],
      construct: (bag) =>
        new TimeComparison(
          bag as unknown as ConstructorParameters<typeof TimeComparison>[0],
        ),
      matches: (value) => value instanceof TimeComparison,
    },
  ],
  [
    "CohortCriteria",
    {
      fields: ["_selector_node", "_behavior_key", "_behavior"],
      required: ["_selector_node", "_behavior_key", "_behavior"],
      construct: (bag) =>
        new CohortCriteria(
          bag as unknown as ConstructorParameters<typeof CohortCriteria>[0],
        ),
      matches: (value) => value instanceof CohortCriteria,
    },
  ],
  // P2-5b cohort-family addition.
  [
    "CohortBreakdown",
    {
      fields: ["cohort", "name", "include_negated"],
      required: ["cohort"],
      construct: (bag) =>
        new CohortBreakdown(
          bag as unknown as ConstructorParameters<typeof CohortBreakdown>[0],
        ),
      matches: (value) => value instanceof CohortBreakdown,
    },
  ],
  // P2-5c funnel/retention/flow/frequency family.
  [
    "FunnelStep",
    {
      fields: ["event", "label", "filters", "filters_combinator", "order"],
      required: ["event"],
      construct: (bag) => new FunnelStep(bag as unknown as FunnelStepFields),
      matches: (value) => value instanceof FunnelStep,
    },
  ],
  [
    "Exclusion",
    {
      fields: ["event", "from_step", "to_step"],
      required: ["event"],
      construct: (bag) => new Exclusion(bag as unknown as ExclusionFields),
      matches: (value) => value instanceof Exclusion,
    },
  ],
  [
    "HoldingConstant",
    {
      fields: ["property", "resource_type"],
      required: ["property"],
      construct: (bag) =>
        new HoldingConstant(bag as unknown as HoldingConstantFields),
      matches: (value) => value instanceof HoldingConstant,
    },
  ],
  [
    "RetentionEvent",
    {
      fields: ["event", "filters", "filters_combinator"],
      required: ["event"],
      construct: (bag) =>
        new RetentionEvent(bag as unknown as RetentionEventFields),
      matches: (value) => value instanceof RetentionEvent,
    },
  ],
  [
    "FlowStep",
    {
      fields: [
        "event",
        "forward",
        "reverse",
        "label",
        "filters",
        "filters_combinator",
        "session_event",
      ],
      required: ["event"],
      construct: (bag) => new FlowStep(bag as unknown as FlowStepFields),
      matches: (value) => value instanceof FlowStep,
    },
  ],
  [
    "FrequencyBreakdown",
    {
      fields: ["event", "bucket_size", "bucket_min", "bucket_max", "label"],
      required: ["event"],
      construct: (bag) =>
        new FrequencyBreakdown(bag as unknown as FrequencyBreakdownFields),
      matches: (value) => value instanceof FrequencyBreakdown,
    },
  ],
  [
    "FrequencyFilter",
    {
      fields: [
        "event",
        "value",
        "operator",
        "date_range_value",
        "date_range_unit",
        "event_filters",
        "label",
      ],
      required: ["event", "value"],
      construct: (bag) =>
        new FrequencyFilter(bag as unknown as FrequencyFilterFields),
      matches: (value) => value instanceof FrequencyFilter,
    },
  ],
];

/**
 * The Phase-2 contract tag-codec table, keyed by `$type` name.
 *
 * @internal
 */
export const CONTRACT_TAG_CODECS: ReadonlyMap<string, ContractTagCodec> =
  new Map<string, ContractTagCodec>([
    ["OAuthTokens", oauthTokensCodec],
    ["CohortDefinition", cohortDefinitionCodec],
    ...DATACLASS_CODECS.map(
      ([tag, spec]): readonly [string, ContractTagCodec] => [
        tag,
        dataclassCodec(tag, spec),
      ],
    ),
  ]);

// Re-exported so the runner's SecretStr built-in swap and the codec-sweep
// anti-vacuity probes have a single import site alongside the table.
export { OAuthTokens, Secret };
