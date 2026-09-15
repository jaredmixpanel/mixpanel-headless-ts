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
 * `bindings.ts::registerContractCodecs`. It lives in the rig (moved out of
 * `packages/core/src/types/` at docs/history/cleanup-plan-2026-09.md §7.3 — the library never
 * imports it); the child-codec callbacks are typed structurally
 * (`unknown`) and datetime children are duck-typed on their `iso` field
 * rather than on the runner's `PyDatetime` class.
 *
 * P2-4 seeds the table with `OAuthTokens` (the one auth-model corpus
 * tag); P2-5a..c, P2-6, and P2-7 extend it with the query-param, result,
 * and entity tags.
 */

import {
  BlueprintCard,
  BlueprintFinishParams,
  BulkAnomalyEntry,
  BulkCreateSchemasParams,
  BulkEventUpdate,
  BulkPropertyUpdate,
  BulkUpdateAnomalyParams,
  BulkUpdateBookmarkEntry,
  BulkUpdateCohortEntry,
  BulkUpdateEventsParams,
  BulkUpdatePropertiesParams,
  CohortBreakdown,
  CohortCriteria,
  CohortDefinition,
  CohortMetric,
  ComposedPropertyValue,
  CreateAlertParams,
  CreateAnnotationParams,
  CreateAnnotationTagParams,
  CreateBookmarkParams,
  CreateCohortParams,
  CreateCustomEventParams,
  CreateCustomPropertyParams,
  CreateDashboardParams,
  CreateDeletionRequestParams,
  CreateDropFilterParams,
  CreateExperimentParams,
  CreateFeatureFlagParams,
  CreateRcaDashboardParams,
  CreateTagParams,
  CreateWebhookParams,
  CustomPropertyRef,
  DuplicateExperimentParams,
  Exclusion,
  type ExclusionFields,
  ExperimentConcludeParams,
  ExperimentDecideParams,
  Filter,
  FlowStep,
  type FlowStepFields,
  Formula,
  FrequencyBreakdown,
  type FrequencyBreakdownFields,
  FrequencyFilter,
  type FrequencyFilterFields,
  FunnelStep,
  type FunnelStepFields,
  GroupBy,
  type GroupByFields,
  HoldingConstant,
  type HoldingConstantFields,
  InitSchemaEnforcementParams,
  InlineCustomProperty,
  ListItemGroupMode,
  MarkLookupTableReadyParams,
  Metric,
  type MetricFields,
  OAuthTokens,
  parseOAuthTokens,
  PreviewDeletionFiltersParams,
  PropertyInput,
  pythonFloatStr,
  RcaSourceData,
  ReplaceSchemaEnforcementParams,
  Replay,
  ReplayEvent,
  type ReplayFields,
  RetentionEvent,
  type RetentionEventFields,
  SchemaEntry,
  SetTestUsersParams,
  SignedReplay,
  type SignedReplayFields,
  TimeComparison,
  UpdateAlertParams,
  UpdateAnnotationParams,
  UpdateAnomalyParams,
  UpdateBookmarkParams,
  UpdateCohortParams,
  UpdateCustomPropertyParams,
  UpdateDashboardParams,
  UpdateDropFilterParams,
  UpdateEventDefinitionParams,
  UpdateExperimentParams,
  UpdateFeatureFlagParams,
  UpdateLookupTableParams,
  UpdatePropertyDefinitionParams,
  UpdateReportLinkParams,
  UpdateSchemaEnforcementParams,
  UpdateTagParams,
  UpdateWebhookParams,
  UserAction,
  type UserActionFields,
  ValidateAlertsForBookmarkParams,
  WebhookTestParams,
} from "@mixpanel-headless/core";
import {
  type EntityModel,
  type EntityModelStatics,
  filterUnchecked,
} from "@mixpanel-headless/core/internal";

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
 * TODO(Ω): verbatim twin of core `types/entities/decode-utils.ts#requireIsoText`
 * (different error class only); import it once `internal.ts` exports it.
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
    typeof value.iso === "string"
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
      // Python PR #236: the codec rehydrates through `_filter_unchecked`,
      // not `Filter(**kwargs)` — recorded Filters must reach the builder
      // under test with their fields exactly as captured (SG1/SG2/SG3 and
      // ES13 vectors carry operators the constructor now rejects).
      construct: (bag) => filterUnchecked(bag),
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
 * The three GroupBy bucket fields whose Python annotation is
 * `int | float | None` (`types.py:8367-8373`) — the fields the
 * {@link groupByCodec} float-ness memory tracks.
 */
