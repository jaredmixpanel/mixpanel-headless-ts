// B6-W7 Layer-3 translation (packet `b6-packets.md` §9) — the class
// split of `tests/unit/test_workspace_data_governance.py` (1,842 lines)
// that W7 owns:
//
//   drop filters      : `TestListDropFilters`,
//     `TestCreateDropFilter`, `TestUpdateDropFilter`,
//     `TestDeleteDropFilter`, `TestGetDropFilterLimits`
//   custom properties : `TestListCustomProperties`,
//     `TestCreateCustomProperty`, `TestGetCustomProperty`,
//     `TestUpdateCustomProperty`, `TestDeleteCustomProperty`
//     (:891), `TestValidateCustomProperty` (:905)
//   custom events     : `TestCreateCustomEvent`,
//     `TestListCustomEvents`, `TestUpdateCustomEvent`,
//     `TestDeleteCustomEvent`
//   lookup tables     : `TestListLookupTables`,
//     `TestUploadLookupTable`, `TestMarkLookupTableReady`
//     (:1648), `TestGetLookupUploadUrl` (:1672),
//     `TestGetLookupUploadStatus`, `TestUpdateLookupTable`
//     (:1751), `TestDeleteLookupTables` (:1775),
//     `TestDownloadLookupTable`, `TestGetLookupDownloadUrl`
//
// The lexicon / tags / tracking-history classes in the same Python file
// belong to W6 (`b6-packets.md` §8) and are NOT re-translated here.
//
// Python's `httpx.MockTransport` handler becomes the injected-fetch
// `fakeTransport` seam; `_make_workspace(temp_dir, handler)`
// becomes `makeWorkspace(handler)` — the client is built over the OAuth
// session (`_make_oauth_credentials`, :82-88) while the facade carries
// the service-account `_TEST_SESSION`, exactly as Python does.
// `temp_dir` has no TS analog EXCEPT in `TestUploadLookupTable`, where
// Python writes a real CSV and the facade reads it with
// `Path(...).read_bytes()`; the TS twin injects the W7-D1 `readFile`
// seam with the same bytes (packet §9 W7-D1: `packages/core` is
// runtime-agnostic, so `node:fs` is a B8 wiring job).
//
// ADDITIVE sections (clearly headed, never substituting for a
// translated Python assertion — B5 Caution #13 / packet §0.2): the
// facade-local branches Python's suite does not cover — the
// `displayFormula` corruption re-raise, the
// `to_form_body` JSON spelling, the `readFile` seam default, the
// `REVOKED` / `NOTFOUND` / non-dict-result poll arms
// (`workspace.py`) and the per-member delegation contracts
// (which client method, with which arguments).

import { describe, expect, it } from "vitest";

import type { MixpanelClient } from "../../src/client/client.js";
import {
  MixpanelHeadlessError,
  ParamValidationError,
  ResponseValidationError,
} from "../../src/errors.js";
import {
  LookupTable,
  LookupTableUploadUrl,
  MarkLookupTableReadyParams,
  UpdateLookupTableParams,
  UploadLookupTableParams,
} from "../../src/types/entities/data-governance.js";
import {
  type LookupUploadSeams,
  uploadLookupTable as uploadLookupTableMember,
} from "../../src/workspace-members/governance-data.js";
import {
  type CannedHandler,
  type CannedResponse,
  type CapturedFetchRequest,
  ok,
} from "../../test-support/client-test-helpers.js";
import {
  lookupTableJson,
  makeWorkspace,
  okBare,
} from "./governance-data-fixtures.js";

/**
 * A virtual monotonic clock whose `sleep` advances it — the
 * deterministic twin of Python's `time.sleep` + `time.monotonic` in
 * `_poll_lookup_upload`. Real timers are
 * banned in Layer-3 (playbook risk #4).
 *
 * @returns The `monotonic` seam plus the matching client `sleep`.
 */
function virtualClock(): {
  monotonic: () => number;
  sleep: (ms: number) => Promise<void>;
  slept: number[];
} {
  let seconds = 0;
  const slept: number[] = [];
  return {
    monotonic: (): number => seconds,
    sleep: (ms: number): Promise<void> => {
      slept.push(ms);
      seconds += ms / 1000;
      return Promise.resolve();
    },
    slept,
  };
}

