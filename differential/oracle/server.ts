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
 * Phase-2 `oracle.call` surface (protocol §4.2/§8): the D13 compat module
 * (`compat.zfill` / `compat.python_str` / `compat.python_float_str`,
 * bound to the real `packages/core` port via the raw-token path) PLUS the
 * 44 `types.*` contract entries, served through the SAME bindings module
 * as the conformance runner (`conformance-runner/src/bindings.ts`
 * `createRunnerDeps` — one registration module, so runner and oracle can
 * never disagree; phase2-design C9). The protocol 1.1 addendum method
 * `codec.roundtrip` round-trips `$type`-tagged values through the full
 * rich codec table. Every other api the naming sources know answers the
 * `{class: "Unported", code: "UNPORTED"}` skip payload — the fuzz
 * harness counts it as skip, never divergence — and a name in NO mapping
 * source is a `-32602` protocol error (fail fast; the harness only emits
 * registry names). Scope is checked BEFORE input decoding on purpose:
 * unported apis may carry rich `$type` tags whose decode failures would
 * otherwise turn their skips into protocol errors; `wirestub.*` stays
 * UNPORTED here (async replay transport — wire scope is Phase 3).
 *
 * The stdin/stdout loop lives in `main.ts`; this module is transport-free
 * so protocol behavior is unit-testable in-process (mirroring oracle-py's
 * `server.py` / `__main__.py` split).
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  canonicalize,
  canonicalizeError,
  CONTRACT_TAG_CODECS,
  createRunnerDeps,
  createShims,
  encodeExpectValue,
  fieldsFromBag,
  type InvocationContext,
  isExpectErrorConvertible,
  JsonNumber,
  type JsonValue,
  resolveApi,
  type RunnerDeps,
  UndecodableValueError,
} from "@mixpanel-headless/conformance-runner";
import {
  pythonFloatStr,
  ReplayBundle,
  ReplayEvent,
  ReplaySummary,
  zfill,
} from "@mixpanel-headless/core";

import { pythonStrRaw } from "./python-str-raw.js";
import {
  parseRawJson,
  RawObject,
  type RawValue,
  type SerializableValue,
  serializeAsciiJson,
  toJsonValue,
} from "./raw-json.js";

/**
 * Version stamp returned by `oracle.info` (oracle-protocol.md §2; "1.1"
 * adds the §8 `codec.roundtrip` method — the Phase-2 P2-9 addendum).
 */
export const PROTOCOL_VERSION = "1.1";

/**
 * The frozen record instant (oracle-protocol.md §7 determinism
 * environment; corpus manifest `record_epoch`).
 */
const RECORD_EPOCH = "2026-01-15T12:00:00Z";

/** JSON-RPC 2.0: the request line was not valid JSON. */
export const JSONRPC_PARSE_ERROR = -32700;

/** JSON-RPC 2.0: the request object was malformed. */
export const JSONRPC_INVALID_REQUEST = -32600;

/**
 * JSON-RPC 2.0: the method is not one of the four protocol methods
 * (`oracle.info` / `oracle.call` / `oracle.shutdown` / `codec.roundtrip`
 * — oracle-protocol.md §5/§8).
 */
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

/**
 * The three replay dataclass tags with NO corpus `$type` occurrences.
 *
 * They stay unregistered in `vector-codecs.ts` so the P2-8 sweep's
 * every-registered-tag-exercised check stays honest, but the ORACLE
 * needs them: `oracle.call` success outputs and `codec.roundtrip`
 * instances of these classes must encode/decode exactly like Python's
 * generic dataclass codec (which serves ALL registered dataclasses).
 * The rows are registered on the oracle's own registry instance only.
 */
const ORACLE_REPLAY_ROWS: ReadonlyArray<
  readonly [string, new (fields: never) => object]
> = [
  ["ReplaySummary", ReplaySummary],
  ["ReplayEvent", ReplayEvent],
  ["ReplayBundle", ReplayBundle],
];

