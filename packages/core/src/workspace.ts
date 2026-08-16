/**
 * The `Workspace` facade — TS port of `mixpanel_headless/workspace.py`.
 *
 * Phase-3 batch B5 splits this file three ways
 * (`context/phase3/design/b5-packets.md` §2): the class skeleton plus
 * the 22 query members (S2), the 12 discovery/lexicon members (S1) and
 * the 10 session-replay members (S3). Each shard owns ONE marked,
 * append-only section; B6 appends its own below them.
 *
 * SEQUENCING NOTE (B5-S1, recorded in `B5-S1-notes.md` §0): the packet
 * assigns the skeleton below to S2, but the orchestrator dispatched S1
 * first against the Phase-1 placeholder. S1 therefore built the §2
 * skeleton to the packet's contract, verbatim, and filled only its own
 * section. S2 EXTENDS this file — its marker is already in place — and
 * owns the `_live_query_service` accessor plus the `query`-bound
 * `_replays_service` accessor (`workspace.py:1012-1033`) that S3 needs.
 */

import type { Session } from "./auth/session.js";
import {
  createMixpanelClient,
  type MixpanelClient,
  type MixpanelClientOptions,
} from "./client/client.js";
import { MixpanelHeadlessError } from "./errors.js";
import {
  DiscoveryService,
  type DiscoveryLogger,
  type WarningSink,
} from "./services/discovery.js";
import type { BookmarkType, EntityType } from "./types/literals.js";
import type {
  BookmarkInfo,
  FunnelInfo,
  LexiconSchema,
  SavedCohort,
  SchemaGraphResult,
  SubPropertyInfo,
  TopEvent,
} from "./types/results/discovery.js";

/** Options bag of the {@link Workspace} constructor. */
export interface WorkspaceOptions {
  /** The RESOLVED session (account + project + optional workspace). */
  readonly session: Session;
  /**
   * Injected wire client — the test/replay seam mirroring Python's
   * `_api_client` kwarg (`workspace.py:424-432`; conformance twin
   * `conformance/runner/targets.py:316-328`). When absent the
   * constructor builds one from {@link clientOptions}.
   */
  readonly client?: MixpanelClient | undefined;
  /**
   * Extra options for the client the constructor builds when no
   * {@link client} is injected (transport, sleep/RNG/clock seams).
   */
  readonly clientOptions?: Omit<MixpanelClientOptions, "session"> | undefined;
  /** `warnings.warn` sink threaded into the discovery service (R9.5). */
  readonly warn?: WarningSink | undefined;
  /** Debug-log sink threaded into the discovery service (R9.5). */
  readonly logger?: DiscoveryLogger | undefined;
}

/** Options bag of {@link Workspace.events}. */
export interface WorkspaceEventsOptions {
  /** Maximum events to return (client default: 5000). */
  readonly limit?: number | null | undefined;
  /** `YYYY-MM-DD` lower bound (client default: `2000-01-01`). */
  readonly from_date?: string | null | undefined;
  /** `YYYY-MM-DD` upper bound (client default: today). */
  readonly to_date?: string | null | undefined;
}

/** Options bag of {@link Workspace.propertyValues}. */
export interface WorkspacePropertyValuesOptions {
  /** Optional event to filter by. */
  readonly event?: string | null | undefined;
  /** Maximum number of values to return (default 100). */
  readonly limit?: number | undefined;
}

/** Options bag of {@link Workspace.subproperties}. */
export interface WorkspaceSubpropertiesOptions {
  /** Optional event name to scope the sample. */
  readonly event?: string | null | undefined;
  /** Number of raw values to sample (default 50). */
  readonly sample_size?: number | undefined;
}

/** Options bag of {@link Workspace.topEvents}. */
export interface WorkspaceTopEventsOptions {
  /** Counting method (default `"general"`). */
  readonly type?: "general" | "average" | "unique" | undefined;
  /** Maximum number of events to return. */
  readonly limit?: number | null | undefined;
}

