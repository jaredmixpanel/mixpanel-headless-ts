/**
 * Pure parse and build helpers for Mixpanel report links — TS port of
 * `mixpanel_headless/_internal/report_links.py` (045-report-links,
 * Python PR #223).
 *
 * A **report link** is a Mixpanel web URL that opens a report in the
 * browser. This module turns such a URL into a {@link ParsedReportLink},
 * builds the canonical URL for an unsaved-report slug or a saved report
 * (bookmark), and mints slugs. It makes no network calls and is total:
 * for any input string {@link parseReportLink} either returns a
 * {@link ParsedReportLink} or throws {@link ReportLinkParseError}.
 *
 * The grammar is specified in the Python repo's
 * `specs/045-report-links/contracts/url-grammar.md`. The constants below
 * are the single place to change when Mixpanel moves an app path (see
 * {@link SLUG_APP_FOR_TYPE}).
 *
 * Python `_internal` module: NOT barrel-exported. Use the `Workspace`
 * members (`createReportLink`, `resolveReportLink`, `savedReportLink`)
 * instead of importing this module directly.
 */

import { pythonRepr } from "./compat/python-str.js";
import { pythonStrip } from "./compat/python-strip.js";
import { urlsplit, UrlSplitError } from "./compat/urllib.js";
import { ParamValidationError, ReportLinkParseError } from "./errors.js";
import type { Region } from "./types/literals.js";

// =============================================================================
// Constants (data-model.md §8)
// =============================================================================

/** Characters the web app draws from when it mints a slug (no 0, I, O, l). */
export const SLUG_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Length of every unsaved-report slug. */
export const SLUG_LENGTH = 12;

/** The server-side slug regex. Wider than the mint alphabet on purpose. */
export const SLUG_RE: RegExp = /^[0-9a-zA-Z_-]{12}$/u;

/** Web host per region. Builders always emit these hosts. Read-only. */
export const WEB_HOSTS: ReadonlyMap<string, string> = new Map([
  ["us", "mixpanel.com"],
  ["eu", "eu.mixpanel.com"],
  ["in", "in.mixpanel.com"],
]);

/**
 * App path segment used when a created slug URL is built, per report
 * type. The keys are exactly the `ReportLinkType` members.
 *
 * Follows the Mixpanel MCP server: the Insights app hosts insights,
 * funnels, and retention slugs and reads `type` from the slug record;
 * the Flows app hosts flows slugs. If live QA shows the Insights app
 * does not switch type, change the `funnels` and `retention` rows here —
 * one line each.
 */
export const SLUG_APP_FOR_TYPE: ReadonlyMap<string, string> = new Map([
  ["insights", "insights"],
  ["funnels", "insights"],
  ["retention", "insights"],
  ["flows", "flows"],
]);

/**
 * `{app}#{hash}` template per saved-report (bookmark) type (`{id}` is
 * the placeholder). The keys are exactly the `BookmarkType` members.
 */
export const BOOKMARK_HASH_FOR_TYPE: ReadonlyMap<string, string> = new Map([
  ["insights", "insights#report/{id}"],
  ["funnels", "funnels#view/{id}"],
  ["retention", "retention#report/{id}"],
  ["flows", "flows#report/{id}"],
  ["launch-analysis", "impact#report/{id}"],
]);

/** Report type hinted by an app path segment. `boards` has no hint. */
export const APP_TO_REPORT_TYPE: ReadonlyMap<string, string> = new Map([
  ["insights", "insights"],
  ["funnels", "funnels"],
  ["retention", "retention"],
  ["flows", "flows"],
  ["impact", "launch-analysis"],
]);

/** What a parsed link points at. */
export type ReportLinkKind =
  "slug" | "bookmark" | "short_link" | "dashboard" | "legacy_jsurl";

/** Recognized web hosts. `mixpanel.org` parses as US; builders never emit it. */
const HOST_TO_REGION: ReadonlyMap<string, Region> = new Map<string, Region>([
  ["mixpanel.com", "us"],
  ["eu.mixpanel.com", "eu"],
  ["in.mixpanel.com", "in"],
  ["mixpanel.org", "us"],
]);

