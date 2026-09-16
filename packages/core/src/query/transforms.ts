/**
 * Normalize raw Mixpanel API responses — export-API events and
 * engage-API profiles — for the streaming and `query_user` result
 * paths. Not exported from the package barrel.
 *
 * Contract notes a reader must not "clean up": `event_time` is
 * Python-isoformat text, not a `Date` (the result models keep datetimes
 * as iso text, and {@link fromTimestampUtcIso} is pure arithmetic —
 * `new Date()` truncates to milliseconds and reads the local zone);
 * microsecond rounding is CPython's half-even, not `Math.round`'s
 * half-up; the `$insert_id` generator is injectable so streaming vectors
 * replay deterministically; and every `dict.get`/`dict.pop` default goes
 * through `Object.hasOwn`, never `in`. Python's debug logging on the
 * uuid-fill branch has no twin — only the value behavior is contract.
 *
 * @see mixpanel_headless._internal.transforms
 * @internal
 */

import {
  dictGet,
  floatCarrierValue,
  isFloatCarrier,
  isPythonDict,
  pythonFloatStr,
  pythonIterableElements,
  pythonStrOf,
  pythonTypeName,
  requireHashable,
  zfill,
} from "../compat/index.js";
import { OverflowError, ValueError } from "../compat/python-builtins.js";

/** A normalized event / profile dict — twin of `dict[str, Any]`. */
export type TransformedRecord = Record<string, unknown>;

/** Injectable seams for {@link transformEvent}. */
export interface TransformEventOptions {
  /**
   * `$insert_id` generator used when the event carries none (Python's
   * `str(uuid.uuid4())`).
   *
   * @defaultValue `crypto.randomUUID()`
   */
  readonly uuid?: () => string;
}

/**
 * Reserved keys that {@link transformEvent} promotes from `properties`
 * to top-level fields.
 */
export const RESERVED_EVENT_KEYS: ReadonlySet<string> = new Set([
  "distinct_id",
  "time",
  "$insert_id",
]);

/** Reserved keys that {@link transformProfile} promotes from `$properties`. */
export const RESERVED_PROFILE_KEYS: ReadonlySet<string> = new Set([
  "$last_seen",
]);

// --- Python-semantics helpers ---

/**
 * Python `dict.pop(key, default)` over a mutable plain-object dict.
 *
 * @param target - The dict being mutated.
 * @param key - Key to remove.
 * @param fallback - Value returned when the key is absent.
 * @returns The removed value or the fallback.
 */
function dictPop(
  target: Record<string, unknown>,
  key: string,
  fallback: unknown,
): unknown {
  if (!Object.hasOwn(target, key)) {
    return fallback;
  }
  const value = target[key];
  Reflect.deleteProperty(target, key);
  return value;
}

/**
 * Key spelling used when a `dict(pairs)` pair carries a non-string key.
 *
 * @remarks
 * A JS object cannot hold Python's int/float/bool/None keys with their
 * types, so the JSON spelling — what any downstream encoder emits for
 * the Python dict — is used. Only reachable through the
 * `dict(iterable-of-pairs)` branch of {@link pythonDictCopy}, which no
 * Mixpanel response can produce.
 *
 * - Python `float` (PyFloat carrier, or a fractional plain number) →
 *   CPython `float.__repr__`, exactly `json.dumps`' float-key spelling
 *   (`"18.0"`, `"1e+16"`, `"-0.0"`); `String()` would spell `18.0` as
 *   `"18"`.
 * - Python `int` (integral plain number / bigint) → digit run.
 * - `true`/`false`/`null` → `"true"`/`"false"`/`"null"` — the JSON
 *   spelling, not `str()`'s `"True"`.
 * @param key - The pair's first element (already hashability-checked).
 * @returns The object-key spelling.
 */
function dictKeyText(key: unknown): string {
  // Divergence: non-string dict keys are stored under their JSON spelling; Python keeps the typed key.
  if (typeof key === "string") {
    return key;
  }
  if (key === null) {
    return "null";
  }
  if (isFloatCarrier(key)) {
    return pythonFloatStr(floatCarrierValue(key));
  }
  if (typeof key === "number") {
    return Number.isInteger(key) ? String(key) : pythonFloatStr(key);
  }
  if (typeof key === "boolean" || typeof key === "bigint") {
    return String(key);
  }
  return pythonStrOf(key);
}