/** Options bag of {@link Workspace.lexiconSchemas}. */
export interface WorkspaceLexiconSchemasOptions {
  /** Optional filter by type (`"event"` / `"profile"`). */
  readonly entity_type?: EntityType | null | undefined;
}

/** Options bag of {@link Workspace.schemaGraph}. */
export interface WorkspaceSchemaGraphOptions {
  /** Request the property-level `densityLocal`. */
  readonly include_density?: boolean | undefined;
  /** Also gather user properties (default `true`). */
  readonly include_user_properties?: boolean | undefined;
  /** Bypass the cache and re-fetch. */
  readonly force_refresh?: boolean | undefined;
}

/**
 * Main facade for Mixpanel operations — TS port of
 * `workspace.Workspace` (`workspace.py:274+`).
 *
 * The B5 constructor takes a RESOLVED {@link Session} only. Python's
 * `account` / `project` / `workspace` / `target` kwargs
 * (`workspace.py:427-430`) are the resolver axes, which are batch B7;
 * `use()` is B6-W1.
 *
 * @example
 * ```typescript
 * const ws = new Workspace({ session });
 * const events = await ws.events();
 * ```
 */
export class Workspace {
  /** The resolved session bound to this facade. */
  readonly session: Session;

  /** The bound wire client (Python `self._api_client`). @internal */
  readonly client: MixpanelClient;

  /** Lazily-created discovery service (`self._discovery`). */
  #discovery: DiscoveryService | null = null;

  /** `warnings.warn` sink handed to the discovery service. */
  readonly #warn: WarningSink | undefined;

  /** Debug-log sink handed to the discovery service. */
  readonly #logger: DiscoveryLogger | undefined;

  /**
   * Create a workspace facade.
   *
   * @param options - The resolved session plus the optional injected
   *   client / seams.
   */
  constructor(options: WorkspaceOptions) {
    this.session = options.session;
    this.client =
      options.client ??
      createMixpanelClient({
        session: options.session,
        ...(options.clientOptions ?? {}),
      });
    this.#warn = options.warn;
    this.#logger = options.logger;
    // TODO(port): the `account` / `project` / `workspace` / `target`
    // constructor kwargs (`workspace.py:427-430`) resolve through
    // `resolve_session(...)` — batch B7. B5 takes a resolved Session.
  }

  /**
   * Get or create the discovery service (lazy initialization —
   * `workspace.py:1005-1010`).
   *
   * @returns The memoized service.
   * @internal
   */
  get discoveryService(): DiscoveryService {
    if (this.#discovery === null) {
      this.#discovery = new DiscoveryService(this.client, {
        ...(this.#warn !== undefined ? { warn: this.#warn } : {}),
        ...(this.#logger !== undefined ? { logger: this.#logger } : {}),
      });
    }
    return this.#discovery;
  }

  /**
   * Switch account / project / workspace axes in place
   * (`workspace.py` `use`).
   *
   * @returns Never — B6-W1 owns this member.
   * @throws MixpanelHeadlessError - Always, code `UNPORTED_MEMBER`.
   */
  use(): this {
    // TODO(port): B6-W1 — the axis-switch facade (and the discovery-cache
    // reset `TestDiscoveryCacheAcrossUse` locks) land with the resolver.
    throw new MixpanelHeadlessError(
      "Workspace.use() is not ported yet (batch B6-W1)",
      "UNPORTED_MEMBER",
      { member: "workspace.use" },
    );
  }

  /**
   * Release the underlying connection pool (`close`).
   *
   * @returns Never — B6-W1 owns this member.
   * @throws MixpanelHeadlessError - Always, code `UNPORTED_MEMBER`.
   */
  close(): Promise<void> {
    // TODO(port): B6-W1 — pairs with `use()` and the R6.2 connection-reuse
    // invariant.
    return Promise.reject(
      new MixpanelHeadlessError(
        "Workspace.close() is not ported yet (batch B6-W1)",
        "UNPORTED_MEMBER",
        { member: "workspace.close" },
      ),
    );
  }