/** App path segments the parser accepts. */
const KNOWN_APPS: ReadonlySet<string> = new Set([
  "insights",
  "funnels",
  "retention",
  "flows",
  "impact",
  "boards",
]);

/** ASCII-only digit run. `str.isdigit` accepts Unicode digits; we do not. */
const ASCII_DIGITS_RE = /^[0-9]+$/u;

/** Leading URL scheme. Only `http` and `https` are accepted, any case. */
const SCHEME_RE = /^https?:\/\//iu;

/** A percent-encoded `#`. The only escape the parser decodes. */
const PERCENT_HASH_RE = /%23/gu;

/** Shortlink code after `/s/`. */
const SHORT_CODE_RE = /^[0-9A-Za-z_-]+$/u;

/** `report/{id}[/{title}][/~(...)]`, `segmentation-report/{id}`, `view/{id}`. */
const BOOKMARK_HASH_RE =
  /^(?:report|segmentation-report|view)\/([0-9]+)(?:\/(?!~)([^/]+))?(?:\/(~[\s\S]*))?$/u;

const UNPARSEABLE_HINT =
  "Pass a full Mixpanel report URL, a shortlink (https://mixpanel.com/s/...), " +
  "or a 12-character slug.";
const HOST_HINT = "Expected mixpanel.com, eu.mixpanel.com, or in.mixpanel.com.";
const PATH_HINT =
  "Expected /project/{id}/app/{app}#..., " +
  "/project/{id}/view/{wid}/app/{app}#..., or /s/{code}.";
const HASH_HINT =
  "Expected a 12-character slug, report/{id}, view/{id}, or id={dashboard_id}.";
const EMPTY_HASH_HINT =
  "Open the report in the browser and copy the full URL including the part after '#'.";

// =============================================================================
// Parsed link
// =============================================================================

/**
 * The structured parts of a report link string. Pure data — the
 * `ParsedReportLink` frozen dataclass; absent fields are `null`.
 */
export interface ParsedReportLink {
  /** What the link points at. */
  readonly kind: ReportLinkKind;
  /** The input after `strip()`. */
  readonly raw: string;
  /** Lower-case host without port. `null` for a bare slug. */
  readonly host: string | null;
  /** Region derived from the host. `mixpanel.org` maps to `us`. */
  readonly region: Region | null;
  /** From `/project/{pid}/` or legacy `/report/{pid}/`. */
  readonly project_id: number | null;
  /** From `/view/{wid}/`. */
  readonly workspace_id: number | null;
  /**
   * The app path segment (`insights`, `funnels`, `retention`, `flows`,
   * `impact`, `boards`).
   */
  readonly app: string | null;
  /**
   * `APP_TO_REPORT_TYPE[app]`. The server-stored type is authoritative;
   * this is a hint only.
   */
  readonly report_type_hint: string | null;
  /** Set when `kind === "slug"`. */
  readonly slug: string | null;
  /** Set when `kind === "bookmark"`. */
  readonly bookmark_id: number | null;
  /**
   * Set for `boards#id=` links, kept when an `edited-bookmark` slug is
   * also present.
   */
  readonly dashboard_id: number | null;
  /** Set when `kind === "short_link"`. */
  readonly short_code: string | null;
  /** The kebab title after `#report/{id}/`. */
  readonly title_segment: string | null;
  /** The raw `~(...)` tail after a bookmark hash. Never decoded. */
  readonly overrides_jsurl: string | null;
}

/** Constructor bag of {@link parsedReportLink} (dataclass defaults = `null`). */
export type ParsedReportLinkInit = Pick<ParsedReportLink, "kind" | "raw"> &
  Partial<Omit<ParsedReportLink, "kind" | "raw">>;

/**
 * Build a {@link ParsedReportLink} with dataclass defaults (`null`) for
 * every omitted field — the `ParsedReportLink(...)` constructor twin.
 *
 * @param init - `kind` + `raw` plus any set fields.
 * @returns The frozen parsed link.
 */
