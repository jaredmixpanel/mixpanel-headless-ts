/**
 * B6-W7 R10.9 harness — the drop-filter / custom-property /
 * lookup-table / custom-event facade wire+edge set (packet
 * `b6-packets.md` §9 "R10.9 `throwaway/b6-w7/`").
 *
 * The W7 members are facade delegations with no oracle-call surface
 * (all-wire batch, §11.5), so the harness runs them through the
 * injected-fetch seam with hand-built interactions and asserts:
 *
 *   (i)   delegation equivalence — facade result === direct client
 *         result re-validated through the SAME model seam, over the
 *         same canned interaction;
 *   (ii)  wire status branches — `create_drop_filter` (200 / 400) and
 *         `download_lookup_table` (200 / 404 / 500), per the packet;
 *   (iii) the mandatory edge set (18.0, 1.5, true, null, [], "", "𝒳")
 *         pushed through every param whose declared annotation admits
 *         it (Discrepancy #8: the contract IS the annotation — the two
 *         `filters: Any` fields and the opaque `dict[str, Any]`
 *         passthroughs admit the whole set; `event_name: str | None`
 *         admits "" / "𝒳"; `active: bool | None` admits `true`;
 *         `poll_interval` / `max_poll_seconds` are the shard's only
 *         float params). NO integer-like unknown keys anywhere
 *         (#9/#10);
 *   (iv)  EVERY W7-local branch. The shard has ZERO empty-response
 *         guards (grep-verified over `workspace.py:7583-8525`), so the
 *         local branch set is: the `list_custom_properties`
 *         `displayFormula` re-raise (all five arms), the upload
 *         orchestration (sync-complete / async-poll-then-ready /
 *         timeout / FAILURE / REVOKED / NOTFOUND / SUCCESS-with-
 *         non-dict-result / UNKNOWN-keeps-polling), the `readFile`
 *         seam default, the `data-group-id` present/absent arms of
 *         BOTH form-data builders, the `name` back-fill, the three
 *         dump spellings, and `RESPONSE_VALIDATION_ERROR` from a
 *         malformed 200 body for every validated member.
 *
 *     npx vite-node throwaway/b6-w7/wire-edges.ts
 *
 * Deterministic: no RNG, no seed — every case is a hand-built canned
 * interaction over the injected-fetch seam, and the poll loop rides a
 * virtual clock (no real timers).
 *
 * THROWAWAY: deleted at the B6 gate; the RUN record lives in
 * `context/phase3/notes/B6-W7-notes.md` §3, which survives.
 */

import {
  createMockClient,
  makeSession,
  type CannedResponse,
  type CapturedFetchRequest,
} from "../../packages/core/test/client/client-test-helpers.js";
import type { MixpanelClient } from "../../packages/core/src/client/client.js";
import { toNativeJson } from "../../packages/core/src/client/json-value.js";
import {
  validateResponseModel,
  validateResponseModels,
} from "../../packages/core/src/client/response-validation.js";
import { QueryError } from "../../packages/core/src/errors.js";
import { Workspace } from "../../packages/core/src/workspace.js";
import {
  ComposedPropertyValue,
  CreateCustomEventParams,
  CreateCustomPropertyParams,
  CreateDropFilterParams,
  CustomProperty,
  DropFilter,
  LookupTable,
  MarkLookupTableReadyParams,
  UpdateCustomPropertyParams,
  UpdateDropFilterParams,
  UpdateLookupTableParams,
  UploadLookupTableParams,
} from "../../packages/core/src/types/entities/data-governance.js";
import { CustomPropertyResourceType } from "../../packages/core/src/types/enums.js";
import { UpdateEventDefinitionParams } from "../../packages/core/src/types/entities/lexicon.js";
import * as members from "../../packages/core/src/workspace-members/governance-data.js";

let checks = 0;
let failures = 0;

/**
 * Record one expectation.
 *
 * @param label - What is being checked.
 * @param actual - The observed value (JSON-compared).
 * @param expected - The expected value.
 */
function check(label: string, actual: unknown, expected: unknown): void {
  checks += 1;
  const a = JSON.stringify(actual) ?? "undefined";
  const b = JSON.stringify(expected) ?? "undefined";
  if (a !== b) {
    failures += 1;
    console.log(`FAIL ${label}\n  actual   ${a}\n  expected ${b}`);
  }
}