const GROUP_BY_BUCKET_FIELDS = [
  "bucket_size",
  "bucket_min",
  "bucket_max",
] as const;

/**
 * Decode-time float-ness memory for {@link groupByCodec} (B2 gate
 * remediation, RUN.md 2026-08-15 B2-attempt-1 divergence): maps each
 * decoded `GroupBy` instance to the set of bucket fields that ARRIVED
 * as `$type: float` carriers, so encode can re-tag exactly those.
 * WeakMap keying keeps the memory garbage-collectable with the
 * instance and invisible to library consumers.
 */
const GROUP_BY_FLOAT_BUCKETS = new WeakMap<GroupBy, ReadonlySet<string>>();

/** Shared empty set for {@link groupByCodec} instances with no memory. */
const NO_FLOAT_BUCKETS: ReadonlySet<string> = new Set<string>();

/**
 * The `GroupBy` dataclass codec row (fields in Python
 * `dataclasses.fields` order) — split out of {@link DATACLASS_CODECS}
 * because {@link groupByCodec} pairs it with a custom encode.
 */
const GROUP_BY_SPEC: DataclassCodecSpec = {
  fields: [
    "property",
    "property_type",
    "bucket_size",
    "bucket_min",
    "bucket_max",
    "_list_item_mode",
  ],
  required: ["property"],
  construct: (bag) => {
    // B2-BIND (B2-M1 carrier table): `$type: float` bucket children
    // decode as PyFloat carriers, but Python's GroupBy holds real
    // floats whose ctor guard (V18 `bucket_min >= bucket_max`) and
    // validator arithmetic compare NUMERICALLY — a carrier object
    // string-compares under JS `>=` and inverts the guard. Unwrap
    // the three bucket fields to native numbers before construction
    // (the SignedReplay `signed_at` unwrap precedent below), and
    // REMEMBER which fields were float-spelled so the encode half can
    // restore the carrier (B2 gate remediation — Python's buckets are
    // `int | float | None`, so a plain TS number cannot carry the
    // int-vs-float distinction by itself).
    const unwrapped: Record<string, unknown> = { ...bag };
    const floatFields = new Set<string>();
    for (const field of GROUP_BY_BUCKET_FIELDS) {
      const value = unwrapped[field];
      // TODO(Ω): `isFloatCarrier` (core) once `internal.ts` exports it — its
      // extra `!isPythonDict` guard is equivalent here (PyFloat is a class).
      if (
        typeof value === "object" &&
        value !== null &&
        "spelling" in value &&
        typeof value.spelling === "string"
      ) {
        // R11.7 rig-internal exemption: the spelling is the rig's
        // canonical PyFloat token (constructor-validated), same as
        // the SignedReplay `signed_at` unwrap below — not user input.
        unwrapped[field] = Number((value as { spelling: string }).spelling);
        floatFields.add(field);
      }
    }
    const instance = new GroupBy(unwrapped as unknown as GroupByFields);
    if (floatFields.size > 0) {
      GROUP_BY_FLOAT_BUCKETS.set(instance, floatFields);
    }
    return instance;
  },
  matches: (value) => value instanceof GroupBy,
};

/**
 * The generic-half `GroupBy` codec {@link groupByCodec} wraps: decode
 * (unknown-field rejection, required-field check, carrier unwrap +
 * float-ness recording via {@link GROUP_BY_SPEC}) is reused verbatim.
 */
const groupByBaseCodec: ContractTagCodec = dataclassCodec(
  "GroupBy",
  GROUP_BY_SPEC,
);

/**
 * The `GroupBy` tag codec — custom encode paired with the decode-side
 * carrier unwrap (B2 gate remediation): a bucket field remembered in
 * {@link GROUP_BY_FLOAT_BUCKETS} re-tags as
 * `{$type: "float", value: pythonFloatStr(v)}` (mirroring Python
 * `_encode_common`, which tags INTEGRAL floats inside rich payloads);
 * every other field takes the generic declared-field walk. Python's
 * bucket annotation is `int | float | None`, so — unlike
 * {@link signedReplayCodec}'s always-float `signed_at` — the re-tag
 * must be conditional on how the value arrived: `18` (int) stays `18`,
 * `18.0` (float carrier) stays the carrier.
 */