/**
 * The `readFile` seam returning fixed bytes (the tmp-CSV twin).
 *
 * @param content - The CSV text.
 * @param paths - Optional log receiving each requested path.
 * @returns The seam.
 */
function fakeReadFile(
  content: string,
  paths: string[] = [],
): (path: string) => Promise<Uint8Array> {
  return (path: string): Promise<Uint8Array> => {
    paths.push(path);
    return Promise.resolve(new TextEncoder().encode(content));
  };
}

// =============================================================================
// US5: Lookup Tables
// =============================================================================

describe("TestListLookupTables", () => {
  it("list_lookup_tables() returns list of LookupTable objects", async () => {
    const { ws } = makeWorkspace(() =>
      ok([lookupTableJson(1, "Products"), lookupTableJson(2, "Categories")]),
    );
    const tables = await ws.listLookupTables();

    expect(tables).toHaveLength(2);
    expect(tables[0]).toBeInstanceOf(LookupTable);
    expect(tables[0]?.name).toBe("Products");
    expect(tables[1]?.id).toBe(2);
  });

  it("list_lookup_tables() returns empty list when none exist", async () => {
    const { ws } = makeWorkspace(() => ok([]));
    await expect(ws.listLookupTables()).resolves.toStrictEqual([]);
  });

  it("list_lookup_tables(data_group_id=5) passes param to API", async () => {
    const capturedUrls: string[] = [];
    const { ws } = makeWorkspace((request) => {
      capturedUrls.push(request.url);
      return ok([lookupTableJson()]);
    });
    const tables = await ws.listLookupTables({ data_group_id: 5 });

    expect(tables).toHaveLength(1);
    // ADDITIVE: Python captures the URL but only asserts the length
    // (:1402-1420); the `data-group-id` param spelling is the B4
    // client's contract.
    expect(capturedUrls[0]).toContain("data-group-id=5");
  });
});