/**
 * The rich (dataclass/model) `$type` tags — the tags Python's EXPECT
 * encoder drops (`_encode_common(tagged_models=False)`), as opposed to
 * the built-in value tags (`datetime`, `date`, `bytes`, `SecretStr`,
 * `float`, `callback`), which appear in expect encodings too.
 */
const RICH_TAGS: ReadonlySet<string> = new Set([
  ...CONTRACT_TAG_CODECS.keys(),
  ...ORACLE_REPLAY_ROWS.map(([tag]) => tag),
]);

/**
 * Whether one vector-JSON value is a plain (prototype-Object) record.
 *
 * @param value - The value to test.
 * @returns `true` for plain objects (never `JsonNumber` tokens/arrays).
 */
function isPlainRecord(value: JsonValue): value is Record<string, JsonValue> {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/**
 * Extract a finite `$type: float` payload's spelling, if any.
 *
 * @param value - A vector-JSON value.
 * @returns The canonical float spelling for finite float tags (raw-token
 *   convertible), or `null` (non-float payloads, NaN/Infinity spellings).
 */
function finiteFloatSpelling(value: JsonValue): string | null {
  if (!isPlainRecord(value) || value["$type"] !== "float") {
    return null;
  }
  const spelling = value["value"];
  if (
    typeof spelling !== "string" ||
    ["NaN", "Infinity", "-Infinity"].includes(spelling)
  ) {
    return null;
  }
  return spelling;
}

/**
 * Tag integral-float number TOKENS so decode preserves Python float-ness.
 *
 * Python's `json.loads` keeps `18.0` a `float`; the TS
 * `decodeInputKwargs` collapses the `JsonNumber("18.0")` token to the
 * integer-valued number `18`. Rewriting such tokens as `$type: float`
 * payloads before decoding makes them `PyFloat` — the established
 * float-ness carrier (D13 / Risk #3) — so both bridges construct with
 * the same value kind. Integer tokens and fractional floats pass
 * through untouched.
 *
 * @param value - The undecoded vector-JSON value.
 * @returns The value with every integral-float token float-tagged.
 */
function tagIntegralFloatTokens(value: JsonValue): JsonValue {
  if (value instanceof JsonNumber) {
    if (!value.isIntegerToken()) {
      const parsed = value.toNumber();
      if (Number.isFinite(parsed) && Number.isInteger(parsed)) {
        return { $type: "float", value: pythonFloatStr(parsed) };
      }
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => tagIntegralFloatTokens(item));
  }
  if (isPlainRecord(value)) {
    const out: Record<string, JsonValue> = {};
    for (const [key, member] of Object.entries(value)) {
      out[key] = tagIntegralFloatTokens(member);
    }
    return out;
  }
  return value;
}

/**
 * Re-encode one tagged vector-JSON value in Python's EXPECT encoding.
 *
 * oracle-py's `oracle.call` output side is `_encode_result` →
 * `encode_expect_value` (measured semantics): rich `$type` members are
 * absent EVERYWHERE, floats are raw number tokens EVERYWHERE, and the
 * built-in tags (`datetime`, `date`, `bytes`, `SecretStr`, `callback`)
 * stay. The conformance bindings encode through the INPUT-side registry
 * (`runGuarded` → `codecs.encodeValue`), so the oracle applies this
 * transform to mirror oracle-py byte-for-byte. Non-finite float tags
 * stay tagged (raw NaN/Infinity tokens are illegal vector JSON — the
 * D6 canonicalizer rejects the payload on both sides symmetrically).
 *
 * @param value - The tagged vector-JSON value.
 * @returns The expect-encoded value.
 */
function toExpectEncoding(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map((item) => toExpectEncoding(item));
  }
  if (isPlainRecord(value)) {
    const spelling = finiteFloatSpelling(value);
    if (spelling !== null) {
      return new JsonNumber(spelling);
    }
    const out: Record<string, JsonValue> = {};
    for (const [key, member] of Object.entries(value)) {
      if (
        key === "$type" &&
        typeof member === "string" &&
        RICH_TAGS.has(member)
      ) {
        continue;
      }
      out[key] = toExpectEncoding(member);
    }
    return out;
  }
  return value;
}

