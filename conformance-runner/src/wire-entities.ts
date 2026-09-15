/**
 * B4-C3 wire bindings — the 38 packet-C3 api-index names (dashboard
 * CRUD + blueprints/RCA + bookmarks-v2 + cohorts App API), registered
 * inline in the shard commit per the P3-2 b′ fable-batch rule.
 *
 * Binding honesty (P3-5 §3): every binding is memoized
 * `clientFromSession` + ONE client-method call + kwarg passthrough
 * (absent-stays-absent). The only output adaptations are the C1 codec
 * twins (`runWire`/`coreToVectorJson`); void Python methods return
 * `null` (the recorder's `None`).
 *
 * Oracle note: wire api names have NO oracle `call` surface (P3-2 c/e);
 * registration here is complete.
 */

import type { MixpanelClient } from "@mixpanel-headless/core";

import type { JsonValue } from "./json-value.js";
import type { ImplementationRegistry, InvocationContext } from "./runner.js";
import { clientFromSession, requireWireKwarg, runWire } from "./wire-client.js";

/**
 * Copy the PRESENT members of `call.input` into an options bag under
 * the same Python kwarg names (absent stays absent — R3.5; the B4-C2
 * `kwargBag` twin).
 *
 * @param context - The invocation context.
 * @param names - The kwarg names the method accepts.
 * @returns The options bag.
 */
function kwargBag(
  context: InvocationContext,
  names: readonly string[],
): Record<string, unknown> {
  const bag: Record<string, unknown> = {};
  for (const name of names) {
    if (Object.hasOwn(context.kwargs, name)) {
      bag[name] = context.kwargs[name];
    }
  }
  return bag;
}

/**
 * Register the B4-C3 bindings (38 names).
 *
 * @param implementations - The registry to extend.
 */
