/**
 * B4-C5 wire bindings — the 64 packet-C5 api-index names (schemas +
 * lexicon + drop filters + custom properties + lookup tables + custom
 * events + schema enforcement + audit + anomalies + deletion requests
 * + replays signing), registered inline in the shard commit per the
 * P3-2 b′ fable-batch rule. `get_schemas` doubles as the shard's one
 * setup api (packet setup-owner table).
 *
 * Binding honesty (P3-5 §3): every binding is memoized
 * `clientFromSession` + ONE client-method call + kwarg passthrough
 * (absent-stays-absent). The only output adaptations are the C1 codec
 * twins (`runWire`/`coreToVectorJson`), the `$type: bytes` encoding on
 * `download_lookup_table` (`encodeExpectValue` — the recorder's own
 * bytes codec), and `null` returns for void Python methods.
 *
 * Oracle note: wire api names have NO oracle `call` surface (P3-2 c/e);
 * registration here is complete.
 */

import type { MixpanelClient } from "../../packages/core/src/client/client.js";
import type { ReplayEnv } from "../../packages/core/src/services/entities/replays-signing.js";
import { encodeExpectValue } from "./codecs.js";
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
 * Register the B4-C5 bindings (64 names).
 *
 * @param implementations - The registry to extend.
 */
export function registerGovernanceWireBindings(
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

  // ----- schemas (Lexicon reads + Schema Registry CRUD) -----

  implementations.register(
    "api_client.get_schemas",
    withClient((client, context) =>
      client.getSchemas(kwargBag(context, ["entity_type"])),
    ),
  );

  implementations.register(
    "api_client.get_schema",
    withClient((client, context) =>
      client.getSchema(
        requireWireKwarg(context, "entity_type") as string,
        requireWireKwarg(context, "name") as string,
      ),
    ),
  );

  implementations.register(
    "api_client.list_schema_registry",
    withClient((client, context) =>
      client.listSchemaRegistry(kwargBag(context, ["entity_type"])),
    ),
  );

  implementations.register(
    "api_client.create_schema",
    withClient((client, context) =>
      client.createSchema(
        requireWireKwarg(context, "entity_type") as string,
        requireWireKwarg(context, "entity_name") as string,
        requireWireKwarg(context, "schema_json") as Record<string, unknown>,
      ),
    ),
  );

  implementations.register(
    "api_client.create_schemas_bulk",
    withClient((client, context) =>
      client.createSchemasBulk(
        requireWireKwarg(context, "body") as Record<string, unknown>,
      ),
    ),
  );

  implementations.register(
    "api_client.update_schema",
    withClient((client, context) =>
      client.updateSchema(
        requireWireKwarg(context, "entity_type") as string,
        requireWireKwarg(context, "entity_name") as string,
        requireWireKwarg(context, "schema_json") as Record<string, unknown>,
      ),
    ),
  );

  implementations.register(
    "api_client.update_schemas_bulk",
    withClient((client, context) =>
      client.updateSchemasBulk(
        requireWireKwarg(context, "body") as Record<string, unknown>,
      ),
    ),
  );

  implementations.register(
    "api_client.delete_schemas",
    withClient((client, context) =>
      client.deleteSchemas(kwargBag(context, ["entity_type", "entity_name"])),
    ),
  );

  // ----- lexicon definitions -----

  implementations.register(
    "api_client.get_event_definitions",
    withClient((client, context) =>
      client.getEventDefinitions(
        requireWireKwarg(context, "names") as string[],
      ),
    ),
  );

  implementations.register(
    "api_client.list_event_definitions",
    withClient((client) => client.listEventDefinitions()),
  );

  implementations.register(
    "api_client.update_event_definition",
    withClient((client, context) =>
      client.updateEventDefinition(
        requireWireKwarg(context, "name") as string,
        requireWireKwarg(context, "body") as Record<string, unknown>,
      ),
    ),
  );

  implementations.register(
    "api_client.delete_event_definition",
    withClient(async (client, context) => {
      await client.deleteEventDefinition(
        requireWireKwarg(context, "name") as string,
      );
      return null;
    }),
  );

  implementations.register(
    "api_client.bulk_update_event_definitions",
    withClient((client, context) =>
      client.bulkUpdateEventDefinitions(
        requireWireKwarg(context, "body") as Record<string, unknown>,
      ),
    ),
  );

  implementations.register(
    "api_client.get_property_definitions",
    withClient((client, context) =>
      client.getPropertyDefinitions(
        requireWireKwarg(context, "names") as string[],
        ...(Object.hasOwn(context.kwargs, "resource_type")
          ? [context.kwargs["resource_type"] as string | null]
          : []),
      ),
    ),
  );

  implementations.register(
    "api_client.list_property_definitions",
    withClient((client, context) =>
      client.listPropertyDefinitions(
        kwargBag(context, [
          "resource_type",
          "include_events",
          "include_density",
          "include_custom",
          "include_zero_counts",
        ]),
      ),
    ),
  );

  implementations.register(
    "api_client.list_per_event_properties",
    withClient((client) => client.listPerEventProperties()),
  );

  implementations.register(
    "api_client.update_property_definition",
    withClient((client, context) =>
      client.updatePropertyDefinition(
        requireWireKwarg(context, "name") as string,
        requireWireKwarg(context, "body") as Record<string, unknown>,
      ),
    ),
  );

  implementations.register(
    "api_client.bulk_update_property_definitions",
    withClient((client, context) =>
      client.bulkUpdatePropertyDefinitions(
        requireWireKwarg(context, "body") as Record<string, unknown>,
      ),
    ),
  );

  // ----- lexicon tags / metadata / history / export -----

  implementations.register(
    "api_client.list_lexicon_tags",
    withClient((client) => client.listLexiconTags()),
  );

  implementations.register(
    "api_client.create_lexicon_tag",
    withClient((client, context) =>
      client.createLexiconTag(
        requireWireKwarg(context, "body") as Record<string, unknown>,
      ),
    ),
  );

  implementations.register(
    "api_client.update_lexicon_tag",
    withClient((client, context) =>
      client.updateLexiconTag(
        requireWireKwarg(context, "tag_id") as number,
        requireWireKwarg(context, "body") as Record<string, unknown>,
      ),
    ),
  );

  implementations.register(
    "api_client.delete_lexicon_tag",
    withClient(async (client, context) => {
      await client.deleteLexiconTag(
        requireWireKwarg(context, "name") as string,
      );
      return null;
    }),
  );

  implementations.register(
    "api_client.get_tracking_metadata",
    withClient((client, context) =>
      client.getTrackingMetadata(
        requireWireKwarg(context, "event_name") as string,
      ),
    ),
  );

  implementations.register(
    "api_client.get_event_history",
    withClient((client, context) =>
      client.getEventHistory(requireWireKwarg(context, "event_name") as string),
    ),
  );

  implementations.register(
    "api_client.get_property_history",
    withClient((client, context) =>
      client.getPropertyHistory(
        requireWireKwarg(context, "property_name") as string,
        requireWireKwarg(context, "entity_type") as string,
      ),
    ),
  );

  implementations.register(
    "api_client.export_lexicon",
    withClient((client, context) =>
      client.exportLexicon(
        ...(Object.hasOwn(context.kwargs, "export_types")
          ? [context.kwargs["export_types"] as string[] | null]
          : []),
      ),
    ),
  );

  // ----- drop filters -----

  implementations.register(
    "api_client.list_drop_filters",
    withClient((client) => client.listDropFilters()),
  );

  implementations.register(
    "api_client.create_drop_filter",
    withClient((client, context) =>
      client.createDropFilter(
        requireWireKwarg(context, "body") as Record<string, unknown>,
      ),
    ),
  );

  implementations.register(
    "api_client.update_drop_filter",
    withClient((client, context) =>
      client.updateDropFilter(
        requireWireKwarg(context, "body") as Record<string, unknown>,
      ),
    ),
  );

  implementations.register(
    "api_client.delete_drop_filter",
    withClient((client, context) =>
      client.deleteDropFilter(
        requireWireKwarg(context, "drop_filter_id") as number,
      ),
    ),
  );

  implementations.register(
    "api_client.get_drop_filter_limits",
    withClient((client) => client.getDropFilterLimits()),
  );

  // ----- custom properties -----

  implementations.register(
    "api_client.list_custom_properties",
    withClient((client) => client.listCustomProperties()),
  );

  implementations.register(
    "api_client.create_custom_property",
    withClient((client, context) =>
      client.createCustomProperty(
        requireWireKwarg(context, "body") as Record<string, unknown>,
      ),
    ),
  );

  implementations.register(
    "api_client.get_custom_property",
    withClient((client, context) =>
      client.getCustomProperty(
        requireWireKwarg(context, "property_id") as string,
      ),
    ),
  );

  implementations.register(
    "api_client.update_custom_property",
    withClient((client, context) =>
      client.updateCustomProperty(
        requireWireKwarg(context, "property_id") as string,
        requireWireKwarg(context, "body") as Record<string, unknown>,
      ),
    ),
  );

  implementations.register(
    "api_client.delete_custom_property",
    withClient(async (client, context) => {
      await client.deleteCustomProperty(
        requireWireKwarg(context, "property_id") as string,
      );
      return null;
    }),
  );

  implementations.register(
    "api_client.validate_custom_property",
    withClient((client, context) =>
      client.validateCustomProperty(
        requireWireKwarg(context, "body") as Record<string, unknown>,
      ),
    ),
  );

  // ----- lookup tables -----

  implementations.register(
    "api_client.list_lookup_tables",
    withClient((client, context) =>
      client.listLookupTables(kwargBag(context, ["data_group_id"])),
    ),
  );

  implementations.register(
    "api_client.get_lookup_upload_url",
    withClient((client, context) =>
      client.getLookupUploadUrl(
        ...(Object.hasOwn(context.kwargs, "content_type")
          ? [context.kwargs["content_type"] as string]
          : []),
      ),
    ),
  );

  implementations.register(
    "api_client.upload_to_signed_url",
    withClient(async (client, context) => {
      await client.uploadToSignedUrl(
        requireWireKwarg(context, "url") as string,
        requireWireKwarg(context, "csv_bytes") as Uint8Array,
      );
      return null;
    }),
  );

  implementations.register(
    "api_client.register_lookup_table",
    withClient((client, context) =>
      client.registerLookupTable(
        requireWireKwarg(context, "form_data") as Record<string, string>,
      ),
    ),
  );

  implementations.register(
    "api_client.mark_lookup_table_ready",
    withClient((client, context) =>
      client.markLookupTableReady(
        requireWireKwarg(context, "form_data") as Record<string, string>,
      ),
    ),
  );

  implementations.register(
    "api_client.get_lookup_upload_status",
    withClient((client, context) =>
      client.getLookupUploadStatus(
        requireWireKwarg(context, "upload_id") as string,
      ),
    ),
  );

  implementations.register(
    "api_client.update_lookup_table",
    withClient((client, context) =>
      client.updateLookupTable(
        requireWireKwarg(context, "data_group_id") as number,
        requireWireKwarg(context, "body") as Record<string, unknown>,
      ),
    ),
  );

  implementations.register(
    "api_client.delete_lookup_tables",
    withClient(async (client, context) => {
      await client.deleteLookupTables(
        requireWireKwarg(context, "data_group_ids") as number[],
      );
      return null;
    }),
  );

  implementations.register(
    "api_client.download_lookup_table",
    withClient(async (client, context) => {
      const bytes = await client.downloadLookupTable(
        requireWireKwarg(context, "data_group_id") as number,
        kwargBag(context, ["file_name", "limit"]),
      );
      // Output codec twin: the recorder's bytes encoding
      // (`$type: bytes` base64 carrier).
      return encodeExpectValue(bytes);
    }),
  );

  implementations.register(
    "api_client.get_lookup_download_url",
    withClient((client, context) =>
      client.getLookupDownloadUrl(
        requireWireKwarg(context, "data_group_id") as number,
      ),
    ),
  );

  // ----- custom events -----

  implementations.register(
    "api_client.create_custom_event",
    withClient((client, context) =>
      client.createCustomEvent(
        requireWireKwarg(context, "body") as Record<string, string>,
      ),
    ),
  );

  implementations.register(
    "api_client.update_custom_event",
    withClient((client, context) =>
      client.updateCustomEvent(
        requireWireKwarg(context, "custom_event_id") as number,
        requireWireKwarg(context, "body") as Record<string, unknown>,
      ),
    ),
  );

  implementations.register(
    "api_client.delete_custom_event",
    withClient(async (client, context) => {
      await client.deleteCustomEvent(
        requireWireKwarg(context, "custom_event_id") as number,
      );
      return null;
    }),
  );

  // ----- schema enforcement -----

  implementations.register(
    "api_client.get_schema_enforcement",
    withClient((client, context) =>
      client.getSchemaEnforcement(kwargBag(context, ["fields"])),
    ),
  );

  implementations.register(
    "api_client.init_schema_enforcement",
    withClient((client, context) =>
      client.initSchemaEnforcement(
        requireWireKwarg(context, "body") as Record<string, unknown>,
      ),
    ),
  );

  implementations.register(
    "api_client.update_schema_enforcement",
    withClient((client, context) =>
      client.updateSchemaEnforcement(
        requireWireKwarg(context, "body") as Record<string, unknown>,
      ),
    ),
  );

  implementations.register(
    "api_client.replace_schema_enforcement",
    withClient((client, context) =>
      client.replaceSchemaEnforcement(
        requireWireKwarg(context, "body") as Record<string, unknown>,
      ),
    ),
  );

  implementations.register(
    "api_client.delete_schema_enforcement",
    withClient((client) => client.deleteSchemaEnforcement()),
  );

  // ----- audit -----

  implementations.register(
    "api_client.run_audit",
    withClient((client) => client.runAudit()),
  );

  implementations.register(
    "api_client.run_audit_events_only",
    withClient((client) => client.runAuditEventsOnly()),
  );

  // ----- anomalies -----

  implementations.register(
    "api_client.list_data_volume_anomalies",
    withClient((client, context) =>
      client.listDataVolumeAnomalies(kwargBag(context, ["query_params"])),
    ),
  );

  implementations.register(
    "api_client.update_anomaly",
    withClient((client, context) =>
      client.updateAnomaly(
        requireWireKwarg(context, "body") as Record<string, unknown>,
      ),
    ),
  );

  implementations.register(
    "api_client.bulk_update_anomalies",
    withClient((client, context) =>
      client.bulkUpdateAnomalies(
        requireWireKwarg(context, "body") as Record<string, unknown>,
      ),
    ),
  );

  // ----- deletion requests -----

  implementations.register(
    "api_client.list_deletion_requests",
    withClient((client) => client.listDeletionRequests()),
  );

  implementations.register(
    "api_client.create_deletion_request",
    withClient((client, context) =>
      client.createDeletionRequest(
        requireWireKwarg(context, "body") as Record<string, unknown>,
      ),
    ),
  );

  implementations.register(
    "api_client.cancel_deletion_request",
    withClient((client, context) =>
      client.cancelDeletionRequest(
        requireWireKwarg(context, "request_id") as number,
      ),
    ),
  );

  implementations.register(
    "api_client.preview_deletion_filters",
    withClient((client, context) =>
      client.previewDeletionFilters(
        requireWireKwarg(context, "body") as Record<string, unknown>,
      ),
    ),
  );

  // ----- replays signing -----

  implementations.register(
    "api_client.sign_replays",
    withClient((client, context) =>
      client.signReplays(
        requireWireKwarg(context, "replay_ids") as string[],
        ...(Object.hasOwn(context.kwargs, "env")
          ? [context.kwargs["env"] as ReplayEnv]
          : []),
      ),
    ),
  );
}
