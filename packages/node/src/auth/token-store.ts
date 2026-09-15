/**
 * The real per-account token/artifact store — the B8-N2 implementation
 * of the core `TokenStore` seam (`auth-effects.ts:305-362`;
 * b8-packets.md §3.1 row 6). Python twins per member:
 *
 * - `writeTokens` ← `_persist_browser_tokens` (`accounts.py:878-893`);
 * - `removeTokens` ← `logout` (`accounts.py:916-929`);
 * - `removeAccountDir` ← `_safe_rmtree_warn` (`accounts.py:278-303` —
 *   warn, NEVER raise);
 * - `clientInfoPath` ← `_client_info_path` (`accounts.py:894-915` —
 *   honors `MP_OAUTH_STORAGE_DIR`);
 * - `accountDirExists` ← `account_dir(name).exists()` — the B7-ARB-A
 *   SEM-F2 orphan-directory probe (`accounts.py:1704-1708`;
 *   `b7-reviewA-resolution.md:239-241`);
 * - `readTokens` ← the storage-read discipline (missing/corrupt →
 *   `null`; the member has no direct Python function — it is the B7
 *   seam abstraction of the on-disk read the fakes model).
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

import { errorMessage } from "../errors.js";
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
  /** Injected log sink (default silent — R9.5). */
  readonly logger?: StorageLogger | undefined;
}

/**
 * Build the real on-disk {@link TokenStore}.
 *
 * @param options - Optional log sink for the warn-only cleanup path.
 * @returns The store over `~/.mp/accounts/{name}/` (or the
 *   `MP_OAUTH_STORAGE_DIR` override — every path routes through
 *   `accountDir` / `OAuthStorage.defaultStorageDir`).
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
        // Shared pydantic-lax mirror (B8-ARB-B F1) — this reader and
        // the OnDiskTokenResolver consume the SAME file and must agree.
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
            `${errorMessage(error)} — ignoring.`,
        );
        return null;
      }
    },
    writeTokens: (name: string, tokens: OAuthTokens): string => {
      // `_persist_browser_tokens`: ensure the 0o700 account dir, then
      // an atomic 0o600 write of the canonical payload (CRED-F3 reveal
      // happens inside `tokenPayloadBytes`, its designated site).
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
            `${errorMessage(error)}. ` +
            `Run \`rm -rf ${dir}\` manually to remove them.`,
        );
      }
    },
    clientInfoPath: (region: Region): string =>
      join(OAuthStorage.defaultStorageDir(), `client_${region}.json`),
    accountDirExists: (name: string): boolean => existsSync(accountDir(name)),
  };
}
