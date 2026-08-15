/**
 * oracle-ts protocol server (design D14; `conformance/schema/
 * oracle-protocol.md` in the Python repo is the normative spec).
 *
 * Implements newline-delimited JSON-RPC 2.0 with the three oracle methods
 * (`oracle.info` / `oracle.call` / `oracle.shutdown`), ASCII-safe framing,
 * and the R5.4 error-mapping rule: expected library errors are DATA
 * (`ok: false` payloads with class name + code, messages stripped), while
 * only harness bugs surface as JSON-RPC `error` objects.
 *
 * Phase-1 `oracle.call` surface (protocol §4.2): the D13 compat module
 * ONLY (`compat.zfill` / `compat.python_str` / `compat.python_float_str`,
 * bound to the real `packages/core` port). Every other api the naming
 * sources know answers the `{class: "Unported", code: "UNPORTED"}` skip
 * payload — the fuzz harness counts it as skip, never divergence — and a
 * name in NO mapping source is a `-32602` protocol error (fail fast; the
 * harness only emits registry names). Scope is checked BEFORE input
 * decoding on purpose: unported apis carry rich `$type` tags (`Filter`,
 * ...) this side cannot decode yet, and decoding first would turn their
 * skips into protocol errors.
 *
 * The stdin/stdout loop lives in `main.ts`; this module is transport-free
 * so protocol behavior is unit-testable in-process (mirroring oracle-py's
 * `server.py` / `__main__.py` split).
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveApi } from "../../conformance-runner/src/api-map.js";
import {
  canonicalize,
  canonicalizeError,
} from "../../conformance-runner/src/canonical.js";
import {
  CodecRegistry,
  UndecodableValueError,
  encodeExpectValue,
} from "../../conformance-runner/src/codecs.js";
import type { JsonValue } from "../../conformance-runner/src/json-value.js";
import { pythonFloatStr, zfill } from "../../packages/core/src/compat/index.js";
import { pythonStrRaw } from "./python-str-raw.js";
import {
  RawObject,
  type RawValue,
  type SerializableValue,
  parseRawJson,
  serializeAsciiJson,
  toJsonValue,
} from "./raw-json.js";

/** Version stamp returned by `oracle.info` (oracle-protocol.md §2). */
export const PROTOCOL_VERSION = "1.0";

/** JSON-RPC 2.0: the request line was not valid JSON. */
export const JSONRPC_PARSE_ERROR = -32700;

/** JSON-RPC 2.0: the request object was malformed. */
export const JSONRPC_INVALID_REQUEST = -32600;

/** JSON-RPC 2.0: the method is not one of the three oracle methods. */
export const JSONRPC_METHOD_NOT_FOUND = -32601;

/** JSON-RPC 2.0: params failed validation (unknown api, bad input). */
export const JSONRPC_INVALID_PARAMS = -32602;

/**
 * JSON-RPC 2.0 server range: harness-level failure inside the oracle
 * (unencodable output, canonicalization rejection, unexpected dispatch
 * bug — never an expected library error, which is `ok: false` DATA per
 * R5.4).
 */
export const JSONRPC_INTERNAL_ERROR = -32000;

/** The Phase-1 live surface: the D13 compat module (protocol §4.2). */
const COMPAT_APIS: ReadonlySet<string> = new Set([
  "compat.zfill",
  "compat.python_str",
  "compat.python_float_str",
]);

/** The `oracle.info` identity block (oracle-protocol.md §3). */
export interface OracleIdentity {
  /** Always `"typescript"` for this bridge. */
  readonly language: string;
  /** The `@mixpanel-headless/core` package version, or `"unknown"`. */
  readonly libraryVersion: string;
  /** The pinned `corpus.config.json` `sourceCommit`, or `"unknown"`. */
  readonly sourceCommit: string;
}

