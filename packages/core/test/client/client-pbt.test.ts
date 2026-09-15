// Property tests for the client's auth header round-trip, `calculateBackoff`
// bounds, `buildUrl` path normalisation and `iterJsonlLines` chunk
// invariance. Mirrors tests/unit/test_api_client_pbt.py (fast-check for
// Hypothesis; TestActivityFeedDateRange is in client-queries-pbt.test.ts).
// Hypothesis category alphabets become explicit alphabets with non-ASCII and non-BMP members.

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  BACKOFF_MAX_SECONDS,
  calculateBackoff,
} from "../../src/client/backoff.js";
import { createMixpanelClient } from "../../src/client/client.js";
import { iterJsonlLines } from "../../src/client/jsonl.js";
import {
  buildUrl,
  type EndpointKind,
  type Region,
} from "../../src/client/url.js";
import { codepoints } from "../../src/compat/codepoint.js";
import { pythonStrip } from "../../src/compat/index.js";
import {
  asyncIterableOf,
  makeSession,
} from "../../test-support/client-test-helpers.js";

/** Decode a base64 payload to UTF-8 text (the tests' b64decode+decode). */
function decodeBase64Utf8(encoded: string): string {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

/**
 * Header-safe text: no NUL, no lone surrogates (`unit: "binary"` is
 * code-point based), non-blank after Python strip — the `usernames` /
 * `secrets` strategy shape.
 */
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

describe("Auth header properties", () => {
  // python: TestAuthHeaderProperties
  it("auth header roundtrip", async () => {
    // python: test_auth_header_roundtrip
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

  it("auth header handles colons in username", async () => {
    // python: test_auth_header_handles_colons_in_username
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

describe("Backoff properties", () => {
  // python: TestBackoffProperties
  it("backoff within bounds", () => {
    // python: test_backoff_within_bounds
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

  it("backoff caps at 60 seconds base", () => {
    // python: test_backoff_caps_at_60_seconds_base
    fc.assert(
      fc.property(fc.integer({ min: 10, max: 100 }), (attempt) => {
        const delay = calculateBackoff(attempt, Math.random);
        expect(delay).toBeGreaterThanOrEqual(60.0);
        expect(delay).toBeLessThanOrEqual(66.0);
      }),
      { numRuns: 30 },
    );
  });

  it("backoff monotonically increasing base", () => {
    // python: test_backoff_monotonically_increasing_base
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

// `url_paths` alphabet: categories L/N plus "/-_." — mirrored
// with non-ASCII L/N members (é Ω ٤ ㅎ) and the non-BMP 𝒳 (category L),
// drawn per CODE POINT so surrogate halves never split.
const URL_PATH_ALPHABET = [
  ...codepoints(
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
  ),
  ...codepoints("éΩ٤ㅎ"),
  "𝒳",
  ...codepoints("/-_."),
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

describe("URL build properties", () => {
  // python: TestUrlBuildProperties
  it("URL path normalization idempotent", () => {
    // python: test_url_path_normalization_idempotent
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

  it("URL contains path", () => {
    // python: test_url_contains_path
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

  it("URL starts with HTTPS", () => {
    // python: test_url_starts_with_https
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

// --- Iter JSONL lines properties: chunk-boundary invariance of the splitter ---

/**
 * `json_line_content` alphabet: L/N/P/S categories plus the JSON
 * punctuation `{}[]":,` and space, minus newlines — mirrored with
 * non-ASCII members (§ ± 𝒳).
 */
const LINE_ALPHABET = [
  ...codepoints(
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
  ),
  ...codepoints("!#$%&'()*+-./;<=>?@\\^_`|~"),
  ...codepoints("§±éΩ"),
  "𝒳",
  ...codepoints('{}[]":, '),
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

/** `_split_bytes_at_positions`. */
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

/** `_collect_lines_from_chunks` over `iterJsonlLines`. */
async function collectLinesFromChunks(
  chunks: readonly Uint8Array[],
): Promise<string[]> {
  const source = asyncIterableOf(chunks);
  const lines: string[] = [];
  for await (const line of iterJsonlLines(source)) {
    lines.push(line);
  }
  return lines;
}

describe("Iter JSONL lines properties", () => {
  // python: TestIterJsonlLinesProperties
  it("chunk invariance", async () => {
    // python: test_chunk_invariance
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
          expect(chunkedLines).toStrictEqual(referenceLines);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("content preservation", async () => {
    // python: test_content_preservation
    await fc.assert(
      fc.asyncProperty(jsonlDocuments, async (lines) => {
        const content = `${lines.join("\n")}\n`;
        const contentBytes = new TextEncoder().encode(content);
        const outputLines = await collectLinesFromChunks([contentBytes]);
        // All input lines should appear in output.
        expect(outputLines).toStrictEqual(lines);
      }),
      { numRuns: 50 },
    );
  });

  it("never raises on arbitrary bytes", async () => {
    // python: test_never_raises_on_arbitrary_bytes
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

  it("byte by byte chunking", async () => {
    // python: test_byte_by_byte_chunking
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
        expect(outputLines).toStrictEqual(lines);
      }),
      { numRuns: 30 },
    );
  });
});
