// Layer-3 translation — tests/unit/test_api_client_pbt.py → fast-check
// (Phase-3 packet B4-C1; same strategy shapes). Classes:
//
// - ::TestAuthHeaderProperties (:98) — through the real client's
//   per-request auth path (C1).
// - ::TestBackoffProperties (:206), ::TestUrlBuildProperties (:336),
//   ::TestIterJsonlLinesProperties (:537) — these lock B0-owned modules
//   (`backoff.ts`, `url.ts`, `jsonl.ts`) but were NOT translated at B0
//   (packet C1 §Layer-3: "translate them HERE against the B0 modules").
// - ::TestActivityFeedDateRange (:673) → B4-C2 (header exclusion; the
//   date-range builder is C2 source range).
//
// Strategy-shape notes: Hypothesis `st.characters(categories=...)`
// alphabets translate to explicit alphabets carrying non-ASCII members
// of the same categories (incl. the non-BMP 𝒳, code-point-safe
// indexing) — the B2 arbiter M1-PBT precedent; Python `.strip()`
// filters translate via `pythonStrip` (R11.7).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  BACKOFF_MAX_SECONDS,
  calculateBackoff,
} from "../../src/client/backoff.js";
import { iterJsonlLines } from "../../src/client/jsonl.js";
import {
  buildUrl,
  type EndpointKind,
  type Region,
} from "../../src/client/url.js";
import { pythonStrip } from "../../src/compat/index.js";
import { createMixpanelClient } from "../../src/client/client.js";
import { makeSession } from "../../test-support/client-test-helpers.js";

/** Decode a base64 payload to UTF-8 text (the tests' b64decode+decode). */
function decodeBase64Utf8(encoded: string): string {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

/** Header-safe text: no NUL, no lone surrogates (`unit: "binary"` is
 * code-point based), non-blank after Python strip — the `usernames` /
 * `secrets` strategy shape (:45-64). */
const credentialText = fc
  .string({ unit: "binary", minLength: 1, maxLength: 100 })
  .filter((s) => !s.includes("\x00"))
  .filter((s) => pythonStrip(s) !== "");

const regionArb = fc.constantFrom<Region>("us", "eu", "in");
const apiTypeArb = fc.constantFrom<EndpointKind>(
  "query",
  "export",
  "engage",
  "app",
);

describe("TestAuthHeaderProperties", () => {
  it("test_auth_header_roundtrip", async () => {
    await fc.assert(
      fc.asyncProperty(
        credentialText,
        credentialText,
        regionArb,
        async (username, secret, region) => {
          const client = createMixpanelClient({
            session: makeSession({
              username,
              secret,
              projectId: "12345",
              region,
            }),
          });
          try {
            const header = await client.currentAuthHeader();
            // Header should have correct format.
            expect(header.startsWith("Basic ")).toBe(true);
            // Decode and verify roundtrip.
            const decoded = decodeBase64Utf8(header.replace("Basic ", ""));
            expect(decoded).toBe(`${username}:${secret}`);
          } finally {
            await client.close();
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  it("test_auth_header_handles_colons_in_username", async () => {
    const prefix = fc
      .string({ unit: "binary", minLength: 1, maxLength: 20 })
      .filter((s) => !s.includes("\x00"))
      .filter((s) => pythonStrip(s) !== "");
    const suffix = fc
      .string({ unit: "binary", maxLength: 20 })
      .filter((s) => !s.includes("\x00"));
    await fc.assert(
      fc.asyncProperty(
        prefix,
        suffix,
        credentialText,
        regionArb,
        async (p, s, secret, region) => {
          // Build username with guaranteed colon.
          const username = `${p}:${s}`;
          const client = createMixpanelClient({
            session: makeSession({
              username,
              secret,
              projectId: "12345",
              region,
            }),
          });
          try {
            const header = await client.currentAuthHeader();
            const decoded = decodeBase64Utf8(header.replace("Basic ", ""));
            // Exactly username:secret even if username contains colons.
            expect(decoded).toBe(`${username}:${secret}`);
          } finally {
            await client.close();
          }
        },
      ),
      { numRuns: 30 },
    );
  });
});

describe("TestBackoffProperties", () => {
  it("test_backoff_within_bounds", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 20 }), (attempt) => {
        const delay = calculateBackoff(attempt, Math.random);
        const expectedBase = Math.min(1.0 * 2 ** attempt, 60.0);
        const maxJitter = expectedBase * 0.1;
        // Delay should be at least the base (no negative jitter).
        expect(delay).toBeGreaterThanOrEqual(expectedBase);
        // Delay should not exceed base + max jitter.
        expect(delay).toBeLessThanOrEqual(expectedBase + maxJitter);
        // Absolute maximum is 66 seconds (60 * 1.1).
        expect(delay).toBeLessThanOrEqual(66.0);
      }),
      { numRuns: 100 },
    );
  });

  it("test_backoff_caps_at_60_seconds_base", () => {
    fc.assert(
      fc.property(fc.integer({ min: 10, max: 100 }), (attempt) => {
        const delay = calculateBackoff(attempt, Math.random);
        expect(delay).toBeGreaterThanOrEqual(60.0);
        expect(delay).toBeLessThanOrEqual(66.0);
      }),
      { numRuns: 30 },
    );
  });

  it("test_backoff_monotonically_increasing_base", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 5 }),
        fc.integer({ min: 0, max: 5 }),
        (attempt1, attempt2) => {
          fc.pre(attempt1 < attempt2);
          const base1 = Math.min(1.0 * 2 ** attempt1, BACKOFF_MAX_SECONDS);
          const base2 = Math.min(1.0 * 2 ** attempt2, BACKOFF_MAX_SECONDS);
          // Base should be monotonically non-decreasing.
          expect(base1).toBeLessThanOrEqual(base2);
        },
      ),
      { numRuns: 50 },
    );
  });
});

