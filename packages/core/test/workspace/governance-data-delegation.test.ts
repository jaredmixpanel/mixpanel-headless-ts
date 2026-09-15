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
  ComposedPropertyValue,
  CreateCustomPropertyParams,
  CreateDropFilterParams,
  MarkLookupTableReadyParams,
  UpdateCustomPropertyParams,
  UpdateLookupTableParams,
} from "../../src/types/entities/data-governance.js";
import { CustomPropertyResourceType } from "../../src/types/enums.js";
import { Workspace } from "../../src/workspace.js";
import { FACADE_SESSION } from "../../test-support/client-test-helpers.js";
import {
  customPropertyJson,
  lookupTableJson,
} from "./governance-data-fixtures.js";

/**
 * A client stub whose single method returns `value` (the additive
 * delegation probes — the W6 `stubClient` pattern).
 *
 * @param method - The client method name to stub.
 * @param value - The value the stub resolves to.
 * @param calls - Optional log receiving each argument list.
 * @returns The stub cast to the client type.
 */
function stubClient(
  method: string,
  value: unknown,
  calls: unknown[][] = [],
): MixpanelClient {
  return {
    // The facade installs a `/me` workspace resolver at construction
    // (`workspace.py:775-793`), so every stub must accept one.
    hasWorkspaceResolver: false,
    setWorkspaceResolver: (): void => {},
    [method]: (...args: unknown[]): Promise<unknown> => {
      calls.push(args);
      return Promise.resolve(value);
    },
  } as unknown as MixpanelClient;
}

describe("ADDITIVE: delegation contracts", () => {
  it("create_drop_filter dumps the params with exclude_none and no aliases", async () => {
    const calls: unknown[][] = [];
    const client = stubClient("createDropFilter", [], calls);
    const params = new CreateDropFilterParams({
      event_name: "e",
      filters: { a: 1 },
    });
    await new Workspace({ session: FACADE_SESSION, client }).createDropFilter(
      params,
    );
    expect(calls[0]?.[0]).toStrictEqual({ event_name: "e", filters: { a: 1 } });
  });

  it("update_custom_property dumps the params with by_alias=True", async () => {
    const calls: unknown[][] = [];
    const client = stubClient(
      "updateCustomProperty",
      customPropertyJson(1, "N", "events"),
      calls,
    );
    const params = new UpdateCustomPropertyParams({
      name: "N",
      display_formula: "f",
    });
    await new Workspace({
      session: FACADE_SESSION,
      client,
    }).updateCustomProperty("42", params);
    expect(calls[0]?.[0]).toBe("42");
    expect(calls[0]?.[1]).toStrictEqual({ name: "N", displayFormula: "f" });
  });

  it("mark_lookup_table_ready builds the form body Python builds", async () => {
    const calls: unknown[][] = [];
    const client = stubClient(
      "markLookupTableReady",
      lookupTableJson(1, "P"),
      calls,
    );
    await new Workspace({
      session: FACADE_SESSION,
      client,
    }).markLookupTableReady(
      new MarkLookupTableReadyParams({
        name: "P",
        key: "k",
        data_group_id: 9,
      }),
    );
    expect(calls[0]?.[0]).toStrictEqual({
      name: "P",
      key: "k",
      "data-group-id": "9",
    });
  });

  it("update_lookup_table forwards the id and the plain dump", async () => {
    const calls: unknown[][] = [];
    const client = stubClient(
      "updateLookupTable",
      lookupTableJson(1, "P"),
      calls,
    );
    await new Workspace({ session: FACADE_SESSION, client }).updateLookupTable(
      3,
      new UpdateLookupTableParams({ name: "P" }),
    );
    expect(calls[0]?.[0]).toBe(3);
    expect(calls[0]?.[1]).toStrictEqual({ name: "P" });
  });

  it("get_lookup_upload_url defaults content_type to text/csv", async () => {
    const calls: unknown[][] = [];
    const client = stubClient(
      "getLookupUploadUrl",
      { url: "u", path: "p", key: "k" },
      calls,
    );
    await new Workspace({
      session: FACADE_SESSION,
      client,
    }).getLookupUploadUrl();
    expect(calls[0]?.[0]).toBe("text/csv");
  });

  it("download_lookup_table forwards file_name/limit under their Python names", async () => {
    const calls: unknown[][] = [];
    const client = stubClient(
      "downloadLookupTable",
      new Uint8Array([1]),
      calls,
    );
    await new Workspace({
      session: FACADE_SESSION,
      client,
    }).downloadLookupTable(4, { file_name: "f.csv", limit: 2 });
    expect(calls[0]?.[0]).toBe(4);
    expect(calls[0]?.[1]).toStrictEqual({ file_name: "f.csv", limit: 2 });
  });

  it("delete_lookup_tables forwards the id list verbatim", async () => {
    const calls: unknown[][] = [];
    const client = stubClient("deleteLookupTables", undefined, calls);
    await new Workspace({ session: FACADE_SESSION, client }).deleteLookupTables(
      [1, 2, 3],
    );
    expect(calls[0]?.[0]).toStrictEqual([1, 2, 3]);
  });

  it("validate_custom_property returns the client payload unvalidated", async () => {
    const client = stubClient("validateCustomProperty", { anything: [1, 2] });
    const result = await new Workspace({
      session: FACADE_SESSION,
      client,
    }).validateCustomProperty(
      new CreateCustomPropertyParams({
        name: "n",
        resource_type: CustomPropertyResourceType.EVENTS,
        display_formula: "f",
        composed_properties: {
          x: new ComposedPropertyValue({ resource_type: "event" }),
        },
      }),
    );
    expect(result).toStrictEqual({ anything: [1, 2] });
  });
});
