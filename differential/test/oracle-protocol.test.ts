// Protocol-conformance tests for oracle-ts (design D14; the normative
// spec is conformance/schema/oracle-protocol.md in the Python repo).
// Mirrors the oracle-py suite (conformance/tests/test_oracle_protocol.py)
// so both bridges are pinned to the same observable behavior, plus the
// TS-specific raw-token traps: nested integral floats and integer-like
// dict-key ordering, which only this side can get wrong.
import { describe, expect, it } from "vitest";

import {
  JSONRPC_INTERNAL_ERROR,
  JSONRPC_INVALID_PARAMS,
  JSONRPC_INVALID_REQUEST,
  JSONRPC_METHOD_NOT_FOUND,
  JSONRPC_PARSE_ERROR,
  OracleServer,
  PROTOCOL_VERSION,
  type OracleIdentity,
} from "../oracle/server.js";
import {
  RawObject,
  parseRawJson,
  serializeAsciiJson,
  toJsonValue,
} from "../oracle/raw-json.js";
import { JsonNumber } from "../../conformance-runner/src/json-value.js";

/** Fixed identity injected in every test (no filesystem dependence). */
const TEST_IDENTITY: OracleIdentity = {
  language: "typescript",
  libraryVersion: "0.0.0-test",
  sourceCommit: "f".repeat(40),
};

/** A parsed JSON-RPC response envelope, loosely typed for assertions. */
interface Envelope {
  jsonrpc: string;
  id: unknown;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

/**
 * Build a fresh server over the fixed test identity.
 *
 * @returns A new `OracleServer`.
 */
function makeServer(): OracleServer {
  return new OracleServer(TEST_IDENTITY);
}

/**
 * Serve one raw request line and parse the response envelope.
 *
 * @param server - The server under test.
 * @param line - The raw request line.
 * @returns The parsed response envelope.
 */
function serveLine(server: OracleServer, line: string): Envelope {
  const response = server.handleLine(line);
  expect(response).not.toBeNull();
  return JSON.parse(response as string) as Envelope;
}

/**
 * Serve one well-formed request and parse the response envelope.
 *
 * @param server - The server under test.
 * @param method - The JSON-RPC method.
 * @param params - The params object, omitted when `undefined`.
 * @returns The parsed response envelope.
 */
function serve(
  server: OracleServer,
  method: string,
  params?: Record<string, unknown>,
): Envelope {
  const request: Record<string, unknown> = { jsonrpc: "2.0", id: 1, method };
  if (params !== undefined) {
    request["params"] = params;
  }
  return serveLine(server, JSON.stringify(request));
}

/**
 * Execute one `oracle.call` and return its result payload.
 *
 * @param server - The server under test.
 * @param api - The dotted api name.
 * @param input - The `call.input`-shaped kwargs.
 * @returns The `{ok, ...}` payload.
 */
function call(
  server: OracleServer,
  api: string,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const envelope = serve(server, "oracle.call", { api, input });
  expect(envelope.error).toBeUndefined();
  return envelope.result as Record<string, unknown>;
}

describe("oracle.info / oracle.shutdown / framing", () => {
  it("reports the identity block", () => {
    const envelope = serve(makeServer(), "oracle.info");
    expect(envelope.result).toEqual({
      language: "typescript",
      library_version: "0.0.0-test",
      source_commit: "f".repeat(40),
      protocol_version: PROTOCOL_VERSION,
    });
  });

  it("acknowledges shutdown then flags exit", () => {
    const server = makeServer();
    expect(server.shutdownRequested).toBe(false);
    const envelope = serve(server, "oracle.shutdown");
    expect(envelope.result).toEqual({ ok: true });
    expect(server.shutdownRequested).toBe(true);
  });

  it("ignores blank input lines", () => {
    const server = makeServer();
    expect(server.handleLine("")).toBeNull();
    expect(server.handleLine("   \t ")).toBeNull();
  });

  it("answers id null with -32700 for unparseable lines", () => {
    const envelope = serveLine(makeServer(), "{nope");
    expect(envelope.id).toBeNull();
    expect(envelope.error?.code).toBe(JSONRPC_PARSE_ERROR);
  });

  it.each([
    ['"just a string"', null],
    ['{"id": 3, "method": "oracle.info"}', 3],
    ['{"jsonrpc": "1.0", "id": 4, "method": "oracle.info"}', 4],
    ['{"jsonrpc": "2.0", "id": 5, "method": 7}', 5],
  ])("answers -32600 for malformed request %s", (line, id) => {
    const envelope = serveLine(makeServer(), line);
    expect(envelope.error?.code).toBe(JSONRPC_INVALID_REQUEST);
    expect(envelope.id).toBe(id);
  });

  it("answers -32601 for unknown methods", () => {
    const envelope = serve(makeServer(), "oracle.nope");
    expect(envelope.error?.code).toBe(JSONRPC_METHOD_NOT_FOUND);
  });

  it("frames responses as single ASCII lines (D14 ensure_ascii parity)", () => {
    const server = makeServer();
    const line = server.handleLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 5,
        method: "oracle.call",
        params: { api: "compat.python_str", input: { value: "\u{1f40d}" } },
      }),
    );
    expect(line).not.toBeNull();
    expect(line).not.toContain("\n");
    expect([...(line as string)].every((ch) => ch.charCodeAt(0) < 128)).toBe(
      true,
    );
    const envelope = JSON.parse(line as string) as Envelope;
    expect(envelope.result?.["output"]).toBe("\u{1f40d}");
  });

  it("echoes string ids verbatim and preserves integer id tokens", () => {
    const server = makeServer();
    const byString = serveLine(
      server,
      '{"jsonrpc": "2.0", "id": "req-9", "method": "oracle.info"}',
    );
    expect(byString.id).toBe("req-9");
    const line = server.handleLine(
      '{"jsonrpc": "2.0", "id": 9007199254740993, "method": "oracle.info"}',
    );
    // 2^53 + 1 survives echo exactly — the raw token round-trips.
    expect(line).toContain('"id": 9007199254740993');
  });
});