// `url_paths` alphabet (:80-87): categories L/N plus "/-_." — mirrored
// with non-ASCII L/N members (é Ω ٤ ㅎ) and the non-BMP 𝒳 (category L),
// drawn per CODE POINT so surrogate halves never split.
const URL_PATH_ALPHABET = [
  ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
  ..."éΩ٤ㅎ",
  "𝒳",
  ..."/-_.",
];

const urlPathArb = fc
  .array(fc.constantFrom(...URL_PATH_ALPHABET), {
    minLength: 1,
    maxLength: 100,
  })
  .map((chars) => chars.join(""));

/** Python `path.lstrip("/")` — strips ALL leading slashes. */
function lstripSlashes(path: string): string {
  return path.replace(/^\/+/, "");
}

describe("TestUrlBuildProperties", () => {
  it("test_url_path_normalization_idempotent", () => {
    fc.assert(
      fc.property(
        apiTypeArb,
        urlPathArb,
        regionArb,
        (apiType, path, region) => {
          const withSlash = `/${lstripSlashes(path)}`;
          const withoutSlash = lstripSlashes(path);
          expect(buildUrl(region, apiType, withSlash)).toBe(
            buildUrl(region, apiType, withoutSlash),
          );
        },
      ),
      { numRuns: 50 },
    );
  });

  it("test_url_contains_path", () => {
    fc.assert(
      fc.property(
        apiTypeArb,
        urlPathArb,
        regionArb,
        (apiType, path, region) => {
          const url = buildUrl(region, apiType, path);
          const normalized = `/${lstripSlashes(path)}`;
          expect(url.includes(normalized)).toBe(true);
        },
      ),
      { numRuns: 30 },
    );
  });

  it("test_url_starts_with_https", () => {
    fc.assert(
      fc.property(
        apiTypeArb,
        urlPathArb,
        regionArb,
        (apiType, path, region) => {
          expect(buildUrl(region, apiType, path).startsWith("https://")).toBe(
            true,
          );
        },
      ),
      { numRuns: 30 },
    );
  });
});

// ---------------------------------------------------------------------------
// TestIterJsonlLinesProperties — chunk-boundary invariance of the B0
// jsonl splitter (the core bug the Python module fixed).
// ---------------------------------------------------------------------------

