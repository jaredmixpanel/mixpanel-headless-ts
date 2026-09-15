/**
 * Disk-based per-account `/me` cache: the core `MeCacheStore` contract
 * plus the `MeCacheEffects.put` effect. The models, `select_workspace_id`
 * and `MeService` live in core.
 *
 * Layout is one file per account at `~/.mp/accounts/{name}/me.json`
 * (dir `0o700`, file `0o600`, atomic write, default TTL 86400 s). As in
 * Python, the default cache dir reads `Path.home()/.mp` directly and
 * does not route through `MP_OAUTH_STORAGE_DIR`; the effects wrapper
 * passes `storageDir=accountDir(name)` to honour the override, exactly
 * as `_persist_me_cache` does.
 *
 * Failure postures: a chmod failure on the cache dir raises a coded
 * `ConfigError` (the payload is PII — user emails, org and project names
 * must not be world-readable); corrupt or missing files degrade to
 * `null`; symlinks are refused with a warning.
 *
 * The write side serializes the three container maps in insertion order
 * (a JS plain object cannot hold out-of-order integer-like keys, so the
 * writer emits JSON text via a Map-aware stringifier); the read side
 * parses through the lossless ordered-entries path so
 * `MeResponse.organizations` recovers Python-dict order.
 *
 * @see mixpanel_headless._internal.me.MeCache
 */

import { chmodSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  type MeCacheEffects,
  type MeCacheStore,
  MeResponse,
  MixpanelHeadlessError,
  parseLossless,
  toNativeJson,
} from "@mixpanel-headless/core";
import { exceptionMessage } from "@mixpanel-headless/core/internal";

import { accountDir, type StorageLogger } from "./auth/storage.js";
import { wrapAsConfigError } from "./errors.js";
import {
  atomicWriteBytes,
  CredentialPathError,
  readCredentialText,
  rejectIfSymlink,
} from "./io-utils.js";

/** Cache TTL default in seconds. */
const DEFAULT_TTL_SECONDS = 86_400;

/** Workspace payload fields stripped before caching. */
const STRIP_FROM_WORKSPACES = new Set(["member_list", "unified_member_list"]);

/** Injected log sink (alias of the storage shape). */
export type MeCacheLogger = StorageLogger;

/** The silent default logger. */
const SILENT_LOGGER: MeCacheLogger = {
  warning: (): void => undefined,
  debug: (): void => undefined,
};

/** Options bag of {@link MeCache} (the Python kwargs plus seams). */
export interface MeCacheOptions {
  /** Account name — drives the per-account directory layout. */
  readonly accountName: string;
  /**
   * Override the cache directory entirely (`{storageDir}/me.json`);
   * tests and the effects wrapper use this.
   *
   * @defaultValue `~/.mp/accounts/{accountName}`
   */
  readonly storageDir?: string | undefined;
  /**
   * Cache TTL in seconds.
   *
   * @defaultValue 86400 (24 h)
   */
  readonly ttlSeconds?: number | undefined;
  /**
   * Epoch-seconds clock seam (the `time.time()` twin), used for both the
   * `cached_at` stamp and the TTL expiry check.
   *
   * @defaultValue the ambient clock
   */
  readonly now?: (() => number) | undefined;
  /** Injected chmod (the `os.chmod` monkeypatch seam). */
  readonly chmodSync?: ((path: string, mode: number) => void) | undefined;
  /**
   * Injected log sink.
   *
   * @defaultValue silent
   */
  readonly logger?: MeCacheLogger | undefined;
}