  /**
   * `await using` support (R6.2) — delegates to {@link close}.
   *
   * @returns Never — B6-W1 owns this member.
   * @throws MixpanelHeadlessError - Always, code `UNPORTED_MEMBER`.
   */
  [Symbol.asyncDispose](): Promise<void> {
    return this.close();
  }

  // === B5-S2 query members (S2 owns; append-only) ===

  // === B5-S1 discovery/lexicon members (append-only; S1 owns) ===

  /**
   * List event names in the Mixpanel project (`events`,
   * `workspace.py:1039-1088`).
   *
   * Defaults to the widest window `/events/names` accepts
   * (`limit=5000`, `from_date=2000-01-01`, `to_date=today`); the wire
   * layer retries a date-range-gated 403 with the project's
   * `max_data_history_days` ceiling. The result reflects events seen in
   * the window — it is NOT the Lexicon registry.
   *
   * Cached per `(limit, from_date, to_date)` for the facade's lifetime.
   *
   * @param options - Optional limit / date bounds.
   * @returns Alphabetically sorted event names.
   * @throws AuthenticationError - Credentials rejected.
   * @throws QueryError - Non-gate 403s and other 4xx errors.
   */
  async events(options: WorkspaceEventsOptions = {}): Promise<string[]> {
    return this.discoveryService.listEvents(options);
  }

  /**
   * List all property names for an event (`properties`,
   * `workspace.py:1090-1104`). Cached per event.
   *
   * @param event - Event name.
   * @returns Alphabetically sorted property names.
   * @throws EventNotFoundError - Unknown event (with suggestions).
   */
  async properties(event: string): Promise<string[]> {
    return this.discoveryService.listProperties(event);
  }

  /**
   * Get sample values for a property (`property_values`,
   * `workspace.py:1106-1130`). Cached per
   * `(property, event, limit)`.
   *
   * @param propertyName - Property to get values for.
   * @param options - Optional event filter and limit.
   * @returns Sample property values as strings (unsorted).
   * @throws AuthenticationError - Credentials rejected.
   */
  async propertyValues(
    propertyName: string,
    options: WorkspacePropertyValuesOptions = {},
  ): Promise<string[]> {
    return this.discoveryService.listPropertyValues(propertyName, options);
  }

  /**
   * List inferred subproperties of a list-of-object property
   * (`subproperties`, `workspace.py:1132-1191`).
   *
   * Only SCALAR sub-values (string / number / boolean / ISO datetime
   * string) are reported; nested dicts and lists are skipped because
   * `GroupBy.list_item` / `Filter.list_contains` cannot use them.
   *
   * @param propertyName - Top-level property name (e.g. `"cart"`).
   * @param options - Optional event scope and sample size.
   * @returns Alphabetically sorted subproperty infos.
   * @throws AuthenticationError - Credentials rejected.
   *
   * Emits the injected {@link WarningSink} (Python `UserWarning`) for
   * mixed scalar types, mixed scalar/nested shapes, and all-null keys.
   *
   * @example
   * ```typescript
   * for (const sp of await ws.subproperties("cart", { event: "Cart Viewed" })) {
   *   console.log(sp.name, sp.type, sp.sample_values);
   * }
   * ```
   */
  async subproperties(
    propertyName: string,
    options: WorkspaceSubpropertiesOptions = {},
  ): Promise<SubPropertyInfo[]> {
    return this.discoveryService.listSubproperties(propertyName, options);
  }

  /**
   * List saved funnels (`funnels`, `workspace.py:1193-1204`). Cached.
   *
   * @returns Funnel infos sorted by name.
   * @throws AuthenticationError - Credentials rejected.
   */
  async funnels(): Promise<FunnelInfo[]> {
    return this.discoveryService.listFunnels();
  }

