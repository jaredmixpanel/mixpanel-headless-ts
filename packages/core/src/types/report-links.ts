/**
 * Report-link result types: the `ReportLink` and `ResolvedReport` frozen
 * dataclasses and the `ReportLinkQueryResult` union. `ReportLinkType`
 * lives with the other Literal aliases in `literals.ts`; `BookmarkUrl` (a
 * Pydantic model) lives with the entity models in `entities/bookmarks.ts`.
 *
 * Field names keep their Python snake_case spelling — these are the
 * dataclass twins whose `toDict()` output is JSON-compared.
 *
 * @see mixpanel_headless.types.ReportLink
 */

import { ParamValidationError } from "../errors.js";
import type { Bookmark } from "./entities/bookmarks.js";
import type { Region, ReportLinkType } from "./literals.js";
import type {
  FlowQueryResult,
  FunnelQueryResult,
  QueryResult,
  RetentionQueryResult,
} from "./results/query-engine.js";

/** Constructor bag of {@link ReportLink} (dataclass fields + defaults). */
export interface ReportLinkFields {
  /** The shareable web URL (`String(link)` returns this). */
  readonly url: string;
  /** The 12-character slug headless minted and stored. */
  readonly slug: string;
  /** One of `ReportLinkType`. */
  readonly report_type: ReportLinkType;
  /** Project the slug record lives in. */
  readonly project_id: number;
  /** Workspace in the URL, or `null` for a project-only URL. */
  readonly workspace_id: number | null;
  /** Optional name stored with the record (default `""`). */
  readonly name?: string | undefined;
  /** Optional description stored with the record (default `""`). */
  readonly description?: string | undefined;
  /** Optional saved-report reference stored with the record. */
  readonly bookmark_id?: number | null | undefined;
  /** Server creation timestamp, when the response carried one. */
  readonly created_at?: string | null | undefined;
}

/**
 * The result of `Workspace.createReportLink` (`ReportLink`, frozen
 * dataclass).
 *
 * @example
 * ```typescript
 * const link = await ws.createReportLink(await ws.buildParams("Login", { last: 7 }));
 * console.log(String(link)); // the URL
 * link.toDict();             // every field, JSON-serializable
 * ```
 */
export class ReportLink {
  /** The shareable web URL. */
  readonly url: string;
  /** The 12-character slug headless minted and stored. */
  readonly slug: string;
  /** One of `ReportLinkType`. */
  readonly report_type: ReportLinkType;
  /** Project the slug record lives in. */
  readonly project_id: number;
  /** Workspace in the URL, or `null` for a project-only URL. */
  readonly workspace_id: number | null;
  /** Optional name stored with the record. */
  readonly name: string;
  /** Optional description stored with the record. */
  readonly description: string;
  /** Optional saved-report reference stored with the record. */
  readonly bookmark_id: number | null;
  /** Server creation timestamp, when the response carried one. */
  readonly created_at: string | null;

  /**
   * Construct the (frozen) dataclass.
   *
   * @param fields - The field values.
   */
  constructor(fields: ReportLinkFields) {
    this.url = fields.url;
    this.slug = fields.slug;
    this.report_type = fields.report_type;
    this.project_id = fields.project_id;
    this.workspace_id = fields.workspace_id;
    this.name = fields.name ?? "";
    this.description = fields.description ?? "";
    this.bookmark_id = fields.bookmark_id ?? null;
    this.created_at = fields.created_at ?? null;
    Object.freeze(this);
  }

  /**
   * Serialize every field to a JSON-friendly dict (`to_dict`).
   *
   * @returns Dict with keys `url`, `slug`, `report_type`, `project_id`,
   *   `workspace_id`, `name`, `description`, `bookmark_id`, `created_at`.
   */
  toDict(): Record<string, unknown> {
    return {
      url: this.url,
      slug: this.slug,
      report_type: this.report_type,
      project_id: this.project_id,
      workspace_id: this.workspace_id,
      name: this.name,
      description: this.description,
      bookmark_id: this.bookmark_id,
      created_at: this.created_at,
    };
  }

  /**
   * Return the URL so `String(link)` / template literals are
   * shell-friendly (`__str__`).
   *
   * @returns The `url` field.
   */
  toString(): string {
    return this.url;
  }
}

/** Constructor bag of {@link ResolvedReport} (dataclass fields + defaults). */
export interface ResolvedReportFields {
  /** Which record type was fetched: `slug` or `bookmark`. */
  readonly source: "slug" | "bookmark";
  /**
   * Server `type` for a slug, `Bookmark.bookmark_type` for a bookmark.
   * May be `launch-analysis`, which cannot be run.
   */
  readonly report_type: string;
  /** The raw parameters. Never merged with `overrides`. */
  readonly params: Readonly<Record<string, unknown>>;
  /** Project the record lives in. */
  readonly project_id: number;
  /** URL `wid`, else the session pin at resolve time, else `null`. */
  readonly workspace_id: number | null;
  /** Session region (`us`, `eu`, or `in`). */
  readonly region: Region;
  /** Canonical rebuilt URL. */
  readonly url: string;
  /** What the caller passed. */
  readonly input: string;
  /** The shortlink target when the input was a shortlink. */
  readonly expanded_url?: string | null | undefined;
  /** Set for a slug record. */
  readonly slug?: string | null | undefined;
  /** Set for a bookmark link. */
  readonly bookmark_id?: number | null | undefined;
  /**
   * Set for a bookmark link, or for a slug record with an embedded
   * bookmark.
   */
  readonly bookmark?: Bookmark | null | undefined;
  /** Record name when present. */
  readonly name?: string | null | undefined;
  /** Record description when present. */
  readonly description?: string | null | undefined;
  /** Slug-record overrides when present. */
  readonly overrides?: Readonly<Record<string, unknown>> | null | undefined;
}

