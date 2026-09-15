/**
 * The `validation.*` / `user_validators.*` bindings.
 *
 * Binding honesty: every binding calls the real ported public entry
 * point from `packages/core/src/query`; the only adaptations are kwarg
 * plumbing, the measured PyFloat carrier policy, the frozen-clock
 * `today` seam, the shared error wrap, and the `validation_errors`
 * output encoding. Nothing here re-derives a check or filters/reorders
 * the returned list.
 *
 * Oracle note: oracle-ts serves every name registered here through the
 * same registry, so this registration IS the oracle surface.
 * `validation.validate_sorting_block` has zero corpus vectors but is
 * bound for the gate's mechanical `oracle.call` probe.
 */

import {
  validateBookmark,
  type ValidateBookmarkOptions,
  type ValidationError,
} from "@mixpanel-headless/core";
import {
  validateFlowArgs,
  type ValidateFlowArgsOptions,
  validateFlowBookmark,
  validateFunnelArgs,
  type ValidateFunnelArgsOptions,
  validateGroupByArgs,
  type ValidateGroupByArgsOptions,
  validateQueryArgs,
  type ValidateQueryArgsOptions,
  validateRetentionArgs,
  type ValidateRetentionArgsOptions,
  validateSortingBlock,
  validateTimeArgs,
  type ValidateTimeArgsOptions,
  validateUserArgs,
  validateUserParams,
} from "@mixpanel-headless/core/internal";

import { PyFloat } from "../codecs.js";
import { isPlainObject } from "../internal/guards.js";
import { optionalKwargAs, requireKwarg } from "../internal/kwargs.js";
import type { ImplementationRegistry, InvocationContext } from "../runner.js";
import {
  encodeValidationErrors,
  guardCompat,
  registerTable,
} from "./shared.js";

/** A validator binder (the output codec is applied by the registrar). */
type ValidatorBinder = (context: InvocationContext) => ValidationError[];

/**
 * Unwrap one finite-integral `PyFloat` carrier to its native number.
 *
 * Applied ONLY at the kwarg positions measured as pure NUMERIC
 * comparisons in the Python source: there Python's `30.0` compares
 * equal to `30`, so the TS twin needs the native number. Positions with
 * `isinstance(int/float)` semantics keep the carrier — the ported
 * validators classify it via `isPythonInt`/`isFloatCarrier` exactly
 * where CPython classifies a float (any wider unwrap is a
 * binding-honesty smell).
 *
 * @param value - A decoded kwarg value.
 * @returns The carrier's numeric value, or the value unchanged.
 */
function unwrapCarrierNumber(value: unknown): unknown {
  return value instanceof PyFloat ? value.toNumber() : value;
}

/**
 * Deep-unwrap NON-FINITE `PyFloat` carriers to native non-finite
 * numbers ("non-finite spellings always unwrap", the `vector-codecs.ts`
 * SignedReplay precedent). Finite carriers stay carriers — that is what
 * makes `isinstance(x, int)` fail in TS exactly where it fails in
 * CPython. The walk covers plain dicts/lists only; reconstructed core
 * instances pass through untouched. Behavior-neutral for the
 * carrier-aware sorting surface (its classifiers treat native
 * non-finite numbers identically) — this is NOT a `params.sorting`
 * unwrap rule.
 *
 * @param value - A decoded kwarg value.
 * @returns The value with every non-finite carrier made native.
 */
function unwrapNonFiniteDeep(value: unknown): unknown {
  if (
    value instanceof PyFloat &&
    ["Infinity", "-Infinity", "NaN"].includes(value.spelling)
  ) {
    return value.toNumber();
  }
  if (Array.isArray(value)) {
    return value.map((item) => unwrapNonFiniteDeep(item));
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, member] of Object.entries(value)) {
      out[key] = unwrapNonFiniteDeep(member);
    }
    return out;
  }
  return value;
}

/**
 * Build one validator options bag from the decoded kwargs.
 *
 * Every kwarg passes through {@link unwrapNonFiniteDeep}; the
 * `numericFields` then get the finite-carrier unwrap
 * ({@link unwrapCarrierNumber}). Absent kwargs stay absent — the TS
 * validators' destructuring defaults mirror the Python kwonly defaults,
 * which is also why the bag is handed over typed as the validator's
 * options without a shape check (the ONE cast; `GroupBy` bucket fields
 * are unwrapped by the GroupBy contract codec itself, so decoded
 * `group_by` values arrive here already native).
 *
 * @param context - The invocation context.
 * @param numericFields - Kwarg names measured as numeric comparisons.
 * @returns The prepared kwargs bag typed as the validator's options.
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- O is the validator's options type the call site names explicitly; the kwonly-defaults contract cannot be expressed structurally (see doc)
function validatorKwargs<O>(
  context: InvocationContext,
  numericFields: readonly string[],
): O {
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(context.kwargs)) {
    let value = unwrapNonFiniteDeep(raw);
    if (numericFields.includes(key)) {
      value = unwrapCarrierNumber(value);
    }
    out[key] = value;
  }
  return out as O;
}

/**
 * Read the required `params` dict kwarg of a Layer-2 validator, with
 * the deep non-finite unwrap applied.
 *
 * @param context - The invocation context.
 * @returns The prepared params dict.
 * @throws Error - When the kwarg is missing from `call.input`.
 */