/** `json_line_content` alphabet (:514-528): L/N/P/S categories plus
 * '{}[]":, ', minus newlines — mirrored with non-ASCII members (§ ± 𝒳)
 * per the strategy-shape rule. */
const LINE_ALPHABET = [
  ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
  ..."!#$%&'()*+-./;<=>?@\\^_`|~",
  ..."§±éΩ",
  "𝒳",
  ...'{}[]":, ',
];

const jsonLineContent = fc
  .array(fc.constantFrom(...LINE_ALPHABET), { minLength: 1, maxLength: 100 })
  .map((chars) => pythonStrip(chars.join("")))
  .filter((s) => s !== "");

const jsonlDocuments = fc.array(jsonLineContent, {
  minLength: 1,
  maxLength: 10,
});

const chunkPositions = fc.array(fc.integer({ min: 0, max: 1000 }), {
  maxLength: 20,
});

/** `_split_bytes_at_positions` (:469-491). */
function splitBytesAtPositions(
  data: Uint8Array,
  positions: readonly number[],
): Uint8Array[] {
  const valid = [
    ...new Set(positions.filter((p) => p > 0 && p < data.length)),
  ].sort((a, b) => a - b);
  const boundaries = [0, ...valid, data.length];
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < boundaries.length - 1; i += 1) {
    const chunk = data.slice(boundaries[i], boundaries[i + 1]);
    if (chunk.length > 0) {
      chunks.push(chunk);
    }
  }
  if (chunks.length > 0) {
    return chunks;
  }
  return data.length > 0 ? [data] : [new Uint8Array(0)];
}

/** `_collect_lines_from_chunks` (:494-511) over the B0 splitter. */
async function collectLinesFromChunks(
  chunks: readonly Uint8Array[],
): Promise<string[]> {
  const source = (async function* (): AsyncIterable<Uint8Array> {
    for (const chunk of chunks) {
      yield chunk;
    }
  })();
  const lines: string[] = [];
  for await (const line of iterJsonlLines(source)) {
    lines.push(line);
  }
  return lines;
}

describe("TestIterJsonlLinesProperties", () => {
  it("test_chunk_invariance", async () => {
    await fc.assert(
      fc.asyncProperty(
        jsonlDocuments,
        chunkPositions,
        async (lines, splitPositions) => {
          const content = `${lines.join("\n")}\n`;
          const contentBytes = new TextEncoder().encode(content);
          const referenceLines = await collectLinesFromChunks([contentBytes]);
          const chunks = splitBytesAtPositions(contentBytes, splitPositions);
          const chunkedLines = await collectLinesFromChunks(chunks);
          // Output should be identical regardless of chunking.
          expect(chunkedLines).toEqual(referenceLines);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("test_content_preservation", async () => {
    await fc.assert(
      fc.asyncProperty(jsonlDocuments, async (lines) => {
        const content = `${lines.join("\n")}\n`;
        const contentBytes = new TextEncoder().encode(content);
        const outputLines = await collectLinesFromChunks([contentBytes]);
        // All input lines should appear in output.
        expect(outputLines).toEqual(lines);
      }),
      { numRuns: 50 },
    );
  });

  it("test_never_raises_on_arbitrary_bytes", async () => {
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ maxLength: 500 }), async (data) => {
        // Should not raise any exception (errors='replace' decoding).
        const result = await collectLinesFromChunks([data]);
        expect(Array.isArray(result)).toBe(true);
        for (const line of result) {
          expect(typeof line).toBe("string");
        }
      }),
      { numRuns: 50 },
    );
  });

  it("test_byte_by_byte_chunking", async () => {
    await fc.assert(
      fc.asyncProperty(jsonlDocuments, async (lines) => {
        const content = `${lines.join("\n")}\n`;
        const contentBytes = new TextEncoder().encode(content);
        // Byte-by-byte creates many chunks; keep content bounded.
        fc.pre(contentBytes.length <= 200);
        const byteChunks = [...contentBytes].map(
          (byte) => new Uint8Array([byte]),
        );
        const outputLines = await collectLinesFromChunks(byteChunks);
        expect(outputLines).toEqual(lines);
      }),
      { numRuns: 30 },
    );
  });
});
