// Type-level cross-check of the hand-written entity models against the
// byte-frozen schema4api files under `vendor/mixpanel-contracts/` (imported
// `import type` only — nothing here reaches a runtime bundle). Python is the
// arbiter where the two disagree: each documented divergence (recorded in
// `vendor/mixpanel-contracts/PROVENANCE.json` `verified_divergences`) is
// asserted exactly, so silent drift in either direction fails the typecheck.
// Key sets compare the `*Init` constructor interfaces (their keys are the
// Python `model_fields` names); instance types carry methods. Areas without
// a usable vendored contract (cohorts, dashboards, schemas, annotations,
// lookup tables — PROVENANCE `coverage_holes`) are covered by the runtime
// goldens instead.
import { describe, expectTypeOf, it } from "vitest";

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

describe("alerts (vendored alerts/custom request + response models)", () => {
  it("request params carry exactly the vendored request keys", () => {
    expectTypeOf<keyof CreateAlertParamsInit>().toEqualTypeOf<
      keyof CreateCustomAlertRequest
    >();
    expectTypeOf<keyof UpdateAlertParamsInit>().toEqualTypeOf<
      keyof UpdateCustomAlertRequest
    >();
    expectTypeOf<keyof ValidateAlertsForBookmarkParamsInit>().toEqualTypeOf<
      keyof ValidateAlertsForBookmarkRequest
    >();
  });

  it("the unwrapped alert count is assignable to the vendored results model", () => {
    // Python unwraps the `{status, results}` envelope before modelling.
    expectTypeOf<
      Pick<
        AlertCount,
        "anomaly_alerts_count" | "alert_limit" | "is_below_limit"
      >
    >().toExtend<CustomAlertsCountResults>();
  });

  it("CustomAlert differs from the vendored model by exactly the documented keys", () => {
    // Python-only: nested creator/workspace/project objects plus the trigger
    // `results`; vendored-only: the flat user/validity/workspace ids. `id` is
    // an integer in Python (the wire vectors record integers), a string in
    // the vendored file — Python wins.
    expectTypeOf<
      Exclude<keyof CustomAlertInit, keyof VendoredCustomAlert>
    >().toEqualTypeOf<"creator" | "workspace" | "project" | "results">();
    expectTypeOf<
      Exclude<keyof VendoredCustomAlert, keyof CustomAlertInit>
    >().toEqualTypeOf<"user_id" | "validity_status" | "workspace_id">();
  });

  it("cursor pagination adds `page_size` over the vendored cursor pair", () => {
    expectTypeOf<
      Exclude<keyof CursorPaginationInit, keyof AlertsCursorPaginationResponse>
    >().toEqualTypeOf<"page_size">();
  });
});

describe("webhooks (iron-only contract)", () => {
  it("request params carry exactly the vendored payload keys", () => {
    expectTypeOf<keyof CreateWebhookParamsInit>().toEqualTypeOf<
      keyof WebhookCreatePayload
    >();
    expectTypeOf<keyof UpdateWebhookParamsInit>().toEqualTypeOf<
      keyof WebhookUpdatePayload
    >();
    expectTypeOf<keyof WebhookTestParamsInit>().toEqualTypeOf<
      keyof WebhookTestPayload
    >();
  });

  it("ProjectWebhook covers the vendored list item plus `auth_type`", () => {
    // Python parses `auth_type` from detail responses; the iron list-item
    // model omits it.
    expectTypeOf<
      Exclude<keyof ProjectWebhookInit, keyof WebhookItem>
    >().toEqualTypeOf<"auth_type">();
    expectTypeOf<
      Exclude<keyof WebhookItem, keyof ProjectWebhookInit>
    >().toBeNever();
  });
});

describe("feature flags", () => {
  it("create params are a key subset of the server payload model", () => {
    expectTypeOf<
      Exclude<keyof CreateFeatureFlagParamsInit, keyof FeatureFlagApiPayload>
    >().toBeNever();
  });

  it("limits are a key subset of the vendored results model", () => {
    // The vendored startup_block_* / is_startup_blocked fields are not
    // modelled in Python. The `FeatureFlagStatus` literal set also differs
    // from the Python enum; the Python enum is the contract and the literal
    // tables are locked against `literal-aliases.json` instead.
    expectTypeOf<
      Exclude<keyof FlagLimitsResponseInit, keyof FeatureFlagLimitsResults>
    >().toBeNever();
  });
});

describe("experiments", () => {
  // `ExperimentCreatePayload` carries an index signature, which makes a
  // `keyof`-subset check vacuous — compare against its declared key list.
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

  it("the transcribed declared-key list is honest against the vendored type", () => {
    expectTypeOf<VendoredExperimentCreateDeclaredKeys>().toExtend<
      keyof ExperimentCreatePayload
    >();
  });

  it("create params add exactly the two wire-legal Python-only keys", () => {
    expectTypeOf<
      Exclude<
        keyof CreateExperimentParamsInit,
        VendoredExperimentCreateDeclaredKeys
      >
    >().toEqualTypeOf<"access_type" | "can_edit">();
  });
});

describe("data governance (drop-filter limits)", () => {
  it("DropFilterLimitsResponse carries exactly the vendored keys", () => {
    expectTypeOf<keyof DropFilterLimitsResponseInit>().toEqualTypeOf<
      keyof EventDropFiltersLimitResults
    >();
  });
});