/**
 * Python `dict(value)` — the shallow `properties` copy.
 *
 * @remarks
 * A non-dict `properties` value is in-annotation (the interior of a
 * `dict[str, Any]`), so CPython's behavior is contract and is
 * reproduced branch for branch:
 *
 * | input | CPython |
 * |---|---|
 * | `{"a": 1}` | shallow copy |
 * | `5` / `None` | `TypeError: 'int' object is not iterable` |
 * | `"ab"` | `ValueError: dictionary update sequence element #0 has length 1; 2 is required` |
 * | `[1, 2]` | `TypeError` (element not iterable) |
 * | `[["a", "b"]]` / `["ab"]`-shaped pairs | `{"a": "b"}` |
 * | `[[["x"], 2]]` | `TypeError` (unhashable key) |
 * @param value - The value being copied.
 * @returns A shallow copy of the dict (or the built pair mapping).
 * @throws {@link TypeError} - Non-iterable value, non-iterable element,
 *   or an unhashable key.
 * @throws {@link ValueError} - An element that is not a 2-element
 *   sequence.
 */
function pythonDictCopy(value: unknown): Record<string, unknown> {
  if (isPythonDict(value)) {
    return { ...value };
  }
  const elements = pythonIterableElements(value);
  if (elements === null) {
    throw new TypeError(`'${pythonTypeName(value)}' object is not iterable`);
  }
  const out: Record<string, unknown> = {};
  for (const [index, element] of elements.entries()) {
    const pair = pythonIterableElements(element);
    if (pair === null) {
      throw new TypeError(
        `cannot convert dictionary update sequence element #${String(index)} to a sequence`,
      );
    }
    if (pair.length !== 2) {
      throw new ValueError(
        `dictionary update sequence element #${String(index)} has length ` +
          `${String(pair.length)}; 2 is required`,
      );
    }
    // CPython hashes the key before storing it, so an unhashable key
    // raises `TypeError` here too.
    requireHashable(pair[0]);
    out[dictKeyText(pair[0])] = pair[1];
  }
  return out;
}

/**
 * CPython's `round(x)` for floats: nearest integer, ties to even.
 *
 * @param x - Value to round.
 * @returns The rounded integer (`-0` is possible and harmless — it
 *   compares equal to `0` and stringifies as `"0"`).
 */
function pyRoundHalfEven(x: number): number {
  const floor = Math.floor(x);
  if (x - floor === 0.5) {
    // Exact tie: pick the even neighbour (CPython's
    // `2.0 * round(x / 2.0)` correction).
    return floor % 2 === 0 ? floor : floor + 1;
  }
  return Math.round(x);
}

/**
 * Civil (proleptic Gregorian) date from a day count since 1970-01-01.
 *
 * Howard Hinnant's `civil_from_days`, the same algorithm CPython's
 * `datetime` uses in spirit; integer arithmetic only, valid for every
 * day count this module can reach (years 1..9999).
 *
 * @param days - Whole days since the Unix epoch (may be negative).
 * @returns `[year, month, day]`.
 */
function civilFromDays(days: number): [number, number, number] {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097; // [0, 146096]
  const yoe = Math.floor(
    (doe -
      Math.floor(doe / 1460) +
      Math.floor(doe / 36524) -
      Math.floor(doe / 146096)) /
      365,
  ); // [0, 399]
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153); // [0, 11]
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1; // [1, 31]
  const m = mp < 10 ? mp + 3 : mp - 9; // [1, 12]
  return [m <= 2 ? y + 1 : y, m, d];
}