function requireParamsDict(
  context: InvocationContext,
): Record<string, unknown> {
  return unwrapNonFiniteDeep(requireKwarg(context, "params")) as Record<
    string,
    unknown
  >;
}

/** The validator table (`validation.*` + `user_validators.*`). */
const VALIDATOR_BINDINGS: ReadonlyArray<readonly [string, ValidatorBinder]> = [
  [
    "validation.validate_time_args",
    (context) =>
      validateTimeArgs(
        validatorKwargs<ValidateTimeArgsOptions>(context, ["last"]),
      ),
  ],
  [
    "validation.validate_group_by_args",
    (context) =>
      validateGroupByArgs(
        validatorKwargs<ValidateGroupByArgsOptions>(context, []),
      ),
  ],
  // `conversion_window` and `data_group_id` keep carriers: Python
  // type-checks them (F3_CONVERSION_WINDOW_TYPE / DG1).
  [
    "validation.validate_funnel_args",
    (context) =>
      validateFunnelArgs(
        validatorKwargs<ValidateFunnelArgsOptions>(context, ["last"]),
      ),
  ],
  // `bucket_sizes[i]` and `data_group_id` keep carriers
  // (R5_BUCKET_SIZES_INTEGER / DG1).
  [
    "validation.validate_retention_args",
    (context) =>
      validateRetentionArgs(
        validatorKwargs<ValidateRetentionArgsOptions>(context, ["last"]),
      ),
  ],
  [
    "validation.validate_flow_args",
    (context) =>
      validateFlowArgs(
        validatorKwargs<ValidateFlowArgsOptions>(context, [
          "last",
          "forward",
          "reverse",
          "cardinality",
          "conversion_window",
        ]),
      ),
  ],
  [
    "validation.validate_query_args",
    (context) =>
      validateQueryArgs(
        validatorKwargs<ValidateQueryArgsOptions>(context, ["last", "rolling"]),
      ),
  ],
  [
    "validation.validate_bookmark",
    (context) => {
      const bookmarkType = optionalKwargAs<string>(context, "bookmark_type");
      const options: ValidateBookmarkOptions =
        bookmarkType === undefined ? {} : { bookmark_type: bookmarkType };
      return validateBookmark(requireParamsDict(context), options);
    },
  ],
  [
    "validation.validate_flow_bookmark",
    (context) => validateFlowBookmark(requireParamsDict(context)),
  ],
  [
    "validation.validate_sorting_block",
    (context) =>
      validateSortingBlock(
        unwrapNonFiniteDeep(requireKwarg(context, "sorting")),
      ),
  ],
  [
    "user_validators.validate_user_args",
    (context) => {
      // Carrier table: `limit`/`percentile`/`workers` and the ELEMENTS of
      // `segment_by` are pure numeric comparisons in Python (no
      // isinstance(int/float) anywhere in user_validators.py);
      // `cohort`/`as_of` keep carriers (isinstance-only reads).
      const options = validatorKwargs<Record<string, unknown>>(context, [
        "limit",
        "percentile",
        "workers",
      ]);
      const segmentBy = options["segment_by"];
      if (Array.isArray(segmentBy)) {
        options["segment_by"] = segmentBy.map((item) =>
          unwrapCarrierNumber(item),
        );
      }
      // Clock seam: the recorder and both oracles run under the frozen
      // record epoch — the binding injects the shims' date; the library
      // defaults to the real clock.
      options["today"] = (): string => context.shims.today();
      return validateUserArgs(options);
    },
  ],
  [
    "user_validators.validate_user_params",
    (context) => validateUserParams(requireParamsDict(context)),
  ],
];

/**
 * Register the validator bindings.
 *
 * @param implementations - The registry to extend.
 */
export function registerValidatorBindings(
  implementations: ImplementationRegistry,
): void {
  registerTable(
    implementations,
    VALIDATOR_BINDINGS,
    (binder) => (context) =>
      encodeValidationErrors(guardCompat(() => binder(context))),
  );
}
