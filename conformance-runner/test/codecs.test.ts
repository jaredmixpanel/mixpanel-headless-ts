// Unit tests for the $type codec mirror (src/codecs.ts, design D4.4,
// task TS-4). The table must stay in lockstep with
// conformance/record/codecs.py in the Python repo.
import { describe, expect, it } from "vitest";

import { GroupBy } from "@mixpanel-headless/core";

import { registerContractCodecs } from "../src/bindings.js";
import {
  CodecRegistry,
  encodeExpectValue,
  PyDate,
  PyDatetime,
  RecordingCallback,
  Secret,
  UndecodableValueError,
  UnencodableValueError,
} from "../src/codecs.js";
import { JsonNumber } from "../src/json-value.js";
import { parseLossless } from "../src/lossless-json.js";

describe("CodecRegistry built-in tags (D4.4)", () => {
  const registry = new CodecRegistry();

  it("decodes $type datetime and date to lossless ISO wrappers", () => {
    const dt = registry.decodeValue({
      $type: "datetime",
      iso: "2026-01-15T12:00:00+00:00",
    });
    expect(dt).toBeInstanceOf(PyDatetime);
    expect((dt as PyDatetime).iso).toBe("2026-01-15T12:00:00+00:00");
    const d = registry.decodeValue({ $type: "date", iso: "2026-01-15" });
    expect(d).toBeInstanceOf(PyDate);
    expect((d as PyDate).iso).toBe("2026-01-15");
  });

  it("decodes $type SecretStr to the real core Secret (D5.5, C7/V4)", () => {
    const secret = registry.decodeValue({
      $type: "SecretStr",
      value: "test_secret",
    });
    expect(secret).toBeInstanceOf(Secret);
    // The revealed value survives; every stringification surface masks.
    expect((secret as Secret).reveal()).toBe("test_secret");
    expect(String(secret)).toBe("**********");
  });

  it("round-trips $type bytes through Uint8Array", () => {
    const bytes = registry.decodeValue({
      $type: "bytes",
      encoding: "base64",
      data: "aGVsbG8=",
    });
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect([...(bytes as Uint8Array)]).toStrictEqual([104, 101, 108, 108, 111]);
    expect(encodeExpectValue(bytes)).toStrictEqual({
      $type: "bytes",
      encoding: "base64",
      data: "aGVsbG8=",
    });
  });

  it("rejects unknown bytes encodings and malformed base64", () => {
    expect(() =>
      registry.decodeValue({ $type: "bytes", encoding: "hex", data: "00" }),
    ).toThrow(UndecodableValueError);
    expect(() =>
      registry.decodeValue({ $type: "bytes", encoding: "base64", data: "%%%" }),
    ).toThrow(UndecodableValueError);
  });

  it("decodes $type callback to a recording stub that logs encoded args", () => {
    const stub = registry.decodeValue({ $type: "callback", name: "on_batch" });
    expect(stub).toBeInstanceOf(RecordingCallback);
    const recording = stub as RecordingCallback;
    expect(recording.name).toBe("on_batch");
    recording.fn([{ event: "Login" }], 2);
    expect(recording.calls).toStrictEqual([[[{ event: "Login" }], 2]]);
  });

  it("throws UndecodableValueError on unknown tags (never silent)", () => {
    expect(() => registry.decodeValue({ $type: "Filter", prop: "x" })).toThrow(
      UndecodableValueError,
    );
    expect(() => registry.decodeValue({ $type: "Filter", prop: "x" })).toThrow(
      /Filter/,
    );
  });

  it("passes plain JSON through and recurses containers", () => {
    const decoded = registry.decodeValue(
      parseLossless('{"a": [1, {"b": null}], "c": "x", "d": true}'),
    );
    expect(decoded).toStrictEqual({ a: [1, { b: null }], c: "x", d: true });
  });

  it("decodes number tokens: safe ints/floats to number, unsafe ints to bigint", () => {
    expect(registry.decodeValue(new JsonNumber("18"))).toBe(18);
    expect(registry.decodeValue(new JsonNumber("18.5"))).toBe(18.5);
    expect(registry.decodeValue(new JsonNumber("9007199254740993"))).toBe(
      9007199254740993n,
    );
  });
});