describe("TestUploadLookupTable", () => {
  /**
   * The three-step upload handler (`:1430-1460`).
   *
   * @param registerResult - The `results` payload of step 3.
   * @param statusResults - Successive `results` payloads of the status
   *   polls.
   * @param log - Counters mutated by the handler.
   * @returns The handler.
   */
  function uploadHandler(
    registerResult: unknown,
    statusResults: readonly unknown[] = [],
    counters?: { requests: number; polls: number },
  ): CannedHandler {
    const log = counters ?? { requests: 0, polls: 0 };
    return (request: CapturedFetchRequest): CannedResponse => {
      log.requests += 1;
      const url = request.url;
      if (url.includes("upload-url") || url.includes("upload_url")) {
        return ok({
          url: "https://storage.googleapis.com/upload",
          path: "gs://bucket/path",
          key: "product_id",
        });
      }
      if (url.includes("storage.googleapis.com")) {
        return { status: 200, text: "" };
      }
      if (!url.includes("upload-status") && request.method === "POST") {
        return ok(registerResult);
      }
      const index = Math.min(log.polls, statusResults.length - 1);
      log.polls += 1;
      return ok(statusResults[index] ?? {});
    };
  }

  it("upload_lookup_table() handles get URL, upload, register steps", async () => {
    const log = { requests: 0, polls: 0 };
    const paths: string[] = [];
    const { ws } = makeWorkspace(
      uploadHandler(lookupTableJson(99, "Products"), [], log),
      {
        readFile: fakeReadFile("product_id,name\n1,Widget\n2,Gadget\n", paths),
      },
    );
    const params = new UploadLookupTableParams({
      name: "Products",
      file_path: "/tmp/products.csv",
    });
    const result = await ws.uploadLookupTable(params);

    expect(result).toBeInstanceOf(LookupTable);
    expect(result.name).toBe("Products");
    expect(result.id).toBe(99);
    expect(log.requests).toBeGreaterThanOrEqual(2);
    // ADDITIVE (W7-D1): the CSV is read through the injected seam.
    expect(paths).toStrictEqual(["/tmp/products.csv"]);
  });

  it("upload_lookup_table() polls status for async uploads (>= 5 MB)", async () => {
    const log = { requests: 0, polls: 0 };
    const clock = virtualClock();
    const { ws } = makeWorkspace(
      uploadHandler(
        { uploadId: "task-abc-123" },
        [
          { uploadStatus: "PENDING" },
          {
            uploadStatus: "SUCCESS",
            result: lookupTableJson(99, "BigTable"),
          },
        ],
        log,
      ),
      {
        readFile: fakeReadFile("product_id,name\n1,Widget\n"),
        monotonic: clock.monotonic,
      },
      clock.sleep,
    );
    const params = new UploadLookupTableParams({
      name: "BigTable",
      file_path: "/tmp/big.csv",
    });
    const result = await ws.uploadLookupTable(params, { poll_interval: 0.01 });

    expect(result).toBeInstanceOf(LookupTable);
    expect(result.name).toBe("BigTable");
    expect(result.id).toBe(99);
    expect(log.polls).toBeGreaterThanOrEqual(2);
  });

  it("upload_lookup_table() raises MixpanelHeadlessError on async timeout", async () => {
    const clock = virtualClock();
    const { ws } = makeWorkspace(
      uploadHandler({ uploadId: "task-timeout" }, [
        { uploadStatus: "PENDING" },
      ]),
      {
        readFile: fakeReadFile("product_id,name\n1,Widget\n"),
        monotonic: clock.monotonic,
      },
      clock.sleep,
    );
    const params = new UploadLookupTableParams({
      name: "BigTable",
      file_path: "/tmp/big.csv",
    });

    const call = ws.uploadLookupTable(params, {
      poll_interval: 0.01,
      max_poll_seconds: 0.05,
    });
    // B6-ARB (assertions Finding C): Python asserts BOTH the class and
    // the message (`pytest.raises(MixpanelHeadlessError, match="timed out")`,
    // test_workspace_data_governance.py).
    await expect(call).rejects.toBeInstanceOf(MixpanelHeadlessError);
    await expect(call).rejects.toThrow(/timed out/);
  });

  it("upload_lookup_table() raises MixpanelHeadlessError on async failure", async () => {
    const clock = virtualClock();
    const { ws } = makeWorkspace(
      uploadHandler({ uploadId: "task-fail" }, [{ uploadStatus: "FAILURE" }]),
      {
        readFile: fakeReadFile("product_id,name\n1,Widget\n"),
        monotonic: clock.monotonic,
      },
      clock.sleep,
    );
    const params = new UploadLookupTableParams({
      name: "BadTable",
      file_path: "/tmp/bad.csv",
    });

    const call = ws.uploadLookupTable(params, { poll_interval: 0.01 });
    // B6-ARB (assertions Finding C): Python asserts BOTH the class and
    // the message (`pytest.raises(MixpanelHeadlessError, match="failed")`,
    // test_workspace_data_governance.py).
    await expect(call).rejects.toBeInstanceOf(MixpanelHeadlessError);
    await expect(call).rejects.toThrow(/failed/);
  });
});

describe("TestMarkLookupTableReady", () => {
  it("mark_lookup_table_ready() returns a LookupTable", async () => {
    const { ws } = makeWorkspace(() => ok(lookupTableJson(1, "Products")));
    const params = new MarkLookupTableReadyParams({
      name: "Products",
      key: "product_id",
    });
    const result = await ws.markLookupTableReady(params);

    expect(result).toBeInstanceOf(LookupTable);
    expect(result.name).toBe("Products");
  });
});

