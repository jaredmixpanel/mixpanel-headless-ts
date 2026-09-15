/**
 * The report-link members of the `Workspace` facade — `create_report_link`,
 * `resolve_report_link`, `query_report_link`, `saved_report_link` and the
 * `_report_link_*` / `_check_report_link_scope` / `_expand_short_link`
 * helpers (`mixpanel_headless.workspace.Workspace`) — as functions over
 * the facade slice they read ({@link ReportLinkHost}). The pure
 * parse/build helpers stay in `../report-links.ts`; this module is the
 * session-aware layer above them.
 *
 * Calls between members go back through the host (`host.getBookmark`,
 * `host.resolveReportLink`, …) so an instance-level override on the
 * facade is honoured exactly as `self.resolve_report_link(...)` would be;
 * the session is read through a thunk so a `use()` swap during an
 * awaited call is seen where Python re-reads `self._session`.
 */

import type { Session } from "../auth/session.js";
import type { MixpanelClient } from "../client/client.js";
import { jsonValuePythonStr } from "../client/internals.js";
import { toNativeJson } from "../client/json-value.js";
import { validateResponseModel } from "../client/response-validation.js";
import { pythonRepr } from "../compat/python-str.js";
import {
  BookmarkValidationError,
  ParamValidationError,
  QueryError,
  ReportLinkNotFoundError,
  ReportLinkScopeMismatchError,
  ShortLinkResolutionError,
  UnsupportedReportLinkError,
  WorkspaceScopeError,
} from "../errors.js";
import {
  BOOKMARK_HASH_FOR_TYPE,
  buildBookmarkUrl,
  buildSlugUrl,
  type ParsedReportLink,
  parsedReportLink,
  parseReportLink,
  SLUG_APP_FOR_TYPE,
} from "../report-links.js";
import type { LiveQueryService } from "../services/live-query.js";
import { type Bookmark, BookmarkUrl } from "../types/entities/bookmarks.js";
import type { ReportLinkType } from "../types/literals.js";
import {
  ReportLink,
  type ReportLinkQueryResult,
  ResolvedReport,
} from "../types/report-links.js";
import {
  FlowQueryResult,
  FunnelQueryResult,
  QueryResult,
  RetentionQueryResult,
} from "../types/results/query-engine.js";
import { validateBookmarkParamsSchema } from "./bookmarks-cohorts.js";
import type {
  ReportLinkParamsInput,
  ResolvedWorkspaceLogger,
  WorkspaceCreateReportLinkOptions,
  WorkspaceQueryReportLinkOptions,
  WorkspaceSavedReportLinkOptions,
} from "./options.js";
import { requireEntityId } from "./shared.js";

/**
 * The facade slice the report-link members read. The session, the
 * project id and the live-query service are thunks so they resolve where
 * the Python method reads `self._session` / `self._live_query`.
 */
export interface ReportLinkHost {
  /** The bound wire client (`createBookmarkUrl`, `getBookmarkUrl`, `resolveShortLink`). */
  readonly client: MixpanelClient;
  /** The log seam. */
  readonly logger: ResolvedWorkspaceLogger;
  /** The current session (`self._session`, swapped in place by `use()`). */
  readonly session: () => Session;
  /** `int(self._session.project.id)`. */
  readonly projectId: () => number;
  /** The `generate_slug` seam. */
  readonly generateSlug: () => string;
  /** The memoized `LiveQueryService` (`self._live_query`). */
  readonly liveQueryService: () => LiveQueryService;
  /** The facade's `resolveWorkspaceId` (instance dispatch, see the module doc). */
  readonly resolveWorkspaceId: () => Promise<number>;
  /** The facade's `getBookmark`. */
  readonly getBookmark: (bookmarkId: number) => Promise<Bookmark>;
  /** The facade's `resolveReportLink`. */
  readonly resolveReportLink: (link: string) => Promise<ResolvedReport>;
}