/**
 * Run a thunk and describe the thrown error.
 *
 * @param fn - The thunk.
 * @returns `[name, code]`, or `["<resolved>", ""]` when it did not throw.
 */
async function thrown(fn: () => Promise<unknown>): Promise<string[]> {
  try {
    await fn();
    return ["<resolved>", ""];
  } catch (error) {
    const err = error as { name?: string; code?: string };
    return [err.name ?? "?", err.code ?? "?"];
  }
}

const SESSION = makeSession({
  projectId: "12345",
  region: "us",
  oauthToken: "test-token",
});

/**
 * Build the facade + its client over one canned handler
 * (`_make_workspace`, `test_workspace_data_governance.py:97-116`).
 *
 * @param handler - The canned-response handler.
 * @returns The facade, its client and the capture log.
 */
function rig(handler: (request: CapturedFetchRequest) => CannedResponse): {
  ws: Workspace;
  client: MixpanelClient;
  captures: readonly CapturedFetchRequest[];
} {
  const { client, transport } = createMockClient(SESSION, handler);
  return {
    ws: new Workspace({ session: SESSION, client }),
    client,
    captures: transport.captures,
  };
}

/**
 * A stub client whose single method records its args and resolves.
 *
 * @param method - The client method name.
 * @param value - The resolved value.
 * @param calls - Log receiving each argument list.
 * @returns The stub cast to the client type.
 */
function stub(
  method: string,
  value: unknown,
  calls: unknown[][] = [],
): MixpanelClient {
  return {
    hasWorkspaceResolver: false,
    setWorkspaceResolver: (): void => {},
    [method]: (...args: unknown[]): Promise<unknown> => {
      calls.push(args);
      return Promise.resolve(value);
    },
  } as unknown as MixpanelClient;
}

/**
 * A 200 App-API envelope wrapping `results`.
 *
 * @param results - The `results` payload.
 * @returns The canned response.
 */
function ok(results: unknown): CannedResponse {
  return { status: 200, json: { status: "ok", results } };
}

/**
 * A drop-filter payload (`_drop_filter_json` twin).
 *
 * @param id - Filter ID.
 * @param eventName - Event name.
 * @returns The payload.
 */
function df(id: number, eventName: string): Record<string, unknown> {
  return { id, event_name: eventName, filters: [], active: true };
}

/**
 * A custom-property payload (`_custom_property_json` twin).
 *
 * @param id - Custom property ID.
 * @param name - Property name.
 * @returns The payload.
 */
function cp(id: number, name: string): Record<string, unknown> {
  return {
    custom_property_id: id,
    name,
    resource_type: "events",
    description: `Custom property ${name}`,
    display_formula: 'number(properties["amount"])',
    is_visible: true,
  };
}

/**
 * A lookup-table payload (`_lookup_table_json` twin).
 *
 * @param id - Table ID.
 * @param name - Table name.
 * @returns The payload.
 */
function lt(id: number, name: string): Record<string, unknown> {
  return { id, name, token: "abc123", created_at: "2026-01-01T00:00:00Z" };
}

/** The signed-URL payload every upload run starts from. */
const URL_INFO = {
  url: "https://storage.googleapis.com/upload",
  path: "gs://bucket/path",
  key: "product_id",
};

/**
 * A virtual monotonic clock whose sleep advances it (no real timers).
 *
 * @returns The seam pair.
 */
function clock(): {
  monotonic: () => number;
  sleep: (ms: number) => Promise<void>;
} {
  let seconds = 0;
  return {
    monotonic: (): number => seconds,
    sleep: (ms: number): Promise<void> => {
      seconds += ms / 1000;
      return Promise.resolve();
    },
  };
}

/**
 * The seam bag for the direct `uploadLookupTable` member calls.
 *
 * @param csv - The CSV text the fake `readFile` returns.
 * @returns The seams.
 */
function uploadSeams(csv = "a,b\n1,2\n"): members.LookupUploadSeams {
  const c = clock();
  return {
    readFile: (): Promise<Uint8Array> =>
      Promise.resolve(new TextEncoder().encode(csv)),
    monotonic: c.monotonic,
    sleep: c.sleep,
  };
}

/**
 * A stub covering the five wire calls the upload orchestrator makes.
 *
 * @param registerResult - Step-3 payload.
 * @param statuses - Successive poll payloads (last one repeats).
 * @param calls - Log of `[method, ...args]` tuples.
 * @returns The stub.
 */