describe("oracle.call: compat surface", () => {
  it("returns ok output for compat.zfill", () => {
    expect(
      call(makeServer(), "compat.zfill", { value: "-1", width: 3 }),
    ).toEqual({ ok: true, output: "-01" });
  });

  // Raw request lines mirror Python json.dumps tokens exactly — JS
  // JSON.stringify would destroy the float tokens under test ("18.0"
  // becomes "18", "-0.0" becomes "0").
  it.each([
    ["18.0", "18.0"],
    ["1.5", "1.5"],
    ["-0.0", "-0.0"],
    ["1e+16", "1e+16"],
    ["1e-05", "1e-05"],
    ["5e-324", "5e-324"],
  ])("renders python_float_str(token %s) = %s", (token, expected) => {
    const line =
      '{"jsonrpc": "2.0", "id": 1, "method": "oracle.call", "params": ' +
      `{"api": "compat.python_float_str", "input": {"value": ${token}}}}`;
    const envelope = serveLine(makeServer(), line);
    expect(envelope.result).toEqual({ ok: true, output: expected });
  });

  it("recovers nested integral floats from raw tokens in python_str", () => {
    // Decoded JS values collapse 18.0 to 18; only the raw token knows it
    // was a Python float. A bridge that loses this reports a false
    // divergence against oracle-py's "[18.0, {'k': 1.0}]".
    const line =
      '{"jsonrpc": "2.0", "id": 1, "method": "oracle.call", "params": ' +
      '{"api": "compat.python_str", "input": {"value": [18.0, {"k": 1.0}]}}}';
    const envelope = serveLine(makeServer(), line);
    expect(envelope.result).toEqual({ ok: true, output: "[18.0, {'k': 1.0}]" });
  });

  it("preserves insertion order of integer-like dict keys in python_str", () => {
    // Plain JS objects iterate "0" before "1" regardless of insertion
    // order; Python str(dict) preserves insertion order. The ordered
    // RawObject model keeps the bridge faithful.
    const line =
      '{"jsonrpc": "2.0", "id": 1, "method": "oracle.call", "params": ' +
      '{"api": "compat.python_str", "input": {"value": {"1": null, "0": true}}}}';
    const envelope = serveLine(makeServer(), line);
    expect(envelope.result).toEqual({
      ok: true,
      output: "{'1': None, '0': True}",
    });
  });

  it("keeps duplicate-key semantics of json.loads (last wins, first position)", () => {
    const server = makeServer();
    const line =
      '{"jsonrpc": "2.0", "id": 1, "method": "oracle.call", "params": ' +
      '{"api": "compat.python_str", "input": {"value": {"a": 1, "b": 2, "a": 3}}}}';
    const envelope = serveLine(server, line);
    expect(envelope.result).toEqual({ ok: true, output: "{'a': 3, 'b': 2}" });
  });

  it("renders integers beyond 2^53 exactly in python_str", () => {
    const server = makeServer();
    const line =
      '{"jsonrpc": "2.0", "id": 1, "method": "oracle.call", "params": ' +
      '{"api": "compat.python_str", "input": {"value": 12345678901234567890123}}}';
    const envelope = serveLine(server, line);
    expect(envelope.result).toEqual({
      ok: true,
      output: "12345678901234567890123",
    });
  });

  it("returns R10.9 edge outputs matching CPython", () => {
    const server = makeServer();
    expect(call(server, "compat.python_str", { value: true })).toEqual({
      ok: true,
      output: "True",
    });
    expect(call(server, "compat.python_str", { value: null })).toEqual({
      ok: true,
      output: "None",
    });
    expect(call(server, "compat.python_str", { value: [] })).toEqual({
      ok: true,
      output: "[]",
    });
    expect(call(server, "compat.python_str", { value: "" })).toEqual({
      ok: true,
      output: "",
    });
    expect(call(server, "compat.zfill", { value: "", width: 2 })).toEqual({
      ok: true,
      output: "00",
    });
    expect(
      call(server, "compat.zfill", { value: "\u{1f40d}", width: 3 }),
    ).toEqual({ ok: true, output: "00\u{1f40d}" });
  });

  it("returns thrown library errors as bare-class DATA (R5.4)", () => {
    // Wrong argument types are library errors, not protocol errors —
    // "Python raised TypeError / TS raised TypeError" stays comparable.
    const result = call(makeServer(), "compat.zfill", { value: "5" });
    expect(result).toEqual({ ok: false, error: { class: "TypeError" } });
  });
});