/**
 * Choose the workspace id a created report link embeds
 * (`_report_link_workspace_id`): explicit, else the pinned session
 * workspace, else `resolveWorkspaceId()`, else `null` (project-only).
 *
 * @param host - The facade slice.
 * @param explicit - Caller-supplied workspace id, or `null`.
 * @returns The workspace id to embed, or `null`.
 */
async function reportLinkWorkspaceId(
  host: ReportLinkHost,
  explicit: number | null,
): Promise<number | null> {
  if (explicit !== null) {
    return explicit;
  }
  const pinned = host.session().workspace ?? null;
  if (pinned !== null) {
    return pinned.id;
  }
  try {
    return await host.resolveWorkspaceId();
  } catch (error) {
    if (!(error instanceof WorkspaceScopeError)) {
      throw error;
    }
    host.logger.debug(
      `report link: no workspace resolved for project ` +
        `${host.session().project.id}; emitting project-only URL`,
    );
    return null;
  }
}

/**
 * Turn query params (or a typed result) into a shareable report link
 * (`create_report_link`).
 *
 * Stores an **unsaved report** on the Mixpanel server under a
 * client-minted 12-character slug and returns the web URL that opens
 * it in the report editor. One App API POST, plus workspace
 * auto-resolution (which can call the App API) when no workspace is
 * pinned or passed. The record is created, never overwritten.
 *
 * @param host - The facade slice.
 * @param params - Raw bookmark params, or a typed result from
 *   {@link query}, {@link queryFunnel}, {@link queryRetention}, or
 *   {@link queryFlow}.
 * @param options - `report_type`, `name`, `description`,
 *   `workspace_id`, `bookmark_id`, `validate`.
 * @returns A {@link ReportLink} whose `url` opens the query in the
 *   browser.
 * @throws ParamValidationError - `RL4_REPORT_TYPE_CONFLICT` on a
 *   contradicting `report_type`; `RL1`/`RL3` from the URL builder;
 *   `RL6_INVALID_ID` for a zero or negative `workspace_id`. All of
 *   these fire before the POST, so no record is created for bad input.
 * @throws BookmarkValidationError - Params failed schema validation
 *   (raised before any network call).
 * @throws AuthenticationError - Invalid credentials (401).
 * @throws QueryError - The server rejected the record (400/422).
 * @throws RateLimitError - Rate limit exceeded (429).
 * @throws ServerError - Server-side errors (5xx).
 * @example
 * ```typescript
 * const result = await ws.query(Metric.total("Login"), { last: 7 });
 * const link = await ws.createReportLink(result, { name: "Logins, last 7 days" });
 * console.log(link.url);
 * // https://mixpanel.com/project/3/view/75/app/insights#EBrV5bW2u9Mw
 *
 * // From raw params, without running the query first
 * const link2 = await ws.createReportLink(await ws.buildParams("Login", { last: 7 }));
 * ```
 */
export async function createReportLink(
  host: ReportLinkHost,
  params: ReportLinkParamsInput,
  options: WorkspaceCreateReportLinkOptions = {},
): Promise<ReportLink> {
  const { rawParams, reportType: resolvedType } = reportLinkInputs(
    params,
    options.report_type ?? null,
  );
  const name = options.name ?? "";
  const description = options.description ?? "";
  const bookmarkId = options.bookmark_id ?? null;

  if (options.validate ?? true) {
    const schemaErrors = validateBookmarkParamsSchema(rawParams, resolvedType);
    if (schemaErrors.some((e) => e.severity === "error")) {
      throw new BookmarkValidationError(schemaErrors);
    }
    for (const w of schemaErrors) {
      if (w.severity === "warning") {
        host.logger.warning(
          `create_report_link validation warning: ${w.message} [${w.code}]`,
        );
      }
    }
  }

  const slug = host.generateSlug();
  const wid = await reportLinkWorkspaceId(host, options.workspace_id ?? null);
  const projectId = host.projectId();
  // Build the URL before the POST so every local input guard (RL1,
  // RL3, RL6) fires before a record exists on the server.
  const url = buildSlugUrl({
    region: host.session().account.region,
    project_id: projectId,
    slug,
    report_type: resolvedType,
    workspace_id: wid,
  });

  const body: Record<string, unknown> = {
    slug,
    type: resolvedType,
    params: rawParams,
  };
  // Python `if name:` / `if description:` — empty strings stay absent.
  if (name !== "") {
    body["name"] = name;
  }
  if (description !== "") {
    body["description"] = description;
  }
  if (bookmarkId !== null) {
    body["bookmark_id"] = bookmarkId;
  }

  const response = await host.client.createBookmarkUrl(body);
  const created = Object.hasOwn(response, "created_at")
    ? response["created_at"]
    : undefined;

  let createdAt: string | null = null;
  if (created !== undefined && created !== null) {
    createdAt =
      typeof created === "string" ? created : jsonValuePythonStr(created);
  }
  return new ReportLink({
    url,
    slug,
    report_type: resolvedType,
    project_id: projectId,
    workspace_id: wid,
    name,
    description,
    bookmark_id: bookmarkId,
    created_at: createdAt,
  });
}

