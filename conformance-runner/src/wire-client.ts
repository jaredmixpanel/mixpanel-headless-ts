/**
 * B4 wire-enablement seam (P3-5 §1-§3, landed with shard C1):
 * `clientFromSession` — the ONE shared client-construction helper every
 * B4 wire binding uses — plus the wire error/result codec twins and the
 * C1 client-core binding registrations.
 *
 * Contract (b4-packets.md §Wire enablement, binding on every B4 shard):
 * 1. `call.session` (D5 canonical fake session) → `parseAccount`
 *    (Phase-2 C4 factory) → `Session` → `createMixpanelClient` — auth
 *    headers are built by the REAL Phase-2 auth model and diffed
 *    byte-exactly against recorded headers.
 * 2. The constructed client is MEMOIZED in `context.state` under
 *    {@link CLIENT_STATE_KEY} so `call.setup[]` entries and the measured
 *    call operate on the SAME instance (`runner.ts` shares one state map
 *    per vector).
 * 3. Determinism seams: `fetch` = the vector harness, zero-delay sleep,
 *    `random: () => 0`, `now` = the frozen record epoch.
 * 4. Binding honesty (P3-5 §3): every binding calls the ported client
 *    method by name and NOTHING else — kwarg plumbing and output-codec
 *    twins only, no request assembly, no path derivation.
 */

import {
  type Account,
  BookmarkValidationError,
  createMixpanelClient,
  JsonNumber as CoreJsonNumber,
  type MixpanelClient,
  MixpanelHeadlessError,
  type OAuthTokenAccount,
  parseAccount,
  type Session,
  type TokenResolver,
  type WorkspaceRef,
} from "@mixpanel-headless/core";

import {
  encodeExpectValue,
  UndecodableValueError,
  UnencodableValueError,
} from "./codecs.js";
import { JsonNumber, type JsonValue } from "./json-value.js";
import type {
  ExpectErrorConvertible,
  ImplementationRegistry,
  InvocationContext,
} from "./runner.js";

/** The ONE well-known `context.state` key for the memoized client. */
export const CLIENT_STATE_KEY = "api_client";

/**
 * Read a required kwarg (local twin of the bindings.ts helper — kept
 * here so the wire module stays self-contained for the B4 shards).
 *
 * @param context - The invocation context.
 * @param name - The Python kwarg name.
 * @returns The decoded kwarg value.
 * @throws Error - When the kwarg is missing from `call.input`.
 */
export function requireWireKwarg(
  context: InvocationContext,
  name: string,
): unknown {
  if (!Object.hasOwn(context.kwargs, name)) {
    throw new Error(
      `${context.api}: vector call.input is missing required kwarg ${JSON.stringify(name)}`,
    );
  }
  return context.kwargs[name];
}

/**
 * Extract the injected replay fetch (wire vectors always carry one).
 *
 * @param context - The invocation context.
 * @returns The `VectorFetch` seam.
 * @throws Error - When invoked without a fetch (a corpus/registry bug).
 */
function requireWireFetch(context: InvocationContext): typeof fetch {
  if (context.fetch === undefined) {
    throw new Error(
      `${context.api}: wire binding invoked without an injected fetch`,
    );
  }
  return context.fetch;
}

/**
 * Convert one raw D5 session scalar to a plain JS value (session
 * objects are lossless-loaded, so numeric members ride as
 * {@link JsonNumber} tokens).
 *
 * @param value - The raw member.
 * @returns The native value.
 */
function sessionScalar(value: JsonValue | undefined): unknown {
  if (value instanceof JsonNumber) {
    return value.toNumber();
  }
  return value;
}

/**
 * Rebuild a `Session` from a vector `call.session` object — the TS twin
 * of the Python runner's `targets.py::build_session` (:48-125): fake
 * credentials verbatim, D5.6 custom headers, `workspace_id` →
 * WorkspaceRef.
 *
 * @param raw - The raw session object.
 * @returns The reconstructed session plus the adopted browser bearer
 *   (D5.2), when the account is `oauth_browser`.
 * @throws Error - On an unknown account type or unreplayable shape.
 */
