/**
 * Pydantic datetime coercion and rendering twins shared by every node
 * credential file reader and writer; one implementation, imported by
 * name, so every read path agrees.
 *
 * Read side (`coerceLaxExpiresAt`): Python parses on-disk datetimes
 * through pydantic-lax models (`OAuthTokens.model_validate_json` in the
 * token resolver, the `BridgeFile` tokens model, the storage loaders),
 * whose speedate coercion accepts numeric epochs as seconds when
 * `|v| <= 20_000_000_000` and as milliseconds above that watershed
 * (`20_000_000_000` itself is seconds, 2603-10-11; `20_000_000_001` is
 * milliseconds, 1970-08-20); numeric strings under the grammar
 * `[+-]?(\d+(\.\d*)?|\.\d+)` (so `"+1893456000"`, `".5"`, `"5."` parse
 * while `" 1893456000"`, `"1e10"`, `"1_0"`, `"0x10"` do not), same
 * watershed; fractional parts as microseconds (`1893456000.5` renders
 * `2030-01-01T00:00:00.500000+00:00`); and only results inside Python's
 * datetime range (`0001-01-01T00:00:00` to `9999-12-31T23:59:59.999999`),
 * epochs beyond it raising `ValidationError`.
 *
 * Write side: Python re-renders the parsed `datetime` per writer. The
 * `tokens.json` and legacy `tokens_{region}.json` writers use
 * `datetime.isoformat()` (`+00:00` offset, 0 or 6 fractional digits);
 * the bridge and `client_{region}.json` writers use pydantic JSON mode
 * (`Z` suffix for UTC). The TS models store ISO text, so echoing it
 * verbatim would leak the source spelling into the written artifact (a
 * Python-written `Z` bridge would keep its `Z` through TS
 * materialization where Python writes `+00:00`, and vice versa). The
 * two formatters below canonicalize zero-offset text to the matching
 * writer shape. Non-zero-offset text (foreign writers only; the library
 * always produces UTC) is canonicalized to `±HH:MM`; text outside the
 * recognized ISO grammar passes through verbatim, a corner no validated
 * model can produce since every read path gates on `Date.parse` plus the
 * tz-aware suffix first.
 *
 * @see mixpanel_headless._internal.auth.token.OAuthTokens
 */

import {
  ParamValidationError,
  pythonUtcIsoformat,
} from "@mixpanel-headless/core";

/** The speedate seconds-to-milliseconds watershed (`|v|` strictly above). */
const MS_WATERSHED = 20_000_000_000;

/** Python `datetime.min` (0001-01-01T00:00:00Z) in epoch ms. */
const PY_DATETIME_MIN_MS = -62_135_596_800_000;

/** One past Python `datetime.max` (10000-01-01T00:00:00Z) in epoch ms. */
const PY_DATETIME_MAX_MS = 253_402_300_800_000;

/** The speedate numeric-string epoch grammar (see the module header). */
const NUMERIC_STRING = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

/**
 * Convert a numeric epoch to Python-isoformat UTC text under the
 * speedate rules (watershed and datetime range).
 *
 * @param value - Epoch number (seconds, or ms beyond the watershed).
 * @returns Python-isoformat text (`+00:00`, 0 or 6 fractional digits).
 * @throws {@link ParamValidationError} - Result outside Python's
 *   datetime range (the pydantic `ValidationError` twin).
 */
function epochToIso(value: number): string {
  const ms = Math.abs(value) > MS_WATERSHED ? value : value * 1000;
  if (
    !Number.isFinite(ms) ||
    ms < PY_DATETIME_MIN_MS ||
    ms >= PY_DATETIME_MAX_MS
  ) {
    throw new ParamValidationError(
      "expires_at epoch is outside the datetime range",
    );
  }
  return pythonUtcIsoformat(ms);
}

/**
 * Coerce a stored datetime value the way a pydantic-lax model would —
 * the one reader-side coercion, used by the on-disk token resolver, the
 * bridge tokens parse, `TokenStore.readTokens` and `OAuthStorage`'s
 * `loadTokens` / `loadClientInfo`.
 *
 * @param value - The raw JSON-decoded value.
 * @returns Tz-aware-parseable ISO text (numeric epochs converted to
 *   `+00:00` UTC text; ISO strings passed through verbatim).
 * @throws {@link ParamValidationError} - Unparseable text, a value that
 *   is neither string nor number, or an epoch outside Python's datetime
 *   range (each call site's pydantic-`ValidationError` handling applies).
 * @example
 * ```ts
 * coerceLaxExpiresAt(1893456000); // "2030-01-01T00:00:00+00:00"
 * coerceLaxExpiresAt("2030-01-01T00:00:00Z"); // passed through
 * ```
 */