export function parsedReportLink(init: ParsedReportLinkInit): ParsedReportLink {
  return Object.freeze({
    kind: init.kind,
    raw: init.raw,
    host: init.host ?? null,
    region: init.region ?? null,
    project_id: init.project_id ?? null,
    workspace_id: init.workspace_id ?? null,
    app: init.app ?? null,
    report_type_hint: init.report_type_hint ?? null,
    slug: init.slug ?? null,
    bookmark_id: init.bookmark_id ?? null,
    dashboard_id: init.dashboard_id ?? null,
    short_code: init.short_code ?? null,
    title_segment: init.title_segment ?? null,
    overrides_jsurl: init.overrides_jsurl ?? null,
  });
}

// =============================================================================
// Small pure helpers
// =============================================================================

/**
 * Return the Mixpanel web host for a region (`web_host`).
 *
 * @param region - One of `us`, `eu`, `in`.
 * @returns The host, for example `eu.mixpanel.com`.
 * @throws ParamValidationError - `RL3_UNKNOWN_REGION` when the region is
 *   not in {@link WEB_HOSTS}.
 */
export function webHost(region: string): string {
  const host = WEB_HOSTS.get(region);
  if (host === undefined) {
    throw new ParamValidationError(
      `Unknown region ${pythonRepr(region)}. Expected one of: us, eu, in.`,
      "RL3_UNKNOWN_REGION",
      { region },
    );
  }
  return host;
}

/**
 * Whether `value` matches the server slug regex (`is_slug`).
 *
 * @param value - Any string.
 * @returns `true` for exactly 12 characters from `[0-9A-Za-z_-]`.
 */
export function isSlug(value: string): boolean {
  return SLUG_RE.test(value);
}

/**
 * Uniform pick from the alphabet via the platform CSPRNG — the
 * `secrets.choice` default (rejection sampling keeps the draw unbiased).
 *
 * @param alphabet - The alphabet to draw from.
 * @returns One character.
 */
function secretsChoice(alphabet: string): string {
  const limit = Math.floor(256 / alphabet.length) * alphabet.length;
  const buf = new Uint8Array(1);
  for (;;) {
    globalThis.crypto.getRandomValues(buf);
    const byte = buf[0] as number;
    if (byte < limit) {
      return alphabet[byte % alphabet.length] as string;
    }
  }
}

/** Options bag of {@link generateSlug}. */
export interface GenerateSlugOptions {
  /**
   * Function that picks one character from the alphabet. Defaults to a
   * CSPRNG-backed uniform pick (`secrets.choice`). Tests inject a
   * deterministic chooser.
   */
  readonly choice?: ((alphabet: string) => string) | undefined;
}

/**
 * Mint a new 12-character slug from {@link SLUG_ALPHABET}
 * (`generate_slug`).
 *
 * @param options - Optional injected chooser.
 * @returns A slug for which {@link isSlug} is true.
 * @example
 * ```typescript
 * generateSlug({ choice: (alphabet) => alphabet[0] });
 * // "111111111111"
 * ```
 */
export function generateSlug(options: GenerateSlugOptions = {}): string {
  const choice = options.choice ?? secretsChoice;
  let out = "";
  for (let i = 0; i < SLUG_LENGTH; i += 1) {
    out += choice(SLUG_ALPHABET);
  }
  return out;
}

/**
 * Reject an id that the parser could never read back
 * (`_require_positive_id`). The path and hash grammars accept ASCII
 * digit runs only, so a zero or negative id would build a URL that
 * {@link parseReportLink} rejects.
 *
 * @param field - The parameter name, for the message and `details`.
 * @param value - The id to check.
 * @throws ParamValidationError - `RL6_INVALID_ID` when `value` is not a
 *   positive integer.
 */
function requirePositiveId(field: string, value: number): void {
  if (value <= 0) {
    throw new ParamValidationError(
      `Invalid ${field} ${String(value)}. An id is a positive integer.`,
      "RL6_INVALID_ID",
      { field, value },
    );
  }
}

/**
 * `/project/{pid}` with an optional `/view/{wid}` segment
 * (`_project_path`).
 *
 * @param projectId - Project id.
 * @param workspaceId - Optional workspace id.
 * @returns The path prefix without the `/app/...` tail.
 * @throws ParamValidationError - `RL6_INVALID_ID`.
 */