export function buildReplaySession(raw: JsonValue): {
  session: Session;
  browserToken: string | null;
} {
  if (
    typeof raw !== "object" ||
    raw === null ||
    Array.isArray(raw) ||
    raw instanceof JsonNumber
  ) {
    throw new Error("call.session is not an object");
  }
  const encoded = raw;
  const type = String(sessionScalar(encoded["type"]));
  const name = String(
    sessionScalar(encoded["account_name"]) ?? "conformance_replay",
  );
  const region = String(sessionScalar(encoded["region"]) ?? "us");
  const defaultProject = sessionScalar(encoded["default_project"]);
  const projectBag =
    defaultProject !== undefined && defaultProject !== null
      ? { default_project: String(defaultProject) }
      : {};
  let account: Account;
  let browserToken: string | null = null;
  switch (type) {
    case "service_account": {
      account = parseAccount({
        type,
        name,
        region,
        username: String(sessionScalar(encoded["username"])),
        secret: String(sessionScalar(encoded["secret"])),
        ...projectBag,
      });

      break;
    }
    case "oauth_token": {
      if (!Object.hasOwn(encoded, "token")) {
        throw new Error(
          "oauth_token session without a token is unreplayable " +
            "(the recorder adopts resolver-observed bearers, D5.2)",
        );
      }
      account = parseAccount({
        type,
        name,
        region,
        token: String(sessionScalar(encoded["token"])),
        ...projectBag,
      });

      break;
    }
    case "oauth_browser": {
      account = parseAccount({ type, name, region });
      const token = sessionScalar(encoded["token"]);
      browserToken =
        token === undefined || token === null ? null : String(token);

      break;
    }
    default: {
      throw new Error(`unknown session type ${JSON.stringify(type)}`);
    }
  }
  const workspaceId = sessionScalar(encoded["workspace_id"]);
  const workspace: WorkspaceRef | null =
    workspaceId !== undefined && workspaceId !== null
      ? { id: Number(workspaceId) }
      : null;
  const headers = new Map<string, string>();
  const rawHeaders = encoded["headers"];
  if (
    typeof rawHeaders === "object" &&
    rawHeaders !== null &&
    !Array.isArray(rawHeaders) &&
    !(rawHeaders instanceof JsonNumber)
  ) {
    for (const [key, value] of Object.entries(rawHeaders)) {
      headers.set(key, String(sessionScalar(value)));
    }
  }
  return {
    session: {
      account,
      project: { id: String(sessionScalar(encoded["project_id"])) },
      workspace,
      headers,
    },
    browserToken,
  };
}

/**
 * The replay token resolver: `oauth_browser` serves the vector-adopted
 * bearer (D5.2 — `targets.py::_StaticTokenResolver`); `oauth_token`
 * serves the inline account token (the OnDiskTokenResolver inline arm).
 *
 * @param browserToken - The adopted bearer, or `null`.
 * @returns The resolver.
 */
function replayTokenResolver(browserToken: string | null): TokenResolver {
  return {
    getBrowserToken(): Promise<string> {
      if (browserToken === null) {
        return Promise.reject(
          new Error(
            "oauth_browser session without an adopted token is " +
              "unreplayable (design D5.2)",
          ),
        );
      }
      return Promise.resolve(browserToken);
    },
    getStaticToken(account: OAuthTokenAccount): Promise<string> {
      const token = account.token;
      if (token === undefined || token === null) {
        return Promise.reject(
          new Error("oauth_token session without an inline token"),
        );
      }
      return Promise.resolve(token.reveal());
    },
  };
}

/**
 * Build (or fetch the memoized) client for a wire vector — P3-5 §1/§2.
 *
 * @param context - The invocation context (session + fetch + shims +
 *   the shared per-vector state map).
 * @returns The vector's ONE client instance.
 * @throws Error - When the vector carries no session (a corpus bug for
 *   an `api_client.*` name).
 */