/**
 * Reject a link whose region, project, or workspace differs from the
 * session (`_check_report_link_scope`). Runs before the record fetch.
 * For a shortlink the region check runs before the redirect GET and
 * the project and workspace checks run on the expanded target, after
 * it. A bare slug carries none of the three values and so skips every
 * check. The workspace check applies only when the session has a
 * pinned workspace **and** the link names one.
 *
 * @param host - The facade slice.
 * @param parsed - The parsed link (or a {@link ResolvedReport}
 *   projected onto one by {@link queryReportLink}).
 * @throws ReportLinkScopeMismatchError - `REPORT_LINK_REGION_MISMATCH`,
 *   `REPORT_LINK_PROJECT_MISMATCH`, or `REPORT_LINK_WORKSPACE_MISMATCH`.
 */
function checkReportLinkScope(
  host: ReportLinkHost,
  parsed: ParsedReportLink,
): void {
  const sessionRegion = host.session().account.region;
  if (parsed.region !== null && parsed.region !== sessionRegion) {
    throw new ReportLinkScopeMismatchError(
      `Report link is on the ${parsed.region} region but the active ` +
        `account is on ${sessionRegion}.`,
      {
        code: "REPORT_LINK_REGION_MISMATCH",
        details: {
          ...reportLinkDetails(parsed),
          link_region: parsed.region,
          session_region: sessionRegion,
          hint:
            `Switch to an account on the ${parsed.region} region with ` +
            `ws.use(account="<name>") (CLI: mp --account <name> ...) ` +
            `and retry.`,
        },
      },
    );
  }
  const sessionProject = host.projectId();
  if (parsed.project_id !== null && parsed.project_id !== sessionProject) {
    throw new ReportLinkScopeMismatchError(
      `Report link belongs to project ${String(parsed.project_id)} but the ` +
        `active session is project ${String(sessionProject)}.`,
      {
        code: "REPORT_LINK_PROJECT_MISMATCH",
        details: {
          ...reportLinkDetails(parsed),
          link_project_id: parsed.project_id,
          session_project_id: sessionProject,
          hint:
            `Switch with ws.use(project="${String(parsed.project_id)}") ` +
            `(CLI: mp --project ${String(parsed.project_id)} ...) and retry.`,
        },
      },
    );
  }
  const pinned = host.session().workspace ?? null;
  if (
    pinned !== null &&
    parsed.workspace_id !== null &&
    parsed.workspace_id !== pinned.id
  ) {
    throw new ReportLinkScopeMismatchError(
      `Report link belongs to workspace ${String(parsed.workspace_id)} but the ` +
        `active session is pinned to workspace ${String(pinned.id)}.`,
      {
        code: "REPORT_LINK_WORKSPACE_MISMATCH",
        details: {
          ...reportLinkDetails(parsed),
          link_workspace_id: parsed.workspace_id,
          session_workspace_id: pinned.id,
          hint:
            `Switch with ws.use(workspace=${String(parsed.workspace_id)}) ` +
            `(CLI: mp --workspace ${String(parsed.workspace_id)} ...) and retry.`,
        },
      },
    );
  }
}

