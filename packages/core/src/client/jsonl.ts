/**
 * Byte-buffered JSONL line splitter for streaming export bodies. Consumes
 * any decoded (already decompressed) byte source — gzip handling belongs
 * to the transport — and reassembles lines split across chunk boundaries
 * byte-first, so a UTF-8 codepoint cut in two still decodes. Decoding
 * matches `bytes.decode("utf-8", errors="replace")` (`TextDecoder`'s
 * non-fatal default); stripping uses the CPython whitespace set
 * (`pythonStrip`), not JS `trim`.
 *
 * @see mixpanel_headless._internal.api_client._iter_jsonl_lines
 */

import { pythonStrip } from "../compat/index.js";

/**
 * Iterate over JSONL lines from a streaming byte source with proper
 * buffering.
 *
 * httpx's `iter_lines()` can incorrectly split lines at chunk
 * boundaries, especially with gzip-compressed responses; like the Python
 * original, this uses manual byte buffering to handle incomplete lines
 * correctly.
 *
 * @param source - Decoded body bytes in arrival order (a `fetch` body
 *   `ReadableStream<Uint8Array>` is an `AsyncIterable<Uint8Array>` on
 *   every supported runtime).
 * @returns Async generator of complete lines, stripped of surrounding
 *   whitespace (Python `str.strip()` set); empty lines are skipped. The
 *   final line is flushed even without a trailing newline.
 * @example
 * ```typescript
 * // Library code parses each line with `parseLossless`; `JSON.parse`
 * // here only mirrors the Python docstring's `json.loads` illustration.
 * for await (const line of iterJsonlLines(response.body)) {
 *   const event = JSON.parse(line);
 * }
 * ```
 */
export async function* iterJsonlLines(
  source: AsyncIterable<Uint8Array>,
): AsyncGenerator<string, void, undefined> {
  // Python uses a bytearray for in-place extension; here a growing
  // Uint8Array with amortized concat keeps the same observable behavior.
  let buffer = new Uint8Array(0);
  // Non-fatal = Python errors="replace". ignoreBOM: true because WHATWG
  // decoders drop a leading U+FEFF by default, while Python's "utf-8"
  // codec never does (only "utf-8-sig" strips BOMs) — and U+FEFF is not
  // in Python's str.strip() whitespace set either, so a BOM-only line is
  // yielded, not skipped.
  const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
  for await (const chunk of source) {
    if (chunk.length > 0) {
      const merged = new Uint8Array(buffer.length + chunk.length);
      merged.set(buffer, 0);
      merged.set(chunk, buffer.length);
      buffer = merged;
    }
    // Extract complete lines from the buffer (split on byte 0x0A).
    for (;;) {
      const newlinePos = buffer.indexOf(0x0a);
      if (newlinePos === -1) {
        break;
      }
      const line = buffer.subarray(0, newlinePos);
      buffer = buffer.slice(newlinePos + 1);
      const lineStr = pythonStrip(decoder.decode(line));
      if (lineStr !== "") {
        yield lineStr;
      }
    }
  }
  // Handle any remaining data (final line without trailing newline).
  if (buffer.length > 0) {
    const lineStr = pythonStrip(decoder.decode(buffer));
    if (lineStr !== "") {
      yield lineStr;
    }
  }
}