const groupByCodec: ContractTagCodec = {
  decode: groupByBaseCodec.decode,
  matches: groupByBaseCodec.matches,
  encode: (instance, encodeChild) => {
    const groupBy = instance as GroupBy;
    const record = instance as Readonly<Record<string, unknown>>;
    const floatFields = GROUP_BY_FLOAT_BUCKETS.get(groupBy) ?? NO_FLOAT_BUCKETS;
    const out: Record<string, unknown> = { $type: "GroupBy" };
    for (const field of GROUP_BY_SPEC.fields) {
      const value = record[field];
      // The integral-finite guard mirrors Python `_encode_common`
      // exactly: only integral finite floats ride as carriers
      // (non-integral floats are unambiguous raw JSON tokens; the
      // canonical-spelling check at PyFloat construction makes a
      // remembered non-integral value unreachable — guard kept for
      // shape parity with signedReplayCodec).
      if (
        floatFields.has(field) &&
        typeof value === "number" &&
        Number.isFinite(value) &&
        Number.isInteger(value)
      ) {
        out[field] = { $type: "float", value: pythonFloatStr(value) };
      } else {
        out[field] = encodeChild(value);
      }
    }
    return out;
  },
};

/**
 * The `SignedReplay` tag codec (phase2-design C6-d) — custom because
 * its Python `signed_at` field is a FLOAT: integral values ride the
 * corpus as `$type: float` spellings (D6 rule 3), which the generic
 * dataclass walk cannot reproduce from a plain TS number. Decode
 * unwraps the runner's PyFloat duck-shape; encode re-tags integral
 * values with the canonical Python repr via `pythonFloatStr`.
 */
const signedReplayCodec: ContractTagCodec = {
  decode: (payload, decodeChild) => {
    const fields = ["replay_id", "url", "query_string", "env", "signed_at"];
    rejectUnknownFields(payload, new Set(fields), "SignedReplay");
    const bag: Record<string, unknown> = {};
    for (const field of fields) {
      if (Object.hasOwn(payload, field)) {
        bag[field] = decodeChild(payload[field]);
      } else {
        throw new Error(
          `missing required field ${JSON.stringify(field)} for $type SignedReplay`,
        );
      }
    }
    const signedAt = bag["signed_at"];
    // TODO(Ω): `isFloatCarrier` (core) once `internal.ts` exports it.
    if (
      typeof signedAt === "object" &&
      signedAt !== null &&
      "spelling" in signedAt &&
      typeof signedAt.spelling === "string"
    ) {
      bag["signed_at"] = Number((signedAt as { spelling: string }).spelling);
    }
    return new SignedReplay(bag as unknown as SignedReplayFields);
  },
  matches: (value) => value instanceof SignedReplay,
  encode: (instance, encodeChild) => {
    const signed = instance as SignedReplay;
    const signedAt: unknown =
      Number.isFinite(signed.signed_at) && Number.isInteger(signed.signed_at)
        ? { $type: "float", value: pythonFloatStr(signed.signed_at) }
        : encodeChild(signed.signed_at);
    return {
      $type: "SignedReplay",
      replay_id: encodeChild(signed.replay_id),
      url: encodeChild(signed.url),
      query_string: encodeChild(signed.query_string),
      env: encodeChild(signed.env),
      signed_at: signedAt,
    };
  },
};

/**
 * The P2-6 replay-family dataclass codec rows (`UserAction` and
 * `Replay` — the two remaining replay tags observed in the corpus;
 * `ReplaySummary`/`ReplayEvent`/`ReplayBundle` have no corpus `$type`
 * occurrences and stay unregistered so the sweep's
 * every-registered-tag-exercised check stays honest).
 */
const REPLAY_DATACLASS_CODECS: ReadonlyArray<
  readonly [string, DataclassCodecSpec]