/**
 * Render `datetime.fromtimestamp(t, tz=timezone.utc).isoformat()` as
 * pure arithmetic.
 *
 * @remarks
 * Mirrors CPython's `datetime._fromtimestamp`: split with `modf`, round
 * the fractional part to microseconds (half-even: `1.5e-6 → 2µs`,
 * `2.5e-6 → 2µs`, `5e-7 → 0µs`), carry the ±1 second, then convert. The
 * rendering is CPython's `isoformat()`: `YYYY-MM-DDTHH:MM:SS+00:00`,
 * gaining `.ffffff` only when the microsecond field is non-zero, with
 * the offset spelled `+00:00` (never `Z`).
 * @param t - Unix timestamp in seconds (int or float).
 * @returns The CPython isoformat text.
 * @throws {@link ValueError} - For `NaN` (CPython: "Invalid value NaN")
 *   and for timestamps whose year falls outside 1..9999.
 * @throws {@link OverflowError} - For infinities and magnitudes at or
 *   beyond the platform `time_t` range.
 * @example
 * ```ts
 * fromTimestampUtcIso(0); // "1970-01-01T00:00:00+00:00"
 * fromTimestampUtcIso(1.5); // "1970-01-01T00:00:01.500000+00:00"
 * ```
 */
export function fromTimestampUtcIso(t: number): string {
  if (Number.isNaN(t)) {
    throw new ValueError("Invalid value NaN (not a number)");
  }
  if (!Number.isFinite(t)) {
    throw new OverflowError("timestamp out of range for platform time_t");
  }

  // `math.modf(t)` -> (fractional, integral), both signed like `t`.
  let secs = Math.trunc(t);
  const frac = t - secs;
  let us = pyRoundHalfEven(frac * 1e6);
  if (us >= 1000000) {
    secs += 1;
    us -= 1000000;
  } else if (us < 0) {
    secs -= 1;
    us += 1000000;
  }

  // 2^63 seconds is the platform `time_t` bound CPython reports as
  // OverflowError; everything inside it that still leaves `datetime`'s
  // 1..9999 year range is a ValueError.
  //
  // Divergence: CPython raises a platform-dependent `OSError` (errno 84, gmtime overflow) across most of the span beyond `datetime.max`; the port raises `ValueError` there. Both sides always raise.
  if (Math.abs(secs) >= 9223372036854775808) {
    throw new OverflowError("timestamp out of range for platform time_t");
  }
  if (secs > 253402300799 || secs < -62135596800) {
    throw new ValueError("year is out of range");
  }

  const days = Math.floor(secs / 86400);
  const secondOfDay = secs - days * 86400;
  const [year, month, day] = civilFromDays(days);
  const hour = Math.floor(secondOfDay / 3600);
  const minute = Math.floor((secondOfDay % 3600) / 60);
  const second = secondOfDay % 60;

  const date = `${zfill(String(year), 4)}-${zfill(String(month), 2)}-${zfill(String(day), 2)}`;
  const time = `${zfill(String(hour), 2)}:${zfill(String(minute), 2)}:${zfill(String(second), 2)}`;
  // CPython omits the fractional part entirely when microsecond == 0.
  const fraction = us === 0 ? "" : `.${zfill(String(us), 6)}`;
  return `${date}T${time}${fraction}+00:00`;
}

/**
 * Coerce a `time` property to the number `datetime.fromtimestamp`
 * accepts.
 *
 * @remarks
 * Python accepts `int` and `float` — and `bool`, since `bool` is a
 * subclass of `int` (`fromtimestamp(True)` is one second past the
 * epoch). Everything else raises
 * `TypeError: argument must be int or float, not X`. The rig's PyFloat
 * carrier is unwrapped here. Exported because the activity-feed
 * transform calls `datetime.fromtimestamp` on the same
 * `properties["time"]` value and must coerce identically.
 * @param value - The raw `time` property value.
 * @returns The timestamp as a JS number.
 * @throws {@link TypeError} - When Python would reject the type.
 * @example
 * ```ts
 * timestampNumber(1704067200); // 1704067200
 * timestampNumber(true); // 1
 * ```
 */
export function timestampNumber(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  if (isFloatCarrier(value)) {
    return floatCarrierValue(value);
  }
  throw new TypeError(
    `argument must be int or float, not ${pythonTypeName(value)}`,
  );
}

// --- Public API ---

