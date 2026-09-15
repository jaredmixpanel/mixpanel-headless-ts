/**
 * Byte-buffered JSONL line splitter — TS port of `_iter_jsonl_lines`
 * (`mixpanel_headless/_internal/api_client.py:109-148`) — Phase-3 packet
 * B0-2, R10.8/R2.6.
 *
 * Python iterates `response.iter_bytes()` — httpx yields DECODED
 * (decompressed) bytes, so gzip handling lives in the transport, not
 * here; the TS twin consumes any decoded byte source (`fetch` bodies are
 * runtime-decompressed the same way). Chunk boundaries are the contract:
 * lines split anywhere — including mid-UTF-8-codepoint — reassemble
 * byte-first, then decode.
 *
 * Decoding matches Python `bytes.decode("utf-8", errors="replace")` via
 * `TextDecoder`'s non-fatal default (the packet's sanctioned mapping);
 * stripping uses `pythonStrip` (CPython `str.strip()` whitespace set ≠
 * JS `trim`, R11.3 enabling dependency).
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
 * // NOTE for B4-C2 (GATE-VERDICT R5): library streaming code parses
 * // each line via parseLossless, never bare JSON.parse — the JSON.parse
 * // here only mirrors the Python docstring's json.loads illustration.
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
  // decoders EAT a leading U+FEFF by default, while Python's "utf-8"
  // codec never does (only "utf-8-sig" strips BOMs) — and U+FEFF is not
  // in Python's str.strip() whitespace set either, so a BOM-only line is
  // yielded, not skipped (divergence found live by the B0-2 R10.9 fuzz:
  // repro 2026-08-15-api_client-_iter_jsonl_lines).
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