/**
 * The result of `Workspace.resolveReportLink` (`ResolvedReport`, frozen
 * dataclass) — the input to `Workspace.queryReportLink`. It holds the
 * raw query parameters; a typed decompile into `Metric` / `Filter`
 * objects is out of scope for 045.
 *
 * @example
 * ```typescript
 * const resolved = await ws.resolveReportLink("EBrV5bW2u9Mw");
 * resolved.report_type; // "insights"
 * const rows = (await ws.queryReportLink(resolved)).toRows();
 * ```
 */
export class ResolvedReport {
  /** Which record type was fetched: `slug` or `bookmark`. */
  readonly source: "slug" | "bookmark";
  /** Server `type` for a slug, `Bookmark.bookmark_type` for a bookmark. */
  readonly report_type: string;
  /** The raw parameters. Never merged with `overrides`. */
  readonly params: Readonly<Record<string, unknown>>;
  /** Project the record lives in. */
  readonly project_id: number;
  /**
   * URL `wid`, else the session pin at resolve time, else `null`.
   * `queryReportLink` runs under exactly this scope; `null` means
   * project-wide.
   */
  readonly workspace_id: number | null;
  /** Session region (`us`, `eu`, or `in`). */
  readonly region: Region;
  /** Canonical rebuilt URL. */
  readonly url: string;
  /** What the caller passed. */
  readonly input: string;
  /** The shortlink target when the input was a shortlink. */
  readonly expanded_url: string | null;
  /** Set for a slug record. */
  readonly slug: string | null;
  /** Set for a bookmark link. */
  readonly bookmark_id: number | null;
  /**
   * Set for a bookmark link, or for a slug record with an embedded
   * bookmark.
   */
  readonly bookmark: Bookmark | null;
  /** Record name when present. */
  readonly name: string | null;
  /** Record description when present. */
  readonly description: string | null;
  /** Slug-record overrides when present. */
  readonly overrides: Readonly<Record<string, unknown>> | null;

  /**
   * Construct the (frozen) dataclass; `__post_init__` ties `source` to
   * the id field that must accompany it.
   *
   * @param fields - The field values.
   * @throws {@link ParamValidationError} - `RL5_RESOLVED_REPORT_INCONSISTENT`
   *   when `source="slug"` has no `slug` or `source="bookmark"` has no
   *   `bookmark_id`.
   */
  constructor(fields: ResolvedReportFields) {
    this.source = fields.source;
    this.report_type = fields.report_type;
    this.params = fields.params;
    this.project_id = fields.project_id;
    this.workspace_id = fields.workspace_id;
    this.region = fields.region;
    this.url = fields.url;
    this.input = fields.input;
    this.expanded_url = fields.expanded_url ?? null;
    this.slug = fields.slug ?? null;
    this.bookmark_id = fields.bookmark_id ?? null;
    this.bookmark = fields.bookmark ?? null;
    this.name = fields.name ?? null;
    this.description = fields.description ?? null;
    this.overrides = fields.overrides ?? null;

    let missing: string | null = null;
    if (this.source === "slug" && this.slug === null) {
      missing = "slug";
    } else if (this.source === "bookmark" && this.bookmark_id === null) {
      missing = "bookmark_id";
    }
    if (missing !== null) {
      throw new ParamValidationError(
        `ResolvedReport with source='${this.source}' requires ${missing}.`,
        "RL5_RESOLVED_REPORT_INCONSISTENT",
        { source: this.source, missing },
      );
    }
    Object.freeze(this);
  }

  /**
   * Serialize to a JSON-friendly dict (`to_dict`). The `bookmark` field
   * is dumped with `model_dump(mode="json", by_alias=True)` so it
   * round-trips through the JSON formatter with the `type` key the API
   * uses.
   *
   * @returns Dict with one key per field.
   */
  toDict(): Record<string, unknown> {
    return {
      source: this.source,
      report_type: this.report_type,
      params: this.params,
      project_id: this.project_id,
      workspace_id: this.workspace_id,
      region: this.region,
      url: this.url,
      input: this.input,
      expanded_url: this.expanded_url,
      slug: this.slug,
      bookmark_id: this.bookmark_id,
      bookmark:
        this.bookmark === null
          ? null
          : this.bookmark.modelDump({ byAlias: true }),
      name: this.name,
      description: this.description,
      overrides: this.overrides,
    };
  }
}

/**
 * Return type of `Workspace.queryReportLink` (`ReportLinkQueryResult`).
 * Narrow with `instanceof` or by `ResolvedReport.report_type`.
 */
export type ReportLinkQueryResult =
  QueryResult | FunnelQueryResult | RetentionQueryResult | FlowQueryResult;