/**
 * Transform an export-API event to the normalized record shape.
 *
 * @remarks
 * Extracts the standard Mixpanel fields (`distinct_id`, `time`,
 * `$insert_id`) from the properties dict and promotes them to top-level
 * fields. `time` is converted from a Unix timestamp to CPython
 * isoformat text, and a UUID is generated when `$insert_id` is missing
 * or `null`.
 * @param event - Raw event from the Mixpanel Export API with `event`
 *   and `properties` keys.
 * @param options - Optional seams; see {@link TransformEventOptions}.
 * @returns Transformed event dict with `event_name`, `event_time`,
 *   `distinct_id`, `insert_id` and `properties` keys.
 * @throws {@link TypeError} - When `properties` is present but not a
 *   dict, or `time` is neither int nor float.
 * @throws {@link ValueError} - When `time` is `NaN` or out of `datetime`
 *   range.
 * @throws {@link OverflowError} - When `time` is infinite or beyond
 *   `time_t`.
 * @example
 * ```ts
 * transformEvent({
 *   event: "Sign Up",
 *   properties: { distinct_id: "user123", time: 1704067200, plan: "premium" },
 * });
 * // {
 * //   event_name: "Sign Up",
 * //   event_time: "2024-01-01T00:00:00+00:00",
 * //   distinct_id: "user123",
 * //   insert_id: "<generated>",
 * //   properties: { plan: "premium" },
 * // }
 * ```
 * @see mixpanel_headless._internal.transforms.transform_event
 */
export function transformEvent(
  event: Readonly<Record<string, unknown>>,
  options?: TransformEventOptions,
): TransformedRecord {
  const properties = dictGet(event, "properties", {});

  // Extract and remove standard fields from properties (shallow copy to
  // avoid mutating the caller's dict).
  const remainingProps = pythonDictCopy(properties);
  const distinctId = dictPop(remainingProps, "distinct_id", "");
  const eventTimeRaw = dictPop(remainingProps, "time", 0);
  let insertId = dictPop(remainingProps, "$insert_id", null);

  // Convert Unix timestamp to a datetime (iso text, see module header).
  const eventTime = fromTimestampUtcIso(timestampNumber(eventTimeRaw));

  // Generate UUID if $insert_id is missing (Python tests `is None`, so
  // an explicit null takes this branch too).
  if (insertId === null) {
    insertId = (options?.uuid ?? defaultUuid)();
  }

  return {
    event_name: dictGet(event, "event", ""),
    event_time: eventTime,
    distinct_id: distinctId,
    insert_id: insertId,
    properties: remainingProps,
  };
}

/**
 * The library's default `$insert_id` generator.
 *
 * @returns A fresh RFC 4122 v4 UUID string.
 */
function defaultUuid(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * Transform an engage-API profile to the normalized record shape.
 *
 * @remarks
 * Extracts the standard Mixpanel fields (`$distinct_id`, `$last_seen`)
 * from the profile and promotes them to top-level fields. Pure — no
 * seams.
 * @param profile - Raw profile from the Mixpanel Engage API with
 *   `$distinct_id` and `$properties` keys.
 * @returns Transformed profile dict with `distinct_id`, `last_seen` and
 *   `properties` keys.
 * @throws {@link TypeError} - When `$properties` is present but not a
 *   dict.
 * @example
 * ```ts
 * transformProfile({
 *   $distinct_id: "user123",
 *   $properties: { $last_seen: "2024-01-15T10:30:00", plan: "premium" },
 * });
 * // { distinct_id: "user123", last_seen: "2024-01-15T10:30:00",
 * //   properties: { plan: "premium" } }
 * ```
 * @see mixpanel_headless._internal.transforms.transform_profile
 */
export function transformProfile(
  profile: Readonly<Record<string, unknown>>,
): TransformedRecord {
  const distinctId = dictGet(profile, "$distinct_id", "");
  const properties = dictGet(profile, "$properties", {});

  // Extract and remove $last_seen from properties (shallow copy to
  // avoid mutating the caller's dict).
  const remainingProps = pythonDictCopy(properties);
  const lastSeen = dictPop(remainingProps, "$last_seen", null);

  return {
    distinct_id: distinctId,
    last_seen: lastSeen,
    properties: remainingProps,
  };
}