export function coerceLaxExpiresAt(value: unknown): string {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new ParamValidationError("expires_at must be a finite number");
    }
    return epochToIso(value);
  }
  if (typeof value === "string") {
    if (NUMERIC_STRING.test(value)) {
      return epochToIso(Number(value));
    }
    if (Number.isNaN(Date.parse(value))) {
      throw new ParamValidationError(
        `invalid expires_at value: ${JSON.stringify(value)}`,
      );
    }
    // Naive text is rejected downstream by the OAuthTokens tz gate.
    return value;
  }
  throw new ParamValidationError("expires_at must be ISO text or epoch");
}

/** Parsed ISO components (`null` when the text is out of grammar). */
interface IsoParts {
  /** `YYYY-MM-DDTHH:MM:SS` with a canonical `T` separator. */
  readonly base: string;
  /** Exactly-6-digit microseconds, or empty when zero or absent. */
  readonly micro: string;
  /** `null` for a zero offset (UTC), else canonical `±HH:MM`. */
  readonly offset: string | null;
}

/**
 * Split tz-aware ISO text into canonicalized components.
 *
 * @param text - Stored ISO text.
 * @returns Components, or `null` when out of the recognized grammar.
 */
function splitIso(text: string): IsoParts | null {
  const match =
    /^(\d{4}-\d{2}-\d{2})[Tt ](\d{2}:\d{2}:\d{2})(?:\.(\d+))?(?:([Zz])|([+-])(\d{2}):?(\d{2}))$/.exec(
      text,
    );
  if (match === null) {
    return null;
  }
  const [, date, time, fraction, zulu, sign, offH, offM] = match;
  let micro = "";
  if (fraction !== undefined) {
    micro = `${fraction}000000`.slice(0, 6);
    if (!/[1-9]/.test(micro)) {
      micro = "";
    }
  }
  const zero = zulu !== undefined || (offH === "00" && offM === "00");
  return {
    base: `${date ?? ""}T${time ?? ""}`,
    micro,
    offset: zero ? null : `${sign ?? ""}${offH ?? ""}:${offM ?? ""}`,
  };
}

/**
 * Render stored ISO text the way `datetime.isoformat()` does (`+00:00`
 * for UTC, 0 or 6 fractional digits) — the `tokens.json` and
 * `tokens_{region}.json` writer shape.
 *
 * @param text - Stored tz-aware ISO text.
 * @returns Canonical isoformat text (verbatim when out of grammar).
 * @example
 * ```ts
 * pythonIsoformatDatetimeText("2030-01-01T00:00:00Z");
 * // "2030-01-01T00:00:00+00:00"
 * ```
 */
export function pythonIsoformatDatetimeText(text: string): string {
  const parts = splitIso(text);
  if (parts === null) {
    return text;
  }
  const frac = parts.micro === "" ? "" : `.${parts.micro}`;
  return `${parts.base}${frac}${parts.offset ?? "+00:00"}`;
}

/**
 * Render stored ISO text the way pydantic's JSON mode does (`Z` for
 * UTC, 0 or 6 fractional digits) — the bridge and `client_{region}.json`
 * writer shape. `model_dump(mode="json")` renders
 * `2030-01-01T00:00:00Z`, `...T00:00:00.000120Z` and
 * `...T00:00:00+05:30`.
 *
 * @param text - Stored tz-aware ISO text.
 * @returns Canonical pydantic-JSON text (verbatim when out of grammar).
 * @example
 * ```ts
 * pydanticJsonDatetimeText("2030-01-01T00:00:00+00:00");
 * // "2030-01-01T00:00:00Z"
 * ```
 */
export function pydanticJsonDatetimeText(text: string): string {
  const parts = splitIso(text);
  if (parts === null) {
    return text;
  }
  const frac = parts.micro === "" ? "" : `.${parts.micro}`;
  return `${parts.base}${frac}${parts.offset ?? "Z"}`;
}