function uploadStub(
  registerResult: Record<string, unknown>,
  statuses: readonly Record<string, unknown>[] = [],
  calls: unknown[][] = [],
): MixpanelClient {
  let poll = 0;
  return {
    hasWorkspaceResolver: false,
    setWorkspaceResolver: (): void => {},
    getLookupUploadUrl: (...args: unknown[]): Promise<unknown> => {
      calls.push(["getLookupUploadUrl", ...args]);
      return Promise.resolve(URL_INFO);
    },
    uploadToSignedUrl: (...args: unknown[]): Promise<void> => {
      calls.push(["uploadToSignedUrl", ...args]);
      return Promise.resolve();
    },
    registerLookupTable: (...args: unknown[]): Promise<unknown> => {
      calls.push(["registerLookupTable", ...args]);
      return Promise.resolve(registerResult);
    },
    getLookupUploadStatus: (...args: unknown[]): Promise<unknown> => {
      calls.push(["getLookupUploadStatus", ...args]);
      const value = statuses[Math.min(poll, statuses.length - 1)] ?? {};
      poll += 1;
      return Promise.resolve(value);
    },
  } as unknown as MixpanelClient;
}

/**
 * Run the whole harness.
 *
 * @returns Nothing; sets `process.exitCode` on failure.
 */