describe("CodecRegistry registration surface", () => {
  it("dispatches registered rich tags with a recursive field decoder", () => {
    const registry = new CodecRegistry();
    registry.register("Filter", (payload, decodeField) => ({
      kind: "Filter",
      prop: decodeField(payload["prop"] ?? null),
    }));
    expect(registry.knows("Filter")).toBe(true);
    expect(
      registry.decodeValue({
        $type: "Filter",
        prop: { $type: "date", iso: "2026-01-15" },
      }),
    ).toStrictEqual({ kind: "Filter", prop: new PyDate("2026-01-15") });
  });

  it("rejects duplicate registrations and built-in shadowing", () => {
    const registry = new CodecRegistry();
    registry.register("Filter", () => null);
    expect(() => registry.register("Filter", () => null)).toThrow(/duplicate/);
    expect(() => registry.register("bytes", () => null)).toThrow(/built-in/);
  });

  it("decodes call.input objects wholesale", () => {
    const registry = new CodecRegistry();
    const kwargs = registry.decodeInputKwargs({
      event: "Login",
      csv_bytes: { $type: "bytes", encoding: "base64", data: "" },
    });
    expect(kwargs["event"]).toBe("Login");
    expect(kwargs["csv_bytes"]).toBeInstanceOf(Uint8Array);
  });
});

describe("encodeExpectValue (D6 rules 2/5 at the output boundary)", () => {
  it("rejects non-finite numbers", () => {
    expect(() => encodeExpectValue(Number.NaN)).toThrow(UnencodableValueError);
    expect(() => encodeExpectValue(Number.POSITIVE_INFINITY)).toThrow(
      UnencodableValueError,
    );
  });

  it("rejects lone surrogates in strings and keys", () => {
    expect(() => encodeExpectValue("bad\uD800end")).toThrow(
      UnencodableValueError,
    );
    expect(() => encodeExpectValue({ "k\uDC00": 1 })).toThrow(
      UnencodableValueError,
    );
    expect(encodeExpectValue("ok 😀")).toBe("ok 😀");
  });

  it("drops undefined object properties (absent, not null — R3.5)", () => {
    expect(encodeExpectValue({ a: 1, b: undefined })).toStrictEqual({ a: 1 });
  });

  it("encodes bare and array-item undefined as null (JSON semantics)", () => {
    expect(encodeExpectValue(undefined)).toBeNull();
    expect(encodeExpectValue([1, undefined])).toStrictEqual([1, null]);
  });

  it("keeps bigint and JsonNumber values intact for the canonicalizer", () => {
    expect(encodeExpectValue(123n)).toBe(123n);
    const token = new JsonNumber("18.0");
    expect(encodeExpectValue(token)).toBe(token);
  });

  it("re-tags wrapper types", () => {
    expect(
      encodeExpectValue(new PyDatetime("2026-01-15T12:00:00")),
    ).toStrictEqual({
      $type: "datetime",
      iso: "2026-01-15T12:00:00",
    });
    // Encode reads the REVEALED value via reveal(), never toJSON()'s
    // mask (phase2-design C7 — mask-vs-mask comparisons are vacuous).
    expect(encodeExpectValue(new Secret("s"))).toStrictEqual({
      $type: "SecretStr",
      value: "s",
    });
  });

  it("rejects unknown class instances", () => {
    class Mystery {}
    expect(() => encodeExpectValue(new Mystery())).toThrow(
      UnencodableValueError,
    );
  });
});

