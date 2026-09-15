/**
 * Date arithmetic helpers for the B4-C2 query-host methods — twins of
 * the CPython `datetime.strptime(value, "%Y-%m-%d")` /
 * `date.isoformat()` / `timedelta(days=n)` calls the Python client
 * makes (`api_client.py:196-249` activity-feed dates, `:2399-2424`
 * `get_events` date defaulting, `:2954-2967` `query_saved_report`
 * funnel windows).
 *
 * Proleptic-Gregorian civil arithmetic (Hinnant's `civil_from_days` /
 * `days_from_civil`) — the same integer math CPython's `datetime`
 * ordinal conversions perform; valid over the full Python date range
 * (years 1..9999).
 *
 * Clock note (TODO(port) disclosure, R10.3): Python's `date.today()` /
 * `datetime.now()` read the LOCAL calendar; both conformance runners
 * replay under a UTC-frozen clock shim (design D1.4/D12 — the runner's
 * `shims.today()` is documented "UTC, matching the frozen epoch"), so
 * these helpers derive the calendar date from the injected `now()` in
 * UTC. At real runtime a host west/east of UTC can differ from CPython
 * near local midnight — disclosed, out of vector reach.
 */

import { pythonInt } from "../../compat/index.js";
import { isLeapYear } from "../../compat/python-dates.js";

/** A parsed civil date. */
export interface CivilDate {
  /** Year (1..9999 for Python-representable dates). */
  readonly year: number;
  /** Month (1..12). */
  readonly month: number;
  /** Day (1..31, month-valid). */
  readonly day: number;
}

/**
 * `%Y-%m-%d` digit runs, CPython `_strptime` grammar: `\d{1,4}` year,
 * `\d{1,2}` month/day where `\d` is UNICODE `Nd` (Python compiles its
 * strptime regexes without `re.ASCII`); the whole string must match.
 * `\p{Nd}` + `pythonInt` reproduce that exactly (R11.7 — no bare
 * `parseInt`, no ASCII-only `\d`).
 */
const YMD_PATTERN = /^(\p{Nd}{1,4})-(\p{Nd}{1,2})-(\p{Nd}{1,2})$/u;

/** Days per month in a non-leap year (index 1..12). */
const MONTH_DAYS = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * Parse a `%Y-%m-%d` date exactly as `datetime.strptime` accepts it
 * (`"2026-5-1"` parses; `"2026/05/01"`, trailing text, month 13, day 32
 * and year 0 do not).
 *
 * @param value - The candidate date string.
 * @returns The civil date, or `null` when CPython would raise
 *   `ValueError` (callers map that to their own error classes).
 */
export function parseYmd(value: string): CivilDate | null {
  const match = YMD_PATTERN.exec(value);
  if (match === null) {
    return null;
  }
  const year = pythonInt(match[1] as string);
  const month = pythonInt(match[2] as string);
  const day = pythonInt(match[3] as string);
  if (year < 1 || month < 1 || month > 12 || day < 1) {
    return null;
  }
  const cap =
    month === 2 && isLeapYear(year) ? 29 : (MONTH_DAYS[month] as number);
  if (day > cap) {
    return null;
  }
  return { year, month, day };
}

/**
 * Days since 1970-01-01 for a civil date (Hinnant `days_from_civil`).
 *
 * @param date - The civil date.
 * @returns Whole days since the Unix epoch (negative before 1970).
 */
export function daysFromCivil(date: CivilDate): number {
  const y = date.year - (date.month <= 2 ? 1 : 0);
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = date.month > 2 ? date.month - 3 : date.month + 9;
  const doy = Math.floor((153 * mp + 2) / 5) + date.day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/**
 * Civil date from a day count since 1970-01-01 (Hinnant
 * `civil_from_days`).
 *
 * @param days - Whole days since the Unix epoch (may be negative).
 * @returns The civil date.
 */
export function civilFromDays(days: number): CivilDate {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor(
    (doe -
      Math.floor(doe / 1460) +
      Math.floor(doe / 36524) -
      Math.floor(doe / 146096)) /
      365,
  );
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  return { year: month <= 2 ? y + 1 : y, month, day };
}

/**
 * Format a civil date as `date.isoformat()` / `strftime("%Y-%m-%d")`
 * does for in-range dates: zero-padded `YYYY-MM-DD`.
 *
 * @param date - The civil date.
 * @returns The ISO text.
 */
export function formatYmd(date: CivilDate): string {
  const y = String(date.year).padStart(4, "0");
  const m = String(date.month).padStart(2, "0");
  const d = String(date.day).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * The calendar date of an instant, read in UTC (see the module-header
 * clock note) — the `date.today()` / `datetime.now().strftime` seam.
 *
 * @param now - The injected clock's current instant.
 * @returns The civil date.
 */
export function civilFromInstantUtc(now: Date): CivilDate {
  return {
    year: now.getUTCFullYear(),
    month: now.getUTCMonth() + 1,
    day: now.getUTCDate(),
  };
}

/**
 * `civil + timedelta(days=delta)` with the Python range guard.
 *
 * @param date - The starting date.
 * @param delta - Whole days to add (may be negative).
 * @returns The shifted date, or `null` where CPython raises
 *   `OverflowError` (result outside years 1..9999).
 */
export function addDays(date: CivilDate, delta: number): CivilDate | null {
  const shifted = civilFromDays(daysFromCivil(date) + delta);
  if (shifted.year < 1 || shifted.year > 9999) {
    return null;
  }
  return shifted;
}