describe("TestGetLookupUploadUrl", () => {
  it("get_lookup_upload_url() returns LookupTableUploadUrl", async () => {
    const { ws } = makeWorkspace(() =>
      ok({
        url: "https://storage.googleapis.com/upload",
        path: "gs://bucket/path",
        key: "id",
      }),
    );
    const result = await ws.getLookupUploadUrl();

    expect(result).toBeInstanceOf(LookupTableUploadUrl);
    expect(result.url).toContain("storage.googleapis.com");
  });

  it("get_lookup_upload_url(content_type='text/csv') passes param", async () => {
    const capturedUrls: string[] = [];
    const { ws } = makeWorkspace((request) => {
      capturedUrls.push(request.url);
      return ok({
        url: "https://storage.googleapis.com/upload",
        path: "gs://bucket/path",
        key: "id",
      });
    });
    const result = await ws.getLookupUploadUrl("text/csv");

    expect(result).toBeInstanceOf(LookupTableUploadUrl);
    // ADDITIVE: Python captures the URL but asserts only the type
    // (:1698-1720).
    expect(capturedUrls[0]).toContain("content-type=text%2Fcsv");
  });
});

describe("TestGetLookupUploadStatus", () => {
  it("get_lookup_upload_status() returns an opaque dict", async () => {
    const { ws } = makeWorkspace(() =>
      ok({ upload_id: "abc123", state: "completed", rows_imported: 1000 }),
    );
    const result = await ws.getLookupUploadStatus("abc123");

    expect(typeof result).toBe("object");
    expect(result["state"]).toBe("completed");
    expect(result["rows_imported"]).toBe(1000);
  });
});

describe("TestUpdateLookupTable", () => {
  it("update_lookup_table() returns the updated LookupTable", async () => {
    const { ws } = makeWorkspace(() =>
      ok(lookupTableJson(1, "Renamed Catalog")),
    );
    const params = new UpdateLookupTableParams({ name: "Renamed Catalog" });
    const result = await ws.updateLookupTable(1, params);

    expect(result).toBeInstanceOf(LookupTable);
    expect(result.name).toBe("Renamed Catalog");
  });
});

describe("TestDeleteLookupTables", () => {
  it("delete_lookup_tables() returns None on success", async () => {
    const { ws } = makeWorkspace(() => okBare());
    await expect(ws.deleteLookupTables([1, 2])).resolves.toBeUndefined();
  });
});

describe("TestDownloadLookupTable", () => {
  it("download_lookup_table() returns raw bytes", async () => {
    const csvContent = "product_id,name\n1,Widget\n2,Gadget\n";
    const { ws } = makeWorkspace(() => ({ status: 200, text: csvContent }));
    const result = await ws.downloadLookupTable(1);

    expect(result).toBeInstanceOf(Uint8Array);
    const decoded = new TextDecoder().decode(result);
    expect(decoded).toContain("product_id");
    expect(decoded).toContain("Widget");
  });

  it("download_lookup_table() accepts optional file_name and limit", async () => {
    const capturedUrls: string[] = [];
    const { ws } = makeWorkspace((request) => {
      capturedUrls.push(request.url);
      return { status: 200, text: "id,name\n1,A\n" };
    });
    const result = await ws.downloadLookupTable(1, {
      file_name: "export.csv",
      limit: 100,
    });

    expect(result).toBeInstanceOf(Uint8Array);
    // ADDITIVE: Python captures the URL but asserts only the type
    // (:1807-1819).
    expect(capturedUrls[0]).toContain("file-name=export.csv");
    expect(capturedUrls[0]).toContain("limit=100");
  });
});

describe("TestGetLookupDownloadUrl", () => {
  it("get_lookup_download_url() returns a signed download URL string", async () => {
    const { ws } = makeWorkspace(() =>
      ok("https://storage.googleapis.com/download/abc"),
    );
    const result = await ws.getLookupDownloadUrl(1);

    expect(typeof result).toBe("string");
    expect(result).toContain("storage.googleapis.com");
  });
});