function projectPath(projectId: number, workspaceId: number | null): string {
  requirePositiveId("project_id", projectId);
  if (workspaceId === null) {
    return `/project/${String(projectId)}`;
  }
  requirePositiveId("workspace_id", workspaceId);
  return `/project/${String(projectId)}/view/${String(workspaceId)}`;
}

/**
 * Look up a report type in a builder table (`_lookup_type`).
 *
 * @param table - {@link SLUG_APP_FOR_TYPE} or {@link BOOKMARK_HASH_FOR_TYPE}.
 * @param reportType - The type to look up.
 * @returns The table value.
 * @throws ParamValidationError - `RL1_UNKNOWN_REPORT_TYPE` when the type
 *   is not a key of `table`.
 */
function lookupType(
  table: ReadonlyMap<string, string>,
  reportType: string,
): string {
  const value = table.get(reportType);
  if (value === undefined) {
    const allowed = [...table.keys()].sort();
    throw new ParamValidationError(
      `Unknown report type ${pythonRepr(reportType)}. Expected one of: ` +
        `${allowed.join(", ")}.`,
      "RL1_UNKNOWN_REPORT_TYPE",
      { report_type: reportType, allowed },
    );
  }
  return value;
}

// =============================================================================
// Builders
// =============================================================================

/** Keyword arguments of {@link buildSlugUrl}. */
export interface BuildSlugUrlArgs {
  /** Session region (`us`, `eu`, `in`). */
  readonly region: string;
  /** Project the slug record lives in. */
  readonly project_id: number;
  /** The 12-character slug. */
  readonly slug: string;
  /** One of the {@link SLUG_APP_FOR_TYPE} keys. */
  readonly report_type: string;
  /** Optional workspace for the `/view/{wid}` segment. */
  readonly workspace_id?: number | null | undefined;
}

/**
 * Build the web URL for an unsaved-report slug (`build_slug_url`).
 *
 * @param args - Region, project, slug, type, optional workspace.
 * @returns `https://{host}/project/{pid}[/view/{wid}]/app/{app}#{slug}`.
 * @throws ParamValidationError - `RL3_UNKNOWN_REGION`,
 *   `RL1_UNKNOWN_REPORT_TYPE`, `RL2_INVALID_SLUG`, or `RL6_INVALID_ID`
 *   (a zero or negative project or workspace id).
 * @example
 * ```typescript
 * buildSlugUrl({
 *   region: "us", project_id: 3, slug: "EBrV5bW2u9Mw",
 *   report_type: "insights", workspace_id: 75,
 * });
 * // "https://mixpanel.com/project/3/view/75/app/insights#EBrV5bW2u9Mw"
 * ```
 */
export function buildSlugUrl(args: BuildSlugUrlArgs): string {
  const host = webHost(args.region);
  const app = lookupType(SLUG_APP_FOR_TYPE, args.report_type);
  if (!isSlug(args.slug)) {
    throw new ParamValidationError(
      `Invalid slug ${pythonRepr(args.slug)}. A slug is exactly 12 characters from ` +
        `[0-9A-Za-z_-].`,
      "RL2_INVALID_SLUG",
      { slug: args.slug },
    );
  }
  const path = projectPath(args.project_id, args.workspace_id ?? null);
  return `https://${host}${path}/app/${app}#${args.slug}`;
}

/** Keyword arguments of {@link buildBookmarkUrl}. */
export interface BuildBookmarkUrlArgs {
  /** Session region (`us`, `eu`, `in`). */
  readonly region: string;
  /** Project the bookmark lives in. */
  readonly project_id: number;
  /** Numeric saved-report id. */
  readonly bookmark_id: number;
  /** One of the {@link BOOKMARK_HASH_FOR_TYPE} keys. */
  readonly report_type: string;
  /** Optional workspace for the `/view/{wid}` segment. */
  readonly workspace_id?: number | null | undefined;
}