> = [
  [
    "UserAction",
    {
      fields: [
        "timestamp",
        "action",
        "target_node_id",
        "target_desc",
        "url",
        "metadata",
        "description",
      ],
      required: ["timestamp", "action", "target_node_id", "target_desc", "url"],
      construct: (bag) => new UserAction(bag as unknown as UserActionFields),
      matches: (value) => value instanceof UserAction,
    },
  ],
  [
    "Replay",
    {
      // dataclasses.fields order: the inherited kw-only `_df_cache`
      // precedes the subclass fields, the subclass kw-only caches
      // trail — exactly as recorded payloads carry them.
      fields: [
        "_df_cache",
        "replay_id",
        "distinct_id",
        "project_id",
        "start_time",
        "end_time",
        "retention_days",
        "rrweb_events",
        "actions",
        "mixpanel_events",
        "_events_df_cache",
        "_actions_df_cache",
        "_mixpanel_df_cache",
      ],
      required: [
        "replay_id",
        "distinct_id",
        "project_id",
        "start_time",
        "end_time",
        "retention_days",
      ],
      construct: (bag) => {
        // Nested `actions` decode through the UserAction tag codec;
        // `mixpanel_events` are untagged in the corpus (no ReplayEvent
        // tag) and reconstruct through the strict fromDict.
        const coerced: Record<string, unknown> = { ...bag };
        if (Array.isArray(coerced["mixpanel_events"])) {
          coerced["mixpanel_events"] = (
            coerced["mixpanel_events"] as readonly unknown[]
          ).map((item) =>
            item instanceof ReplayEvent ? item : ReplayEvent.fromDict(item),
          );
        }
        return new Replay(coerced as unknown as ReplayFields);
      },
      matches: (value) => value instanceof Replay,
    },
  ],
];

// Re-exported so the runner's SecretStr built-in swap and the codec-sweep
// anti-vacuity probes have a single import site alongside the table.

// ---------------------------------------------------------------------------
// P2-7 entity-model tags (the 56 corpus `$type` tags of the C5 models).
// ---------------------------------------------------------------------------

/**
 * Build a {@link ContractTagCodec} for one entity-model class — the TS
 * twin of Python's generic BaseModel codec path (`_decode_model` /
 * the BaseModel arm of `_encode_common(tagged_models=True)`): unknown
 * payload fields are rejected BEFORE construction (the codec is strict
 * even where the Pydantic model allows extras), present fields decode
 * recursively and reconstruct through the real validating `fromDict`,
 * and encode walks ALL declared `model_fields` in declaration order
 * with `$type` first (datetime fields re-tag their preserved iso
 * text; computed fields are EXCLUDED — the tagged walk skips them,
 * mirroring `tagged_models=True`).
 *
 * @param cls - The entity-model class statics.
 * @returns The assembled codec entry.
 */
function entityModelCodec(cls: EntityModelStatics): ContractTagCodec {
  const fields = cls.fieldSpecs.map((spec) => spec.name);
  const fieldSet = new Set(fields);
  const datetimeFields = new Set(
    cls.fieldSpecs
      .filter((spec) => spec.datetime === true)
      .map((spec) => spec.name),
  );
  return {
    decode: (payload, decodeChild) => {
      rejectUnknownFields(payload, fieldSet, cls.modelName);
      const bag: Record<string, unknown> = {};
      for (const field of fields) {
        if (Object.hasOwn(payload, field)) {
          bag[field] = decodeChild(payload[field]);
        }
      }
      try {
        return cls.fromDict(bag);
      } catch (error) {
        throw new Error(
          `could not reconstruct ${cls.modelName} from vector fields: ${
            error instanceof Error ? error.message : String(error)
          }`,
          { cause: error },
        );
      }
    },
    matches: (value) => value instanceof cls,
    encode: (instance, encodeChild) => {
      const model = instance as EntityModel;
      const self = model as unknown as Readonly<Record<string, unknown>>;
      const out: Record<string, unknown> = { $type: cls.modelName };
      for (const field of fields) {
        const value = self[field];
        if (datetimeFields.has(field) && typeof value === "string") {
          out[field] = { $type: "datetime", iso: value };
          continue;
        }
        out[field] = encodeChild(value ?? null);
      }
      return out;
    },
  };
}