export function clientFromSession(context: InvocationContext): MixpanelClient {
  const existing = context.state.get(CLIENT_STATE_KEY);
  if (existing !== undefined) {
    return existing as MixpanelClient;
  }
  if (context.session === undefined) {
    throw new Error(`${context.api}: wire vector carries no call.session`);
  }
  const { session, browserToken } = buildReplaySession(context.session);
  // Recorded non-default constructor kwargs (schema extension 12; the
  // Python runner reads exactly `max_retries` — execute.py:243-245).
  let maxRetries: number | undefined;
  const clientOptions = context.clientOptions;
  if (
    typeof clientOptions === "object" &&
    clientOptions !== null &&
    !Array.isArray(clientOptions) &&
    !(clientOptions instanceof JsonNumber)
  ) {
    const raw = clientOptions["max_retries"];
    if (raw instanceof JsonNumber) {
      maxRetries = raw.toNumber();
    } else if (typeof raw === "number") {
      maxRetries = raw;
    }
  }
  const client = createMixpanelClient({
    session,
    fetch: requireWireFetch(context),
    // P3-5 §2 determinism seams: zero-delay sleep (durations are not
    // vector-observable), zero RNG (kills jitter variance), frozen now.
    sleep: async (): Promise<void> => {
      /* zero-delay */
    },
    random: () => 0,
    now: (): Date => context.shims.now(),
    tokenResolver: replayTokenResolver(browserToken),
    ...(maxRetries === undefined ? {} : { maxRetries }),
  });
  context.state.set(CLIENT_STATE_KEY, client);
  return client;
}

/**
 * Convert a CORE JsonValue tree (library output — core `JsonNumber`
 * tokens, native scalars) into the RUNNER's vector-JSON domain so
 * `encodeExpectValue`/`canonicalize` can compare it (the two JsonNumber
 * classes are distinct — packet C1 notes decision 2). Raw number tokens
 * are preserved verbatim, keeping the recorded `18.0`-vs-`18`
 * distinction intact (D6 rule 3).
 *
 * @param value - The core-domain value.
 * @returns The runner-domain value.
 * @throws UnencodableValueError - Non-finite native numbers (D6 rule 5
 *   — mirrors the recorder's `_reject_bad_float`).
 */
export function coreToVectorJson(value: unknown): JsonValue {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof CoreJsonNumber) {
    return new JsonNumber(value.raw);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new UnencodableValueError(
        `non-finite number in wire output: ${String(value)}`,
      );
    }
    return value;
  }
  if (
    typeof value === "boolean" ||
    typeof value === "string" ||
    typeof value === "bigint"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => coreToVectorJson(item));
  }
  if (typeof value === "object") {
    const out: Record<string, JsonValue> = {};
    for (const [key, member] of Object.entries(value)) {
      out[key] = coreToVectorJson(member);
    }
    return out;
  }
  throw new UnencodableValueError(
    `unencodable wire output member: ${String(value)}`,
  );
}

/**
 * A wire-path library error re-thrown in vector `expect.error` form —
 * the TS twin of the recorder/replay shared `emit._encode_error`
 * (:749-794): `{class, code}` plus `details_contain` carrying EVERY
 * encodable detail except the advisory keys (full structural equality
 * at `canonicalizeError`, exactly like the Python runner's
 * `_diff_error`).
 */
export class WireCoreError extends Error implements ExpectErrorConvertible {
  /** The original core exception. */
  readonly original: MixpanelHeadlessError;

  /**
   * Wrap a core exception.
   *
   * @param original - The thrown `MixpanelHeadlessError`.
   */
  constructor(original: MixpanelHeadlessError) {
    super(original.message, { cause: original });
    this.name = "WireCoreError";
    this.original = original;
  }