/**
 * Follow a shortlink once and parse its target (`_expand_short_link`).
 *
 * @param host - The facade slice.
 * @param parsed - A parsed link with `kind === "short_link"`.
 * @returns `[parsedTarget, expandedUrl]`.
 * @throws ReportLinkScopeMismatchError - `REPORT_LINK_REGION_MISMATCH`
 *   when the shortlink host is on another region (before the GET).
 * @throws ShortLinkResolutionError - `SHORT_LINK_CHAIN` when the target
 *   is another shortlink, plus the transport codes from
 *   {@link MixpanelClient.resolveShortLink}.
 * @throws ReportLinkParseError - The expanded target is not a
 *   recognizable Mixpanel report link.
 * @throws AuthenticationError - The server redirected to the login page.
 */
async function expandShortLink(
  host: ReportLinkHost,
  parsed: ParsedReportLink,
): Promise<[ParsedReportLink, string]> {
  const shortCode = parsed.short_code as string;
  // The shortlink host names a region; a mismatch is knowable before
  // the redirect GET, so check it first (FR-020: no HTTP call on
  // mismatch).
  checkReportLinkScope(host, parsed);
  const target = await host.client.resolveShortLink(shortCode);
  const parsedTarget = parseReportLink(target);
  if (parsedTarget.kind === "short_link") {
    throw new ShortLinkResolutionError(
      `Shortlink /s/${shortCode} redirects to another shortlink ` +
        `(${target}). mixpanel-headless follows one redirect only.`,
      {
        code: "SHORT_LINK_CHAIN",
        details: {
          ...reportLinkDetails(parsed),
          target,
          hint: "Resolve the target shortlink directly.",
        },
      },
    );
  }
  return [parsedTarget, target];
}

/**
 * Turn a report link, a bare slug, or a shortlink into its query
 * params (`resolve_report_link`).
 *
 * Accepts a full Mixpanel URL to an unsaved report (slug) or a saved
 * report (bookmark), a bare 12-character slug, or a
 * `https://mixpanel.com/s/{code}` shortlink. Region, project, and
 * pinned workspace are checked against the active session **before
 * the record fetch**. At most two HTTP calls are made: one optional
 * shortlink expansion and one record fetch. The result holds the raw
 * params; run them with {@link queryReportLink}.
 *
 * @param host - The facade slice.
 * @param link - The link string. Surrounding whitespace, a trailing
 *   slash, a query string, a missing scheme, an upper-case host, and a
 *   percent-encoded `#` are all tolerated.
 * @returns A {@link ResolvedReport} with `report_type`, `params`, the
 *   canonical `url`, and the saved `bookmark` when one exists.
 * @throws ReportLinkParseError - The string is not a recognizable link.
 * @throws UnsupportedReportLinkError - A dashboard link or a legacy
 *   `~(...)` hash.
 * @throws ReportLinkScopeMismatchError - The link's region or project
 *   differs from the session, or its workspace differs from the pinned
 *   session workspace. The record was not fetched.
 * @throws ReportLinkNotFoundError - The slug, saved report, or
 *   shortlink does not exist in scope.
 * @throws ShortLinkResolutionError - The shortlink target could not be
 *   extracted, or it is another shortlink.
 * @throws AuthenticationError - Invalid credentials, or the shortlink
 *   redirected to the login page.
 * @throws RateLimitError - Rate limit exceeded (429).
 * @throws ServerError - Server-side errors (5xx).
 * @throws QueryError - Other App API rejections (400/403/422).
 * @throws ResponseValidationError - The slug or bookmark record the
 *   server returned does not match the expected shape.
 * @throws MixpanelHeadlessError - A transport failure (`HTTP_ERROR`)
 *   or a response that is not a JSON object.
 * @example
 * ```typescript
 * const r = await ws.resolveReportLink(
 *   "https://mixpanel.com/project/3/view/75/app/insights#EBrV5bW2u9Mw",
 * );
 * r.report_type; // "insights"
 * r.params;      // the raw params dict
 * (await ws.queryReportLink(r)).toRows();
 * ```
 */
