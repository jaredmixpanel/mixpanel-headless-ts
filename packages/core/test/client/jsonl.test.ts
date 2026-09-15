// The streaming JSONL splitter `iterJsonlLines` (chunk boundaries, blank
// lines, CRLF, mid-codepoint splits, Python whitespace/BOM semantics).
// Mirrors TestIterJsonlLines from tests/unit/test_api_client.py plus the
// authored chunk vectors in conformance/vectors/authored/streaming/jsonl-chunks.jsonl.
// Gzip decoding is the transport's job, so that vector is left to corpus replay.
import { describe, expect, it } from "vitest";

import { iterJsonlLines } from "../../src/client/jsonl.js";
import { asyncIterableOf } from "../../test-support/client-test-helpers.js";

const encoder = new TextEncoder();

/**
 * Build an async chunk source from string/byte fragments.
 *
 * @param chunks - Chunks in arrival order (strings are UTF-8 encoded).
 * @returns An async iterable yielding each chunk once.
 */
function chunkSource(
  chunks: ReadonlyArray<string | Uint8Array>,
): AsyncIterable<Uint8Array> {
  return asyncIterableOf(
    chunks.map((chunk) =>
      typeof chunk === "string" ? encoder.encode(chunk) : chunk,
    ),
  );
}

/**
 * Collect every yielded line.
 *
 * @param chunks - Chunks in arrival order.
 * @returns The reassembled lines.
 */
async function lines(
  chunks: ReadonlyArray<string | Uint8Array>,
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
    await expect(lines(['\n\n{"a": 1}\n \n{"b": 2}\n'])).resolves.toStrictEqual(
      ['{"a": 1}', '{"b": 2}'],
    );
  });

  it("authored-crlf-line-endings", async () => {
    // CRLF: split on \n, the \r strips (Python str.strip()).
    await expect(lines(['{"a": 1}\r\n{"b": 2}\r\n'])).resolves.toStrictEqual([
      '{"a": 1}',
      '{"b": 2}',
    ]);
  });

  it("authored-final-line-without-newline", async () => {
    await expect(lines(['{"a": 1}\n{"b": 2}'])).resolves.toStrictEqual([
      '{"a": 1}',
      '{"b": 2}',
    ]);
  });

  it("authored-line-split-across-chunks", async () => {
    await expect(lines(['{"a": 1}\n{"b', '": 2}\n'])).resolves.toStrictEqual([
      '{"a": 1}',
      '{"b": 2}',
    ]);
  });

  it("authored-multibyte-char-split-mid-codepoint", async () => {
    // The 😀 UTF-8 sequence (f0 9f 98 80) splits across chunks; byte
    // buffering must reassemble it before decoding.
    const whole = encoder.encode('{"emoji": "😀"}\n');
    await expect(
      lines([whole.slice(0, 12), whole.slice(12)]),
    ).resolves.toStrictEqual(['{"emoji": "😀"}']);
  });

  it("yields nothing for an empty stream", async () => {
    await expect(lines([])).resolves.toStrictEqual([]);
    await expect(lines([""])).resolves.toStrictEqual([]);
  });

  it("strips with the PYTHON whitespace set (U+001C–U+001F are stripped)", async () => {
    // Python str.strip() strips \x1c-\x1f; JS String#trim does not
    // (hence pythonStrip). A line that is ONLY \x1c skips.
    await expect(lines(["\x1C\n", "a\x1C\n"])).resolves.toStrictEqual(["a"]);
  });

  it("yields a BOM-only line verbatim (Python utf-8 codec keeps U+FEFF)", async () => {
    // WHATWG decoders strip a leading BOM by default; Python's "utf-8"
    // codec never does, and U+FEFF is NOT Python str.strip() whitespace —
    // a differential-fuzz repro: the bytes ef bb bf 0a yield one U+FEFF line, never [].
    await expect(
      lines([new Uint8Array([0xef, 0xbb, 0xbf, 0x0a])]),
    ).resolves.toStrictEqual(["\uFEFF"]);
  });

  it("decodes invalid UTF-8 with replacement, never throwing", async () => {
    // errors="replace" semantics (a non-fatal TextDecoder).
    const bad = new Uint8Array([0x61, 0xff, 0x62, 0x0a]);
    await expect(lines([bad])).resolves.toStrictEqual(["a�b"]);
  });

  it("handles many lines within one chunk and one line over many chunks", async () => {
    await expect(lines(["a\nb\nc\n"])).resolves.toStrictEqual(["a", "b", "c"]);
    await expect(lines(["a", "b", "c"])).resolves.toStrictEqual(["abc"]);
  });

  it("fuzz-found edge lines survive verbatim (non-BMP, floats, True/None)", async () => {
    await expect(
      lines(['{"x": 18.0}\n{"y": 1.5}\n𝒳\nTrue\nNone\n']),
    ).resolves.toStrictEqual([
      '{"x": 18.0}',
      '{"y": 1.5}',
      "𝒳",
      "True",
      "None",
    ]);
  });
});
