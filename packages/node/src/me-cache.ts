/**
 * Disk-based per-account `/me` cache — TS port of the MeCache half of
 * `mixpanel_headless/_internal/me.py` (`me.py:413-607`; b8-packets.md
 * §3.1 row 5). Models / `select_workspace_id` / `MeService` are core
 * (B4-C1 / B6) — this module implements the core `MeCacheStore`
 * contract (`services/me.ts:41-66`) plus the `MeCacheEffects.put`
 * effect (`_persist_me_cache`, `accounts.py:1338-1356`).
 *
 * Layout: one file per account at `~/.mp/accounts/{name}/me.json`
 * (dir `0o700`, file `0o600` atomic; TTL default 86400s). NOTE
 * (verbatim Python): the DEFAULT cache dir reads `Path.home()/.mp`
 * DIRECTLY (`me.py:459`) — it does NOT route through
 * `MP_OAUTH_STORAGE_DIR`; the effects wrapper passes
 * `storageDir=accountDir(name)` to honor the override, exactly as
 * `_persist_me_cache` does.
 *
 * Failure postures (packet §7 caution 12 — three postures, three
 * modules): a chmod failure on the cache dir RAISES a coded
 * `ConfigError` (PII — user emails / org / project names must not be
 * world-readable); corrupt/missing files degrade to `null`; symlinks
 * refuse with a WARNING log.
 *
 * Ordered-organizations re-hydration (packet §3.2 item 10): the write
 * side serializes the three container maps in INSERTION order (a JS
 * plain object cannot hold out-of-order integer-like keys, so the
 * writer emits JSON text via a Map-aware stringifier); the read side
 * parses through N1's lossless ordered-entries path so
 * `MeResponse.organizations` recovers Python-dict order.
 */

import { chmodSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  ConfigError,
  type MeCacheEffects,
  type MeCacheStore,
  MeResponse,
  MixpanelHeadlessError,
  parseLossless,
  toNativeJson,
} from "@mixpanel-headless/core";

import { accountDir, type StorageLogger } from "./auth/storage.js";
import {
  atomicWriteBytes,
  CredentialPathError,
  readCredentialText,
  rejectIfSymlink,
} from "./io-utils.js";

/** Cache TTL default in seconds (`me.py:225`). */
const DEFAULT_TTL_SECONDS = 86_400;

/** Workspace payload fields stripped before caching (`me.py:579`). */
const STRIP_FROM_WORKSPACES = new Set(["member_list", "unified_member_list"]);

/** Injected log sink (alias of the storage shape — R9.5). */
export type MeCacheLogger = StorageLogger;

/** The silent default logger. */
const SILENT_LOGGER: MeCacheLogger = {
  warning: (): void => undefined,
  debug: (): void => undefined,
};

/** Options bag of {@link MeCache} (`me.py:439-460` kwargs + seams). */
export interface MeCacheOptions {
  /** Account name — drives the per-account directory layout. */
  readonly accountName: string;
  /**
   * Override the cache directory entirely (`{storageDir}/me.json`);
   * tests and the effects wrapper use this.
   */
  readonly storageDir?: string | undefined;
  /** Cache TTL in seconds (default 86400 = 24h). */
  readonly ttlSeconds?: number | undefined;
  /**
   * Epoch-SECONDS clock seam (`time.time()` twin — used for both the
   * `cached_at` stamp and the TTL expiry check). Default: ambient.
   */
  readonly now?: (() => number) | undefined;
  /** Injected chmod (the `os.chmod` monkeypatch seam). */
  readonly chmodSync?: ((path: string, mode: number) => void) | undefined;
  /** Injected log sink (default silent — R9.5). */
  readonly logger?: MeCacheLogger | undefined;
}

/**
 * Disk-based, per-account cache for `/me` API responses (port of
 * `MeCache`, `me.py:413-607`). Implements the core {@link MeCacheStore}.
 *
 * Example:
 * ```typescript
 * const cache = new MeCache({ accountName: "personal" });
 * cache.put(meResponse);
 * const cached = cache.get(); // MeResponse or null
 * cache.invalidate();
 * ```
 */
export class MeCache implements MeCacheStore {
  /** Account this store is scoped to. */
  readonly accountName: string;

  /** Resolved cache directory. */
  readonly #cacheDir: string;

  /** TTL seconds. */
  readonly #ttlSeconds: number;

  /** Epoch-seconds clock. */
  readonly #now: () => number;

  /** chmod seam. */
  readonly #chmod: (path: string, mode: number) => void;