/**
 * A request that failed at the PROTOCOL level (JSON-RPC `error` object).
 *
 * Raised internally by the dispatch/call paths for harness bugs — unknown
 * api names, undecodable inputs, unencodable outputs, canonicalization
 * rejections (e.g. a lone-surrogate output string, design D14). Expected
 * library errors never raise this; they are returned as `ok: false`
 * result DATA.
 */
export class OracleProtocolError extends Error {
  /** The JSON-RPC error code (one of the module constants). */
  readonly code: number;

  /**
   * Initialize the protocol error.
   *
   * @param code - JSON-RPC error code.
   * @param message - Human-readable description (free-form; never
   *   compared by any consumer).
   */
  constructor(code: number, message: string) {
    super(message);
    this.name = "OracleProtocolError";
    this.code = code;
  }
}

/**
 * Resolve the identity block from the repo's pinned metadata.
 *
 * `library_version` comes from `packages/core/package.json`;
 * `source_commit` from `conformance-runner/corpus.config.json`'s
 * `sourceCommit` (oracle-protocol.md §3: oracle-ts reports the pinned
 * snapshot commit — never `git rev-parse`). Both fall back to
 * `"unknown"` when unreadable. Paths resolve two directories above this
 * module, which is the repo root both from the source location
 * (`differential/oracle/`) and from the esbuild bundle
 * (`differential/dist/`).
 *
 * @returns The resolved identity block.
 */
export function resolveIdentity(): OracleIdentity {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  return {
    language: "typescript",
    libraryVersion: readJsonString(
      resolve(repoRoot, "packages", "core", "package.json"),
      "version",
    ),
    sourceCommit: readJsonString(
      resolve(repoRoot, "conformance-runner", "corpus.config.json"),
      "sourceCommit",
    ),
  };
}

/**
 * Read one string member from a JSON file, tolerating any failure.
 *
 * @param path - The absolute file path.
 * @param key - The top-level member to read.
 * @returns The string value, or `"unknown"` when the file is missing,
 *   malformed, or the member is not a non-empty string.
 */
function readJsonString(path: string, key: string): string {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (typeof parsed === "object" && parsed !== null) {
      const value = (parsed as Record<string, unknown>)[key];
      if (typeof value === "string" && value !== "") {
        return value;
      }
    }
  } catch {
    // fall through to "unknown"
  }
  return "unknown";
}

/**
 * Whether a thrown value carries its own vector `expect.error` encoding
 * (the runner's `ExpectErrorConvertible` shape, R5.2/R5.4).
 *
 * @param value - The thrown value.
 * @returns `true` when `toExpectError` is callable.
 */
function isExpectErrorConvertible(
  value: unknown,
): value is { toExpectError(): JsonValue } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { toExpectError?: unknown }).toExpectError === "function"
  );
}

/**
 * Stateful protocol server: one instance per oracle process/session.
 *
 * Transport-free by design: {@link handleLine} maps one request line to
 * one response line, so the stdin/stdout loop (`main.ts`) and the unit
 * tests share the exact same dispatch path.
 *
 * @example
 * ```typescript
 * const server = new OracleServer(resolveIdentity());
 * server.handleLine('{"jsonrpc": "2.0", "id": 1, "method": "oracle.info"}');
 * // '{"jsonrpc": "2.0", "id": 1, "result": {...}}'
 * ```
 */
export class OracleServer {
  /** The identity block served by `oracle.info`. */
  private readonly identity: OracleIdentity;

  /** The `$type` decode table (built-ins only in Phase 1). */
  private readonly codecs = new CodecRegistry();

  /** Whether `oracle.shutdown` has been served. */
  private shutdown = false;

  /**
   * Initialize the server.
   *
   * @param identity - The identity block (inject fixed values in tests;
   *   use {@link resolveIdentity} in the real process).
   */
  constructor(identity: OracleIdentity) {
    this.identity = identity;
  }

  /**
   * Whether the read loop should exit after the current response.
   *
   * @returns `true` once `oracle.shutdown` has been served.
   */
  get shutdownRequested(): boolean {
    return this.shutdown;
  }

