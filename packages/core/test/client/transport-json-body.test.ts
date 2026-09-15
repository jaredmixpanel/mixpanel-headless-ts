// The transport's bigint-aware JSON body serializer (`stringifyJsonBody`)
// and its use by `rawFetch`: the carrier for int64 ids beyond 2^53 that
// `updateLookupTable` / `deleteLookupTables` send in the JSON body.
// TS-only — Python's `json.dumps` spells any int exactly, so there is no
// Python twin.

import { afterEach, describe, expect, it } from "vitest";

import { rawFetch, stringifyJsonBody } from "../../src/client/transport.js";
import { fakeTransport } from "../../test-support/client-test-helpers.js";

const BIG = -8644926364725811123n;

describe("stringifyJsonBody", () => {
  it("emits a bigint member as its exact digit run", () => {
    expect(stringifyJsonBody({ "data-group-id": BIG })).toBe(
      '{"data-group-id":-8644926364725811123}',
    );
    expect(
      stringifyJsonBody({ "data-group-ids": [BIG, 7, 2n ** 63n - 1n] }),
    ).toBe('{"data-group-ids":[-8644926364725811123,7,9223372036854775807]}');
  });

  it("round-trips through a lossless parse with the digits intact", () => {
    const text = stringifyJsonBody({ id: BIG, nested: { ids: [BIG] } });
    expect(text).toContain("-8644926364725811123");
    expect(text).not.toContain("-8644926364725811000");
    expect(text).not.toContain('"-8644926364725811123"');
  });

  it("is byte-identical to JSON.stringify for bodies without a bigint", () => {
    const bodies: unknown[] = [
      { name: "New Dashboard" },
      { "data-group-ids": [1, 2, 3] },
      { a: null, b: [true, false, 1.5, "xé\n"], c: { d: undefined } },
      { when: new Date(0) },
      [],
      "text",
      42,
      null,
    ];
    for (const body of bodies) {
      expect(stringifyJsonBody(body)).toBe(JSON.stringify(body));
    }
  });

  describe("without JSON.rawJSON", () => {
    const descriptor = Object.getOwnPropertyDescriptor(JSON, "rawJSON");
    afterEach(() => {
      if (descriptor !== undefined) {
        Object.defineProperty(JSON, "rawJSON", descriptor);
      }
    });

    it("throws a TypeError naming the missing hook (never a silent rounding)", () => {
      Object.defineProperty(JSON, "rawJSON", {
        value: undefined,
        configurable: true,
        writable: true,
      });
      expect(() => stringifyJsonBody({ id: BIG })).toThrow(TypeError);
      expect(() => stringifyJsonBody({ id: BIG })).toThrow(/JSON\.rawJSON/);
      // Bodies without a bigint are unaffected.
      expect(stringifyJsonBody({ id: 7 })).toBe('{"id":7}');
    });
  });
});

describe("rawFetch JSON bodies", () => {
  it("sends a bigint member as an exact integer token", async () => {
    const transport = fakeTransport(() => ({ status: 200, json: {} }));
    const { release } = await rawFetch(transport.fetch, {
      method: "PATCH",
      url: "https://mixpanel.com/api/app/projects/1/data-definitions/lookup-tables/",
      params: {},
      jsonBody: { name: "Renamed", "data-group-id": BIG },
      formBody: null,
      headers: {},
      timeoutSeconds: 5,
    });
    release();
    expect(transport.captures[0]?.bodyText).toBe(
      '{"name":"Renamed","data-group-id":-8644926364725811123}',
    );
    expect(transport.captures[0]?.headers["content-type"]).toBe(
      "application/json",
    );
  });
});