export async function resolveReportLink(
  host: ReportLinkHost,
  link: string,
): Promise<ResolvedReport> {
  let parsed = parseReportLink(link);
  let expandedUrl: string | null = null;
  if (parsed.kind === "short_link") {
    [parsed, expandedUrl] = await expandShortLink(host, parsed);
  }

  rejectUnsupportedReportLink(parsed);
  checkReportLinkScope(host, parsed);

  const region = host.session().account.region;
  const projectId = host.projectId();
  const pinned = host.session().workspace ?? null;
  const workspaceId = parsed.workspace_id ?? pinned?.id ?? null;

  if (parsed.kind === "slug") {
    const raw = await host.client.getBookmarkUrl(parsed.slug as string);
    const record = validateResponseModel(BookmarkUrl, toNativeJson(raw), {
      endpoint: "get_bookmark_url",
    });
    const embedded = record.bookmark;
    // The server accepts four slug types today. If it ever returns
    // another, keep the record resolvable and fall back to the app
    // the URL was opened under (or insights for a bare slug) rather
    // than raising RL1 from the builder.
    let slugUrlType = record.bookmark_type;
    if (!SLUG_APP_FOR_TYPE.has(slugUrlType)) {
      const hintType = parsed.report_type_hint;
      slugUrlType =
        hintType !== null && SLUG_APP_FOR_TYPE.has(hintType)
          ? hintType
          : "insights";
      host.logger.warning(
        `slug ${record.slug} has unknown report type ` +
          `${pythonRepr(record.bookmark_type)}; the canonical URL uses ` +
          `the ${SLUG_APP_FOR_TYPE.get(slugUrlType) as string} app and may ` +
          `not open it correctly`,
      );
    }
    return new ResolvedReport({
      source: "slug",
      report_type: record.bookmark_type,
      params: { ...record.params },
      project_id: projectId,
      workspace_id: workspaceId,
      region,
      url: buildSlugUrl({
        region,
        project_id: projectId,
        slug: record.slug,
        report_type: slugUrlType,
        workspace_id: workspaceId,
      }),
      input: link,
      expanded_url: expandedUrl,
      slug: record.slug,
      bookmark_id: embedded === null ? record.bookmark_id : embedded.id,
      bookmark: embedded,
      name: record.name,
      description: record.description,
      overrides: record.overrides,
    });
  }

  // `parsed.kind === "bookmark"` (every other kind was rejected above).
  const bookmarkId = parsed.bookmark_id as number;
  let bookmark: Bookmark;
  try {
    bookmark = await host.getBookmark(bookmarkId);
  } catch (error) {
    if (error instanceof QueryError && error.statusCode === 404) {
      // get_bookmark is workspace-scoped when a workspace is pinned,
      // so a report in a sibling workspace of the same project also
      // 404s. Say so, instead of "not in this project".
      if (pinned !== null) {
        throw new ReportLinkNotFoundError(
          `No saved report found with id ${String(bookmarkId)} in ` +
            `project ${String(projectId)} (${region}) under the pinned ` +
            `workspace ${String(pinned.id)}.`,
          {
            code: "REPORT_LINK_BOOKMARK_NOT_FOUND",
            details: {
              ...reportLinkDetails(parsed),
              session_workspace_id: pinned.id,
              hint:
                "The saved report may live in another workspace " +
                "of this project. Switch with " +
                "ws.use(workspace=<id>) (CLI: mp --workspace " +
                "<id> ...) or unpin the workspace and retry.",
            },
            cause: error,
          },
        );
      }
      throw new ReportLinkNotFoundError(
        `No saved report found with id ${String(bookmarkId)} in ` +
          `project ${String(projectId)} (${region}).`,
        {
          code: "REPORT_LINK_BOOKMARK_NOT_FOUND",
          details: {
            ...reportLinkDetails(parsed),
            hint:
              "Check the saved report id, or switch to the project " +
              "and region that own it (ws.use(project=...); CLI: " +
              "mp --project ...) and retry.",
          },
          cause: error,
        },
      );
    }
    throw error;
  }
  if (parsed.overrides_jsurl !== null) {
    host.logger.warning(
      `ignoring URL overrides ${pythonRepr(parsed.overrides_jsurl)}; ` +
        `running the saved report's base params`,
    );
  }
  const reportType = bookmark.bookmark_type;
  let urlType = reportType;
  if (!BOOKMARK_HASH_FOR_TYPE.has(urlType)) {
    // Python `parsed.report_type_hint or "insights"` (truthiness).
    urlType =
      parsed.report_type_hint !== null && parsed.report_type_hint !== ""
        ? parsed.report_type_hint
        : "insights";
    host.logger.warning(
      `saved report ${String(bookmark.id)} has unknown report type ` +
        `${pythonRepr(reportType)}; the canonical URL uses the ` +
        `${String(parsed.app)} app and may not open it correctly`,
    );
  }
  return new ResolvedReport({
    source: "bookmark",
    report_type: reportType,
    params: { ...bookmark.params },
    project_id: projectId,
    workspace_id: workspaceId,
    region,
    url: buildBookmarkUrl({
      region,
      project_id: projectId,
      bookmark_id: bookmark.id,
      report_type: urlType,
      workspace_id: workspaceId,
    }),
    input: link,
    expanded_url: expandedUrl,
    slug: null,
    bookmark_id: bookmark.id,
    bookmark,
    name: bookmark.name,
    description: bookmark.description,
    overrides: null,
  });
}

