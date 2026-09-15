/**
 * The on-disk per-account token store behind core's `TokenStore` seam.
 * Python twins per member: `writeTokens` is `_persist_browser_tokens`,
 * `removeTokens` is `logout`, `removeAccountDir` is `_safe_rmtree_warn`
 * (warn, never raise), `clientInfoPath` is `_client_info_path` (honours
 * `MP_OAUTH_STORAGE_DIR`), `accountDirExists` is the
 * `account_dir(name).exists()` orphan-directory probe, and `readTokens`
 * is the storage-read discipline (missing or corrupt reads as `null`).
 *
 * @see mixpanel_headless.accounts._persist_browser_tokens
 */

import { existsSync, rmSync, unlinkSync } from "node:fs";
import { join } from "node:path";

import {
  isPythonDict,
  type OAuthTokens,
  parseOAuthTokens,
  type Region,
  type TokenStore,
} from "@mixpanel-headless/core";
import { exceptionMessage } from "@mixpanel-headless/core/internal";

import { atomicWriteBytes, readCredentialText } from "../io-utils.js";
import { coerceLaxExpiresAt } from "./pydantic-datetime.js";
import {
  accountDir,
  ensureAccountDir,
  OAuthStorage,
  type StorageLogger,
} from "./storage.js";
import { tokenPayloadBytes } from "./token-payload.js";
import { accountTokensPath } from "./token-resolver.js";

/** Options bag of {@link createNodeTokenStore}. */
export interface NodeTokenStoreOptions {
  /**
   * Injected log sink for the warn-only cleanup path.
   *
   * @defaultValue silent
   */
  readonly logger?: StorageLogger | undefined;
}

/**
 * Build the on-disk {@link TokenStore}.
 *
 * @param options - Optional log sink for the warn-only cleanup path.
 * @returns The store over `~/.mp/accounts/{name}/` (or the
 *   `MP_OAUTH_STORAGE_DIR` override — every path routes through
 *   `accountDir` / `OAuthStorage.defaultStorageDir`).
 * @example
 * ```ts
 * const store = createNodeTokenStore({ logger: console });
 * const path = store.writeTokens("team", tokens);
 * store.readTokens("team"); // the tokens just written, or null
 * ```
 */
export function createNodeTokenStore(
  options: NodeTokenStoreOptions = {},
): TokenStore {
  const logger = options.logger ?? { warning: (): void => undefined };
  return {
    readTokens: (name: string): OAuthTokens | null => {
      const path = accountTokensPath(name);
      if (!existsSync(path)) {
        return null;
      }
      try {
        let parsed: unknown = JSON.parse(readCredentialText(path));
        // Shared pydantic-lax coercion — this reader and the
        // OnDiskTokenResolver consume the same file and must agree.
        if (isPythonDict(parsed) && Object.hasOwn(parsed, "expires_at")) {
          parsed = {
            ...parsed,
            expires_at: coerceLaxExpiresAt(parsed["expires_at"]),
          };
        }
        return parseOAuthTokens(parsed, { boundary: "param" });
      } catch (error) {
        logger.warning(
          `Failed to read tokens for account '${name}' from ${path}: ` +
            `${exceptionMessage(error)} — ignoring.`,
        );
        return null;
      }
    },
    writeTokens: (name: string, tokens: OAuthTokens): string => {
      // Ensure the 0o700 account dir, then an atomic 0o600 write of the
      // canonical payload (the secret reveal happens inside
      // `tokenPayloadBytes`, its designated site).
      const path = join(ensureAccountDir(name), "tokens.json");
      atomicWriteBytes(path, tokenPayloadBytes(tokens));
      return path;
    },
    removeTokens: (name: string): void => {
      const path = accountTokensPath(name);
      if (existsSync(path)) {
        unlinkSync(path);
      }
    },
    removeAccountDir: (name: string): void => {
      const dir = accountDir(name);
      if (!existsSync(dir)) {
        return;
      }
      try {
        rmSync(dir, { recursive: true });
      } catch (error) {
        logger.warning(
          `Failed to clean up ${dir} containing OAuth tokens: ` +
            `${exceptionMessage(error)}. ` +
            `Run \`rm -rf ${dir}\` manually to remove them.`,
        );
      }
    },
    clientInfoPath: (region: Region): string =>
      join(OAuthStorage.defaultStorageDir(), `client_${region}.json`),
    accountDirExists: (name: string): boolean => existsSync(accountDir(name)),
  };
}