describe("GroupBy contract codec float-carrier buckets (B2-BIND)", () => {
  // Python `GroupBy(bucket_min=0.0, bucket_max=100.0)` is constructible
  // (0.0 >= 100.0 is False) and records with `$type: float` children
  // (P2-5a integral-float tagging). Decoding those children as PyFloat
  // CARRIERS into the constructor is wrong twice over: JS `>=` on two
  // carrier objects string-compares "[object Object]" (guard V18 fires
  // where CPython's float comparison passes — the B2-BIND fuzz crash),
  // and the validator's numeric bucket comparisons need the numeric
  // value (B2-M1 carrier table: GroupBy.bucket_* → unwrap). The codec
  // therefore unwraps bucket carriers to native numbers at decode,
  // mirroring the SignedReplay `signed_at` precedent.
  it("decodes $type float bucket fields to native numbers", () => {
    const registry = new CodecRegistry();
    registerContractCodecs(registry);
    const decoded = registry.decodeValue({
      $type: "GroupBy",
      property: "revenue",
      property_type: "number",
      bucket_size: { $type: "float", value: "10.0" },
      bucket_min: { $type: "float", value: "0.0" },
      bucket_max: { $type: "float", value: "100.0" },
      _list_item_mode: null,
    });
    expect(decoded).toBeInstanceOf(GroupBy);
    const groupBy = decoded as GroupBy;
    expect(groupBy.bucket_size).toBe(10);
    expect(groupBy.bucket_min).toBe(0);
    expect(groupBy.bucket_max).toBe(100);
  });

  it("still raises the V18 guard for genuinely misordered carrier buckets", () => {
    const registry = new CodecRegistry();
    registerContractCodecs(registry);
    expect(() =>
      registry.decodeValue({
        $type: "GroupBy",
        property: "revenue",
        property_type: "number",
        bucket_size: { $type: "float", value: "10.0" },
        bucket_min: { $type: "float", value: "100.0" },
        bucket_max: { $type: "float", value: "5.0" },
        _list_item_mode: null,
      }),
    ).toThrow(UndecodableValueError);
  });

  // B2 gate remediation (RUN.md 2026-08-15 B2-attempt-1 divergence,
  // repro 2026-08-16-codec-roundtrip.json): the decode-side unwrap
  // above must be paired with an ENCODE-side re-tag for exactly the
  // fields that ARRIVED as float carriers — Python's GroupBy buckets
  // are `int | float | None` (types.py:8367-8373), so `18` (int) must
  // re-encode raw while `18.0` (float) must re-encode as the carrier.
  // The SignedReplay unconditional integral re-tag is wrong here; the
  // codec keeps decode-time float-ness memory instead (WeakMap).
  it("re-encodes carrier-decoded buckets as $type float (roundtrip keeps float-ness)", () => {
    const registry = new CodecRegistry();
    registerContractCodecs(registry);
    const decoded = registry.decodeValue({
      $type: "GroupBy",
      property: "plan",
      property_type: "string",
      bucket_size: { $type: "float", value: "18.0" },
      bucket_min: null,
      bucket_max: null,
      _list_item_mode: null,
    });
    expect(decoded).toBeInstanceOf(GroupBy);
    expect(registry.encodeValue(decoded)).toStrictEqual({
      $type: "GroupBy",
      property: "plan",
      property_type: "string",
      bucket_size: { $type: "float", value: "18.0" },
      bucket_min: null,
      bucket_max: null,
      _list_item_mode: null,
    });
  });

  it("re-encodes plain-int buckets as raw numbers (int stays int)", () => {
    const registry = new CodecRegistry();
    registerContractCodecs(registry);
    const decoded = registry.decodeValue({
      $type: "GroupBy",
      property: "plan",
      property_type: "string",
      bucket_size: 18,
      bucket_min: null,
      bucket_max: null,
      _list_item_mode: null,
    });
    expect(decoded).toBeInstanceOf(GroupBy);
    expect(registry.encodeValue(decoded)).toStrictEqual({
      $type: "GroupBy",
      property: "plan",
      property_type: "string",
      bucket_size: 18,
      bucket_min: null,
      bucket_max: null,
      _list_item_mode: null,
    });
  });

  it("keeps per-field float-ness on mixed int/float buckets", () => {
    const registry = new CodecRegistry();
    registerContractCodecs(registry);
    const decoded = registry.decodeValue({
      $type: "GroupBy",
      property: "revenue",
      property_type: "number",
      bucket_size: { $type: "float", value: "10.0" },
      bucket_min: 0,
      bucket_max: { $type: "float", value: "100.0" },
      _list_item_mode: null,
    });
    expect(decoded).toBeInstanceOf(GroupBy);
    expect(registry.encodeValue(decoded)).toStrictEqual({
      $type: "GroupBy",
      property: "revenue",
      property_type: "number",
      bucket_size: { $type: "float", value: "10.0" },
      bucket_min: 0,
      bucket_max: { $type: "float", value: "100.0" },
      _list_item_mode: null,
    });
  });

  it("encodes a directly-constructed GroupBy (no decode memory) with raw buckets", () => {
    const registry = new CodecRegistry();
    registerContractCodecs(registry);
    // A library-constructed instance never carried float spellings —
    // the generic declared-field walk applies (Python int spelling).
    const groupBy = new GroupBy({
      property: "plan",
      property_type: "string",
      bucket_size: 18,
    });
    expect(registry.encodeValue(groupBy)).toStrictEqual({
      $type: "GroupBy",
      property: "plan",
      property_type: "string",
      bucket_size: 18,
      bucket_min: null,
      bucket_max: null,
      _list_item_mode: null,
    });
  });
});