  /**
   * Serve one request line and return the response line.
   *
   * Never throws: every failure mode becomes a JSON-RPC `error` response
   * (a strategy-generated poison value must produce a protocol-level
   * error, "not a hang or crash" — design D14).
   *
   * @param line - One newline-stripped request line.
   * @returns The single-line, ASCII-safe JSON response, or `null` for
   *   blank lines (ignored per oracle-protocol.md §1).
   */
  handleLine(line: string): string | null {
    if (line.trim() === "") {
      return null;
    }
    let request: RawValue;
    try {
      request = parseRawJson(line);
    } catch {
      return this.encodeResponse(null, {
        error: [JSONRPC_PARSE_ERROR, "request line is not valid JSON"],
      });
    }
    if (!(request instanceof RawObject)) {
      return this.encodeResponse(null, {
        error: [JSONRPC_INVALID_REQUEST, "request is not an object"],
      });
    }
    const requestId = request.get("id") ?? null;
    if (request.get("jsonrpc") !== "2.0") {
      return this.encodeResponse(requestId, {
        error: [JSONRPC_INVALID_REQUEST, "jsonrpc member must be '2.0'"],
      });
    }
    const method = request.get("method");
    if (typeof method !== "string") {
      return this.encodeResponse(requestId, {
        error: [JSONRPC_INVALID_REQUEST, "method member must be a string"],
      });
    }
    let result: SerializableValue;
    try {
      result = this.dispatch(method, request.get("params"));
    } catch (thrown) {
      if (thrown instanceof OracleProtocolError) {
        return this.encodeResponse(requestId, {
          error: [thrown.code, thrown.message],
        });
      }
      const name = thrown instanceof Error ? thrown.name : typeof thrown;
      const detail = thrown instanceof Error ? thrown.message : String(thrown);
      return this.encodeResponse(requestId, {
        error: [
          JSONRPC_INTERNAL_ERROR,
          `oracle dispatch failed: ${name}: ${detail}`,
        ],
      });
    }
    return this.encodeResponse(requestId, { result });
  }

  /**
   * Build the `oracle.info` result (oracle-protocol.md §3).
   *
   * @returns The `{language, library_version, source_commit,
   *   protocol_version}` identity block.
   */
  info(): SerializableValue {
    return {
      language: this.identity.language,
      library_version: this.identity.libraryVersion,
      source_commit: this.identity.sourceCommit,
      protocol_version: PROTOCOL_VERSION,
    };
  }

  /**
   * Route one request to its method handler.
   *
   * @param method - The JSON-RPC method name.
   * @param params - The raw `params` member (may be absent).
   * @returns The `result` object for the response.
   * @throws OracleProtocolError - For unknown methods or invalid params.
   */
  private dispatch(
    method: string,
    params: RawValue | undefined,
  ): SerializableValue {
    if (method === "oracle.info") {
      return this.info();
    }
    if (method === "oracle.shutdown") {
      this.shutdown = true;
      return { ok: true };
    }
    if (method === "oracle.call") {
      if (!(params instanceof RawObject)) {
        throw new OracleProtocolError(
          JSONRPC_INVALID_PARAMS,
          "oracle.call requires a params object",
        );
      }
      return this.callFromParams(params);
    }
    throw new OracleProtocolError(
      JSONRPC_METHOD_NOT_FOUND,
      `unknown method ${JSON.stringify(method)}`,
    );
  }

