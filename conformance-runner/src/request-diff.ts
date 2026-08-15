/**
 * Request-side diffing for wire vectors (design D7/D12).
 *
 * After the measured call, every captured request is compared against the
 * interaction slot that served it (positional for ordered interactions,
 * keyed within `unordered_group`s — the slot assignment happened at serve
 * time in `vector-fetch.ts`). Extra requests, unserved interactions, and
 * per-field mismatches all yield divergence strings; any divergence is the
 * `FAIL_REQUEST` verdict.
 *
 * Field semantics (vector.schema.json `expectedRequest` + D5/D6):
 * - `method`/`path`: exact equality.
 * - `scheme_host`: asserted only when recorded (D9 S4 observability).
 * - `params`: full canonical equality of the decoded query-param maps; an
 *   omitted recorded `params` means the captured request must carry none.
 * - `params_absent` / `headers_absent`: the listed keys must be absent.
 * - `headers_contain`: subset match via {@link headersMatch} (lowercased
 *   keys, `{pattern}` regex values for authorization, D5.2/D5.6).
 * - body: exactly one of `json_body` (canonical comparison after LOSSLESS
 *   parsing of the captured bytes — raw-token rule, D6 rule 3),
 *   `body_text` (utf8 equality), `body_base64` (byte equality); when all
 *   are absent the captured body must be empty.
 */

import { canonicalize, headersMatch } from "./canonical.js";
import type { ParsedInteraction } from "./interactions.js";
import type { JsonValue } from "./json-value.js";
import { parseLossless } from "./lossless-json.js";
import type { CapturedRequest } from "./vector-fetch.js";
import { paramsToJson } from "./vector-fetch.js";

/**
 * Encode bytes as base64 text (local helper; mirror of the codec's).
 *
 * @param bytes - The raw bytes.
 * @returns Base64 text.
 */
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/**
 * Diff one captured request against its serving interaction slot.
 *
 * @param captured - The captured request.
 * @param slot - The interaction that served it.
 * @param label - Human-readable slot label for messages.
 * @returns Divergence strings (empty when the request matches).
 */
function diffOneRequest(
  captured: CapturedRequest,
  slot: ParsedInteraction,
  label: string,
): string[] {
  const problems: string[] = [];
  const expected = slot.request;
  if (captured.method !== expected.method) {
    problems.push(
      `${label}: method ${captured.method} != recorded ${expected.method}`,
    );
  }
  if (captured.path !== expected.path) {
    problems.push(
      `${label}: path ${captured.path} != recorded ${expected.path}`,
    );
  }
  if (
    expected.schemeHost !== undefined &&
    captured.schemeHost !== expected.schemeHost
  ) {
    problems.push(
      `${label}: scheme_host ${captured.schemeHost} != recorded ${expected.schemeHost}`,
    );
  }
  const actualParams = paramsToJson(captured.params);
  const recordedParams: JsonValue =
    expected.params !== undefined && Object.keys(expected.params).length > 0
      ? (expected.params as JsonValue)
      : null;
  const actualParamsCanonical = canonicalize(actualParams);
  if (actualParamsCanonical !== canonicalize(recordedParams)) {
    problems.push(
      `${label}: params ${actualParamsCanonical} != recorded ${canonicalize(recordedParams)}`,
    );
  }
  for (const key of expected.paramsAbsent) {
    if (Object.hasOwn(captured.params, key)) {
      problems.push(
        `${label}: param ${JSON.stringify(key)} present but recorded params_absent`,
      );
    }
  }
  if (expected.headersContain !== undefined) {
    const mutableHeaders: { [key: string]: string } = { ...captured.headers };
    for (const [name, value] of Object.entries(expected.headersContain)) {
      if (!headersMatch({ [name]: value }, mutableHeaders)) {
        problems.push(
          `${label}: header ${JSON.stringify(name)} missing or mismatched ` +
            `(got ${JSON.stringify(captured.headers[name.toLowerCase()] ?? null)})`,
        );
      }
    }
  }
  for (const name of expected.headersAbsent) {
    if (Object.hasOwn(captured.headers, name.toLowerCase())) {
      problems.push(
        `${label}: header ${JSON.stringify(name)} present but recorded headers_absent`,
      );
    }
  }
  problems.push(...diffBody(captured, slot, label));
  return problems;
}

/**
 * Diff the captured body against the recorded body field (schema-exclusive
 * `json_body` / `body_text` / `body_base64` / none).
 *
 * @param captured - The captured request.
 * @param slot - The serving interaction.
 * @param label - Slot label for messages.
 * @returns Divergence strings (empty when the body matches).
 */
function diffBody(
  captured: CapturedRequest,
  slot: ParsedInteraction,
  label: string,
): string[] {
  const expected = slot.request;
  if (expected.hasJsonBody) {
    let actualBody: JsonValue;
    try {
      actualBody = parseLossless(new TextDecoder().decode(captured.bodyBytes));
    } catch (cause) {
      return [`${label}: body is not valid JSON (${String(cause)})`];
    }
    const actualCanonical = canonicalize(actualBody);
    const expectedCanonical = canonicalize(expected.jsonBody ?? null);
    if (actualCanonical !== expectedCanonical) {
      return [
        `${label}: json_body ${actualCanonical} != recorded ${expectedCanonical}`,
      ];
    }
    return [];
  }
  if (expected.bodyText !== undefined) {
    const actualText = new TextDecoder().decode(captured.bodyBytes);
    if (actualText !== expected.bodyText) {
      return [
        `${label}: body_text ${JSON.stringify(actualText)} != recorded ${JSON.stringify(expected.bodyText)}`,
      ];
    }
    return [];
  }
  if (expected.bodyBase64 !== undefined) {
    const actualBase64 = toBase64(captured.bodyBytes);
    if (actualBase64 !== expected.bodyBase64) {
      return [`${label}: binary body differs from recorded body_base64`];
    }
    return [];
  }
  if (captured.bodyBytes.length > 0) {
    return [
      `${label}: request carried a ${String(captured.bodyBytes.length)}-byte body but the record has none`,
    ];
  }
  return [];
}

/**
 * Diff the full replay traffic of one wire vector (design D7 mirror).
 *
 * @param interactions - The vector's parsed interactions.
 * @param captures - Captured requests, in arrival order.
 * @param servingViolations - Sequence violations from the fetch harness.
 * @param unservedSlots - Interaction indices never requested.
 * @returns All divergence strings; empty means the request side matches.
 *
 * @example
 * ```typescript
 * const problems = diffRequestTraffic(
 *   parsed,
 *   harness.captures,
 *   harness.violations,
 *   harness.unservedSlots(),
 * );
 * // [] on a faithful replay
 * ```
 */
export function diffRequestTraffic(
  interactions: readonly ParsedInteraction[],
  captures: readonly CapturedRequest[],
  servingViolations: readonly string[],
  unservedSlots: readonly number[],
): string[] {
  const problems: string[] = [...servingViolations];
  for (const index of unservedSlots) {
    const slot = interactions[index] as ParsedInteraction;
    problems.push(
      `interaction[${String(index)}] (${slot.request.method} ${slot.request.path}) was never requested`,
    );
  }
  captures.forEach((captured, order) => {
    if (captured.slotIndex === null) {
      return; // Already reported as a serving violation.
    }
    const slot = interactions[captured.slotIndex] as ParsedInteraction;
    problems.push(
      ...diffOneRequest(
        captured,
        slot,
        `request[${String(order)}]→interaction[${String(captured.slotIndex)}]`,
      ),
    );
  });
  return problems;
}