/**
 * Run the query behind a report link through the matching engine
 * (`query_report_link`).
 *
 * The query runs under the scope the report records
 * (`ResolvedReport.workspace_id`: the URL `wid`, else the pin at
 * resolve time, else `null` for project-wide). That scope is sent
 * explicitly and the session pin is never injected, so a pin cleared
 * or set after resolve time cannot change the data view. A pinned
 * session that contradicts a recorded workspace is rejected first.
 *
 * @param host - The facade slice.
 * @param link - A link string (resolved first with
 *   {@link resolveReportLink}) or an already resolved
 *   {@link ResolvedReport} (no second fetch).
 * @param options - `mode` (flows chart mode).
 * @returns `QueryResult` for insights, `FunnelQueryResult` for funnels,
 *   `RetentionQueryResult` for retention, or `FlowQueryResult` for
 *   flows.
 * @throws UnsupportedReportLinkError - `UNSUPPORTED_REPORT_TYPE` for a
 *   type that cannot be run (for example `launch-analysis`).
 * @throws ReportLinkScopeMismatchError - A {@link ResolvedReport} whose
 *   recorded `region` or `project_id` differs from the active session,
 *   or whose recorded `workspace_id` differs from the pinned session
 *   workspace. Raised before any query.
 * @throws ReportLinkError - Any resolution failure when `link` is a
 *   string (see {@link resolveReportLink}).
 * @throws QueryError - The query engine rejected the params.
 * @throws AuthenticationError - Invalid credentials.
 * @throws RateLimitError - Rate limit exceeded.
 * @throws ServerError - Server-side errors.
 * @example
 * ```typescript
 * const rows = (await ws.queryReportLink("EBrV5bW2u9Mw")).toRows();
 *
 * const resolved = await ws.resolveReportLink(url);
 * if (resolved.report_type === "flows") {
 *   const result = await ws.queryReportLink(resolved, { mode: "paths" });
 * }
 * ```
 */