/**
 * Build the web URL for a saved report (bookmark) (`build_bookmark_url`).
 *
 * @param args - Region, project, bookmark id, type, optional workspace.
 * @returns `https://{host}/project/{pid}[/view/{wid}]/app/{app}#{hash}`.
 * @throws ParamValidationError - `RL3_UNKNOWN_REGION`,
 *   `RL1_UNKNOWN_REPORT_TYPE`, or `RL6_INVALID_ID` (a zero or negative
 *   project, workspace, or bookmark id).
 * @example
 * ```typescript
 * buildBookmarkUrl({
 *   region: "us", project_id: 3, bookmark_id: 123, report_type: "funnels",
 * });
 * // "https://mixpanel.com/project/3/app/funnels#view/123"
 * ```
 */
export function buildBookmarkUrl(args: BuildBookmarkUrlArgs): string {
  const host = webHost(args.region);
  requirePositiveId("bookmark_id", args.bookmark_id);
  // Replacer function: a string replacement would interpret `$` patterns.
  const tail = lookupType(BOOKMARK_HASH_FOR_TYPE, args.report_type).replace(
    "{id}",
    () => String(args.bookmark_id),
  );
  const path = projectPath(args.project_id, args.workspace_id ?? null);
  return `https://${host}${path}/app/${tail}`;
}

// =============================================================================
// Parser
// =============================================================================

/**
 * Build the `REPORT_LINK_UNPARSEABLE` error (`_unparseable`).
 *
 * @param raw - The stripped input.
 * @returns The error, ready to throw.
 */
function unparseable(raw: string): ReportLinkParseError {
  return new ReportLinkParseError(
    `Could not parse report link: ${pythonRepr(raw)}`,
    {
      code: "REPORT_LINK_UNPARSEABLE",
      details: { raw, hint: UNPARSEABLE_HINT },
    },
  );
}

/**
 * Whether a scheme-less string starts with a Mixpanel web host
 * (`_starts_with_known_host`): a known host followed by the end of the
 * string, `/`, `:`, `#`, or `?`.
 *
 * @param value - The input without a leading scheme.
 * @returns The decision.
 */
function startsWithKnownHost(value: string): boolean {
  const lowered = value.toLowerCase();
  for (const host of HOST_TO_REGION.keys()) {
    if (!lowered.startsWith(host)) {
      continue;
    }

    const rest = lowered.slice(host.length);
    if (rest === "" || "/:#?".includes(rest[0] as string)) {
      return true;
    }
  }
  return false;
}

/** Result of {@link parsePath}. */
interface ParsedPath {
  readonly short_code: string | null;
  readonly project_id: number | null;
  readonly workspace_id: number | null;
  readonly app: string | null;
}

const NO_PATH: ParsedPath = {
  short_code: null,
  project_id: null,
  workspace_id: null,
  app: null,
};

/**
 * Match the path segments against the recognized path forms
 * (`_parse_path`). Exactly one of `short_code` or the
 * `(project_id, app)` pair is set on success; all four are `null` when
 * nothing matched.
 *
 * @param segments - Non-empty path segments.
 * @returns The parsed path.
 */
function parsePath(segments: readonly string[]): ParsedPath {
  const n = segments.length;
  if (
    n === 2 &&
    segments[0] === "s" &&
    SHORT_CODE_RE.test(segments[1] as string)
  ) {
    return { ...NO_PATH, short_code: segments[1] as string };
  }
  let pidS: string;
  let widS: string | null = null;
  let app: string;
  if (n === 4 && segments[0] === "project" && segments[2] === "app") {
    pidS = segments[1] as string;
    app = segments[3] as string;
  } else if (
    n === 6 &&
    segments[0] === "project" &&
    segments[2] === "view" &&
    segments[4] === "app"
  ) {
    pidS = segments[1] as string;
    widS = segments[3] as string;
    app = segments[5] as string;
  } else if (n === 3 && segments[0] === "report") {
    pidS = segments[1] as string;
    app = segments[2] as string;
  } else if (n === 5 && segments[0] === "report" && segments[2] === "view") {
    pidS = segments[1] as string;
    widS = segments[3] as string;
    app = segments[4] as string;
  } else {
    return NO_PATH;
  }
  if (pidS === null || !ASCII_DIGITS_RE.test(pidS)) {
    return NO_PATH;
  }
  if (widS !== null && !ASCII_DIGITS_RE.test(widS)) {
    return NO_PATH;
  }
  if (app === null || !KNOWN_APPS.has(app)) {
    return NO_PATH;
  }
  return {
    short_code: null,
    project_id: Number(pidS),
    workspace_id: widS === null ? null : Number(widS),
    app,
  };
}

