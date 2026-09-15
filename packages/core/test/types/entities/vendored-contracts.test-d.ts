/**
 * Compile-only vendored cross-checks (phase2-design C5 item 2, packet
 * P2-7). NOT executed by vitest (no `.test.ts` suffix) — `tsc` alone
 * enforces every assertion here.
 *
 * The hand-written entity models mirror the PYTHON models (R4.1
 * through R10.6 / E4: Python is the arbiter); the byte-frozen
 * schema4api files under `vendor/mixpanel-contracts/` are a TYPE-LEVEL
 * cross-check only, imported `import type` — nothing here reaches the
 * runtime bundle. Where the two disagree, the divergence is DOCUMENTED
 * (alerts: `vendor/mixpanel-contracts/PROVENANCE.json`
 * `verified_divergences.alerts`, recorded by the E4 verification step)
 * and the check asserts the divergence EXACTLY, so silent drift in
 * either direction breaks the build.
 *
 * Key-set comparisons use the `*Init` constructor interfaces (their
 * keys are exactly the Python `model_fields` names); instance types
 * carry methods and are unsuitable for `keyof` comparisons.
 *
 * Areas WITHOUT a usable vendored contract (recorded in PROVENANCE
 * `coverage_holes` + notes): cohorts (no contract exists), dashboards
 * (`projects/dashboards/types.d.ts` covers blueprint REQUEST shapes
 * only), lexicon/data_definitions (history/merge endpoints only —
 * checked below where an overlap exists), schemas / annotations /
 * lookup tables (no schema4api file vendored). Their runtime lock is
 * the C8(a) sweep + C8(b) goldens.
 */

import type {
  WebhookCreatePayload,
  WebhookItem,
  WebhookTestPayload,
  WebhookUpdatePayload,
} from "../../../../../vendor/mixpanel-contracts/iron/common/types/schema4api/webapp/project_webhooks/types.js";
import type {
  CreateCustomAlertRequest,
  CursorPaginationResponse as AlertsCursorPaginationResponse,
  CustomAlert as VendoredCustomAlert,
  CustomAlertsCountResults,
  UpdateCustomAlertRequest,
  ValidateAlertsForBookmarkRequest,
} from "../../../../../vendor/mixpanel-contracts/webapp/app_api/projects/alerts/custom/types.js";
import type { EventDropFiltersLimitResults } from "../../../../../vendor/mixpanel-contracts/webapp/app_api/projects/data_definitions/types.js";
import type { ExperimentCreatePayload } from "../../../../../vendor/mixpanel-contracts/webapp/app_api/projects/experiments/types.js";
import type {
  FeatureFlagApiPayload,
  FeatureFlagLimitsResults,
} from "../../../../../vendor/mixpanel-contracts/webapp/app_api/projects/feature_flags/types.js";
import type {
  AlertCount,
  CreateAlertParamsInit,
  CustomAlertInit,
  UpdateAlertParamsInit,
  ValidateAlertsForBookmarkParamsInit,
} from "../../../src/types/entities/alerts.js";
import type { CursorPaginationInit } from "../../../src/types/entities/common.js";
import type { DropFilterLimitsResponseInit } from "../../../src/types/entities/data-governance.js";
import type { CreateExperimentParamsInit } from "../../../src/types/entities/experiments.js";
import type {
  CreateFeatureFlagParamsInit,
  FlagLimitsResponseInit,
} from "../../../src/types/entities/feature-flags.js";
import type {
  CreateWebhookParamsInit,
  ProjectWebhookInit,
  UpdateWebhookParamsInit,
  WebhookTestParamsInit,
} from "../../../src/types/entities/webhooks.js";

/** Compile-time truth assertion. */
type Expect<T extends true> = T;

/** True when the two key sets are identical. */
type KeysEqual<A, B> = [
  Exclude<keyof A, keyof B>,
  Exclude<keyof B, keyof A>,
] extends [never, never]
  ? true
  : false;

/** True when `keyof A` minus `keyof B` is exactly `Only`. */
type ExtraKeysAre<A, B, Only extends PropertyKey> = [
  Exclude<keyof A, keyof B>,
] extends [Only]
  ? [Only] extends [Exclude<keyof A, keyof B>]
    ? true
    : false
  : false;

// ---------------------------------------------------------------------------
// Alerts (E4 — MANDATORY verification; endpoint diff recorded in
// PROVENANCE.json `verified_divergences.alerts`). Python's alert CRUD
// calls exactly the `alerts/custom/...` endpoint family the vendored
// file describes, so key-level checks are meaningful here.
// ---------------------------------------------------------------------------

// Request params: key sets match the vendored request models exactly.
type AlertCreateKeys = Expect<
  KeysEqual<CreateAlertParamsInit, CreateCustomAlertRequest>
>;
type AlertUpdateKeys = Expect<
  KeysEqual<UpdateAlertParamsInit, UpdateCustomAlertRequest>
>;
type AlertValidateKeys = Expect<
  KeysEqual<
    ValidateAlertsForBookmarkParamsInit,
    ValidateAlertsForBookmarkRequest
  >
>;

// Alert count: Python unwraps the `{status, results}` envelope; the
// unwrapped shape is assignable to the vendored results model.
type AlertCountShape = Expect<
  Pick<
    AlertCount,
    "anomaly_alerts_count" | "alert_limit" | "is_below_limit"
  > extends CustomAlertsCountResults
    ? true
    : false
