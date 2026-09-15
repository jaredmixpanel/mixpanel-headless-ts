/**
 * Python `urllib.parse.parse_qs` twin with its default flags
 * (`keep_blank_values=False`, `strict_parsing=False`, separator `&`),
 * shared by the Node callback server's query parse and the
 * redirect/paste parser — the one query parser in the auth surface.
 * `URLSearchParams` is deliberately not used: its component decoding
 * follows the WHATWG urlencoded serializer, whose replacement-character
 * rules differ from CPython `unquote(errors="replace")` on some
 * malformed inputs, and it cannot express `parse_qs`'s blank-value
 * dropping.
 *
 * @see mixpanel_headless._internal.auth.callback_server
 */

/**
 * CPython `urllib.parse.unquote` twin (string variant,
 * `errors="replace"`): percent-decodes `%XX` runs as UTF-8 byte
 * sequences, leaves malformed escapes (`%zz`, trailing `%`) literal.
 *
 * WHATWG `TextDecoder` (non-fatal) and CPython `errors="replace"` can
 * emit different U+FFFD counts for some malformed multi-byte runs —
 * out of contract (garbage-in inputs only; nothing in the corpus or
 * the Python suite observes the difference).
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
 * on `&`, `+` decoded as space, values percent-decoded, blank values
 * and `=`-less fields dropped, repeated names collected in order.
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
