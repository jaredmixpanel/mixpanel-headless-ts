/**
 * `api_client.*` wire bindings for the query host, engage and
 * streaming/export calls.
 *
 * Every binding is the memoized `clientFromSession` plus one
 * client-method call and kwarg passthrough (absent stays absent); see
 * `wire-client.ts` for the shared client-construction and honesty rules.
 * Beyond the `runWire`/`coreToVectorJson` codec twins, three output
 * adaptations:
 * - streaming generators are drained to arrays (the recorder measured
 *   `list(client.export_events(...))`);
 * - `$type: callback` kwargs are served by the shared `RecordingCallback`
 *   stubs (`on_batch` → the method's `onBatch` seam; the runner diffs
 *   the recorded call log);
 * - `export_profiles_page` results re-encode via
 *   `ProfilePageResult.toVectorPayload()` (the recorder's dataclass
 *   field walk).
 */

import type { MixpanelClient } from "@mixpanel-headless/core";

import { RecordingCallback } from "./codecs.js";
import { kwargBag } from "./internal/kwargs.js";
import type { JsonValue } from "./json-value.js";
import type { ImplementationRegistry, InvocationContext } from "./runner.js";
import { clientFromSession, requireWireKwarg, runWire } from "./wire-client.js";

/**
 * Read an optional `on_batch` recording stub as the `onBatch` seam.
 *
 * @param context - The invocation context.
 * @returns The seam fragment (empty when the kwarg is absent).
 */
function onBatchSeam(context: InvocationContext): {
  onBatch?: (count: number) => void;
} {
  const raw = context.kwargs["on_batch"];
  if (raw instanceof RecordingCallback) {
    return { onBatch: (count: number): void => raw.fn(count) };
  }
  return {};
}

/**
 * Drain an async generator into an array (the recorder's `list(...)`).
 *
 * @param source - The generator.
 * @returns The collected items.
 */
async function drainAsync(source: AsyncIterable<unknown>): Promise<unknown[]> {
  const out: unknown[] = [];
  for await (const item of source) {
    out.push(item);
  }
  return out;
}

/**
 * Register the query wire bindings.
 *
 * @param implementations - The registry to extend.
 */