/**
 * Split a `k=v&k2=v2` fragment into a map. Keeps the first of dupes
 * (`_fragment_fields`).
 *
 * @param fragment - The URL fragment.
 * @returns Key → value for every `k=v` pair.
 */
function fragmentFields(fragment: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const pair of fragment.split("&")) {
    const eq = pair.indexOf("=");
    if (eq === -1) {
      continue;
    }
    const key = pair.slice(0, eq);
    if (!fields.has(key)) {
      fields.set(key, pair.slice(eq + 1));
    }
  }
  return fields;
}

/**
 * Drop a query tail and trailing slashes from a hash that has no JSURL
 * (`_trim_fragment`). A hash that contains `~` carries a JSURL override
 * or legacy body, which may hold `?` and `/` itself, so it is returned
 * unchanged.
 *
 * @param fragment - The raw URL fragment.
 * @returns The fragment to match against the hash grammar.
 */
function trimFragment(fragment: string): string {
  if (fragment.includes("~")) {
    return fragment;
  }
  const q = fragment.indexOf("?");
  const head = q === -1 ? fragment : fragment.slice(0, q);
  return head.replace(/\/+$/u, "");
}

/**
 * Parse a Mixpanel report link, shortlink, or bare slug
 * (`parse_report_link`).
 *
 * Normalization (url-grammar.md §1): strip, decode `%23` to `#` when
 * there is no `#` (no other escape is decoded), prepend `https://` for a
 * scheme-less known host, lower-case the host, drop the port, ignore the
 * query string, drop empty path segments, and drop a `?` tail or
 * trailing `/` from a hash that carries no `~` JSURL body. A scheme
 * other than `http` or `https` is not a report link.
 *
 * The parser is total. It returns a {@link ParsedReportLink} for every
 * recognizable Mixpanel URL, including dashboards and legacy JSURL
 * hashes, and throws {@link ReportLinkParseError} for everything else.
 *
 * @param value - A full URL, a `https://mixpanel.com/s/{code}` shortlink,
 *   or a bare 12-character slug.
 * @returns The parsed link.
 * @throws ReportLinkParseError - With code `REPORT_LINK_UNPARSEABLE`,
 *   `REPORT_LINK_NOT_MIXPANEL_HOST`, `REPORT_LINK_UNRECOGNIZED_PATH`,
 *   `REPORT_LINK_UNRECOGNIZED_HASH`, or `REPORT_LINK_EMPTY_HASH`.
 * @example
 * ```typescript
 * const parsed = parseReportLink(
 *   "https://mixpanel.com/project/3/view/75/app/insights#EBrV5bW2u9Mw",
 * );
 * parsed.kind;       // "slug"
 * parsed.project_id; // 3
 * parsed.slug;       // "EBrV5bW2u9Mw"
 * ```
 */