  /**
   * Validate `oracle.call` params and delegate to {@link callApi}.
   *
   * @param params - The raw params object.
   * @returns The call result payload.
   * @throws OracleProtocolError - If `api` is missing/non-string or the
   *   optional members carry the wrong types.
   */
  private callFromParams(params: RawObject): SerializableValue {
    const api = params.get("api");
    if (typeof api !== "string" || api === "") {
      throw new OracleProtocolError(
        JSONRPC_INVALID_PARAMS,
        "params.api must be a non-empty string",
      );
    }
    const rawInput = params.get("input") ?? null;
    if (rawInput !== null && !(rawInput instanceof RawObject)) {
      throw new OracleProtocolError(
        JSONRPC_INVALID_PARAMS,
        "params.input must be an object when present",
      );
    }
    const session = params.get("session") ?? null;
    if (session !== null && !(session instanceof RawObject)) {
      throw new OracleProtocolError(
        JSONRPC_INVALID_PARAMS,
        "params.session must be an object when present",
      );
    }
    const interactions = params.get("interactions") ?? null;
    if (interactions !== null && !Array.isArray(interactions)) {
      throw new OracleProtocolError(
        JSONRPC_INVALID_PARAMS,
        "params.interactions must be an array when present",
      );
    }
    // `session` and `interactions` are accepted for protocol-shape parity
    // (§4/§4.3) and unused: the compat surface is session-free and every
    // wire-flavored api (wirestub included) is UNPORTED on this side.
    return this.callApi(api, rawInput ?? new RawObject([]));
  }

  /**
   * Execute one api call (oracle-protocol.md §4).
   *
   * @param api - The PYTHON dotted vector name (design D14: language-
   *   neutral naming; this side resolves it through the SAME naming map
   *   as the conformance runner, D12).
   * @param rawInput - The undecoded `call.input`-shaped kwargs.
   * @returns `{ok: true, output}` or the `ok: false` error/skip payload.
   * @throws OracleProtocolError - For unknown apis, undecodable input,
   *   and unencodable/uncanonicalizable outputs (harness-level, D14).
   */
  callApi(api: string, rawInput: RawObject): SerializableValue {
    if (COMPAT_APIS.has(api)) {
      return this.executeCompat(api, rawInput);
    }
    if (resolveApi(api).status === "unmapped") {
      throw new OracleProtocolError(
        JSONRPC_INVALID_PARAMS,
        `unknown api ${JSON.stringify(api)} (in no naming-map source — ` +
          "design D14 resolves api names through the D12 naming map)",
      );
    }
    return { ok: false, error: { class: "Unported", code: "UNPORTED" } };
  }

  /**
   * Execute one D13 compat api and encode its outcome as call DATA.
   *
   * @param api - A member of the compat surface.
   * @param rawInput - The undecoded kwargs.
   * @returns `{ok: true, output}` for returns; `{ok: false, error}` for
   *   thrown library errors (messages stripped, R5.4).
   * @throws OracleProtocolError - If the RETURNED value cannot be encoded
   *   or canonicalized (harness-level per design D14 — e.g. a lone-
   *   surrogate output string must yield a protocol error, never a
   *   crash), or the input is undecodable (`-32602`).
   */
  private executeCompat(api: string, rawInput: RawObject): SerializableValue {
    let returned: unknown;
    try {
      returned = this.invokeCompat(api, rawInput);
    } catch (thrown) {
      if (thrown instanceof OracleProtocolError) {
        throw thrown;
      }
      return { ok: false, error: this.errorPayload(thrown) };
    }
    let output: JsonValue;
    try {
      output = encodeExpectValue(returned);
      canonicalize(output);
    } catch (thrown) {
      throw new OracleProtocolError(
        JSONRPC_INTERNAL_ERROR,
        `output encode/canonicalization failed: ${String(thrown)}`,
      );
    }
    return { ok: true, output };
  }