export function registerEntityWireBindings(
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

  // ----- dashboards -----

  implementations.register(
    "api_client.list_dashboards",
    withClient((client, context) =>
      client.listDashboards(kwargBag(context, ["ids"])),
    ),
  );

  implementations.register(
    "api_client.create_dashboard",
    withClient((client, context) =>
      client.createDashboard(
        requireWireKwarg(context, "body") as Record<string, unknown>,
      ),
    ),
  );

  implementations.register(
    "api_client.get_dashboard",
    withClient((client, context) =>
      client.getDashboard(requireWireKwarg(context, "dashboard_id") as number),
    ),
  );

  implementations.register(
    "api_client.update_dashboard",
    withClient((client, context) =>
      client.updateDashboard(
        requireWireKwarg(context, "dashboard_id") as number,
        requireWireKwarg(context, "body") as Record<string, unknown>,
      ),
    ),
  );

  implementations.register(
    "api_client.delete_dashboard",
    withClient(async (client, context) => {
      await client.deleteDashboard(
        requireWireKwarg(context, "dashboard_id") as number,
      );
      return null;
    }),
  );

  implementations.register(
    "api_client.bulk_delete_dashboards",
    withClient(async (client, context) => {
      await client.bulkDeleteDashboards(
        requireWireKwarg(context, "ids") as readonly number[],
      );
      return null;
    }),
  );

  implementations.register(
    "api_client.favorite_dashboard",
    withClient(async (client, context) => {
      await client.favoriteDashboard(
        requireWireKwarg(context, "dashboard_id") as number,
      );
      return null;
    }),
  );

  implementations.register(
    "api_client.unfavorite_dashboard",
    withClient(async (client, context) => {
      await client.unfavoriteDashboard(
        requireWireKwarg(context, "dashboard_id") as number,
      );
      return null;
    }),
  );

  implementations.register(
    "api_client.pin_dashboard",
    withClient(async (client, context) => {
      await client.pinDashboard(
        requireWireKwarg(context, "dashboard_id") as number,
      );
      return null;
    }),
  );

  implementations.register(
    "api_client.unpin_dashboard",
    withClient(async (client, context) => {
      await client.unpinDashboard(
        requireWireKwarg(context, "dashboard_id") as number,
      );
      return null;
    }),
  );

  implementations.register(
    "api_client.remove_report_from_dashboard",
    withClient((client, context) =>
      client.removeReportFromDashboard(
        requireWireKwarg(context, "dashboard_id") as number,
        requireWireKwarg(context, "bookmark_id") as number,
      ),
    ),
  );

  implementations.register(
    "api_client.add_report_to_dashboard",
    withClient((client, context) =>
      client.addReportToDashboard(
        requireWireKwarg(context, "dashboard_id") as number,
        requireWireKwarg(context, "bookmark_id") as number,
      ),
    ),
  );

  // ----- blueprints / RCA / dashboard-adjacent -----

  implementations.register(
    "api_client.list_blueprint_templates",
    withClient((client, context) =>
      client.listBlueprintTemplates(kwargBag(context, ["include_reports"])),
    ),
  );

  implementations.register(
    "api_client.create_blueprint",
    withClient((client, context) =>
      client.createBlueprint(
        requireWireKwarg(context, "template_type") as string,
      ),
    ),
  );

  implementations.register(
    "api_client.get_blueprint_config",
    withClient((client, context) =>
      client.getBlueprintConfig(
        requireWireKwarg(context, "dashboard_id") as number,
      ),
    ),
  );

  implementations.register(
    "api_client.update_blueprint_cohorts",
    withClient(async (client, context) => {
      await client.updateBlueprintCohorts(
        requireWireKwarg(context, "cohorts") as ReadonlyArray<
          Record<string, unknown>
        >,
      );
      return null;
    }),
  );

  implementations.register(
    "api_client.finalize_blueprint",
    withClient((client, context) =>
      client.finalizeBlueprint(
        requireWireKwarg(context, "body") as Record<string, unknown>,
      ),
    ),
  );

  implementations.register(
    "api_client.create_rca_dashboard",
    withClient((client, context) =>
      client.createRcaDashboard(
        requireWireKwarg(context, "body") as Record<string, unknown>,
      ),
    ),
  );

  implementations.register(
    "api_client.get_bookmark_dashboard_ids",
    withClient((client, context) =>
      client.getBookmarkDashboardIds(
        requireWireKwarg(context, "bookmark_id") as number,
      ),
    ),
  );

  implementations.register(
    "api_client.get_dashboard_erf",
    withClient((client, context) =>
      client.getDashboardErf(
        requireWireKwarg(context, "dashboard_id") as number,
      ),
    ),
  );

  implementations.register(
    "api_client.update_report_link",
    withClient(async (client, context) => {
      await client.updateReportLink(
        requireWireKwarg(context, "dashboard_id") as number,
        requireWireKwarg(context, "report_link_id") as number,
        requireWireKwarg(context, "body") as Record<string, unknown>,
      );
      return null;
    }),
  );

  implementations.register(
    "api_client.update_text_card",
    withClient(async (client, context) => {
      await client.updateTextCard(
        requireWireKwarg(context, "dashboard_id") as number,
        requireWireKwarg(context, "text_card_id") as number,
        requireWireKwarg(context, "body") as Record<string, unknown>,
      );
      return null;
    }),
  );

  // ----- bookmarks v2 -----

  implementations.register(
    "api_client.list_bookmarks_v2",
    withClient((client, context) =>
      client.listBookmarksV2(kwargBag(context, ["bookmark_type", "ids"])),
    ),
  );

  implementations.register(
    "api_client.create_bookmark",
    withClient((client, context) =>
      client.createBookmark(
        requireWireKwarg(context, "body") as Record<string, unknown>,
      ),
    ),
  );

  implementations.register(
    "api_client.get_bookmark",
    withClient((client, context) =>
      client.getBookmark(requireWireKwarg(context, "bookmark_id") as number),
    ),
  );

  // ----- 045-report-links (Python PR #223): slug records + shortlinks -----
  implementations.register(
    "api_client.create_bookmark_url",
    withClient((client, context) =>
      client.createBookmarkUrl(
        requireWireKwarg(context, "body") as Record<string, unknown>,
      ),
    ),
  );

  implementations.register(
    "api_client.get_bookmark_url",
    withClient((client, context) =>
      client.getBookmarkUrl(requireWireKwarg(context, "slug") as string),
    ),
  );

  implementations.register(
    "api_client.resolve_short_link",
    withClient((client, context) =>
      client.resolveShortLink(requireWireKwarg(context, "code") as string),
    ),
  );

  implementations.register(
    "api_client.update_bookmark",
    withClient((client, context) =>
      client.updateBookmark(
        requireWireKwarg(context, "bookmark_id") as number,
        requireWireKwarg(context, "body") as Record<string, unknown>,
      ),
    ),
  );

  implementations.register(
    "api_client.delete_bookmark",
    withClient(async (client, context) => {
      await client.deleteBookmark(
        requireWireKwarg(context, "bookmark_id") as number,
      );
      return null;
    }),
  );

  implementations.register(
    "api_client.bulk_delete_bookmarks",
    withClient(async (client, context) => {
      await client.bulkDeleteBookmarks(
        requireWireKwarg(context, "ids") as readonly number[],
      );
      return null;
    }),
  );

  implementations.register(
    "api_client.bulk_update_bookmarks",
    withClient(async (client, context) => {
      await client.bulkUpdateBookmarks(
        requireWireKwarg(context, "entries") as ReadonlyArray<
          Record<string, unknown>
        >,
      );
      return null;
    }),
  );

  implementations.register(
    "api_client.bookmark_linked_dashboard_ids",
    withClient((client, context) =>
      client.bookmarkLinkedDashboardIds(
        requireWireKwarg(context, "bookmark_id") as number,
      ),
    ),
  );

  implementations.register(
    "api_client.get_bookmark_history",
    withClient((client, context) =>
      client.getBookmarkHistory(
        requireWireKwarg(context, "bookmark_id") as number,
        kwargBag(context, ["cursor", "page_size"]),
      ),
    ),
  );

  // ----- cohorts (App API) -----

  implementations.register(
    "api_client.list_cohorts_app",
    withClient((client, context) =>
      client.listCohortsApp(kwargBag(context, ["data_group_id", "ids"])),
    ),
  );

  implementations.register(
    "api_client.get_cohort",
    withClient((client, context) =>
      client.getCohort(requireWireKwarg(context, "cohort_id") as number),
    ),
  );

  implementations.register(
    "api_client.create_cohort",
    withClient((client, context) =>
      client.createCohort(
        requireWireKwarg(context, "body") as Record<string, unknown>,
      ),
    ),
  );

  implementations.register(
    "api_client.update_cohort",
    withClient((client, context) =>
      client.updateCohort(
        requireWireKwarg(context, "cohort_id") as number,
        requireWireKwarg(context, "body") as Record<string, unknown>,
      ),
    ),
  );

  implementations.register(
    "api_client.delete_cohort",
    withClient(async (client, context) => {
      await client.deleteCohort(
        requireWireKwarg(context, "cohort_id") as number,
      );
      return null;
    }),
  );

  implementations.register(
    "api_client.bulk_delete_cohorts",
    withClient(async (client, context) => {
      await client.bulkDeleteCohorts(
        requireWireKwarg(context, "ids") as readonly number[],
      );
      return null;
    }),
  );

  implementations.register(
    "api_client.bulk_update_cohorts",
    withClient(async (client, context) => {
      await client.bulkUpdateCohorts(
        requireWireKwarg(context, "entries") as ReadonlyArray<
          Record<string, unknown>
        >,
      );
      return null;
    }),
  );
}