export function parseReportLink(value: string): ParsedReportLink {
  // Python `value.strip()` — the CPython whitespace set (R11.3), not JS `trim()`.
  const raw = pythonStrip(value);
  if (raw === "") {
    throw unparseable(raw);
  }
  if (isSlug(raw)) {
    return parsedReportLink({ kind: "slug", raw, slug: raw });
  }

  let normalized = raw;
  if (!normalized.includes("#")) {
    normalized = normalized.replace(PERCENT_HASH_RE, "#");
  }
  if (!SCHEME_RE.test(normalized)) {
    if (!startsWithKnownHost(normalized)) {
      throw unparseable(raw);
    }
    normalized = `https://${normalized}`;
  }

  let parts;
  try {
    parts = urlsplit(normalized);
  } catch (error) {
    if (error instanceof UrlSplitError) {
      throw unparseable(raw);
    }
    throw error;
  }
  const host = parts.hostname;
  if (host === null || host === "") {
    throw unparseable(raw);
  }

  const region = HOST_TO_REGION.get(host);
  if (region === undefined) {
    throw new ReportLinkParseError(
      `Report link host ${pythonRepr(host)} is not a Mixpanel web host.`,
      {
        code: "REPORT_LINK_NOT_MIXPANEL_HOST",
        details: { raw, host, hint: HOST_HINT },
      },
    );
  }

  const segments = parts.path.split("/").filter((s) => s !== "");
  const path = parsePath(segments);
  if (path.short_code !== null) {
    return parsedReportLink({
      kind: "short_link",
      raw,
      host,
      region,
      short_code: path.short_code,
    });
  }
  if (path.project_id === null || path.app === null) {
    throw new ReportLinkParseError(
      `Report link path ${pythonRepr(parts.path)} is not a report, dashboard, ` +
        `or shortlink path.`,
      {
        code: "REPORT_LINK_UNRECOGNIZED_PATH",
        details: {
          raw,
          host,
          region,
          path: parts.path,
          hint: PATH_HINT,
        },
      },
    );
  }
  const projectId = path.project_id;
  const workspaceId = path.workspace_id;
  const app = path.app;

  const base = {
    raw,
    host,
    region,
    project_id: projectId,
    workspace_id: workspaceId,
    app,
  };
  const hint = APP_TO_REPORT_TYPE.get(app) ?? null;
  const fragment = trimFragment(parts.fragment);
  if (fragment === "") {
    throw new ReportLinkParseError(
      `Report link has no fragment after '#'. It points at the ${app} app ` +
        `but not at a report.`,
      {
        code: "REPORT_LINK_EMPTY_HASH",
        details: { ...base, hint: EMPTY_HASH_HINT },
      },
    );
  }

  const bookmarkMatch = BOOKMARK_HASH_RE.exec(fragment);
  if (bookmarkMatch !== null) {
    return parsedReportLink({
      kind: "bookmark",
      raw,
      host,
      region,
      project_id: projectId,
      workspace_id: workspaceId,
      app,
      report_type_hint: hint,
      bookmark_id: Number(bookmarkMatch[1]),
      title_segment: bookmarkMatch[2] ?? null,
      overrides_jsurl: bookmarkMatch[3] ?? null,
    });
  }

  if (app === "boards") {
    const fields = fragmentFields(fragment);
    const dashboardS = fields.get("id");
    if (dashboardS !== undefined && ASCII_DIGITS_RE.test(dashboardS)) {
      const dashboardId = Number(dashboardS);
      const edited = fields.get("edited-bookmark");
      if (edited !== undefined && isSlug(edited)) {
        return parsedReportLink({
          kind: "slug",
          raw,
          host,
          region,
          project_id: projectId,
          workspace_id: workspaceId,
          app,
          report_type_hint: hint,
          slug: edited,
          dashboard_id: dashboardId,
        });
      }
      return parsedReportLink({
        kind: "dashboard",
        raw,
        host,
        region,
        project_id: projectId,
        workspace_id: workspaceId,
        app,
        report_type_hint: hint,
        dashboard_id: dashboardId,
      });
    }
  }

  if (isSlug(fragment)) {
    return parsedReportLink({
      kind: "slug",
      raw,
      host,
      region,
      project_id: projectId,
      workspace_id: workspaceId,
      app,
      report_type_hint: hint,
      slug: fragment,
    });
  }

  if (fragment.startsWith("~")) {
    return parsedReportLink({
      kind: "legacy_jsurl",
      raw,
      host,
      region,
      project_id: projectId,
      workspace_id: workspaceId,
      app,
      report_type_hint: hint,
    });
  }

  throw new ReportLinkParseError(
    `Report link hash ${pythonRepr(fragment)} is not a slug, a saved report, ` +
      `or a dashboard reference.`,
    {
      code: "REPORT_LINK_UNRECOGNIZED_HASH",
      details: { ...base, hash: fragment, hint: HASH_HINT },
    },
  );
}