/**
 * The 56 entity-model classes whose names occur as corpus `$type`
 * tags (`tag-universe.json` rich set minus the query-param/result/
 * auth families registered above). Models WITHOUT corpus tags are
 * deliberately not registered: the C8(a) sweep asserts every
 * registered rich tag is exercised at least once.
 */
const ENTITY_MODEL_CLASSES: readonly EntityModelStatics[] = [
  // dashboards
  BlueprintCard,
  BlueprintFinishParams,
  CreateDashboardParams,
  CreateRcaDashboardParams,
  RcaSourceData,
  UpdateDashboardParams,
  UpdateReportLinkParams,
  // bookmarks
  BulkUpdateBookmarkEntry,
  CreateBookmarkParams,
  UpdateBookmarkParams,
  // cohorts
  BulkUpdateCohortEntry,
  CreateCohortParams,
  UpdateCohortParams,
  // feature flags
  CreateFeatureFlagParams,
  SetTestUsersParams,
  UpdateFeatureFlagParams,
  // experiments
  CreateExperimentParams,
  DuplicateExperimentParams,
  ExperimentConcludeParams,
  ExperimentDecideParams,
  UpdateExperimentParams,
  // annotations
  CreateAnnotationParams,
  CreateAnnotationTagParams,
  UpdateAnnotationParams,
  // webhooks
  CreateWebhookParams,
  UpdateWebhookParams,
  WebhookTestParams,
  // alerts (E4: shapes derive from the Python models + wire vectors)
  CreateAlertParams,
  UpdateAlertParams,
  ValidateAlertsForBookmarkParams,
  // lexicon
  BulkEventUpdate,
  BulkPropertyUpdate,
  BulkUpdateEventsParams,
  BulkUpdatePropertiesParams,
  CreateTagParams,
  UpdateEventDefinitionParams,
  UpdatePropertyDefinitionParams,
  UpdateTagParams,
  // data governance
  ComposedPropertyValue,
  CreateCustomEventParams,
  CreateCustomPropertyParams,
  CreateDropFilterParams,
  MarkLookupTableReadyParams,
  UpdateCustomPropertyParams,
  UpdateDropFilterParams,
  UpdateLookupTableParams,
  // schemas
  BulkAnomalyEntry,
  BulkCreateSchemasParams,
  BulkUpdateAnomalyParams,
  CreateDeletionRequestParams,
  InitSchemaEnforcementParams,
  PreviewDeletionFiltersParams,
  ReplaceSchemaEnforcementParams,
  SchemaEntry,
  UpdateAnomalyParams,
  UpdateSchemaEnforcementParams,
];

/**
 * The P2-7 entity-model tag-codec rows, keyed by `$type` name.
 *
 * @internal Merged into {@link CONTRACT_TAG_CODECS}.
 */
export const ENTITY_TAG_CODECS: ReadonlyMap<string, ContractTagCodec> = new Map<
  string,
  ContractTagCodec
>(
  ENTITY_MODEL_CLASSES.map((cls): readonly [string, ContractTagCodec] => [
    cls.modelName,
    entityModelCodec(cls),
  ]),
);

/**
 * The Phase-2 contract tag-codec table, keyed by `$type` name — the
 * P2-4 auth tag, the P2-5a..c query-param family, the P2-6 replay
 * family, and the P2-7 entity-model rows.
 *
 * @internal
 */
export const CONTRACT_TAG_CODECS: ReadonlyMap<string, ContractTagCodec> =
  new Map<string, ContractTagCodec>([
    ["OAuthTokens", oauthTokensCodec],
    ["CohortDefinition", cohortDefinitionCodec],
    ["GroupBy", groupByCodec],
    ["SignedReplay", signedReplayCodec],
    ...DATACLASS_CODECS.map(
      ([tag, spec]): readonly [string, ContractTagCodec] => [
        tag,
        dataclassCodec(tag, spec),
      ],
    ),
    ...REPLAY_DATACLASS_CODECS.map(
      ([tag, spec]): readonly [string, ContractTagCodec] => [
        tag,
        dataclassCodec(tag, spec),
      ],
    ),
    ...ENTITY_TAG_CODECS,
  ]);

export { OAuthTokens, Secret } from "@mixpanel-headless/core";