  /** Log sink. */
  readonly #logger: MeCacheLogger;

  /**
   * Initialize the cache.
   *
   * @param options - Account name + optional dir/TTL/seams.
   */
  constructor(options: MeCacheOptions) {
    this.accountName = options.accountName;
    this.#cacheDir =
      options.storageDir ??
      join(homedir(), ".mp", "accounts", options.accountName);
    this.#ttlSeconds = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
    this.#now = options.now ?? ((): number => Date.now() / 1000);
    this.#chmod = options.chmodSync ?? chmodSync;
    this.#logger = options.logger ?? SILENT_LOGGER;
  }

  /**
   * The per-account cache file path (port of `_cache_path`,
   * `me.py:462-468`; public because the Python suite reads it).
   *
   * @returns `{cacheDir}/me.json`.
   */
  cachePath(): string {
    return join(this.#cacheDir, "me.json");
  }

  /**
   * Retrieve the cached `/me` response (port of `get`,
   * `me.py:470-544`): symlink probe before the existence check; TTL
   * expiry over the injected clock; corrupt files degrade to `null`;
   * schema drift invalidates the file (unlink + `null`).
   *
   * @returns The cached response, or `null` on miss/expiry/corruption.
   */
  get(): MeResponse | null {
    const path = this.cachePath();
    try {
      rejectIfSymlink(path);
    } catch (error) {
      if (error instanceof CredentialPathError) {
        this.#logger.warning(
          `Refusing to read /me cache at ${path}: ${error.message}`,
        );
        return null;
      }
      throw error;
    }
    if (!existsSync(path)) {
      return null;
    }

    let data: unknown;
    try {
      data = toNativeJson(parseLossless(readCredentialText(path)));
    } catch (error) {
      if (error instanceof CredentialPathError) {
        // Structural rejection — WARNING, louder than the corrupt-file
        // debug path (`me.py:506-513`).
        this.#logger.warning(
          `Refusing to read /me cache at ${path}: ${error.message}`,
        );
        return null;
      }
      // Python degrades `(json.JSONDecodeError, OSError)` only
      // (`me.py:514`) — a UnicodeDecodeError escapes RAW. The TS twin
      // (TextDecoder fatal-mode TypeError) propagates unchanged
      // (B8-ARB-A SEM-F2c, live CPython probe in the resolution).
      if (error instanceof TypeError) {
        throw error;
      }
      this.#logger.debug?.(
        `Corrupted cache file me.json: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }

    // TTL check (`me.py:518-528`).
    if (data !== null && typeof data === "object" && !Array.isArray(data)) {
      const cachedAt = (data as Record<string, unknown>)["cached_at"];
      if (typeof cachedAt === "number") {
        const age = this.#now() - cachedAt;
        if (age > this.#ttlSeconds) {
          this.#logger.debug?.(
            `Cache expired for account '${this.accountName}' (age=${age.toFixed(0)}s)`,
          );
          return null;
        }
      }
    }

    try {
      return MeResponse.fromDict(data);
    } catch (error) {
      if (!(error instanceof MixpanelHeadlessError)) {
        throw error;
      }
      // Schema drift on disk — WARN, unlink, deterministic refetch
      // (`me.py:530-544`).
      this.#logger.warning(
        `Cached /me response in me.json no longer matches the model ` +
          `(schema drift). Invalidating: ${error.message}`,
      );
      rmSync(path, { force: true });
      return null;
    }
  }

  /**
   * Store a `/me` response (port of `put`, `me.py:546-595`): dir
   * `0o700` with the PII chmod-failure RAISE; bulky workspace member
   * lists stripped; `cached_at` stamped; file `0o600` atomic.
   *
   * @param response - The response to cache.
   * @throws ConfigError - The filesystem cannot enforce `0o700` on the
   *   cache directory (PII rationale — port the raise, not a warn;
   *   packet §7 caution 12).
   */
  put(response: MeResponse): void {
    mkdirSync(this.#cacheDir, { recursive: true });
    try {
      this.#chmod(this.#cacheDir, 0o700);
    } catch (error) {
      throw new ConfigError(
        `Cannot enforce 0o700 on cache directory ${this.#cacheDir}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { path: this.#cacheDir },
        { cause: error },
      );
    }

