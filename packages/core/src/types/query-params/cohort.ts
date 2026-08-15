/**
 * Cohort-definition family — P2-5a MINIMAL SHELLS of the P2-5b packet's
 * `cohort.ts` (phase2-design C7/C10).
 *
 * WHY THIS FILE EXISTS ONE PACKET EARLY: the recorded
 * `types.CohortMetric` CM5 guard vectors carry
 * `$type: CohortDefinition` / `$type: CohortCriteria` payloads in
 * `call.input`, and the runner decodes `call.input` BEFORE invoking the
 * bound implementation — so P2-5a cannot make its 159 vectors pass (a
 * C10 done-criterion) without the decode/encode surface of these two
 * classes. Only the codec-required surface is built here:
 *
 * - `CohortCriteria`: the 3 declared fields (a frozen dataclass with no
 *   `__post_init__` in Python — plain field reconstruction).
 * - `CohortDefinition`: `_criteria`/`_operator` fields, the variadic
 *   constructor (AND), the `allOf`/`anyOf` statics, and the
 *   `CD9_EMPTY_CRITERIA` guard they share.
 *
 * TODO(port, P2-5b): `CohortCriteria.didEvent`/`didNotDoEvent`/
 * `hasProperty`/`inCohort`/`notInCohort`/`propertyIsSet`/
 * `propertyIsNotSet` factories (CD- and CA-family guard codes),
 * `CohortDefinition.to_dict` (`toDict`), `CohortBreakdown`, and
 * `sanitizeRawCohort` land with the P2-5b packet, which also re-exports
 * the completed family from the package barrel. NOT barrel-exported
 * until then.
 */

import { ParamValidationError } from "../../errors.js";

/**
 * A single atomic condition for cohort membership — TS port of
 * `types.CohortCriteria` (fields only; factories are P2-5b).
 *
 * Constructed exclusively via class methods in the public API — the
 * field constructor exists for codec reconstruction (mirror of Python's
 * generic `_decode_dataclass` path, which reaches the real dataclass
 * constructor).
 */
export class CohortCriteria {
  /**
   * Expression tree leaf node (behavioral, property, or cohort
   * reference).
   *
   * @internal Codec-visible under its exact Python spelling.
   */
  readonly _selector_node: Readonly<Record<string, unknown>>;

  /**
   * Placeholder behavior key (e.g. `"bhvr_0"`); `null` for
   * non-behavioral criteria.
   *
   * @internal Codec-visible under its exact Python spelling.
   */
  readonly _behavior_key: string | null;

  /**
   * Behavior dict entry (event selector + window/dates); `null` for
   * non-behavioral criteria.
   *
   * @internal Codec-visible under its exact Python spelling.
   */
  readonly _behavior: Readonly<Record<string, unknown>> | null;

  /**
   * Reconstruct a criterion from its declared fields.
   *
   * @param fields - The three declared Python dataclass fields.
   */
  constructor(fields: {
    readonly _selector_node: Readonly<Record<string, unknown>>;
    readonly _behavior_key: string | null;
    readonly _behavior: Readonly<Record<string, unknown>> | null;
  }) {
    this._selector_node = fields._selector_node;
    this._behavior_key = fields._behavior_key;
    this._behavior = fields._behavior;
  }
}

/**
 * A composed set of criteria combined with AND/OR logic — TS port of
 * `types.CohortDefinition` (construction surface only; `toDict` is
 * P2-5b).
 *
 * Mirrors Python's `init=False` design: the stored `_operator` literals
 * are `"and"` (from the constructor / {@link allOf}) and `"or"` (from
 * {@link anyOf}) — there is no other operator value.
 */
export class CohortDefinition {
  /**
   * One or more criteria or nested definitions.
   *
   * @internal Codec-visible under its exact Python spelling.
   */
  readonly _criteria: ReadonlyArray<CohortCriteria | CohortDefinition>;

  /**
   * Boolean combinator (`"and"` | `"or"`).
   *
   * @internal Codec-visible under its exact Python spelling.
   */
  readonly _operator: "and" | "or";

  /**
   * Create a definition combining criteria with AND logic (equivalent
   * to {@link allOf}).
   *
   * @param criteria - One or more criteria or nested definitions.
   * @throws ParamValidationError - `CD9_EMPTY_CRITERIA` when no criteria
   *   are provided.
   */
  constructor(...criteria: ReadonlyArray<CohortCriteria | CohortDefinition>) {
    // CD9_EMPTY_CRITERIA: at least one criterion is required.
    if (criteria.length === 0) {
      throw new ParamValidationError(
        "CohortDefinition requires at least one criterion",
        "CD9_EMPTY_CRITERIA",
      );
    }
    this._criteria = criteria;
    this._operator = "and";
  }

  /**
   * Combine criteria and/or definitions with AND logic.
   *
   * @param criteria - One or more criteria or nested definitions.
   * @returns CohortDefinition with the AND combinator.
   * @throws ParamValidationError - `CD9_EMPTY_CRITERIA` when no criteria
   *   are provided.
   */
  static allOf(
    ...criteria: ReadonlyArray<CohortCriteria | CohortDefinition>
  ): CohortDefinition {
    return new CohortDefinition(...criteria);
  }

  /**
   * Combine criteria and/or definitions with OR logic.
   *
   * @param criteria - One or more criteria or nested definitions.
   * @returns CohortDefinition with the OR combinator.
   * @throws ParamValidationError - `CD9_EMPTY_CRITERIA` when no criteria
   *   are provided.
   */
  static anyOf(
    ...criteria: ReadonlyArray<CohortCriteria | CohortDefinition>
  ): CohortDefinition {
    const instance = new CohortDefinition(...criteria);
    // Mirror of Python's object.__setattr__ any_of construction: same
    // criteria, OR combinator. The field is declared readonly for
    // consumers; this is the one sanctioned mutation site.
    (instance as { _operator: "and" | "or" })._operator = "or";
    return instance;
  }
}