export async function queryReportLink(
  host: ReportLinkHost,
  link: string | ResolvedReport,
  options: WorkspaceQueryReportLinkOptions = {},
): Promise<ReportLinkQueryResult> {
  let resolved: ResolvedReport;
  if (typeof link === "string") {
    resolved = await host.resolveReportLink(link);
  } else {
    resolved = link;
    // A ResolvedReport records the scope it was resolved in. If the
    // caller kept it across `use({project})` or handed it to another
    // Workspace, refuse rather than run its params against an
    // unrelated project (same rule as resolveReportLink).
    checkReportLinkScope(
      host,
      parsedReportLink({
        kind: resolved.source,
        raw: resolved.input,
        region: resolved.region,
        project_id: resolved.project_id,
        workspace_id: resolved.workspace_id,
        slug: resolved.slug,
        bookmark_id: resolved.bookmark_id,
      }),
    );
  }
  const projectId = host.projectId();
  const service = host.liveQueryService();
  const reportType = resolved.report_type;
  // The report records the scope it was resolved in; run under
  // exactly that scope. The pin is never injected here, so a pin that
  // was cleared or set since resolve time cannot change the data view.
  const scope = {
    workspace_id: resolved.workspace_id,
    inject_workspace_id: false,
  };
  if (reportType === "insights") {
    return service.query(resolved.params, projectId, scope);
  }
  if (reportType === "funnels") {
    return service.queryFunnel(resolved.params, projectId, scope);
  }
  if (reportType === "retention") {
    return service.queryRetention(resolved.params, projectId, scope);
  }
  if (reportType === "flows") {
    const mode = options.mode ?? null;
    let derived: string = mode ?? "sankey";
    if (mode === null) {
      const chartType = Object.hasOwn(resolved.params, "chartType")
        ? resolved.params["chartType"]
        : undefined;
      if (
        chartType === "sankey" ||
        chartType === "paths" ||
        chartType === "tree"
      ) {
        derived = chartType;
      }
    }
    return service.queryFlow(resolved.params, projectId, derived, scope);
  }
  throw new UnsupportedReportLinkError(
    `Report type ${pythonRepr(reportType)} cannot be run through mixpanel-headless.`,
    {
      code: "UNSUPPORTED_REPORT_TYPE",
      details: {
        report_type: reportType,
        hint: "Supported types are insights, funnels, retention, and flows.",
      },
    },
  );
}

/**
 * Build the web URL for a saved report (bookmark). Pure; no network
 * (`saved_report_link`).
 *
 * @param host - The facade slice.
 * @param bookmarkId - Numeric saved-report id.
 * @param options - `report_type` (default `insights`; the singular
 *   `funnel` normalizes to `funnels`) and `workspace_id` (defaults to
 *   the pinned session workspace; omitted when none is pinned —
 *   `resolveWorkspaceId()` is never called here).
 * @returns `https://{host}/project/{pid}[/view/{wid}]/app/{app}#{hash}`
 *   for the session region.
 * @throws ParamValidationError - `RL1_UNKNOWN_REPORT_TYPE`,
 *   `RL3_UNKNOWN_REGION`, or `RL6_INVALID_ID` (a zero or negative
 *   `bookmark_id` or `workspace_id`).
 * @example
 * ```typescript
 * ws.savedReportLink(123, { report_type: "funnels" });
 * // "https://mixpanel.com/project/3/app/funnels#view/123"
 * ```
 * @throws ParamValidationError - `RL6_INVALID_ID` when `bookmarkId`
 *   is not a positive integer (network-free guard, before any request).
 */
export function savedReportLink(
  host: ReportLinkHost,
  bookmarkId: number,
  options: WorkspaceSavedReportLinkOptions = {},
): string {
  requireEntityId("bookmark_id", bookmarkId);
  const reportType = options.report_type ?? "insights";
  const normalized = reportType === "funnel" ? "funnels" : reportType;
  const pinned = host.session().workspace ?? null;
  const explicit = options.workspace_id ?? null;
  const wid = explicit ?? pinned?.id ?? null;
  return buildBookmarkUrl({
    region: host.session().account.region,
    project_id: host.projectId(),
    bookmark_id: bookmarkId,
    report_type: normalized,
    workspace_id: wid,
  });
}