    const data = response.modelDump();
    // Strip bulky fields (`me.py:574-584`) — they live in the nested
    // workspace records' extras.
    const workspaces = data["workspaces"];
    if (
      workspaces !== null &&
      typeof workspaces === "object" &&
      !Array.isArray(workspaces)
    ) {
      for (const wsData of Object.values(
        workspaces as Record<string, unknown>,
      )) {
        if (wsData !== null && typeof wsData === "object") {
          for (const key of STRIP_FROM_WORKSPACES) {
            delete (wsData as Record<string, unknown>)[key];
          }
        }
      }
    }
    data["cached_at"] = this.#now();

    // Rebuild the three container maps from the MODEL (insertion
    // order) — `modelDump` flattens Maps into plain objects, which
    // would silently re-hoist integer-like keys ascending (B8-MAPFIX).
    const ordered = new Map<string, unknown>(Object.entries(data));
    ordered.set(
      "organizations",
      mapDump(response.organizations, data, "organizations"),
    );
    ordered.set("projects", mapDump(response.projects, data, "projects"));
    ordered.set("workspaces", mapDump(response.workspaces, data, "workspaces"));

    atomicWriteBytes(
      this.cachePath(),
      new TextEncoder().encode(stringifyOrdered(ordered, 0)),
      { mode: 0o600 },
    );
  }

  /**
   * Remove the cached response (port of `invalidate`, `me.py:597-606`).
   * Missing file is a no-op.
   */
  invalidate(): void {
    rmSync(this.cachePath(), { force: true });
  }
}

/**
 * Rebuild one container field as an insertion-ordered Map whose values
 * come from the (already stripped) `modelDump` product.
 *
 * @param source - The model's ordered map (insertion order source).
 * @param dumped - The `modelDump` product (stripped values source).
 * @param field - The field name.
 * @returns The ordered map of dumped values.
 */
function mapDump(
  source: ReadonlyMap<string, unknown>,
  dumped: Record<string, unknown>,
  field: string,
): Map<string, unknown> {
  const values = dumped[field];
  const record =
    values !== null && typeof values === "object" && !Array.isArray(values)
      ? (values as Record<string, unknown>)
      : {};
  const out = new Map<string, unknown>();
  for (const key of source.keys()) {
    out.set(key, record[key] ?? null);
  }
  return out;
}

/**
 * JSON-stringify with Map support (insertion order emitted verbatim —
 * the ordered-write half of the B8-MAPFIX round-trip). Indentation
 * mirrors Python's `indent=2` well enough for humans; the exact text
 * is out of contract (each side reads its own writes).
 *
 * @param value - The value (Maps, records, arrays, scalars).
 * @param depth - Current indent depth.
 * @returns JSON text.
 */
function stringifyOrdered(value: unknown, depth: number): string {
  const pad = "  ".repeat(depth + 1);
  const close = "  ".repeat(depth);
  if (value instanceof Map) {
    const entries = [...(value as Map<string, unknown>)];
    if (entries.length === 0) {
      return "{}";
    }
    const body = entries
      .map(
        ([key, member]) =>
          `${pad}${JSON.stringify(key)}: ${stringifyOrdered(member, depth + 1)}`,
      )
      .join(",\n");
    return `{\n${body}\n${close}}`;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "[]";
    }
    const body = value
      .map((item) => `${pad}${stringifyOrdered(item, depth + 1)}`)
      .join(",\n");
    return `[\n${body}\n${close}]`;
  }
  if (value !== null && typeof value === "object") {
    return stringifyOrdered(
      new Map(Object.entries(value as Record<string, unknown>)),
      depth,
    );
  }
  // lib.d.ts types `JSON.stringify` as `string`, but functions/symbols
  // really do come back `undefined` at runtime (an `as`, since a typed
  // `const` would narrow straight back).
  const text = JSON.stringify(value === undefined ? null : value) as
    string | undefined;
  return text ?? "null";
}

/**
 * The real node `MeCacheEffects` — the `_persist_me_cache` twin
 * (`accounts.py:1338-1356`): the cache lands in `accountDir(name)` so
 * the `MP_OAUTH_STORAGE_DIR` override is honored, alongside
 * `tokens.json`.
 *
 * @param options - Optional clock/log seams threaded into each cache.
 * @returns The effects object.
 */
export function createNodeMeCacheEffects(
  options: Pick<MeCacheOptions, "now" | "logger"> = {},
): MeCacheEffects {
  return {
    put: (accountName: string, me: MeResponse): void => {
      const cache = new MeCache({
        accountName,
        storageDir: accountDir(accountName),
        ...(options.now === undefined ? {} : { now: options.now }),
        ...(options.logger === undefined ? {} : { logger: options.logger }),
      });
      cache.put(me);
    },
  };
}
