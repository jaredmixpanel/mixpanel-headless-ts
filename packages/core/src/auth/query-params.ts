/**
 * Python `urllib.parse.parse_qs` twin (default flags:
 * `keep_blank_values=False`, `strict_parsing=False`, separator `&`) —
 * shared by the callback server's `do_GET` query parse
 * (`callback_server.py`) and the redirect/paste parser
 * (`flow.py`). One canonical helper (watchlist #13 discipline for
 * query parsing — a second local parser is a per-se finding).
 *
 * B9-R2 HOME NOTE (b9-packets.md §3.1 row 2): moved MECHANICALLY from
 * `packages/node/src/auth/query-params.ts` to core (the fetch-pure
 * hoist — this module was already `node:*`-free); node re-exports from
 * here and its B8 suites stay green unchanged.
 *
 * `URLSearchParams` is NOT used: its component decoding follows the
 * WHATWG urlencoded serializer (throw-free but replacement-char rules
 * differ from CPython `unquote(errors="replace")` on some malformed
 * inputs), and it cannot express parse_qs's blank-value dropping.
 */

/**
 * CPython `urllib.parse.unquote` twin (string variant,
 * `errors="replace"`): percent-decodes `%XX` runs as UTF-8 byte
 * sequences, leaves malformed escapes (`%zz`, trailing `%`) literal.
 *
 * Boundary note: WHATWG `TextDecoder` (non-fatal) and CPython
 * `errors="replace"` can emit different U+FFFD counts for some
 * malformed multi-byte runs — out of contract (garbage-in inputs
 * only; no vector or Layer-3 lock observes the difference).
 *
 * @param text - The percent-encoded text.
 * @returns The decoded text.
 */
export function pythonUnquote(text: string): string {
  if (!text.includes("%")) {
    return text;
  }
  const parts = text.split("%");
  let result = parts[0] ?? "";
  let pending: number[] = [];
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const flush = (): void => {
    if (pending.length === 0) {
      return;
    }

    result += decoder.decode(Uint8Array.from(pending));
    pending = [];
  };
  for (let i = 1; i < parts.length; i += 1) {
    const part = parts[i] ?? "";
    const hex = part.slice(0, 2);
    if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
      pending.push(Number.parseInt(hex, 16));
      const rest = part.slice(2);
      if (rest !== "") {
        flush();
        result += rest;
      }
    } else {
      flush();
      result += `%${part}`;
    }
  }
  flush();
  return result;
}

/**
 * Parse a query string with `parse_qs` default semantics: fields split
 * on `&`, `+` decoded as space, values percent-decoded, BLANK values
 * and `=`-less fields DROPPED, repeated names collected in order.
 *
 * @param query - The raw query-string text (no leading `?`).
 * @returns Name → ordered value list (only non-empty lists appear).
 * @example
 * ```typescript
 * parseQs("code=ABC&state=XYZ");
 * // Map { "code" => ["ABC"], "state" => ["XYZ"] }
 * ```
 */
export function parseQs(query: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const field of query.split("&")) {
    if (field === "") {
      continue;
    }
    const eq = field.indexOf("=");
    if (eq === -1) {
      // No `=`: dropped (keep_blank_values=False).
      continue;
    }
    const rawValue = field.slice(eq + 1);
    if (rawValue === "") {
      // Blank value: dropped (keep_blank_values=False).
      continue;
    }
    const name = pythonUnquote(field.slice(0, eq).replaceAll("+", " "));
    const value = pythonUnquote(rawValue.replaceAll("+", " "));
    const existing = out.get(name);
    if (existing === undefined) {
      out.set(name, [value]);
    } else {
      existing.push(value);
    }
  }
  return out;
}