  /**
   * Encode as a vector `expect.error` value (the `_encode_error` twin).
   *
   * @returns `{class, code, errors?}` for BookmarkValidationError,
   *   `{class, code, details_contain?}` for every other core error.
   */
  toExpectError(): JsonValue {
    if (this.original instanceof BookmarkValidationError) {
      return {
        class: this.original.name,
        code: this.original.code,
        errors: this.original.errors.map((err) => ({
          path: err.path,
          code: err.code,
          severity: err.severity,
        })),
      };
    }
    const encoded: Record<string, JsonValue> = {
      class: this.original.name,
      code: this.original.code,
    };
    const details: Record<string, JsonValue> = {};
    for (const [key, value] of Object.entries(this.original.details)) {
      if (key === "message" || key === "suggestion" || key === "fix") {
        continue;
      }
      try {
        details[key] = encodeExpectValue(coreToVectorJson(value));
      } catch (error) {
        if (
          error instanceof UnencodableValueError ||
          error instanceof UndecodableValueError
        ) {
          continue;
        }
        throw error;
      }
    }
    if (Object.keys(details).length > 0) {
      encoded["details_contain"] = details;
    }
    return encoded;
  }
}

/**
 * Invoke a wire client method, converting the result to vector JSON and
 * wrapping coded library errors for the runner's error diff.
 *
 * @param invoke - Thunk performing the real client call.
 * @returns The vector-JSON encoding of the result.
 * @throws WireCoreError - When the call raises a core exception.
 * @throws unknown - Anything else, unchanged (harness sequence errors
 *   and runner/infra bugs must reach the runner intact).
 */
export async function runWire(
  invoke: () => Promise<unknown>,
): Promise<JsonValue> {
  try {
    return coreToVectorJson(await invoke());
  } catch (error) {
    if (error instanceof MixpanelHeadlessError) {
      throw new WireCoreError(error);
    }
    throw error;
  }
}

/**
 * Read an optional string-record kwarg (absent stays absent — R3.5).
 *
 * @param context - The invocation context.
 * @param name - The kwarg name.
 * @returns The record bag, or an empty bag when absent/null.
 */