describe("oracle.call: scope, skips, and protocol errors", () => {
  it("answers UNPORTED for mapped apis outside the compat surface", () => {
    const result = call(makeServer(), "user_builders.filter_to_selector", {});
    expect(result).toEqual({
      ok: false,
      error: { class: "Unported", code: "UNPORTED" },
    });
  });

  it("answers UNPORTED without decoding rich $type inputs", () => {
    // Unported apis carry tags (Filter, ...) this side cannot decode yet;
    // scope must be checked FIRST or every such probe would crash the
    // harness with -32602 instead of counting as a skip.
    const result = call(makeServer(), "segfilter.build_segfilter_entry", {
      f: { $type: "Filter", field: "x" },
    });
    expect(result).toEqual({
      ok: false,
      error: { class: "Unported", code: "UNPORTED" },
    });
  });

  it("answers UNPORTED for the wirestub gate apis (protocol §4.2)", () => {
    const server = makeServer();
    const envelope = serve(server, "oracle.call", {
      api: "wirestub.request",
      input: { method: "GET", path: "/ping" },
      interactions: [],
    });
    expect(envelope.result).toEqual({
      ok: false,
      error: { class: "Unported", code: "UNPORTED" },
    });
  });

  it("answers -32602 for apis in no naming-map source", () => {
    const envelope = serve(makeServer(), "oracle.call", {
      api: "mystery.call",
      input: {},
    });
    expect(envelope.error?.code).toBe(JSONRPC_INVALID_PARAMS);
  });

  it("answers -32602 for missing params, api, and mistyped members", () => {
    const server = makeServer();
    expect(serve(server, "oracle.call").error?.code).toBe(
      JSONRPC_INVALID_PARAMS,
    );
    expect(serve(server, "oracle.call", { input: {} }).error?.code).toBe(
      JSONRPC_INVALID_PARAMS,
    );
    expect(
      serve(server, "oracle.call", { api: "compat.zfill", input: "nope" }).error
        ?.code,
    ).toBe(JSONRPC_INVALID_PARAMS);
    expect(
      serve(server, "oracle.call", {
        api: "compat.zfill",
        input: {},
        session: "nope",
      }).error?.code,
    ).toBe(JSONRPC_INVALID_PARAMS);
    expect(
      serve(server, "oracle.call", {
        api: "compat.zfill",
        input: {},
        interactions: "nope",
      }).error?.code,
    ).toBe(JSONRPC_INVALID_PARAMS);
  });

  it("answers -32602 for undecodable $type input on the live surface", () => {
    const envelope = serve(makeServer(), "oracle.call", {
      api: "compat.zfill",
      input: { value: { $type: "Filter", field: "x" }, width: 3 },
    });
    expect(envelope.error?.code).toBe(JSONRPC_INVALID_PARAMS);
  });

  it("accepts and ignores session (protocol-shape parity)", () => {
    const result = call(makeServer(), "compat.zfill", { value: "5", width: 3 });
    const withSession = serve(makeServer(), "oracle.call", {
      api: "compat.zfill",
      input: { value: "5", width: 3 },
      session: { kind: "service_account", username: "u" },
    });
    expect(withSession.result).toEqual(result);
    expect(withSession.result).toEqual({ ok: true, output: "005" });
  });

  it("answers -32000 when the output fails D6 canonicalization", () => {
    // A lone-surrogate input arrives via a JSON escape; python_str's
    // OUTPUT then carries the surrogate, which the D6 encoder rejects —
    // a protocol-level error, never a hang or crash (design D14).
    const line =
      '{"jsonrpc": "2.0", "id": 1, "method": "oracle.call", "params": ' +
      '{"api": "compat.python_str", "input": {"value": "\\ud800"}}}';
    const envelope = serveLine(makeServer(), line);
    expect(envelope.error?.code).toBe(JSONRPC_INTERNAL_ERROR);
  });
});

