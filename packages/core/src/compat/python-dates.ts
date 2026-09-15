/**
 * Calendar helpers shared by the query builders — the parts of Python's
 * `datetime.date` the port reaches for without a full date model.
 */

/**
 * Proleptic-Gregorian leap-year rule (`calendar.isleap`).
 *
 * @param year - The year.
 * @returns Whether the year is a leap year.
 * @example
 * ```ts
 * isLeapYear(2024); // true
 * isLeapYear(1900); // false — divisible by 100 but not by 400
 * ```
 */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * `date.today().isoformat()` — today's local calendar date as
 * `YYYY-MM-DD`, the default of every `today` clock seam. The clock is
 * read and rendered here; no date string is ever parsed through `Date`.
 *
 * @returns Today's date as `YYYY-MM-DD`.
 * @example
 * ```ts
 * dateTodayIso(); // e.g. "2026-09-14" (local calendar date)
 * ```
 */
export function dateTodayIso(): string {
  const now = new Date();
  const year = String(now.getFullYear()).padStart(4, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
