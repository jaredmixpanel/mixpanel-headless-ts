// Streaming JSONL splitter unit tests — Phase-3 packet B0-2
// (`_iter_jsonl_lines`, api_client.py:109-148).
//
// Translation sources (header corrected per arbiter fix A1,
// b0-review-resolution): tests/unit/test_api_client.py::TestIterJsonlLines
// (:2709-2877, 8 tests driving `_iter_jsonl_lines` directly — every
// behavior is covered below: simple lines → "handles many lines within
// one chunk"; no-trailing-newline / blank-lines-skipped / chunk-boundary /
// mid-codepoint-split / empty-response / whitespace-only-skipped map to
// the authored-* and named cases; utf8_content is subsumed by the
// strictly-harder split-😀 case), PLUS the 6 authored chunk vectors in
// conformance/vectors/authored/streaming/jsonl-chunks.jsonl (design
// D2/D4.2 item 9), mirrored 1:1. Gzip decoding is the transport's job
// (httpx decodes before `iter_bytes()`; the conformance binding
// decompresses before calling in) — so the gzip authored vector is
// locked by vector replay, not re-tested here.
import { describe, expect, it } from "vitest";
import { iterJsonlLines } from "../../src/client/jsonl.js";

const encoder = new TextEncoder();

/**
 * Build an async chunk source from string/byte fragments.
 *
 * @param chunks - Chunks in arrival order (strings are UTF-8 encoded).
 * @returns An async iterable yielding each chunk once.
 */
async function* chunkSource(
  chunks: readonly (string | Uint8Array)[],
): AsyncIterable<Uint8Array> {
  for (const chunk of chunks) {
    yield typeof chunk === "string" ? encoder.encode(chunk) : chunk;
  }
}

/**
 * Collect every yielded line.
 *
 * @param chunks - Chunks in arrival order.
 * @returns The reassembled lines.
 */
async function lines(
  chunks: readonly (string | Uint8Array)[],
): Promise<string[]> {
  const out: string[] = [];
  for await (const line of iterJsonlLines(chunkSource(chunks))) {
    out.push(line);
  }
  return out;
}

describe("iterJsonlLines", () => {
  it("authored-blank-lines-skipped", async () => {
    // b"\n\n{"a": 1}\n \n{"b": 2}\n" — blank and whitespace-only lines skip.
    expect(await lines(['\n\n{"a": 1}\n \n{"b": 2}\n'])).toEqual([
      '{"a": 1}',
      '{"b": 2}',
    ]);
  });

  it("authored-crlf-line-endings", async () => {
    // CRLF: split on \n, the \r strips (Python str.strip()).
    expect(await lines(['{"a": 1}\r\n{"b": 2}\r\n'])).toEqual([
      '{"a": 1}',
      '{"b": 2}',
    ]);
  });

  it("authored-final-line-without-newline", async () => {
    expect(await lines(['{"a": 1}\n{"b": 2}'])).toEqual([
      '{"a": 1}',
      '{"b": 2}',
    ]);
  });

  it("authored-line-split-across-chunks", async () => {
    expect(await lines(['{"a": 1}\n{"b', '": 2}\n'])).toEqual([
      '{"a": 1}',
      '{"b": 2}',
    ]);
  });

  it("authored-multibyte-char-split-mid-codepoint", async () => {
    // The 😀 UTF-8 sequence (f0 9f 98 80) splits across chunks; byte
    // buffering must reassemble it before decoding.
    const whole = encoder.encode('{"emoji": "😀"}\n');
    expect(await lines([whole.slice(0, 12), whole.slice(12)])).toEqual([
      '{"emoji": "😀"}',
    ]);
  });

  it("yields nothing for an empty stream", async () => {
    expect(await lines([])).toEqual([]);
    expect(await lines([""])).toEqual([]);
  });

  it("strips with the PYTHON whitespace set (\\x1c-\\x1f are stripped)", async () => {
    // Python str.strip() strips \x1c-\x1f; JS String#trim does not
    // (pythonStrip, R11.3/B0-1 item 4). A line that is ONLY \x1c skips.
    expect(await lines(["\x1c\n", "a\x1c\n"])).toEqual(["a"]);
  });

  it("yields a BOM-only line verbatim (Python utf-8 codec keeps U+FEFF)", async () => {
    // WHATWG decoders strip a leading BOM by default; Python's "utf-8"
    // codec never does, and U+FEFF is NOT Python str.strip() whitespace —
    // locked by the B0-2 R10.9 fuzz repro
    // (2026-08-15-api_client-_iter_jsonl_lines: b"\xef\xbb\xbf\n" yields
    // ["\ufeff"], never []).
    expect(await lines([new Uint8Array([0xef, 0xbb, 0xbf, 0x0a])])).toEqual([
      "\ufeff",
    ]);
  });

  it("decodes invalid UTF-8 with replacement, never throwing", async () => {
    // errors="replace" semantics (TextDecoder non-fatal — the packet's
    // sanctioned mapping).
    const bad = new Uint8Array([0x61, 0xff, 0x62, 0x0a]);
    expect(await lines([bad])).toEqual(["a�b"]);
  });

  it("handles many lines within one chunk and one line over many chunks", async () => {
    expect(await lines(["a\nb\nc\n"])).toEqual(["a", "b", "c"]);
    expect(await lines(["a", "b", "c"])).toEqual(["abc"]);
  });

  it("R10.9 edge lines survive verbatim (non-BMP, floats, True/None)", async () => {
    expect(await lines(['{"x": 18.0}\n{"y": 1.5}\n𝒳\nTrue\nNone\n'])).toEqual([
      '{"x": 18.0}',
      '{"y": 1.5}',
      "𝒳",
      "True",
      "None",
    ]);
  });
});