  /**
   * List saved cohorts (`cohorts`, `workspace.py:1206-1217`). Cached.
   *
   * @returns Saved cohorts sorted by name.
   * @throws AuthenticationError - Credentials rejected.
   */
  async cohorts(): Promise<SavedCohort[]> {
    return this.discoveryService.listCohorts();
  }

  /**
   * List saved reports (bookmarks) (`list_bookmarks`,
   * `workspace.py:1219-1241`). NOT cached.
   *
   * @param bookmarkType - Optional report-type filter.
   * @returns Bookmark metadata rows (empty when none exist).
   * @throws QueryError - Permission denied or invalid type parameter.
   */
  async listBookmarks(
    bookmarkType: BookmarkType | null = null,
  ): Promise<BookmarkInfo[]> {
    return this.discoveryService.listBookmarks(bookmarkType);
  }

  /**
   * Today's most active events (`top_events`,
   * `workspace.py:1243-1271`). NOT cached — real-time data.
   *
   * @param options - Counting method and limit.
   * @returns Top events with `event`, `count` and `percent_change`.
   * @throws AuthenticationError - Credentials rejected.
   */
  async topEvents(
    options: WorkspaceTopEventsOptions = {},
  ): Promise<TopEvent[]> {
    return this.discoveryService.listTopEvents({
      type: options.type ?? "general",
      ...(options.limit !== undefined ? { limit: options.limit } : {}),
    });
  }

  /**
   * Clear cached discovery results (`clear_discovery_cache`,
   * `workspace.py:1273-1279`).
   *
   * Mirrors Python's guard exactly: when the discovery service has
   * never been created there is nothing to clear and NO service is
   * constructed as a side effect.
   */
  async clearDiscoveryCache(): Promise<void> {
    if (this.#discovery !== null) {
      this.#discovery.clearCache();
    }
  }

  /**
   * List Lexicon schemas (`lexicon_schemas`,
   * `workspace.py:1285-1313`). Cached for the facade's lifetime — the
   * Lexicon API allows only 5 requests/minute.
   *
   * @param options - Optional entity-type filter.
   * @returns Schemas sorted by `(entity_type, name)`.
   * @throws AuthenticationError - Credentials rejected.
   */
  async lexiconSchemas(
    options: WorkspaceLexiconSchemasOptions = {},
  ): Promise<LexiconSchema[]> {
    return this.discoveryService.listSchemas(options);
  }

  /**
   * Get one Lexicon schema (`lexicon_schema`,
   * `workspace.py:1315-1344`). Cached.
   *
   * @param entityType - Entity type (`"event"` / `"profile"`).
   * @param name - Entity name.
   * @returns The schema.
   * @throws QueryError - Schema not found.
   */
  async lexiconSchema(
    entityType: EntityType,
    name: string,
  ): Promise<LexiconSchema> {
    return this.discoveryService.getSchema(entityType, name);
  }

  /**
   * Gather the full Lexicon schema and the event↔property
   * relationships (`schema_graph`, `workspace.py:1346-1394`). Cached
   * per `(include_density, include_user_properties)`.
   *
   * Group properties are not gathered (headless has no data-groups
   * listing to enumerate them).
   *
   * @param options - Density / user-property / refresh switches.
   * @returns The schema graph, with row views and `toGraph()`.
   * @throws AuthenticationError - Credentials rejected.
   *
   * @example
   * ```typescript
   * const schema = await ws.schemaGraph();
   * schema.propertiesForEvent("Purchase");
   * schema.toGraph();
   * ```
   */
  async schemaGraph(
    options: WorkspaceSchemaGraphOptions = {},
  ): Promise<SchemaGraphResult> {
    return this.discoveryService.getSchemaGraph(options);
  }

  // === B5-S3 session-replay members (append-only; S3 owns) ===

  // === B6 members land below in W1–W7 sections (append-only) ===
}