/**
 * Re-encode one tagged vector-JSON value in Python's INPUT encoding.
 *
 * oracle-py's `codec.roundtrip` output side is `encode_input_value`
 * (measured semantics): rich `$type` tags stay, floats INSIDE rich
 * payloads stay `$type: float`-tagged (recursively), but floats in
 * PLAIN positions — top level, plain lists/dicts outside any rich
 * payload — are raw number tokens. The TS registry tags every `PyFloat`
 * unconditionally, so this transform un-tags exactly the plain-position
 * ones.
 *
 * @param value - The registry-encoded vector-JSON value.
 * @param inRich - Whether the walk is inside a rich `$type` payload.
 * @returns The input-encoded value.
 */
function toInputEncoding(value: JsonValue, inRich: boolean): JsonValue {
  if (Array.isArray(value)) {
    return value.map((item) => toInputEncoding(item, inRich));
  }
  if (isPlainRecord(value)) {
    if (!inRich) {
      const spelling = finiteFloatSpelling(value);
      if (spelling !== null) {
        return new JsonNumber(spelling);
      }
    }
    const tag = value["$type"];
    const childRich = inRich || (typeof tag === "string" && RICH_TAGS.has(tag));
    const out: Record<string, JsonValue> = {};
    for (const [key, member] of Object.entries(value)) {
      out[key] = toInputEncoding(member, childRich);
    }
    return out;
  }
  return value;
}

/**
 * Register the oracle-only replay dataclass codecs (see
 * {@link ORACLE_REPLAY_ROWS}) on one registry instance.
 *
 * Decode = pass every non-`$type` member (child-decoded) to the real
 * constructor — guards fire exactly like Python's `_decode_dataclass`;
 * the always-`null` cache slots are constructor-ignored on both sides.
 * Encode = own-field walk (`$type` first), mirroring Python
 * `_encode_common(tagged_models=True)` over declared dataclass fields.
 *
 * @param codecs - The oracle's codec registry.
 */
function registerOracleReplayCodecs(codecs: RunnerDeps["codecs"]): void {
  for (const [tag, cls] of ORACLE_REPLAY_ROWS) {
    codecs.registerTagCodec(
      tag,
      (payload, decodeField) => {
        const bag: Record<string, unknown> = {};
        for (const [key, member] of Object.entries(payload)) {
          if (key !== "$type") {
            bag[key] = decodeField(member);
          }
        }
        try {
          return new cls(fieldsFromBag(bag));
        } catch (error) {
          throw new UndecodableValueError(
            `could not reconstruct ${tag} from vector fields: ${String(error)}`,
          );
        }
      },
      {
        matches: (value) => value instanceof cls,
        encode: (value, encodeChild) => {
          const out: Record<string, JsonValue> = { $type: tag };
          for (const [key, member] of Object.entries(value as object)) {
            out[key] = encodeChild(member);
          }
          return out;
        },
      },
    );
  }
}

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
 * Stateful protocol server: one instance per oracle process/session.
 *
 * Transport-free by design: {@link handleLine} maps one request line to
 * one response line, so the stdin/stdout loop (`main.ts`) and the unit
 * tests share the exact same dispatch path.
 *
 * @example
 * ```typescript
 * const server = new OracleServer(resolveIdentity());
 * await server.handleLine('{"jsonrpc": "2.0", "id": 1, "method": "oracle.info"}');
 * // '{"jsonrpc": "2.0", "id": 1, "result": {...}}'
 * ```
 */
export class OracleServer {
  /** The identity block served by `oracle.info`. */
  private readonly identity: OracleIdentity;