  /**
   * Invoke one compat entry point over the raw kwargs.
   *
   * `compat.python_str` walks the RAW token tree ({@link pythonStrRaw})
   * because float-ness and dict member order survive only there; the
   * scalar-argument entries decode through the shared codec table first,
   * mirroring the runner's D13 bindings.
   *
   * @param api - A member of the compat surface.
   * @param rawInput - The undecoded kwargs.
   * @returns The entry point's return value.
   * @throws TypeError - For missing/mistyped arguments (library-error
   *   DATA, matching Python's `TypeError` on bad call shapes).
   * @throws OracleProtocolError - For undecodable `$type` input.
   */
  private invokeCompat(api: string, rawInput: RawObject): unknown {
    if (api === "compat.python_str") {
      const raw = rawInput.get("value");
      if (raw === undefined) {
        throw new TypeError("python_str() missing required argument: value");
      }
      return pythonStrRaw(raw);
    }
    const kwargs = this.decodeKwargs(rawInput);
    if (api === "compat.zfill") {
      const value = kwargs["value"];
      const width = kwargs["width"];
      if (typeof value !== "string" || typeof width !== "number") {
        throw new TypeError(
          "zfill() requires (value: str, width: int) per the Python reference",
        );
      }
      return zfill(value, width);
    }
    // compat.python_float_str — the only remaining surface member.
    const value = kwargs["value"];
    if (typeof value !== "number") {
      throw new TypeError(
        "python_float_str() requires a float per the Python reference",
      );
    }
    return pythonFloatStr(value);
  }

  /**
   * Decode `$type`-tagged kwargs through the shared codec table.
   *
   * @param rawInput - The undecoded kwargs object.
   * @returns Live TS kwarg values.
   * @throws OracleProtocolError - If any value has no decoder (harness
   *   bug — the fuzz strategies encode through the same codec table).
   */
  private decodeKwargs(rawInput: RawObject): Record<string, unknown> {
    const decoded: Record<string, unknown> = {};
    try {
      for (const [name, value] of rawInput.entries) {
        decoded[name] = this.codecs.decodeValue(toJsonValue(value));
      }
    } catch (thrown) {
      if (thrown instanceof UndecodableValueError) {
        throw new OracleProtocolError(
          JSONRPC_INVALID_PARAMS,
          `input decode failed: ${thrown.message}`,
        );
      }
      throw thrown;
    }
    return decoded;
  }

  /**
   * Serialize a thrown library error as comparable DATA (R5.4).
   *
   * Errors carrying their own `expect.error` encoding use it (class +
   * code + structural `errors[]`, messages stripped); anything else —
   * e.g. the compat surface's `TypeError` on bad call shapes — encodes
   * as its bare class name, keeping "Python raised TypeError / TS raised
   * TypeError" a comparable pair.
   *
   * @param thrown - The thrown value.
   * @returns The `ok: false` error object.
   * @throws OracleProtocolError - If the payload itself cannot be
   *   canonicalized (harness-level).
   */
  private errorPayload(thrown: unknown): JsonValue {
    let payload: JsonValue;
    if (isExpectErrorConvertible(thrown)) {
      payload = thrown.toExpectError();
    } else {
      payload = {
        class: thrown instanceof Error ? thrown.constructor.name : "Error",
      };
    }
    try {
      canonicalizeError(payload);
    } catch (error) {
      throw new OracleProtocolError(
        JSONRPC_INTERNAL_ERROR,
        `error payload canonicalization failed: ${String(error)}`,
      );
    }
    return payload;
  }

  /**
   * Frame one JSON-RPC response as a single ASCII-safe line (D14).
   *
   * @param requestId - The request's `id` member (echoed verbatim,
   *   `null` for unparseable requests).
   * @param body - Either the `result` object or the `[code, message]`
   *   error pair (mutually exclusive).
   * @returns The serialized response line (no trailing newline).
   */
  private encodeResponse(
    requestId: RawValue,
    body:
      | { readonly result: SerializableValue }
      | { readonly error: readonly [number, string] },
  ): string {
    const envelope: Record<string, SerializableValue> = {
      jsonrpc: "2.0",
      id: requestId,
    };
    if ("error" in body) {
      envelope["error"] = { code: body.error[0], message: body.error[1] };
    } else {
      envelope["result"] = body.result;
    }
    return serializeAsciiJson(envelope);
  }
}