describe("ADDITIVE: upload_lookup_table seams and poll arms", () => {
  /** The three canned interactions of the happy path. */
  const urlInfo = {
    url: "https://storage.googleapis.com/upload",
    path: "gs://bucket/path",
    key: "product_id",
  };

  /**
   * Stub client covering the five wire calls the orchestrator makes.
   *
   * @param registerResult - Step-3 payload.
   * @param statuses - Successive poll payloads.
   * @param calls - Log of `[method, ...args]` tuples.
   * @returns The stub.
   */
  function uploadStub(
    registerResult: unknown,
    statuses: ReadonlyArray<Record<string, unknown>> = [],
    calls: unknown[][] = [],
  ): MixpanelClient {
    let poll = 0;
    return {
      getLookupUploadUrl: (...args: unknown[]): Promise<unknown> => {
        calls.push(["getLookupUploadUrl", ...args]);
        return Promise.resolve(urlInfo);
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
   * The seam bag with a virtual clock and a fixed CSV.
   *
   * @param monotonic - The clock seam.
   * @returns The seams.
   */
  function seams(monotonic: () => number): LookupUploadSeams {
    return {
      readFile: fakeReadFile("a,b\n1,2\n"),
      monotonic,
      sleep: (): Promise<void> => Promise.resolve(),
    };
  }

  it("registers the form body with name/path/key and the data-group-id", async () => {
    const calls: unknown[][] = [];
    const client = uploadStub(lookupTableJson(7, "T"), [], calls);
    const clock = virtualClock();
    await uploadLookupTableMember(
      client,
      new UploadLookupTableParams({
        name: "T",
        file_path: "/tmp/t.csv",
        data_group_id: 5,
      }),
      {},
      { ...seams(clock.monotonic), sleep: clock.sleep },
    );

    const register = calls.find((c) => c[0] === "registerLookupTable");
    expect(register?.[1]).toStrictEqual({
      name: "T",
      path: "gs://bucket/path",
      key: "product_id",
      "data-group-id": "5",
    });
    const upload = calls.find((c) => c[0] === "uploadToSignedUrl");
    expect(upload?.[1]).toBe(urlInfo.url);
    expect(new TextDecoder().decode(upload?.[2] as Uint8Array)).toBe(
      "a,b\n1,2\n",
    );
  });

  it("omits data-group-id when the param is absent", async () => {
    const calls: unknown[][] = [];
    const client = uploadStub(lookupTableJson(7, "T"), [], calls);
    const clock = virtualClock();
    await uploadLookupTableMember(
      client,
      new UploadLookupTableParams({ name: "T", file_path: "/tmp/t.csv" }),
      {},
      { ...seams(clock.monotonic), sleep: clock.sleep },
    );

    const register = calls.find((c) => c[0] === "registerLookupTable");
    expect(Object.hasOwn(register?.[1] as object, "data-group-id")).toBe(false);
  });

  it("injects the params name when the register response omits it", async () => {
    const client = uploadStub({ id: 7 });
    const clock = virtualClock();
    const table = await uploadLookupTableMember(
      client,
      new UploadLookupTableParams({ name: "Injected", file_path: "/tmp/t" }),
      {},
      { ...seams(clock.monotonic), sleep: clock.sleep },
    );
    expect(table.name).toBe("Injected");
    expect(table.id).toBe(7);
  });

  it("hands a non-dict register payload to validation untouched (B6-ARB FID-F2)", async () => {
    // ADDITIVE (B6-ARB red-first lock, fidelity F2): Python guards BOTH
    // register-response reads with `isinstance(raw, dict)`
    // (`workspace.py:8060` uploadId read, `:8072` name-inject). Through
    // an INJECTED client delivering a non-dict payload (the real B4
    // client raises `expected dict` first — api_client.py:7741-7746),
    // the raw value must reach `validate_response_model` UNTOUCHED and
    // fail as a pydantic `model_type` error on the list itself, never
    // as a spread-mangled `{0: …, name: …}` object missing `id`.
    const client = uploadStub(["oops"]);
    const clock = virtualClock();

    const error = await uploadLookupTableMember(
      client,
      new UploadLookupTableParams({ name: "NonDict", file_path: "/tmp/t" }),
      {},
      { ...seams(clock.monotonic), sleep: clock.sleep },
    ).then(
      () => null,
      (error_: unknown) => error_,
    );

    expect(error).toBeInstanceOf(ResponseValidationError);
    const details = (error as ResponseValidationError).details as {
      errors: ReadonlyArray<{ type: string; input: unknown }>;
    };
    expect(details.errors[0]?.type).toBe("model_type");
    expect(details.errors[0]?.input).toStrictEqual(["oops"]);
  });

  it("raises UPLOAD_NOT_FOUND on a NOTFOUND poll", async () => {
    const clock = virtualClock();
    const client = uploadStub({ uploadId: "u1" }, [
      { uploadStatus: "NOTFOUND" },
    ]);
    await expect(
      uploadLookupTableMember(
        client,
        new UploadLookupTableParams({ name: "T", file_path: "/tmp/t" }),
        {},
        { ...seams(clock.monotonic), sleep: clock.sleep },
      ),
    ).rejects.toMatchObject({ code: "UPLOAD_NOT_FOUND" });
  });

  it("raises UPLOAD_FAILED on a REVOKED poll", async () => {
    const clock = virtualClock();
    const client = uploadStub({ uploadId: "u1" }, [
      { uploadStatus: "REVOKED" },
    ]);
    await expect(
      uploadLookupTableMember(
        client,
        new UploadLookupTableParams({ name: "T", file_path: "/tmp/t" }),
        {},
        { ...seams(clock.monotonic), sleep: clock.sleep },
      ),
    ).rejects.toMatchObject({ code: "UPLOAD_FAILED" });
  });

  it("raises INVALID_RESPONSE when SUCCESS carries a non-dict result", async () => {
    const clock = virtualClock();
    const client = uploadStub({ uploadId: "u1" }, [
      { uploadStatus: "SUCCESS", result: "nope" },
    ]);
    await expect(
      uploadLookupTableMember(
        client,
        new UploadLookupTableParams({ name: "T", file_path: "/tmp/t" }),
        {},
        { ...seams(clock.monotonic), sleep: clock.sleep },
      ),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("treats an ABSENT uploadStatus as UNKNOWN and keeps polling", async () => {
    const clock = virtualClock();
    const client = uploadStub({ uploadId: "u1" }, [
      {},
      { uploadStatus: "SUCCESS", result: lookupTableJson(3, "Late") },
    ]);
    const table = await uploadLookupTableMember(
      client,
      new UploadLookupTableParams({ name: "Late", file_path: "/tmp/t" }),
      { poll_interval: 0.01 },
      { ...seams(clock.monotonic), sleep: clock.sleep },
    );
    expect(table.id).toBe(3);
  });

  it("the default readFile seam throws UNPORTED_FILE_READ_SEAM (B8 owns the wiring)", async () => {
    // Step 1 (the signed-URL call) must succeed so the failure lands on
    // the step-2 read, exactly where Python's `read_bytes()` sits.
    const { ws } = makeWorkspace(() => ok(urlInfo));
    await expect(
      ws.uploadLookupTable(
        new UploadLookupTableParams({ name: "T", file_path: "/tmp/t.csv" }),
      ),
    ).rejects.toMatchObject({ code: "UNPORTED_FILE_READ_SEAM" });
  });
});

// =============================================================================
// ADDITIVE — lossless int64 lookup-table ids. Mixpanel assigns negative
// int64 `data_group_id`s (e.g. `-8644926364725811123`) that exceed 2^53;
// Python carries them as unbounded ints, the port as `bigint` past the
// safe-integer range on both legs (outbound guard + URL/body spelling,
// inbound `LookupTable.id`).
// =============================================================================

describe("ADDITIVE: lossless int64 lookup-table ids", () => {
  const BIG = -8644926364725811123n;
  const BIG_DIGITS = "-8644926364725811123";
  /** The same id after `JSON.parse` — rounded, and NOT what was sent. */
  const ROUNDED_DIGITS = "-8644926364725811000";

  /**
   * Serve a body as RAW TEXT so this test's own `JSON.stringify` /
   * `JSON.parse` can never round the id before the port sees it.
   *
   * @param resultsJson - The literal JSON text of `results`.
   * @returns The canned response.
   */
  function okRaw(resultsJson: string): CannedResponse {
    return {
      status: 200,
      text: `{"status":"ok","results":${resultsJson}}`,
      headers: { "content-type": "application/json" },
    };
  }

  /**
   * Await `thunk` and return what it threw.
   *
   * @param thunk - The call under test.
   * @returns The thrown value.
   */
  async function caught(thunk: () => unknown): Promise<unknown> {
    try {
      await thunk();
    } catch (error) {
      return error;
    }
    return undefined;
  }

  // ---- outbound: URL leg -------------------------------------------------

  it("downloadLookupTable(bigint) spells the exact digits into data-group-id", async () => {
    const { ws, transport } = makeWorkspace(() => ({
      status: 200,
      text: "id,name\n1,A\n",
    }));
    await ws.downloadLookupTable(BIG);
    expect(transport.captures[0]?.params["data-group-id"]).toBe(BIG_DIGITS);
    expect(transport.captures[0]?.url).not.toContain(ROUNDED_DIGITS);
  });

  it("downloadLookupTable(-5) is accepted (negative ids are the norm)", async () => {
    const { ws, transport } = makeWorkspace(() => ({ status: 200, text: "" }));
    await ws.downloadLookupTable(-5);
    expect(transport.captures[0]?.params["data-group-id"]).toBe("-5");
  });

  it("downloadLookupTable(2 ** 60) is refused with RL6_INVALID_ID and the bigint hint, network-free", async () => {
    const { ws, transport } = makeWorkspace(() => ({ status: 200, text: "" }));
    const error = await caught(() => ws.downloadLookupTable(2 ** 60));
    expect(error).toBeInstanceOf(ParamValidationError);
    expect((error as ParamValidationError).code).toBe("RL6_INVALID_ID");
    expect((error as ParamValidationError).message).toContain(
      "pass the id as a bigint",
    );
    expect(transport.captures).toHaveLength(0);
  });

  it("getLookupDownloadUrl(bigint) spells the exact digits; a rounded number is refused", async () => {
    const { ws, transport } = makeWorkspace(() =>
      ok("https://storage.googleapis.com/download/abc"),
    );
    await ws.getLookupDownloadUrl(BIG);
    expect(transport.captures[0]?.params["data-group-id"]).toBe(BIG_DIGITS);

    const error = await caught(() => ws.getLookupDownloadUrl(2 ** 60));
    expect((error as ParamValidationError).code).toBe("RL6_INVALID_ID");
    expect(transport.captures).toHaveLength(1);
  });

  // ---- outbound: JSON-body leg -------------------------------------------

  it("updateLookupTable(bigint) sends the id as an exact integer token in the PATCH body", async () => {
    const { ws, transport } = makeWorkspace(() =>
      okRaw(`{"id":${BIG_DIGITS},"name":"Renamed"}`),
    );
    const result = await ws.updateLookupTable(
      BIG,
      new UpdateLookupTableParams({ name: "Renamed" }),
    );
    expect(transport.captures[0]?.method).toBe("PATCH");
    expect(transport.captures[0]?.bodyText).toBe(
      `{"name":"Renamed","data-group-id":${BIG_DIGITS}}`,
    );
    expect(result.id).toBe(BIG);
  });

  it("updateLookupTable(-5) / (2 ** 60): negative accepted, rounded refused", async () => {
    const { ws, transport } = makeWorkspace(() => ok(lookupTableJson(-5)));
    const params = new UpdateLookupTableParams({ name: "n" });
    const result = await ws.updateLookupTable(-5, params);
    expect(result.id).toBe(-5);
    expect(transport.captures[0]?.bodyText).toContain('"data-group-id":-5');

    const error = await caught(() => ws.updateLookupTable(2 ** 60, params));
    expect((error as ParamValidationError).code).toBe("RL6_INVALID_ID");
    expect((error as ParamValidationError).message).toContain("bigint");
    expect(transport.captures).toHaveLength(1);
  });

  it("deleteLookupTables([bigint, number]) sends exact integer tokens; a rounded element is refused", async () => {
    const { ws, transport } = makeWorkspace(() => okBare());
    await ws.deleteLookupTables([BIG, 7]);
    expect(transport.captures[0]?.method).toBe("DELETE");
    expect(transport.captures[0]?.bodyText).toBe(
      `{"data-group-ids":[${BIG_DIGITS},7]}`,
    );

    const error = await caught(() => ws.deleteLookupTables([7, 2 ** 60]));
    expect((error as ParamValidationError).code).toBe("RL6_INVALID_ID");
    expect((error as ParamValidationError).details).toMatchObject({
      field: "data_group_ids",
    });
    expect(transport.captures).toHaveLength(1);
  });

  it("listLookupTables({ data_group_id: bigint }) filters by the exact digits", async () => {
    const { ws, transport } = makeWorkspace(() => ok([]));
    await ws.listLookupTables({ data_group_id: BIG });
    expect(transport.captures[0]?.params["data-group-id"]).toBe(BIG_DIGITS);
  });

  it("markLookupTableReady with a bigint data_group_id form-encodes the exact digits", async () => {
    const { ws, transport } = makeWorkspace(() =>
      okRaw(`{"id":${BIG_DIGITS},"name":"Products"}`),
    );
    const result = await ws.markLookupTableReady(
      new MarkLookupTableReadyParams({
        name: "Products",
        key: "product_id",
        data_group_id: BIG,
      }),
    );
    expect(transport.captures[0]?.bodyText).toContain(
      `data-group-id=${BIG_DIGITS}`,
    );
    expect(result.id).toBe(BIG);
  });

  // ---- inbound: LookupTable.id -------------------------------------------

  it("listLookupTables keeps an int64 id exact as a bigint and a safe id as a number", async () => {
    const { ws } = makeWorkspace(() =>
      okRaw(
        `[{"id":${BIG_DIGITS},"name":"Big"},` +
          `{"id":7,"name":"Small"},` +
          `{"id":9007199254740991,"name":"Edge"}]`,
      ),
    );
    const tables = await ws.listLookupTables();
    expect(tables).toHaveLength(3);
    expect(tables[0]?.id).toBe(BIG);
    expect(typeof tables[0]?.id).toBe("bigint");
    expect(tables[1]?.id).toBe(7);
    expect(typeof tables[1]?.id).toBe("number");
    expect(tables[2]?.id).toBe(Number.MAX_SAFE_INTEGER);
    expect(typeof tables[2]?.id).toBe("number");
  });

  it("toJSON() / modelDump() emit the bigint unchanged (digits available via String)", async () => {
    const { ws } = makeWorkspace(() =>
      okRaw(`[{"id":${BIG_DIGITS},"name":"Big","token":"t"}]`),
    );
    const [table] = await ws.listLookupTables();
    const json = table!.toJSON();
    expect(json["id"]).toBe(BIG);
    expect(String(json["id"])).toBe(BIG_DIGITS);
    expect(table!.modelDump()["id"]).toBe(BIG);
    // A bigint-aware replacer (the consumer's JSON-form layer) renders
    // the digits; plain JSON.stringify throws on bigint by design.
    expect(
      JSON.stringify(json, (_key, value: unknown) =>
        typeof value === "bigint" ? value.toString() : value,
      ),
    ).toContain(`"id":"${BIG_DIGITS}"`);
    expect(() => JSON.stringify(json)).toThrow(TypeError);
    // Round trip through the model's own decoder.
    expect(LookupTable.fromDict(json).id).toBe(BIG);
  });

  it("LookupTable construction narrows: safe bigint → number, unsafe → bigint, decimal string → exact", () => {
    expect(new LookupTable({ id: 7n, name: "n" }).id).toBe(7);
    expect(new LookupTable({ id: BIG, name: "n" }).id).toBe(BIG);
    expect(LookupTable.fromDict({ id: BIG_DIGITS, name: "n" }).id).toBe(BIG);
    expect(LookupTable.fromDict({ id: "7", name: "n" }).id).toBe(7);
  });

  it("a non-integer id is still a ResponseValidationError", async () => {
    const { ws } = makeWorkspace(() => okRaw(`[{"id":1.5,"name":"x"}]`));
    await expect(ws.listLookupTables()).rejects.toBeInstanceOf(
      ResponseValidationError,
    );
  });
});