// eslint-disable-next-line max-lines-per-function -- branch-for-branch port of one Python function (see the docblock); splitting it would scatter the guard order the corpus pins
export function registerQueryWireBindings(
  implementations: ImplementationRegistry,
): void {
  const withClient =
    (
      invoke: (
        client: MixpanelClient,
        context: InvocationContext,
      ) => Promise<unknown>,
    ) =>
    async (context: InvocationContext): Promise<JsonValue> => {
      const client = clientFromSession(context);
      return runWire(() => invoke(client, context));
    };

  // ----- streaming/export -----

  implementations.register(
    "api_client.export_events",
    withClient((client, context) =>
      drainAsync(
        client.exportEvents(
          requireWireKwarg(context, "from_date") as string,
          requireWireKwarg(context, "to_date") as string,
          {
            ...kwargBag(context, ["events", "where", "limit"]),
            ...onBatchSeam(context),
          },
        ),
      ),
    ),
  );

  implementations.register(
    "api_client.export_profiles",
    withClient((client, context) =>
      drainAsync(
        client.exportProfiles({
          ...kwargBag(context, [
            "where",
            "cohort_id",
            "output_properties",
            "distinct_id",
            "distinct_ids",
            "group_id",
            "behaviors",
            "as_of_timestamp",
            "include_all_users",
          ]),
          ...onBatchSeam(context),
        }),
      ),
    ),
  );

  implementations.register(
    "api_client.export_profiles_page",
    withClient(async (client, context) => {
      const result = await client.exportProfilesPage(
        requireWireKwarg(context, "page") as number,
        kwargBag(context, [
          "session_id",
          "where",
          "cohort_id",
          "output_properties",
          "group_id",
          "behaviors",
          "as_of_timestamp",
          "include_all_users",
          "sort_key",
          "sort_order",
          "search",
          "limit",
          "filter_by_cohort",
          "distinct_id",
          "distinct_ids",
        ]),
      );
      // Recorder twin: encode_expect_value walks the dataclass fields
      // (runWire's coreToVectorJson converts the payload members).
      return result.toVectorPayload();
    }),
  );

  implementations.register(
    "api_client.engage_stats",
    withClient((client, context) =>
      client.engageStats(
        kwargBag(context, [
          "where",
          "action",
          "filter_by_cohort",
          "segment_by_cohorts",
          "group_id",
          "as_of_timestamp",
          "include_all_users",
        ]),
      ),
    ),
  );

  // ----- discovery -----

  implementations.register(
    "api_client.get_events",
    withClient((client, context) =>
      client.getEvents(kwargBag(context, ["limit", "from_date", "to_date"])),
    ),
  );

  implementations.register(
    "api_client.get_event_properties",
    withClient((client, context) =>
      client.getEventProperties(requireWireKwarg(context, "event") as string),
    ),
  );

  implementations.register(
    "api_client.get_property_values",
    withClient((client, context) =>
      client.getPropertyValues(
        requireWireKwarg(context, "property_name") as string,
        kwargBag(context, ["event", "limit"]),
      ),
    ),
  );

  implementations.register(
    "api_client.list_funnels",
    withClient((client) => client.listFunnels()),
  );

  implementations.register(
    "api_client.list_cohorts",
    withClient((client) => client.listCohorts()),
  );

  implementations.register(
    "api_client.get_top_events",
    withClient((client, context) =>
      client.getTopEvents(kwargBag(context, ["type", "limit"])),
    ),
  );

  implementations.register(
    "api_client.event_counts",
    withClient((client, context) =>
      client.eventCounts(
        requireWireKwarg(context, "events") as readonly string[],
        requireWireKwarg(context, "from_date") as string,
        requireWireKwarg(context, "to_date") as string,
        kwargBag(context, ["type", "unit"]),
      ),
    ),
  );

  implementations.register(
    "api_client.property_counts",
    withClient((client, context) =>
      client.propertyCounts(
        requireWireKwarg(context, "event") as string,
        requireWireKwarg(context, "property_name") as string,
        requireWireKwarg(context, "from_date") as string,
        requireWireKwarg(context, "to_date") as string,
        kwargBag(context, ["type", "unit", "values", "limit"]),
      ),
    ),
  );

  // ----- query methods -----

  implementations.register(
    "api_client.segmentation",
    withClient((client, context) =>
      client.segmentation(
        requireWireKwarg(context, "event") as string,
        requireWireKwarg(context, "from_date") as string,
        requireWireKwarg(context, "to_date") as string,
        kwargBag(context, ["on", "unit", "type", "where"]),
      ),
    ),
  );

  implementations.register(
    "api_client.funnel",
    withClient((client, context) =>
      client.funnel(
        requireWireKwarg(context, "funnel_id") as number,
        requireWireKwarg(context, "from_date") as string,
        requireWireKwarg(context, "to_date") as string,
        kwargBag(context, ["unit", "on", "where", "length", "length_unit"]),
      ),
    ),
  );

  implementations.register(
    "api_client.retention",
    withClient((client, context) =>
      client.retention(
        requireWireKwarg(context, "born_event") as string,
        requireWireKwarg(context, "event") as string,
        requireWireKwarg(context, "from_date") as string,
        requireWireKwarg(context, "to_date") as string,
        kwargBag(context, [
          "retention_type",
          "born_where",
          "where",
          "interval",
          "interval_count",
          "unit",
        ]),
      ),
    ),
  );

  implementations.register(
    "api_client.activity_feed",
    withClient((client, context) =>
      client.activityFeed(
        requireWireKwarg(context, "distinct_ids") as readonly string[],
        kwargBag(context, [
          "from_date",
          "to_date",
          "limit",
          "include_events",
          "exclude_events",
          "sentinel_event",
          "paging_window",
          "search",
          "search_properties",
          "use_custom_events",
        ]),
      ),
    ),
  );

  implementations.register(
    "api_client.query_saved_report",
    withClient((client, context) =>
      client.querySavedReport(
        requireWireKwarg(context, "bookmark_id") as number,
        kwargBag(context, ["bookmark_type", "from_date", "to_date"]),
      ),
    ),
  );

  implementations.register(
    "api_client.list_bookmarks",
    withClient((client, context) =>
      client.listBookmarks(
        Object.hasOwn(context.kwargs, "bookmark_type")
          ? (context.kwargs["bookmark_type"] as string | null)
          : undefined,
      ),
    ),
  );

  implementations.register(
    "api_client.insights_query",
    withClient((client, context) =>
      client.insightsQuery(
        requireWireKwarg(context, "body") as Record<string, unknown>,
        kwargBag(context, ["workspace_id", "inject_workspace_id"]),
      ),
    ),
  );

  implementations.register(
    "api_client.arb_funnels_query",
    withClient((client, context) =>
      client.arbFunnelsQuery(
        requireWireKwarg(context, "body") as Record<string, unknown>,
        kwargBag(context, ["workspace_id", "inject_workspace_id"]),
      ),
    ),
  );

  implementations.register(
    "api_client.query_saved_flows",
    withClient((client, context) =>
      client.querySavedFlows(
        requireWireKwarg(context, "bookmark_id") as number,
      ),
    ),
  );

  implementations.register(
    "api_client.frequency",
    withClient((client, context) =>
      client.frequency(
        requireWireKwarg(context, "from_date") as string,
        requireWireKwarg(context, "to_date") as string,
        requireWireKwarg(context, "unit") as string,
        requireWireKwarg(context, "addiction_unit") as string,
        kwargBag(context, ["event", "where", "on", "limit"]),
      ),
    ),
  );

  implementations.register(
    "api_client.segmentation_numeric",
    withClient((client, context) =>
      client.segmentationNumeric(
        requireWireKwarg(context, "event") as string,
        requireWireKwarg(context, "from_date") as string,
        requireWireKwarg(context, "to_date") as string,
        requireWireKwarg(context, "on") as string,
        kwargBag(context, ["unit", "where", "type"]),
      ),
    ),
  );

  implementations.register(
    "api_client.segmentation_sum",
    withClient((client, context) =>
      client.segmentationSum(
        requireWireKwarg(context, "event") as string,
        requireWireKwarg(context, "from_date") as string,
        requireWireKwarg(context, "to_date") as string,
        requireWireKwarg(context, "on") as string,
        kwargBag(context, ["unit", "where"]),
      ),
    ),
  );

  implementations.register(
    "api_client.segmentation_average",
    withClient((client, context) =>
      client.segmentationAverage(
        requireWireKwarg(context, "event") as string,
        requireWireKwarg(context, "from_date") as string,
        requireWireKwarg(context, "to_date") as string,
        requireWireKwarg(context, "on") as string,
        kwargBag(context, ["unit", "where"]),
      ),
    ),
  );
}