export function optionalRecord(
  context: InvocationContext,
  name: string,
): Record<string, unknown> | undefined {
  const value = context.kwargs[name];
  if (value === undefined || value === null) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

/**
 * Encode a returned `WorkspaceRef` exactly as the recorder's
 * `encode_expect_value` walks the Pydantic model: every declared field
 * under its Python name, `null` for absent optionals.
 *
 * @param ref - The returned workspace ref.
 * @returns The 4-field plain encoding.
 */
function encodeWorkspaceRef(ref: WorkspaceRef): JsonValue {
  return {
    id: ref.id,
    name: ref.name ?? null,
    is_default: ref.is_default ?? null,
    project_id: ref.project_id ?? null,
  };
}

/**
 * Register the B4-C1 client-core bindings — the 11 packet-C1 api-index
 * names (`app_request`†, `close`, `maybe_scoped_path`†, `request`,
 * `require_scoped_path`, `resolve_workspace`, `resolve_workspace_id`,
 * `set_workspace_id`, `use`, `list_workspaces`,
 * `projects_metadata_index`; † = B0-owned modules reached through the
 * client by name, R10.8).
 *
 * Binding honesty (P3-5 §3): each binding is memoized
 * `clientFromSession` + ONE client-method call + kwarg passthrough; the
 * only output adaptations are the codec twins ({@link coreToVectorJson},
 * {@link encodeWorkspaceRef}, `PublicWorkspace.toJSON`).
 *
 * Oracle note: wire api names have NO oracle `call` surface (P3-2 c/e —
 * exempt from the both-bridge probe); registration here is complete.
 *
 * @param implementations - The registry to extend.
 */
export function registerApiClientCoreBindings(
  implementations: ImplementationRegistry,
): void {
  implementations.register("api_client.app_request", async (context) => {
    const client = clientFromSession(context);
    const params = optionalRecord(context, "params");
    const jsonBody = optionalRecord(context, "json_body");
    const formBody = optionalRecord(context, "form_body");
    const raw = context.kwargs["raw"];
    return runWire(() =>
      client.appRequest(
        requireWireKwarg(context, "method") as string,
        requireWireKwarg(context, "path") as string,
        {
          ...(params === undefined
            ? {}
            : { params: params as Record<string, string> }),
          ...(jsonBody === undefined ? {} : { jsonBody }),
          ...(formBody === undefined
            ? {}
            : { formBody: formBody as Record<string, string> }),
          ...(raw === undefined ? {} : { raw: raw as boolean }),
        },
      ),
    );
  });

  implementations.register("api_client.request", async (context) => {
    const client = clientFromSession(context);
    const params = optionalRecord(context, "params");
    const jsonBody = optionalRecord(context, "json_body");
    const headers = optionalRecord(context, "headers");
    const timeout = context.kwargs["timeout"];
    return runWire(() =>
      client.request(
        requireWireKwarg(context, "method") as string,
        requireWireKwarg(context, "url") as string,
        {
          ...(params === undefined ? {} : { params }),
          ...(jsonBody === undefined ? {} : { jsonBody }),
          ...(headers === undefined
            ? {}
            : { headers: headers as Record<string, string> }),
          ...(typeof timeout === "number" ? { timeoutSeconds: timeout } : {}),
        },
      ),
    );
  });

  implementations.register("api_client.close", async (context) => {
    const client = clientFromSession(context);
    await client.close();
    return null;
  });

  implementations.register("api_client.use", async (context) => {
    const client = clientFromSession(context);
    const account = context.kwargs["account"];
    const project = context.kwargs["project"];
    const workspace = context.kwargs["workspace"];
    return runWire(async () => {
      await client.use({
        ...(account !== undefined && account !== null
          ? { account: parseAccount(account) }
          : {}),
        ...(project !== undefined && project !== null
          ? {
              project: project as string | { readonly id: string },
            }
          : {}),
        ...(workspace !== undefined && workspace !== null
          ? { workspace: workspace as number | WorkspaceRef }
          : {}),
      });
      return null;
    });
  });

  implementations.register("api_client.set_workspace_id", (context) => {
    const client = clientFromSession(context);
    const value = requireWireKwarg(context, "workspace_id");
    client.setWorkspaceId(value === null ? null : (value as number));
    return null;
  });

  implementations.register("api_client.maybe_scoped_path", async (context) => {
    const client = clientFromSession(context);
    return runWire(() =>
      Promise.resolve(
        client.maybeScopedPath(
          requireWireKwarg(context, "domain_path") as string,
        ),
      ),
    );
  });

  implementations.register(
    "api_client.require_scoped_path",
    async (context) => {
      const client = clientFromSession(context);
      return runWire(() =>
        client.requireScopedPath(
          requireWireKwarg(context, "domain_path") as string,
        ),
      );
    },
  );

  implementations.register("api_client.resolve_workspace", async (context) => {
    const client = clientFromSession(context);
    return runWire(async () =>
      encodeWorkspaceRef(await client.resolveWorkspace()),
    );
  });

  implementations.register(
    "api_client.resolve_workspace_id",
    async (context) => {
      const client = clientFromSession(context);
      return runWire(() => client.resolveWorkspaceId());
    },
  );

  implementations.register("api_client.list_workspaces", async (context) => {
    const client = clientFromSession(context);
    return runWire(async () => {
      const workspaces = await client.listWorkspaces();
      // Recorder twin: `encode_expect_value` walks Pydantic model_fields
      // to the plain to-dict shape — `EntityModel.toJSON` is that walk.
      return workspaces.map((ws) => ws.toJSON());
    });
  });

  implementations.register(
    "api_client.projects_metadata_index",
    async (context) => {
      const client = clientFromSession(context);
      return runWire(() => client.projectsMetadataIndex());
    },
  );
}