/**
 * Disk-based, per-account cache for `/me` API responses; implements the
 * core {@link MeCacheStore}.
 *
 * @example
 * ```ts
 * const cache = new MeCache({ accountName: "personal" });
 * cache.put(meResponse);
 * const cached = cache.get(); // MeResponse or null
 * cache.invalidate();
 * ```
 * @see mixpanel_headless._internal.me.MeCache
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
   * @param options - Account name plus optional directory, TTL and seams.
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
   * Return the per-account cache file path; public because the Python
   * suite reads it.
   *
   * @returns `{cacheDir}/me.json`.
   * @see mixpanel_headless._internal.me.MeCache._cache_path
   */
  cachePath(): string {
    return join(this.#cacheDir, "me.json");
  }

  /**
   * Retrieve the cached `/me` response: symlink probe before the
   * existence check, TTL expiry over the injected clock, corrupt files
   * degrade to `null`, schema drift invalidates the file (unlink and
   * `null`).
   *
   * @returns The cached response, or `null` on miss, expiry or corruption.
   * @throws TypeError - The file is not valid UTF-8 (the
   *   `UnicodeDecodeError` twin, which Python lets escape).
   * @see mixpanel_headless._internal.me.MeCache.get
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
        // Structural rejection — a warning, louder than the corrupt-file
        // debug path.
        this.#logger.warning(
          `Refusing to read /me cache at ${path}: ${error.message}`,
        );
        return null;
      }
      // Python degrades `(json.JSONDecodeError, OSError)` only; a
      // UnicodeDecodeError escapes raw. The TS twin (TextDecoder
      // fatal-mode TypeError) propagates unchanged.
      if (error instanceof TypeError) {
        throw error;
      }
      this.#logger.debug?.(
        `Corrupted cache file me.json: ${exceptionMessage(error)}`,
      );
      return null;
    }

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
      // Schema drift on disk: warn, unlink, deterministic refetch.
      this.#logger.warning(
        `Cached /me response in me.json no longer matches the model ` +
          `(schema drift). Invalidating: ${error.message}`,
      );
      rmSync(path, { force: true });
      return null;
    }
  }

  /**
   * Store a `/me` response: dir `0o700`, bulky workspace member lists
   * stripped, `cached_at` stamped, file `0o600` written atomically.
   *
   * @param response - The response to cache.
   * @throws {@link ConfigError} - The filesystem cannot enforce `0o700`
   *   on the cache directory; the payload is PII, so this raises rather
   *   than warns.
   * @see mixpanel_headless._internal.me.MeCache.put
   */
  put(response: MeResponse): void {
    mkdirSync(this.#cacheDir, { recursive: true });
    try {
      this.#chmod(this.#cacheDir, 0o700);
    } catch (error) {
      throw wrapAsConfigError(
        `Cannot enforce 0o700 on cache directory ${this.#cacheDir}`,
        error,
        { path: this.#cacheDir },
      );
    }

    const data = response.modelDump();
    // Strip the bulky member lists; they live in the nested workspace
    // records' extras.
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
            Reflect.deleteProperty(wsData, key);
          }
        }
      }
    }
    data["cached_at"] = this.#now();

    // Rebuild the three container maps from the model (insertion
    // order): `modelDump` flattens Maps into plain objects, which would
    // silently re-hoist integer-like keys ascending.
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
   * Remove the cached response; a missing file is a no-op.
   *
   * @see mixpanel_headless._internal.me.MeCache.invalidate
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
 * JSON-stringify with Map support, emitting insertion order verbatim
 * (the ordered-write half of the round-trip). Indentation mirrors
 * Python's `indent=2` well enough for humans; the exact text is out of
 * contract (each side reads its own writes).
 *
 * @param value - The value (Maps, records, arrays, scalars).
 * @param depth - Current indent depth.
 * @returns JSON text.
 */
function stringifyOrdered(value: unknown, depth: number): string {
  const pad = "  ".repeat(depth + 1);
  const close = "  ".repeat(depth);
  const entries = orderedEntriesOf(value);
  if (entries !== null) {
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
  // lib.d.ts types `JSON.stringify` as `string`, but functions/symbols
  // really do come back `undefined` at runtime (an `as`, since a typed
  // `const` would narrow straight back).
  const text = JSON.stringify(value === undefined ? null : value) as
    string | undefined;
  return text ?? "null";
}

/**
 * The ordered members of a Map or plain object (a plain object reads in
 * its own insertion order), or `null` for anything else.
 *
 * @param value - The candidate container.
 * @returns Key/value pairs in order, or `null`.
 */
function orderedEntriesOf(value: unknown): Array<[string, unknown]> | null {
  if (value instanceof Map) {
    return [...(value as Map<string, unknown>)];
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return Object.entries(value as Record<string, unknown>);
  }
  return null;
}

/**
 * Build the node `MeCacheEffects`: the cache lands in `accountDir(name)`
 * alongside `tokens.json`, so the `MP_OAUTH_STORAGE_DIR` override is
 * honoured.
 *
 * @param options - Optional clock and log seams threaded into each cache.
 * @returns The effects object.
 * @example
 * ```ts
 * const effects = createNodeMeCacheEffects({ logger: console });
 * effects.put("team", meResponse);
 * ```
 * @see mixpanel_headless.accounts._persist_me_cache
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