/**
 * Split a `createReportLink` input into raw params and a type
 * (`_report_link_inputs`). A dict with no type is `insights`.
 *
 * @param params - A raw params dict or a typed query result.
 * @param reportType - Caller-supplied type, or `null` to infer.
 * @returns The raw params and the resolved type.
 * @throws ParamValidationError - `RL4_REPORT_TYPE_CONFLICT` when an
 *   explicit type contradicts the type inferred from a typed result.
 */
function reportLinkInputs(
  params: ReportLinkParamsInput,
  reportType: ReportLinkType | null,
): { rawParams: Record<string, unknown>; reportType: ReportLinkType } {
  let inferred: ReportLinkType;
  let resultClass: string;
  if (params instanceof QueryResult) {
    inferred = "insights";
    resultClass = "QueryResult";
  } else if (params instanceof FunnelQueryResult) {
    inferred = "funnels";
    resultClass = "FunnelQueryResult";
  } else if (params instanceof RetentionQueryResult) {
    inferred = "retention";
    resultClass = "RetentionQueryResult";
  } else if (params instanceof FlowQueryResult) {
    inferred = "flows";
    resultClass = "FlowQueryResult";
  } else {
    return {
      rawParams: params,
      reportType: reportType ?? "insights",
    };
  }
  if (reportType !== null && reportType !== inferred) {
    throw new ParamValidationError(
      `report_type=${pythonRepr(reportType)} contradicts the ` +
        `${resultClass} result, which is ${pythonRepr(inferred)}. ` +
        `Omit report_type or pass a plain params dict.`,
      "RL4_REPORT_TYPE_CONFLICT",
      { given: reportType, inferred, result_class: resultClass },
    );
  }
  return { rawParams: { ...params.params }, reportType: inferred };
}

/**
 * Collect the parsed link fields that are set, for error `details`
 * (`_report_link_details`).
 *
 * @param parsed - The parsed link.
 * @returns `kind` plus every non-`null` id field.
 */
function reportLinkDetails(parsed: ParsedReportLink): Record<string, unknown> {
  const details: Record<string, unknown> = { kind: parsed.kind };
  const fields = [
    "region",
    "project_id",
    "workspace_id",
    "slug",
    "bookmark_id",
    "dashboard_id",
    "short_code",
  ] as const;
  for (const name of fields) {
    const value = parsed[name];
    if (value !== null) {
      details[name] = value;
    }
  }
  return details;
}

/**
 * Throw for link kinds that headless recognizes but cannot resolve
 * (`_reject_unsupported_report_link`).
 *
 * @param parsed - The parsed link.
 * @throws UnsupportedReportLinkError - `UNSUPPORTED_DASHBOARD_LINK` or
 *   `UNSUPPORTED_LEGACY_HASH`.
 */
function rejectUnsupportedReportLink(parsed: ParsedReportLink): void {
  if (parsed.kind === "dashboard") {
    const did = String(parsed.dashboard_id);
    throw new UnsupportedReportLinkError(
      `This link points at dashboard ${did}, not at a single report.`,
      {
        code: "UNSUPPORTED_DASHBOARD_LINK",
        details: {
          ...reportLinkDetails(parsed),
          hint:
            `Use ws.get_dashboard(${did}) (CLI: mp dashboards get ${did}) ` +
            `to list its reports, then resolve one report link.`,
        },
      },
    );
  }
  if (parsed.kind === "legacy_jsurl") {
    throw new UnsupportedReportLinkError(
      "This link uses the legacy JSURL hash format, which " +
        "mixpanel-headless cannot decode.",
      {
        code: "UNSUPPORTED_LEGACY_HASH",
        details: {
          ...reportLinkDetails(parsed),
          hint:
            "Open it in a browser (the app re-mints a shareable link " +
            "on load) and copy the new URL.",
        },
      },
    );
  }
}