  /**
   * The SAME bindings the conformance runner uses (phase2-design C9:
   * one registration module, imported by both, so runner and oracle can
   * never disagree): the full rich `$type` codec table plus the
   * `compat.*`/`wirestub.*`/`types.*` implementation registry.
   */
  private readonly deps: RunnerDeps = createRunnerDeps(RECORD_EPOCH);

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
    registerOracleReplayCodecs(this.deps.codecs);
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
   * Async since Phase-3 B0-2: bound implementations may be async (the
   * `api_client._iter_jsonl_lines` chunk adapter drives an async
   * generator), so dispatch awaits them — closing the former
   * "async bindings are out of oracle scope until Phase 3" note.
   *
   * @param line - One newline-stripped request line.
   * @returns The single-line, ASCII-safe JSON response, or `null` for
   *   blank lines (ignored per oracle-protocol.md §1).
   */
  async handleLine(line: string): Promise<string | null> {
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
      result = await this.dispatch(method, request.get("params"));
    } catch (error) {
      if (error instanceof OracleProtocolError) {
        return this.encodeResponse(requestId, {
          error: [error.code, error.message],
        });
      }
      const name = error instanceof Error ? error.name : typeof error;
      const detail = error instanceof Error ? error.message : String(error);
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
  private async dispatch(
    method: string,
    params: RawValue | undefined,
  ): Promise<SerializableValue> {
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
    if (method === "codec.roundtrip") {
      if (!(params instanceof RawObject)) {
        throw new OracleProtocolError(
          JSONRPC_INVALID_PARAMS,
          "codec.roundtrip requires a params object",
        );
      }
      return this.codecRoundtrip(params);
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
  private async callFromParams(params: RawObject): Promise<SerializableValue> {
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
  async callApi(api: string, rawInput: RawObject): Promise<SerializableValue> {
    if (COMPAT_APIS.has(api)) {
      return this.executeCompat(api, rawInput);
    }
    if (!api.startsWith("wirestub.") && this.deps.implementations.has(api)) {
      // Bound library entry points: served through the SAME bindings the
      // conformance runner replays (protocol §8 scope note). `wirestub.*`
      // is excluded — its bindings need the vector replay TRANSPORT
      // (`context.fetch` interactions), which oracle calls do not carry.
      return this.executeBound(api, rawInput);
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
   * Execute one bindings-registry entry and encode its outcome as DATA.
   *
   * The invocation context mirrors the conformance runner's: decoded
   * kwargs (rich `$type` values reconstructed through the shared codec
   * table), the undecoded lossless input, fresh per-call shims at the
   * §7 record epoch, and an empty state map (the `types.*` surface is
   * setup-free).
   *
   * @param api - A bound Python dotted api name.
   * @param rawInput - The undecoded kwargs.
   * @returns `{ok: true, output}` for returns; `{ok: false, error}` for
   *   thrown library errors (class + code, messages stripped, R5.4).
   * @throws OracleProtocolError - For undecodable input (`-32602`) or an
   *   unencodable/uncanonicalizable output (`-32000`). Async bindings
   *   are awaited (Phase-3 B0-2); rejections encode as error DATA like
   *   sync throws.
   */
  private async executeBound(
    api: string,
    rawInput: RawObject,
  ): Promise<SerializableValue> {
    const inputJson: Record<string, JsonValue> = {};
    for (const [name, value] of rawInput.entries) {
      // Integral-float tokens carry Python float-ness only in the raw
      // token; re-tag them so decode yields PyFloat (D13 / Risk #3).
      inputJson[name] = tagIntegralFloatTokens(toJsonValue(value));
    }
    let kwargs: Record<string, unknown>;
    try {
      kwargs = this.deps.codecs.decodeInputKwargs(inputJson);
    } catch (error) {
      if (error instanceof UndecodableValueError) {
        throw new OracleProtocolError(
          JSONRPC_INVALID_PARAMS,
          `input decode failed: ${error.message}`,
        );
      }
      throw error;
    }
    const context: InvocationContext = {
      api,
      kwargs,
      rawInput: inputJson,
      shims: createShims(this.deps.recordEpoch),
      state: new Map<string, unknown>(),
    };
    const implementation = this.deps.implementations.get(api);
    if (implementation === undefined) {
      throw new OracleProtocolError(
        JSONRPC_INTERNAL_ERROR,
        `binding vanished for ${JSON.stringify(api)}`,
      );
    }
    let returned: unknown;
    try {
      returned = await implementation(context);
    } catch (error) {
      return { ok: false, error: this.errorPayload(error) };
    }
    let output: JsonValue;
    try {
      // Mirror oracle-py's `_encode_result` (EXPECT encoding): the
      // bindings encode through the input-side tagged registry, so rich
      // `$type` members are stripped and float tags become raw tokens
      // (built-in non-float tags stay).
      output = toExpectEncoding(this.deps.codecs.encodeValue(returned));
      canonicalize(output);
    } catch (error) {
      throw new OracleProtocolError(
        JSONRPC_INTERNAL_ERROR,
        `output encode/canonicalization failed: ${String(error)}`,
      );
    }
    return { ok: true, output };
  }

  /**
   * Round-trip one `$type`-tagged value through the codec table
   * (protocol 1.1 addendum, oracle-protocol.md §8; phase2-design C9).
   *
   * Decodes `params.value` with the FULL rich codec table (reconstructing
   * the real core instances) and re-encodes with the input-side tagged
   * encoder, so a valid tagged payload round-trips to itself modulo D6
   * canonicalization.
   *
   * @param params - The raw params object; must carry a `value` member
   *   (any vector-JSON value — untagged values round-trip through the
   *   identity path).
   * @returns `{ok: true, output: encode(decode(value))}`.
   * @throws OracleProtocolError - `-32602` when `value` is missing or
   *   undecodable (unknown tag, malformed payload, constructor guard
   *   failure during reconstruction — §8: the harness only ships
   *   payloads it encoded from live instances); `-32000` when the
   *   round-tripped product cannot be encoded or canonicalized.
   */
  private codecRoundtrip(params: RawObject): SerializableValue {
    const raw = params.get("value");
    if (raw === undefined) {
      throw new OracleProtocolError(
        JSONRPC_INVALID_PARAMS,
        "codec.roundtrip requires params.value",
      );
    }
    let decoded: unknown;
    try {
      // Integral-float tokens re-tag first so decode preserves Python
      // float-ness (see executeBound); the output side then un-tags
      // plain-position floats to mirror `encode_input_value` exactly.
      decoded = this.deps.codecs.decodeValue(
        tagIntegralFloatTokens(toJsonValue(raw)),
      );
    } catch (error) {
      throw new OracleProtocolError(
        JSONRPC_INVALID_PARAMS,
        `value decode failed: ${String(error)}`,
      );
    }
    let output: JsonValue;
    try {
      output = toInputEncoding(this.deps.codecs.encodeValue(decoded), false);
      canonicalize(output);
    } catch (error) {
      throw new OracleProtocolError(
        JSONRPC_INTERNAL_ERROR,
        `round-trip encode/canonicalization failed: ${String(error)}`,
      );
    }
    return { ok: true, output };
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
    } catch (error) {
      if (error instanceof OracleProtocolError) {
        throw error;
      }
      return { ok: false, error: this.errorPayload(error) };
    }
    let output: JsonValue;
    try {
      output = encodeExpectValue(returned);
      canonicalize(output);
    } catch (error) {
      throw new OracleProtocolError(
        JSONRPC_INTERNAL_ERROR,
        `output encode/canonicalization failed: ${String(error)}`,
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
      const text = kwargs["value"];
      const width = kwargs["width"];
      if (typeof text !== "string" || typeof width !== "number") {
        throw new TypeError(
          "zfill() requires (value: str, width: int) per the Python reference",
        );
      }
      return zfill(text, width);
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
        decoded[name] = this.deps.codecs.decodeValue(toJsonValue(value));
      }
    } catch (error) {
      if (error instanceof UndecodableValueError) {
        throw new OracleProtocolError(
          JSONRPC_INVALID_PARAMS,
          `input decode failed: ${error.message}`,
        );
      }
      throw error;
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
