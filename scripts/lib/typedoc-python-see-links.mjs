// TypeDoc plugin: link `@see mixpanel_headless.…` provenance tags to the
// Python library's reference.
//
// Every ported symbol cites its Python origin as a dotted name
// (`@see mixpanel_headless.workspace.Workspace.query`; CONTRIBUTING,
// "Comments and docstrings"). The Python site renders its API with
// mkdocstrings, whose heading anchors are the identifier exactly as the
// page's `::: mixpanel_headless.X` directive spells it plus the member
// path — `#mixpanel_headless.Workspace.query`, `#mixpanel_headless.accounts.add`,
// `#mixpanel_headless.auth_types.OAuthTokens`. The table below is that
// directive list per page (source: `docs/api/{workspace,auth,exceptions,types}.md`
// in the Python repo); refresh it when a page gains or loses a directive.
//
// A tag resolves when one of its segments names a directive's object
// (the first capitalised segment, or for module-level names each segment
// in turn); module segments the directive omits (`workspace.`, `types.`)
// are dropped, module segments it keeps (`auth_types.`) stay. Anything
// else — `_internal` modules, private helpers — is left as plain text, so
// no link can be dead.
//
// Registered from `typedoc.json` (`plugin`); runs in `npm run docs:api`
// and `npm run docs:api:check`.
import { Application } from "typedoc";

const SITE = "https://mixpanel.github.io/mixpanel-headless/api";
const ROOT = "mixpanel_headless";

/** Page → the `::: mixpanel_headless.<id>` directives it carries. */
const PAGES = {
  workspace: ["Workspace"],
  auth: [
    "ServiceAccount",
    "OAuthBrowserAccount",
    "OAuthTokenAccount",
    "Session",
    "Project",
    "WorkspaceRef",
    "auth_types.ActiveSession",
    "accounts",
    "session",
    "targets",
    "AccountSummary",
    "AccountTestResult",
    "OAuthLoginResult",
    "Target",
    "auth_types.BridgeFile",
    "auth_types.load_bridge",
    "auth_types.OAuthTokens",
    "auth_types.OAuthClientInfo",
    "auth_types.TokenResolver",
    "auth_types.OnDiskTokenResolver",
  ],
  exceptions: [
    "MixpanelHeadlessError",
    "APIError",
    "AuthenticationError",
    "RateLimitError",
    "QueryError",
    "ServerError",
    "ConfigError",
    "AccountNotFoundError",
    "AccountExistsError",
    "AccountInUseError",
    "ProjectNotFoundError",
    "InvalidArgumentError",
    "OAuthError",
    "RegionProbeError",
    "RegionProbeNetworkError",
    "WorkspaceScopeError",
    "BusinessContextValidationError",
    "SessionReplayError",
    "SessionReplayAccessError",
    "SignedURLExpiredError",
    "ReplayNotFoundError",
    "ReportLinkError",
    "ReportLinkParseError",
    "UnsupportedReportLinkError",
    "ReportLinkNotFoundError",
    "ReportLinkScopeMismatchError",
    "ShortLinkResolutionError",
  ],
  types: [
    "PublicWorkspace",
    "CursorPagination",
    "PaginatedResponse",
    "Metric",
    "Formula",
    "Filter",
    "GroupBy",
    "ListItemGroupMode",
    "QueryResult",
    "CohortBreakdown",
    "CohortMetric",
    "CustomPropertyRef",
    "InlineCustomProperty",
    "PropertyInput",
    "TimeComparison",
    "FrequencyBreakdown",
    "FrequencyFilter",
    "CohortDefinition",
    "CohortCriteria",
    "FunnelStep",
    "Exclusion",
    "HoldingConstant",
    "FunnelQueryResult",
    "RetentionEvent",
    "RetentionAlignment",
    "RetentionMode",
    "RetentionMathType",
    "RetentionQueryResult",
    "FlowStep",
    "FlowTreeNode",
    "FlowQueryResult",
    "ReplaySummary",
    "SignedReplay",
    "ReplayEvent",
    "UserAction",
    "Replay",
    "ReplayBundle",
    "default_label_fn",
    "selector_label_fn",
    "url_normalizer",
  ],
};

/** Directive object name → `{ page, id }`. */
const DIRECTIVES = new Map();
for (const [page, ids] of Object.entries(PAGES)) {
  for (const id of ids) {
    DIRECTIVES.set(id.slice(id.lastIndexOf(".") + 1), { page, id });
  }
}

/**
 * The Python reference URL for a dotted `mixpanel_headless.…` name.
 *
 * @param {string} dotted - The name as written after `@see`.
 * @returns {string | undefined} The page URL with anchor, or `undefined`
 *   when no documented directive covers the name.
 */
export function pythonReferenceUrl(dotted) {
  const segments = dotted.split(".");
  if (segments.shift() !== ROOT || segments.length === 0) return;
  // mkdocstrings hides private members and merges `__init__` into the
  // class heading, so a `_`-prefixed tail has no anchor: link its parent.
  while (segments.length > 1 && segments.at(-1)?.startsWith("_"))
    segments.pop();
  const capital = segments.findIndex((s) => /^[A-Z]/.test(s));
  const candidates = capital === -1 ? segments.keys() : [capital];
  for (const index of candidates) {
    const hit = DIRECTIVES.get(segments[index]);
    if (!hit) continue;
    const anchor = [`${ROOT}.${hit.id}`, ...segments.slice(index + 1)].join(
      ".",
    );
    return `${SITE}/${hit.page}/#${anchor}`;
  }
  return;
}

/**
 * TypeDoc's plugin entry point.
 *
 * @param {Application} app - The TypeDoc application.
 * @returns {void}
 */
export function load(app) {
  app.on(Application.EVENT_PROJECT_REVIVE, (project) => {
    for (const id in project.reflections) {
      const comment = project.reflections[id].comment;
      if (!comment) continue;
      for (const tag of comment.blockTags) {
        if (tag.tag !== "@see" || tag.content.length !== 1) continue;
        const [part] = tag.content;
        if (part.kind !== "text") continue;
        const dotted = part.text.trim();
        if (!dotted.startsWith(`${ROOT}.`) || /\s/.test(dotted)) continue;
        const url = pythonReferenceUrl(dotted);
        if (url === undefined) continue;
        tag.content = [
          { kind: "inline-tag", tag: "@link", text: dotted, target: url },
        ];
      }
    }
  });
}