describe("raw-json: ordered lossless model", () => {
  it("preserves member order and number tokens", () => {
    const value = parseRawJson('{"1": 18.0, "0": null}');
    expect(value).toBeInstanceOf(RawObject);
    const entries = (value as RawObject).entries;
    expect(entries.map(([key]) => key)).toEqual(["1", "0"]);
    expect(entries[0]?.[1]).toBeInstanceOf(JsonNumber);
    expect((entries[0]?.[1] as JsonNumber).raw).toBe("18.0");
  });

  it("flattens to JsonValue for codec/canonicalizer consumers", () => {
    const flat = toJsonValue(parseRawJson('{"a": [1, "x"], "b": true}'));
    expect(flat).toEqual({
      a: [new JsonNumber("1"), "x"],
      b: true,
    });
  });

  it("serializes ASCII-safe lines with lone surrogates escaped", () => {
    const text = serializeAsciiJson({
      astral: "\u{1f40d}",
      lone: "\ud800",
      token: new JsonNumber("18.0"),
      big: 123456789012345678901n,
    });
    expect([...text].every((ch) => ch.charCodeAt(0) < 128)).toBe(true);
    expect(text).toContain("\\ud83d\\udc0d");
    expect(text).toContain("\\ud800");
    expect(text).toContain("18.0");
    expect(text).toContain("123456789012345678901");
  });

  it("rejects trailing content and malformed tokens", () => {
    expect(() => parseRawJson('{"a": 1} extra')).toThrow(
      "unexpected trailing content",
    );
    expect(() => parseRawJson('{"a": 01}')).toThrow("at offset");
    expect(() => parseRawJson('"\\x00"')).toThrow("malformed string token");
  });
});