async function main(): Promise<void> {
  // -------------------------------------------------------------------
  // (i) Delegation equivalence — facade === client + the SAME model seam
  // -------------------------------------------------------------------
  {
    const payload = [df(1, "debug_log"), df(2, "test_event")];
    const a = rig(() => ok(payload));
    const b = rig(() => ok(payload));
    check(
      "(i) list_drop_filters facade === client + validateResponseModels",
      (await a.ws.listDropFilters()).map((m) => m.toJSON()),
      validateResponseModels(
        DropFilter,
        (await b.client.listDropFilters()).map((r) => toNativeJson(r)),
        { endpoint: "list_drop_filters" },
      ).map((m) => m.toJSON()),
    );
  }
  {
    const payload = cp(42, "Revenue");
    const a = rig(() => ok(payload));
    const b = rig(() => ok(payload));
    check(
      "(i) get_custom_property facade === client + validateResponseModel",
      (await a.ws.getCustomProperty("42")).toJSON(),
      validateResponseModel(
        CustomProperty,
        toNativeJson(await b.client.getCustomProperty("42")),
        { endpoint: "get_custom_property" },
      ).toJSON(),
    );
  }
  {
    const payload = [lt(1, "Products")];
    const a = rig(() => ok(payload));
    const b = rig(() => ok(payload));
    check(
      "(i) list_lookup_tables facade === client + validateResponseModels",
      (await a.ws.listLookupTables()).map((m) => m.toJSON()),
      validateResponseModels(
        LookupTable,
        (await b.client.listLookupTables({ data_group_id: null })).map((r) =>
          toNativeJson(r),
        ),
        { endpoint: "list_lookup_tables" },
      ).map((m) => m.toJSON()),
    );
  }
  {
    const opaque = { valid: true, errors: [] };
    const a = rig(() => ok(opaque));
    const b = rig(() => ok(opaque));
    const params = new CreateCustomPropertyParams({
      name: "P",
      resource_type: CustomPropertyResourceType.EVENTS,
      display_formula: "f",
      composed_properties: {
        x: new ComposedPropertyValue({ resource_type: "event" }),
      },
    });
    check(
      "(i) validate_custom_property facade === client payload",
      await a.ws.validateCustomProperty(params),
      toNativeJson(
        await b.client.validateCustomProperty(
          params.modelDumpExcludeNone({ byAlias: true }),
        ),
      ),
    );
  }

  // -------------------------------------------------------------------
  // (ii) Wire status branches
  // -------------------------------------------------------------------
  {
    const params = new CreateDropFilterParams({
      event_name: "e",
      filters: { a: 1 },
    });
    check(
      "(ii) create_drop_filter 200",
      (await rig(() => ok([df(1, "e")])).ws.createDropFilter(params)).length,
      1,
    );
    check(
      "(ii) create_drop_filter 400 -> QueryError/QUERY_FAILED",
      await thrown(() =>
        rig(() => ({
          status: 400,
          json: { error: "bad" },
        })).ws.createDropFilter(params),
      ),
      ["QueryError", "QUERY_FAILED"],
    );
  }
  {
    check(
      "(ii) download_lookup_table 200 -> bytes",
      new TextDecoder().decode(
        await rig(() => ({
          status: 200,
          text: "id,name\n1,A\n",
        })).ws.downloadLookupTable(1),
      ),
      "id,name\n1,A\n",
    );
    check(
      "(ii) download_lookup_table 404 -> QueryError/QUERY_FAILED",
      await thrown(() =>
        rig(() => ({
          status: 404,
          json: { error: "nope" },
        })).ws.downloadLookupTable(1),
      ),
      ["QueryError", "QUERY_FAILED"],
    );
    check(
      "(ii) download_lookup_table 500 -> ServerError/SERVER_ERROR",
      await thrown(() =>
        rig(() => ({ status: 500, text: "boom" })).ws.downloadLookupTable(1),
      ),
      ["ServerError", "SERVER_ERROR"],
    );
  }

  // -------------------------------------------------------------------
  // (iii) Mandatory edge set through annotation-admitting params
  // -------------------------------------------------------------------
  {
    // `filters: Any` / `Any | None` admits the WHOLE set (#8: `Any`
    // interiors are in-annotation).
    const edges: readonly unknown[] = [18.0, 1.5, true, null, [], "", "𝒳"];
    for (const edge of edges) {
      const calls: unknown[][] = [];
      await members.createDropFilter(
        stub("createDropFilter", [], calls),
        new CreateDropFilterParams({ event_name: "e", filters: edge }),
      );
      // `exclude_none` drops a None `filters` — a REQUIRED field in
      // Python, so `None` genuinely vanishes from the body.
      check(
        `(iii) create_drop_filter filters=${JSON.stringify(edge) ?? "undefined"}`,
        calls[0]?.[0],
        edge === null
          ? { event_name: "e" }
          : { event_name: "e", filters: edge },
      );
    }
    for (const name of ["", "𝒳"]) {
      const calls: unknown[][] = [];
      await members.updateDropFilter(
        stub("updateDropFilter", [], calls),
        new UpdateDropFilterParams({ id: 1, event_name: name, active: true }),
      );
      check(`(iii) update_drop_filter event_name=${name}`, calls[0]?.[0], {
        id: 1,
        event_name: name,
        active: true,
      });
    }
  }
  {
    // Opaque `dict[str, Any]` passthroughs carry the whole set.
    const opaque = {
      integral: 18.0,
      fractional: 1.5,
      flag: true,
      nothing: null,
      empty_list: [],
      empty_string: "",
      astral: "𝒳",
    };
    check(
      "(iii) get_lookup_upload_status verbatim edge payload",
      await members.getLookupUploadStatus(
        stub("getLookupUploadStatus", opaque),
        "u",
      ),
      opaque,
    );
    check(
      "(iii) validate_custom_property verbatim edge payload",
      await members.validateCustomProperty(
        stub("validateCustomProperty", opaque),
        new CreateCustomPropertyParams({
          name: "𝒳",
          resource_type: CustomPropertyResourceType.EVENTS,
          display_formula: "f",
          composed_properties: {
            x: new ComposedPropertyValue({ resource_type: "event" }),
          },
        }),
      ),
      opaque,
    );
  }
  {
    // The shard's only float params: `poll_interval` /
    // `max_poll_seconds`. 1.5 s of interval against an 18.0 s budget
    // must poll 12 times before SUCCESS is served on the last one.
    const calls: unknown[][] = [];
    const client = uploadStub(
      { uploadId: "u1" },
      [
        { uploadStatus: "PENDING" },
        { uploadStatus: "SUCCESS", result: lt(9, "F") },
      ],
      calls,
    );
    const table = await members.uploadLookupTable(
      client,
      new UploadLookupTableParams({ name: "𝒳", file_path: "𝒳.csv" }),
      { poll_interval: 1.5, max_poll_seconds: 18.0 },
      uploadSeams(),
    );
    check("(iii) float poll params reach SUCCESS", table.id, 9);
  }
  {
    // `data_group_id: int | None` — the absent arm.
    const calls: unknown[][] = [];
    await members.markLookupTableReady(
      stub("markLookupTableReady", lt(1, "P"), calls),
      new MarkLookupTableReadyParams({ name: "", key: "𝒳" }),
    );
    check("(iii) mark_ready empty name / astral key", calls[0]?.[0], {
      name: "",
      key: "𝒳",
    });
  }

  // -------------------------------------------------------------------
  // (iv) Every W7-local branch
  // -------------------------------------------------------------------

  // -- list_custom_properties displayFormula re-raise, all five arms --
  {
    /**
     * Build the App-API `QueryError` with the given body.
     *
     * @param body - The `response_body` detail.
     * @returns The error.
     */
    const err = (body: unknown): QueryError =>
      new QueryError("boom", {
        statusCode: 400,
        responseBody: body,
        requestMethod: "GET",
        requestUrl: "u",
        requestParams: { a: 1 },
      });
    /**
     * A client whose `listCustomProperties` rejects.
     *
     * @param error - The rejection value.
     * @returns The stub.
     */
    const reject = (error: unknown): MixpanelClient =>
      ({
        listCustomProperties: (): Promise<never> => Promise.reject(error),
      }) as unknown as MixpanelClient;

    const corrupt = err({ field: "displayFormula" });
    let reRaised: unknown = null;
    try {
      await members.listCustomProperties(reject(corrupt));
    } catch (error) {
      reRaised = error;
    }
    const re = reRaised as QueryError;
    check(
      "(iv) displayFormula arm re-raises a NEW QueryError",
      [
        re instanceof QueryError,
        re !== corrupt,
        re.message.includes("invalid displayFormula"),
        re.statusCode,
        re.requestMethod,
        re.requestUrl,
        re.cause === corrupt,
      ],
      [true, true, true, 400, "GET", "u", true],
    );

    for (const [label, error] of [
      ["other field", err({ field: "name" })],
      ["absent response_body", new QueryError("boom", { statusCode: 400 })],
      ["non-dict response_body", err(["displayFormula"])],
    ] as const) {
      let seen: unknown = null;
      try {
        await members.listCustomProperties(reject(error));
      } catch (caught) {
        seen = caught;
      }
      check(`(iv) ${label} re-raises the ORIGINAL`, seen === error, true);
    }
    const notQuery = new Error("transport");
    let seen: unknown = null;
    try {
      await members.listCustomProperties(reject(notQuery));
    } catch (caught) {
      seen = caught;
    }
    check("(iv) non-QueryError propagates untouched", seen === notQuery, true);
  }

  // -- upload orchestration: sync-complete --
  {
    const calls: unknown[][] = [];
    const client = uploadStub(lt(99, "Products"), [], calls);
    const table = await members.uploadLookupTable(
      client,
      new UploadLookupTableParams({
        name: "Products",
        file_path: "/tmp/p.csv",
        data_group_id: 5,
      }),
      {},
      uploadSeams("product_id,name\n1,Widget\n"),
    );
    check(
      "(iv) sync upload returns the table",
      [table.id, table.name],
      [99, "Products"],
    );
    check(
      "(iv) sync upload calls the three steps in order",
      calls.map((c) => c[0]),
      ["getLookupUploadUrl", "uploadToSignedUrl", "registerLookupTable"],
    );
    check("(iv) register form body carries data-group-id", calls[2]?.[1], {
      name: "Products",
      path: URL_INFO.path,
      key: URL_INFO.key,
      "data-group-id": "5",
    });
    check(
      "(iv) signed-url PUT receives the readFile bytes",
      new TextDecoder().decode(calls[1]?.[2] as Uint8Array),
      "product_id,name\n1,Widget\n",
    );
  }
  // -- upload orchestration: no data_group_id --
  {
    const calls: unknown[][] = [];
    await members.uploadLookupTable(
      uploadStub(lt(1, "P"), [], calls),
      new UploadLookupTableParams({ name: "P", file_path: "/tmp/p" }),
      {},
      uploadSeams(),
    );
    check(
      "(iv) register form body omits an absent data-group-id",
      Object.hasOwn(calls[2]?.[1] as object, "data-group-id"),
      false,
    );
  }
  // -- upload orchestration: name back-fill --
  {
    const table = await members.uploadLookupTable(
      uploadStub({ id: 7 }),
      new UploadLookupTableParams({ name: "Injected", file_path: "/tmp/p" }),
      {},
      uploadSeams(),
    );
    check(
      "(iv) name back-fill on a name-less register response",
      [table.id, table.name],
      [7, "Injected"],
    );
  }
  // -- upload orchestration: async poll arms --
  {
    /**
     * Run the orchestrator against a poll script.
     *
     * @param statuses - Successive poll payloads.
     * @param options - The poll options.
     * @returns `[name, code]` on throw, else `["<resolved>", ""]`.
     */
    const poll = (
      statuses: readonly Record<string, unknown>[],
      options: members.WorkspaceUploadLookupTableOptions = {
        poll_interval: 0.01,
        max_poll_seconds: 1,
      },
    ): Promise<string[]> =>
      thrown(() =>
        members.uploadLookupTable(
          uploadStub({ uploadId: "u1" }, statuses),
          new UploadLookupTableParams({ name: "T", file_path: "/tmp/t" }),
          options,
          uploadSeams(),
        ),
      );

    const ready = await members.uploadLookupTable(
      uploadStub({ uploadId: "u1" }, [
        { uploadStatus: "PENDING" },
        { uploadStatus: "SUCCESS", result: lt(4, "Async") },
      ]),
      new UploadLookupTableParams({ name: "Async", file_path: "/tmp/t" }),
      { poll_interval: 0.01 },
      uploadSeams(),
    );
    check("(iv) async poll then ready", [ready.id, ready.name], [4, "Async"]);

    check(
      "(iv) SUCCESS with a non-dict result -> INVALID_RESPONSE",
      await poll([{ uploadStatus: "SUCCESS", result: "nope" }]),
      ["MixpanelHeadlessError", "INVALID_RESPONSE"],
    );
    check(
      "(iv) FAILURE -> UPLOAD_FAILED",
      await poll([{ uploadStatus: "FAILURE" }]),
      ["MixpanelHeadlessError", "UPLOAD_FAILED"],
    );
    check(
      "(iv) REVOKED -> UPLOAD_FAILED",
      await poll([{ uploadStatus: "REVOKED" }]),
      ["MixpanelHeadlessError", "UPLOAD_FAILED"],
    );
    check(
      "(iv) NOTFOUND -> UPLOAD_NOT_FOUND",
      await poll([{ uploadStatus: "NOTFOUND" }]),
      ["MixpanelHeadlessError", "UPLOAD_NOT_FOUND"],
    );
    check(
      "(iv) deadline exhausted -> UPLOAD_TIMEOUT",
      await poll([{ uploadStatus: "PENDING" }], {
        poll_interval: 0.01,
        max_poll_seconds: 0.05,
      }),
      ["MixpanelHeadlessError", "UPLOAD_TIMEOUT"],
    );
    const unknownArm = await members.uploadLookupTable(
      uploadStub({ uploadId: "u1" }, [
        {},
        { uploadStatus: "SUCCESS", result: lt(6, "Late") },
      ]),
      new UploadLookupTableParams({ name: "Late", file_path: "/tmp/t" }),
      { poll_interval: 0.01 },
      uploadSeams(),
    );
    check("(iv) absent uploadStatus keeps polling (UNKNOWN)", unknownArm.id, 6);

    // The timeout message keeps CPython's float spelling (`300.0`,
    // not `300`) — Discrepancy #12 avoided at this site.
    let message = "";
    try {
      await members.uploadLookupTable(
        uploadStub({ uploadId: "u1" }, [{ uploadStatus: "PENDING" }]),
        new UploadLookupTableParams({ name: "T", file_path: "/tmp/t" }),
        { poll_interval: 100, max_poll_seconds: 300 },
        uploadSeams(),
      );
    } catch (error) {
      message = (error as Error).message;
    }
    check(
      "(iv) timeout message renders 300.0s (pythonFloatStr)",
      message.includes("after 300.0s"),
      true,
    );
  }
  // -- readFile seam default --
  {
    check(
      "(iv) default readFile seam -> UNPORTED_FILE_READ_SEAM",
      await thrown(() =>
        rig(() => ok(URL_INFO)).ws.uploadLookupTable(
          new UploadLookupTableParams({ name: "T", file_path: "/tmp/t.csv" }),
        ),
      ),
      ["MixpanelHeadlessError", "UNPORTED_FILE_READ_SEAM"],
    );
  }
  // -- the three dump spellings --
  {
    const plain: unknown[][] = [];
    await members.updateLookupTable(
      stub("updateLookupTable", lt(1, "P"), plain),
      3,
      new UpdateLookupTableParams({ name: "P" }),
    );
    check("(iv) update_lookup_table plain dump", plain[0]?.[1], { name: "P" });

    const aliased: unknown[][] = [];
    await members.updateCustomProperty(
      stub("updateCustomProperty", cp(1, "N"), aliased),
      "42",
      new UpdateCustomPropertyParams({ name: "N", display_formula: "f" }),
    );
    check("(iv) update_custom_property by_alias dump", aliased[0]?.[1], {
      name: "N",
      displayFormula: "f",
    });

    const modeJson: unknown[][] = [];
    await members.createCustomProperty(
      stub("createCustomProperty", cp(1, "N"), modeJson),
      new CreateCustomPropertyParams({
        name: "N",
        resource_type: CustomPropertyResourceType.EVENTS,
        display_formula: "f",
        composed_properties: {
          x: new ComposedPropertyValue({ resource_type: "event" }),
        },
      }),
    );
    check(
      "(iv) create_custom_property by_alias + mode=json dump (W7-D4)",
      modeJson[0]?.[0],
      {
        name: "N",
        resourceType: "events",
        displayFormula: "f",
        composedProperties: { x: { resourceType: "event" } },
      },
    );

    const formBody: unknown[][] = [];
    await members.createCustomEvent(
      stub(
        "createCustomEvent",
        { id: 1, name: "X", alternatives: [] },
        formBody,
      ),
      new CreateCustomEventParams({ name: "X", alternatives: ["A", "𝒳"] }),
    );
    check(
      "(iv) create_custom_event to_form_body (CPython json.dumps)",
      formBody[0]?.[0],
      {
        name: "X",
        alternatives: '[{"event": "A"}, {"event": "\\ud835\\udcb3"}]',
      },
    );

    const eventAlias: unknown[][] = [];
    await members.updateCustomEvent(
      stub("updateCustomEvent", { id: 1, name: "E" }, eventAlias),
      7,
      new UpdateEventDefinitionParams({
        description: "d",
        display_name: "D",
      }),
    );
    // Key order is `model_fields` order, not call order.
    check("(iv) update_custom_event by_alias dump", eventAlias[0]?.[1], {
      displayName: "D",
      description: "d",
    });
  }
  // -- RESPONSE_VALIDATION_ERROR from a malformed 200 body --
  {
    for (const [label, run] of [
      [
        "list_drop_filters",
        (): Promise<unknown> =>
          rig(() => ok([{ nope: 1 }])).ws.listDropFilters(),
      ],
      [
        "get_drop_filter_limits",
        (): Promise<unknown> =>
          rig(() => ok({ nope: 1 })).ws.getDropFilterLimits(),
      ],
      [
        "get_custom_property",
        (): Promise<unknown> =>
          rig(() => ok({ nope: 1 })).ws.getCustomProperty("1"),
      ],
      [
        "list_lookup_tables",
        (): Promise<unknown> =>
          rig(() => ok([{ nope: 1 }])).ws.listLookupTables(),
      ],
      [
        "list_custom_events",
        (): Promise<unknown> =>
          rig(() => ok([{ nope: 1 }])).ws.listCustomEvents(),
      ],
    ] as const) {
      const [, code] = await thrown(run);
      check(
        `(iv) ${label} malformed 200 -> RESPONSE_VALIDATION_ERROR`,
        code,
        "RESPONSE_VALIDATION_ERROR",
      );
    }
    // `get_lookup_upload_url` never reaches the model seam on a
    // malformed body: the B4 client's url/path/key presence guard
    // (`api_client.py:7616-7622`) fires first with `MISSING_FIELD`.
    const [, uploadUrlCode] = await thrown(() =>
      rig(() => ok({ nope: 1 })).ws.getLookupUploadUrl(),
    );
    check(
      "(iv) get_lookup_upload_url malformed 200 -> MISSING_FIELD (client guard)",
      uploadUrlCode,
      "MISSING_FIELD",
    );
  }
  // -- the void members resolve to undefined --
  {
    check(
      "(iv) delete_custom_property resolves undefined",
      await rig(() => ok({})).ws.deleteCustomProperty("1"),
      undefined,
    );
    check(
      "(iv) delete_lookup_tables resolves undefined",
      await rig(() => ok({})).ws.deleteLookupTables([1, 2]),
      undefined,
    );
    check(
      "(iv) delete_custom_event resolves undefined",
      await rig(() => ok({})).ws.deleteCustomEvent(7),
      undefined,
    );
  }

  console.log(`\nchecks ${String(checks)}   failures ${String(failures)}`);
  if (failures > 0) {
    process.exitCode = 1;
  }
}

await main();
