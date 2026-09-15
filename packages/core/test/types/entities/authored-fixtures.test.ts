// C8(b) authored-fixture locks (phase2-design C5 item 5, packet P2-7).
//
// The models below have NO corpus `$type` occurrences and NO wire
// vector whose api returns them (model-coverage.json rows the P2-1
// generator left `unresolved`): nested sub-models the recorder only
// ever saw inside their parents, params models with no recorded
// call, and the account-surface models. Each gets an authored
// full-field payload — the same `tagged_models=False` walk shape the
// recorder emits — locked by the identity round-trip
// `fromDict(payload)` -> `toVectorPayload()` deep-equal, plus the
// C8(b) anti-vacuity probes (unknown-key mutation + declared-keys
// equality). `coverage_overrides.json` on the Python support branch
// points each model's `authored_fixture` at this file.
//
// The five auth-family Pydantic models (`ServiceAccount`,
// `OAuthBrowserAccount`, `OAuthTokenAccount`, `Session`, `Project`)
// are locked by their P2-4 parse-factory suites instead
// (`packages/core/test/auth/*.test.ts`) and are not repeated here.
import { describe, expect, it } from "vitest";

import { ResponseValidationError } from "../../../src/errors.js";
import * as entities from "../../../src/types/entities/index.js";
import {
  EntityModel,
  type EntityModelStatics,
} from "../../../src/types/entities/model-base.js";

/** Authored full-field payloads, keyed by model name. */
const FIXTURES: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  AccountSummary: {
    name: "x",
    type: "service_account",
    region: "us",
    status: "untested",
    is_active: false,
    referenced_by_targets: [],
    user_email: null,
    project_id: null,
    project_name: null,
  },
  AccountTestResult: {
    account_name: "x",
    ok: true,
    user: null,
    accessible_project_count: null,
    error: null,
    error_code: null,
    error_details: null,
  },
  AlertBookmark: {
    id: 1,
    name: null,
    type: null,
  },
  AlertCreator: {
    id: 1,
    first_name: null,
    last_name: null,
    email: null,
  },
  AlertHistoryPagination: {
    next_cursor: null,
    previous_cursor: null,
    page_size: 20,
  },
  AlertProject: {
    id: 1,
    name: null,
  },
  AlertValidation: {
    alert_id: 1,
    alert_name: "x",
    valid: true,
    reason: null,
  },
  AlertWorkspace: {
    id: 1,
    name: null,
  },
  AnnotationUser: {
    id: 1,
    first_name: "x",
    last_name: "x",
  },
  AuditViolation: {
    violation: "x",
    name: "x",
    platform: null,
    version: null,
    count: 1,
    event: null,
    sensitive: null,
    property_type_error: null,
  },
  BlueprintConfig: {
    variables: {},
  },
  BlueprintTemplate: {
    title_key: "x",
    description_key: "x",
    alternative_description_key: null,
    number_of_reports: null,
  },
  BookmarkHistoryPagination: {
    next_cursor: null,
    previous_cursor: null,
    page_size: 0,
  },
  BookmarkUrl: {
    slug: "EBrV5bW2u9Mw",
    bookmark_type: "insights",
    params: { sections: { show: [] }, displayOptions: { chartType: "line" } },
    name: null,
    description: null,
    overrides: null,
    project_id: 12345,
    user_id: null,
    created_at: "2026-09-02T10:00:00",
    bookmark_id: null,
    bookmark: null,
  },
  BookmarkMetadata: {
    table_display_mode: null,
    compare_enabled: null,
    compare_filters: null,
    retention_calculation_type: null,
    event_name: null,
    funnel_conversion_window: null,
    funnel_breakdown_limit: null,
  },
  CohortCreator: {
    id: null,
    name: null,
    email: null,
  },
  CursorPagination: {
    page_size: 1,
    next_cursor: null,
    previous_cursor: null,
  },
  CustomEventAlternative: {
    event: "x",
  },
  DashboardRow: {
    contents: [
      {
        content_type: "text",
        content_params: {},
      },
    ],
  },
  DashboardRowContent: {
    content_type: "text",
    content_params: {},
  },
  ExperimentCreator: {
    id: null,
    first_name: null,
    last_name: null,
  },
  FlagHistoryParams: {
    page: null,
    page_size: null,
  },
  OAuthLoginResult: {
    account_name: "x",
    user: null,
    expires_at: null,
    tokens_path: "table.csv",
    client_path: "table.csv",
  },
  PaginatedResponse: {
    status: "x",
    results: [],
    pagination: null,
  },
  Target: {
    name: "acct",
    account: "acct",
    project: "12345",
    workspace: null,
  },
  UpdateTextCardParams: {
    markdown: null,
  },
  UploadLookupTableParams: {
    name: "lookup-table",
    file_path: "x",
    data_group_id: null,
  },
};

describe("C8(b) authored entity fixtures", () => {
  for (const [name, payload] of Object.entries(FIXTURES)) {
    const cls = (entities as Readonly<Record<string, unknown>>)[
      name
    ] as EntityModelStatics;

    describe(name, () => {
      it("is a real exported entity class", () => {
        expect(typeof cls).toBe("function");
      });

      it("round-trips the authored payload identically", () => {
        const instance = cls.fromDict(payload);
        expect(instance).toBeInstanceOf(cls as unknown as CallableFunction);
        expect(instance).toBeInstanceOf(EntityModel);
        expect(instance.toVectorPayload()).toEqual(payload);
      });

      it("survives the unknown-key mutation probe", () => {
        const mutated = { ...payload, __p2_7_unknown__: true };
        if (cls.extraPolicy === "forbid") {
          expect(() => cls.fromDict(mutated)).toThrow(ResponseValidationError);
        } else {
          const instance = cls.fromDict(mutated);
          expect(Object.keys(instance.toJSON())).toEqual([
            ...cls.fieldSpecs.map((spec) => spec.name),
            ...(cls.computedSpecs ?? []).map((spec) => spec.name),
          ]);
        }
      });
    });
  }
});