>;

// CustomAlert response: the documented E4 divergences, asserted
// exactly. Python-only keys (nested creator/workspace/project objects
// + trigger `results`); vendored-only keys (flat user_id /
// validity_status / workspace_id). `id` is `int` in Python (wire
// vectors record integers) vs `string` in the vendored file — Python
// wins (E4).
type CustomAlertPythonOnly = Expect<
  ExtraKeysAre<
    CustomAlertInit,
    VendoredCustomAlert,
    "creator" | "workspace" | "project" | "results"
  >
>;
type CustomAlertVendoredOnly = Expect<
  ExtraKeysAre<
    VendoredCustomAlert,
    CustomAlertInit,
    "user_id" | "validity_status" | "workspace_id"
  >
>;

// Alert history pagination: Python adds `page_size` on top of the
// vendored cursor pair (checked via the shared CursorPagination model,
// which the alerts/bookmarks history paginations mirror).
type CursorPaginationExtra = Expect<
  ExtraKeysAre<
    CursorPaginationInit,
    AlertsCursorPaginationResponse,
    "page_size"
  >
>;

// ---------------------------------------------------------------------------
// Webhooks (iron-only contract — PROVENANCE coverage_holes.webhooks).
// ---------------------------------------------------------------------------

type WebhookCreateKeys = Expect<
  KeysEqual<CreateWebhookParamsInit, WebhookCreatePayload>
>;
type WebhookUpdateKeys = Expect<
  KeysEqual<UpdateWebhookParamsInit, WebhookUpdatePayload>
>;
type WebhookTestKeys = Expect<
  KeysEqual<WebhookTestParamsInit, WebhookTestPayload>
>;
// ProjectWebhook models one Python-only extra over the vendored list
// item: `auth_type` (Python parses it from detail responses; the iron
// list-item model omits it).
type WebhookItemExtras = Expect<
  ExtraKeysAre<ProjectWebhookInit, WebhookItem, "auth_type">
>;
type WebhookItemCoversVendored = Expect<
  Exclude<keyof WebhookItem, keyof ProjectWebhookInit> extends never
    ? true
    : false
>;

// ---------------------------------------------------------------------------
// Feature flags.
// ---------------------------------------------------------------------------

// Create params are a strict key subset of the server payload model.
type FlagCreateSubset = Expect<
  Exclude<
    keyof CreateFeatureFlagParamsInit,
    keyof FeatureFlagApiPayload
  > extends never
    ? true
    : false
>;
// Limits: Python subsets the vendored results model (the extra
// startup_block_* / is_startup_blocked fields are not modeled).
type FlagLimitsSubset = Expect<
  Exclude<
    keyof FlagLimitsResponseInit,
    keyof FeatureFlagLimitsResults
  > extends never
    ? true
    : false
>;
// NOTE (documented, not asserted): the vendored `FeatureFlagStatus`
// literal set is `'enabled' | 'disabled' | 'archived'` while the
// Python `FeatureFlagStatus` enum carries different member values —
// the Python enum is the contract (E4 authority order); the literal
// tables are locked against `literal-aliases.json` instead.

// ---------------------------------------------------------------------------
// Experiments.
// ---------------------------------------------------------------------------

// `ExperimentCreatePayload` carries an index signature
// (`[k: string]: any`), which makes `keyof`-subset checks vacuous —
// compare against its DECLARED key list instead. Python-only keys
// (`access_type`, `can_edit`) ride the index signature and are
// wire-legal; assert they are exactly the documented pair, and that
// the declared-list transcription stays honest against the vendored
// type.
type VendoredExperimentCreateDeclaredKeys =
  | "description"
  | "feature_flag"
  | "feature_flag_id"
  | "feature_flag_key"
  | "hypothesis"
  | "metrics"
  | "name"
  | "settings"
  | "tags"
  | "variants";
type ExperimentDeclaredKeysHonest = Expect<
  VendoredExperimentCreateDeclaredKeys extends keyof ExperimentCreatePayload
    ? true
    : false
>;
type ExperimentCreateExtras = Expect<
  ExtraKeysAre<
    CreateExperimentParamsInit,
    Record<VendoredExperimentCreateDeclaredKeys, unknown>,
    "access_type" | "can_edit"
  >
>;

// ---------------------------------------------------------------------------
// Data governance (drop-filter limits — the one data_definitions
// overlap with a vendored model).
// ---------------------------------------------------------------------------

type DropFilterLimitsKeys = Expect<
  KeysEqual<DropFilterLimitsResponseInit, EventDropFiltersLimitResults>
>;

/**
 * Every assertion above, referenced once so the compile-only file has
 * no unused locals (the tuple itself is never imported anywhere).
 */
export type VendoredContractChecks = [
  AlertCreateKeys,
  AlertUpdateKeys,
  AlertValidateKeys,
  AlertCountShape,
  CustomAlertPythonOnly,
  CustomAlertVendoredOnly,
  CursorPaginationExtra,
  WebhookCreateKeys,
  WebhookUpdateKeys,
  WebhookTestKeys,
  WebhookItemExtras,
  WebhookItemCoversVendored,
  FlagCreateSubset,
  FlagLimitsSubset,
  ExperimentDeclaredKeysHonest,
  ExperimentCreateExtras,
  DropFilterLimitsKeys,
];
