/**
 * B4-C4 wire bindings — the 46 packet-C4 api-index names (feature
 * flags + experiments + annotations + webhooks + alerts), registered
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

import type { MixpanelClient } from "../../packages/core/src/client/client.js";
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
 * Read an OPTIONAL positional dict argument (the
 * `conclude_experiment`/`duplicate_experiment` `body=None` default —
 * absent stays absent so the TS default applies).
 *
 * @param context - The invocation context.
 * @param name - The kwarg name.
 * @returns The dict, `null`, or `undefined` when absent.
 */
function optionalBody(
  context: InvocationContext,
  name: string,
): Record<string, unknown> | null | undefined {
  if (!Object.hasOwn(context.kwargs, name)) {
    return undefined;
  }
  return context.kwargs[name] as Record<string, unknown> | null;
}

/**
 * Register the B4-C4 bindings (46 names).
 *
 * @param implementations - The registry to extend.
 */
export function registerLifecycleWireBindings(
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

  // ----- feature flags -----

  implementations.register(
    "api_client.list_feature_flags",
    withClient((client, context) =>
      client.listFeatureFlags(kwargBag(context, ["include_archived"])),
    ),
  );

  implementations.register(
    "api_client.create_feature_flag",
    withClient((client, context) =>
      client.createFeatureFlag(
        requireWireKwarg(context, "body") as Record<string, unknown>,
      ),
    ),
  );

  implementations.register(
    "api_client.get_feature_flag",
    withClient((client, context) =>
      client.getFeatureFlag(requireWireKwarg(context, "flag_id") as string),
    ),
  );

  implementations.register(
    "api_client.update_feature_flag",
    withClient((client, context) =>
      client.updateFeatureFlag(
        requireWireKwarg(context, "flag_id") as string,
        requireWireKwarg(context, "body") as Record<string, unknown>,
      ),
    ),
  );

  implementations.register(
    "api_client.delete_feature_flag",
    withClient(async (client, context) => {
      await client.deleteFeatureFlag(
        requireWireKwarg(context, "flag_id") as string,
      );
      return null;
    }),
  );

  implementations.register(
    "api_client.archive_feature_flag",
    withClient(async (client, context) => {
      await client.archiveFeatureFlag(
        requireWireKwarg(context, "flag_id") as string,
      );
      return null;
    }),
  );

  implementations.register(
    "api_client.restore_feature_flag",
    withClient((client, context) =>
      client.restoreFeatureFlag(requireWireKwarg(context, "flag_id") as string),
    ),
  );

  implementations.register(
    "api_client.duplicate_feature_flag",
    withClient((client, context) =>
      client.duplicateFeatureFlag(
        requireWireKwarg(context, "flag_id") as string,
      ),
    ),
  );

  implementations.register(
    "api_client.set_flag_test_users",
    withClient(async (client, context) => {
      await client.setFlagTestUsers(
        requireWireKwarg(context, "flag_id") as string,
        requireWireKwarg(context, "body") as Record<string, unknown>,
      );
      return null;
    }),
  );

  implementations.register(
    "api_client.get_flag_history",
    withClient((client, context) =>
      client.getFlagHistory(
        requireWireKwarg(context, "flag_id") as string,
        kwargBag(context, ["params"]),
      ),
    ),
  );

  implementations.register(
    "api_client.get_flag_limits",
    withClient((client) => client.getFlagLimits()),
  );

  // ----- experiments -----

  implementations.register(
    "api_client.list_experiments",
    withClient((client, context) =>
      client.listExperiments(kwargBag(context, ["include_archived"])),
    ),
  );

  implementations.register(
    "api_client.create_experiment",
    withClient((client, context) =>
      client.createExperiment(
        requireWireKwarg(context, "body") as Record<string, unknown>,
      ),
    ),
  );

  implementations.register(
    "api_client.get_experiment",
    withClient((client, context) =>
      client.getExperiment(
        requireWireKwarg(context, "experiment_id") as string,
      ),
    ),
  );

  implementations.register(
    "api_client.update_experiment",
    withClient((client, context) =>
      client.updateExperiment(
        requireWireKwarg(context, "experiment_id") as string,
        requireWireKwarg(context, "body") as Record<string, unknown>,
      ),
    ),
  );

  implementations.register(
    "api_client.delete_experiment",
    withClient(async (client, context) => {
      await client.deleteExperiment(
        requireWireKwarg(context, "experiment_id") as string,
      );
      return null;
    }),
  );

  implementations.register(
    "api_client.launch_experiment",
    withClient((client, context) =>
      client.launchExperiment(
        requireWireKwarg(context, "experiment_id") as string,
      ),
    ),
  );

  implementations.register(
    "api_client.conclude_experiment",
    withClient((client, context) =>
      client.concludeExperiment(
        requireWireKwarg(context, "experiment_id") as string,
        optionalBody(context, "body"),
      ),
    ),
  );

  implementations.register(
    "api_client.decide_experiment",
    withClient((client, context) =>
      client.decideExperiment(
        requireWireKwarg(context, "experiment_id") as string,
        requireWireKwarg(context, "body") as Record<string, unknown>,
      ),
    ),
  );

  implementations.register(
    "api_client.archive_experiment",
    withClient(async (client, context) => {
      await client.archiveExperiment(
        requireWireKwarg(context, "experiment_id") as string,
      );
      return null;
    }),
  );

  implementations.register(
    "api_client.restore_experiment",
    withClient((client, context) =>
      client.restoreExperiment(
        requireWireKwarg(context, "experiment_id") as string,
      ),
    ),
  );

  implementations.register(
    "api_client.duplicate_experiment",
    withClient((client, context) =>
      client.duplicateExperiment(
        requireWireKwarg(context, "experiment_id") as string,
        optionalBody(context, "body"),
      ),
    ),
  );

  implementations.register(
    "api_client.list_erf_experiments",
    withClient((client) => client.listErfExperiments()),
  );

  // ----- annotations -----

  implementations.register(
    "api_client.list_annotations",
    withClient((client, context) =>
      client.listAnnotations(
        kwargBag(context, ["from_date", "to_date", "tags"]),
      ),
    ),
  );

  implementations.register(
    "api_client.create_annotation",
    withClient((client, context) =>
      client.createAnnotation(
        requireWireKwarg(context, "body") as Record<string, unknown>,
      ),
    ),
  );

  implementations.register(
    "api_client.get_annotation",
    withClient((client, context) =>
      client.getAnnotation(
        requireWireKwarg(context, "annotation_id") as number,
      ),
    ),
  );

  implementations.register(
    "api_client.update_annotation",
    withClient((client, context) =>
      client.updateAnnotation(
        requireWireKwarg(context, "annotation_id") as number,
        requireWireKwarg(context, "body") as Record<string, unknown>,
      ),
    ),
  );

  implementations.register(
    "api_client.delete_annotation",
    withClient(async (client, context) => {
      await client.deleteAnnotation(
        requireWireKwarg(context, "annotation_id") as number,
      );
      return null;
    }),
  );

  implementations.register(
    "api_client.list_annotation_tags",
    withClient((client) => client.listAnnotationTags()),
  );

  implementations.register(
    "api_client.create_annotation_tag",
    withClient((client, context) =>
      client.createAnnotationTag(
        requireWireKwarg(context, "body") as Record<string, unknown>,
      ),
    ),
  );

  // ----- webhooks -----

  implementations.register(
    "api_client.list_webhooks",
    withClient((client) => client.listWebhooks()),
  );

  implementations.register(
    "api_client.create_webhook",
    withClient((client, context) =>
      client.createWebhook(
        requireWireKwarg(context, "body") as Record<string, unknown>,
      ),
    ),
  );

  implementations.register(
    "api_client.update_webhook",
    withClient((client, context) =>
      client.updateWebhook(
        requireWireKwarg(context, "webhook_id") as string,
        requireWireKwarg(context, "body") as Record<string, unknown>,
      ),
    ),
  );

  implementations.register(
    "api_client.delete_webhook",
    withClient(async (client, context) => {
      await client.deleteWebhook(
        requireWireKwarg(context, "webhook_id") as string,
      );
      return null;
    }),
  );

  implementations.register(
    "api_client.test_webhook",
    withClient((client, context) =>
      client.testWebhook(
        requireWireKwarg(context, "body") as Record<string, unknown>,
      ),
    ),
  );

  // ----- alerts -----

  implementations.register(
    "api_client.list_alerts",
    withClient((client, context) =>
      client.listAlerts(kwargBag(context, ["bookmark_id", "skip_user_filter"])),
    ),
  );

  implementations.register(
    "api_client.create_alert",
    withClient((client, context) =>
      client.createAlert(
        requireWireKwarg(context, "body") as Record<string, unknown>,
      ),
    ),
  );

  implementations.register(
    "api_client.get_alert",
    withClient((client, context) =>
      client.getAlert(requireWireKwarg(context, "alert_id") as number),
    ),
  );

  implementations.register(
    "api_client.update_alert",
    withClient((client, context) =>
      client.updateAlert(
        requireWireKwarg(context, "alert_id") as number,
        requireWireKwarg(context, "body") as Record<string, unknown>,
      ),
    ),
  );

  implementations.register(
    "api_client.delete_alert",
    withClient(async (client, context) => {
      await client.deleteAlert(requireWireKwarg(context, "alert_id") as number);
      return null;
    }),
  );

  implementations.register(
    "api_client.bulk_delete_alerts",
    withClient(async (client, context) => {
      await client.bulkDeleteAlerts(
        requireWireKwarg(context, "ids") as readonly number[],
      );
      return null;
    }),
  );

  implementations.register(
    "api_client.get_alert_count",
    withClient((client, context) =>
      client.getAlertCount(kwargBag(context, ["alert_type"])),
    ),
  );

  implementations.register(
    "api_client.get_alert_history",
    withClient((client, context) =>
      client.getAlertHistory(
        requireWireKwarg(context, "alert_id") as number,
        kwargBag(context, ["page_size", "next_cursor", "previous_cursor"]),
      ),
    ),
  );

  implementations.register(
    "api_client.test_alert",
    withClient((client, context) =>
      client.testAlert(
        requireWireKwarg(context, "body") as Record<string, unknown>,
      ),
    ),
  );

  implementations.register(
    "api_client.get_alert_screenshot_url",
    withClient((client, context) =>
      client.getAlertScreenshotUrl(
        requireWireKwarg(context, "gcs_key") as string,
      ),
    ),
  );

  implementations.register(
    "api_client.validate_alerts_for_bookmark",
    withClient((client, context) =>
      client.validateAlertsForBookmark(
        requireWireKwarg(context, "body") as Record<string, unknown>,
      ),
    ),
  );
}
