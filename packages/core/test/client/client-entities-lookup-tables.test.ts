// Layer-3 translation — Phase-3 packet B4-C5 data-governance locks.
// Source: tests/unit/test_api_client_data_governance.py (ALL classes —
// lexicon definitions/tags/metadata/history/export, custom properties,
// drop filters, lookup tables incl. upload/download wiring, custom
// events incl. the form-body + envelope-peeling + echo-mismatch
// branches, and the error-path classes).
import { describe, expect, it } from "vitest";

import type { Session } from "../../src/auth/session.js";
import { toNativeJson } from "../../src/client/json-value.js";
import { MixpanelHeadlessError } from "../../src/errors.js";
import {
  createMockClient,
  makeSession,
  parseBody,
} from "../../test-support/client-test-helpers.js";

/** The `oauth_credentials` fixture twin. */
function oauthCredentials(): Session {
  return makeSession({
    projectId: "12345",
    region: "us",
    oauthToken: "test-oauth-token",
  });
}

// ---------------------------------------------------------------------------
// Domain 12 — Lookup Tables (US6)
// ---------------------------------------------------------------------------

describe("TestListLookupTables", () => {
  it("test_returns_list", async () => {
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: {
        status: "ok",
        results: [{ name: "Plans" }, { name: "Countries" }],
      },
    }));
    const result = toNativeJson(await client.listLookupTables()) as Array<
      Record<string, unknown>
    >;
    expect(result).toHaveLength(2);
    expect(result[0]?.["name"]).toBe("Plans");
  });

  it("test_uses_maybe_scoped_path", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.listLookupTables();
    expect(capturedUrls[0]).toContain("/data-definitions/lookup-tables/");
  });

  it("test_data_group_id_param", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.listLookupTables({ data_group_id: 5 });
    expect(capturedUrls[0]).toContain("data-group-id=5");
  });

  it("test_uses_get_method", async () => {
    const capturedMethods: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedMethods.push(request.method);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.listLookupTables();
    expect(capturedMethods[0]).toBe("GET");
  });
});

describe("TestGetLookupUploadUrl", () => {
  it("test_returns_dict", async () => {
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: {
        status: "ok",
        results: {
          url: "https://storage.googleapis.com/upload",
          path: "/uploads/abc",
          key: "abc-123",
        },
      },
    }));
    const result = toNativeJson(await client.getLookupUploadUrl()) as Record<
      string,
      unknown
    >;
    expect(Object.keys(result)).toContain("url");
    expect(Object.keys(result)).toContain("path");
    expect(Object.keys(result)).toContain("key");
  });

  it("test_uses_maybe_scoped_path", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return {
        status: 200,
        json: { status: "ok", results: { url: "", path: "", key: "" } },
      };
    });
    await client.getLookupUploadUrl();
    expect(capturedUrls[0]).toContain(
      "/data-definitions/lookup-tables/upload-url/",
    );
  });

  it("test_content_type_param", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return {
        status: 200,
        json: { status: "ok", results: { url: "", path: "", key: "" } },
      };
    });
    await client.getLookupUploadUrl("text/csv");
    const url = capturedUrls[0] ?? "";
    expect(
      url.includes("content-type=text") ||
        url.includes("content-type=text%2Fcsv"),
    ).toBe(true);
  });
});

describe("TestUploadToSignedUrl", () => {
  it("test_returns_none", async () => {
    const captured: Array<[string, string]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([request.method, request.url]);
      return { status: 200 };
    });
    await client.uploadToSignedUrl(
      "https://storage.googleapis.com/upload",
      new TextEncoder().encode("col1,col2\na,b"),
    );
    expect(captured[0]?.[0]).toBe("PUT");
  });

  it("test_targets_external_url", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200 };
    });
    await client.uploadToSignedUrl(
      "https://storage.googleapis.com/bucket/key",
      new TextEncoder().encode("data"),
    );
    expect(capturedUrls[0]).toContain("storage.googleapis.com");
  });
});

describe("TestRegisterLookupTable", () => {
  it("test_returns_dict", async () => {
    const captured: Array<[string, string]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([request.method, request.headers["content-type"] ?? ""]);
      return {
        status: 200,
        json: {
          status: "ok",
          results: { data_group_id: 10, name: "New Table" },
        },
      };
    });
    const result = toNativeJson(
      await client.registerLookupTable({
        name: "New Table",
        gcs_path: "/uploads/abc",
      }),
    ) as Record<string, unknown>;
    expect(captured[0]?.[0]).toBe("POST");
    expect(result["data_group_id"]).toBe(10);
  });

  it("test_uses_maybe_scoped_path", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return {
        status: 200,
        json: { status: "ok", results: { data_group_id: 1 } },
      };
    });
    await client.registerLookupTable({ name: "X" });
    expect(capturedUrls[0]).toContain("/data-definitions/lookup-tables/");
  });
});

describe("TestMarkLookupTableReady", () => {
  it("test_returns_dict", async () => {
    const captured: Array<[string, string]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([request.method, request.headers["content-type"] ?? ""]);
      return {
        status: 200,
        json: { status: "ok", results: { data_group_id: 10, status: "ready" } },
      };
    });
    const result = toNativeJson(
      await client.markLookupTableReady({
        data_group_id: "10",
        status: "ready",
      }),
    ) as Record<string, unknown>;
    expect(captured[0]?.[0]).toBe("POST");
    expect(result["status"]).toBe("ready");
  });

  it("test_uses_maybe_scoped_path", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return {
        status: 200,
        json: { status: "ok", results: { data_group_id: 1 } },
      };
    });
    await client.markLookupTableReady({ data_group_id: "1" });
    expect(capturedUrls[0]).toContain("/data-definitions/lookup-tables/");
  });
});

describe("TestGetLookupUploadStatus", () => {
  it("test_returns_dict", async () => {
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: {
        status: "ok",
        results: { upload_id: "u-123", state: "complete" },
      },
    }));
    const result = toNativeJson(
      await client.getLookupUploadStatus("u-123"),
    ) as Record<string, unknown>;
    expect(result["upload_id"]).toBe("u-123");
    expect(result["state"]).toBe("complete");
  });

  it("test_uses_maybe_scoped_path", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: {} } };
    });
    await client.getLookupUploadStatus("u-123");
    expect(capturedUrls[0]).toContain(
      "/data-definitions/lookup-tables/upload-status/",
    );
    expect(capturedUrls[0]).toContain("upload-id=u-123");
  });
});

describe("TestUpdateLookupTable", () => {
  it("test_returns_dict", async () => {
    const captured: Array<[string, unknown]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([request.method, parseBody(request.bodyText)]);
      return {
        status: 200,
        json: {
          status: "ok",
          results: { data_group_id: 5, name: "Updated Table" },
        },
      };
    });
    const result = toNativeJson(
      await client.updateLookupTable(5, { name: "Updated Table" }),
    ) as Record<string, unknown>;
    expect(captured[0]?.[0]).toBe("PATCH");
    expect(result["name"]).toBe("Updated Table");
  });

  it("test_uses_maybe_scoped_path", async () => {
    const captured: Array<[string, Record<string, unknown>]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([
        request.url,
        parseBody(request.bodyText) as Record<string, unknown>,
      ]);
      return {
        status: 200,
        json: { status: "ok", results: { data_group_id: 5 } },
      };
    });
    await client.updateLookupTable(5, { name: "X" });
    expect(captured[0]?.[0]).toContain("/data-definitions/lookup-tables/");
    expect(captured[0]?.[1]["data-group-id"]).toBe(5);
    expect(captured[0]?.[1]["name"]).toBe("X");
  });
});

describe("TestDeleteLookupTables", () => {
  it("test_returns_none", async () => {
    const captured: Array<[string, unknown]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([request.method, parseBody(request.bodyText)]);
      return { status: 200, json: { status: "ok" } };
    });
    await client.deleteLookupTables([1, 2, 3]);
    expect(captured[0]?.[0]).toBe("DELETE");
    expect(captured[0]?.[1]).toStrictEqual({ "data-group-ids": [1, 2, 3] });
  });

  it("test_uses_maybe_scoped_path", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok" } };
    });
    await client.deleteLookupTables([1]);
    expect(capturedUrls[0]).toContain("/data-definitions/lookup-tables/");
  });
});

describe("TestDownloadLookupTable", () => {
  it("test_returns_bytes", async () => {
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      text: "col1,col2\nval1,val2",
      headers: { "content-type": "text/csv" },
    }));
    const result = await client.downloadLookupTable(5);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(result)).toContain("col1,col2");
  });

  it("test_uses_maybe_scoped_path", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, text: "data" };
    });
    await client.downloadLookupTable(5);
    expect(capturedUrls[0]).toContain(
      "/data-definitions/lookup-tables/download/",
    );
    expect(capturedUrls[0]).toContain("data-group-id=5");
  });

  it("test_optional_params", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, text: "data" };
    });
    await client.downloadLookupTable(5, {
      file_name: "export.csv",
      limit: 100,
    });
    const url = capturedUrls[0] ?? "";
    expect(url).toContain("file-name=export.csv");
    expect(url).toContain("limit=100");
  });
});

describe("TestGetLookupDownloadUrl", () => {
  it("test_returns_str", async () => {
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: {
        status: "ok",
        results: "https://storage.googleapis.com/download/abc",
      },
    }));
    const result = await client.getLookupDownloadUrl(5);
    expect(typeof result).toBe("string");
    expect(result).toContain("storage.googleapis.com");
  });

  it("test_uses_maybe_scoped_path", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return {
        status: 200,
        json: { status: "ok", results: "https://example.com" },
      };
    });
    await client.getLookupDownloadUrl(5);
    expect(capturedUrls[0]).toContain(
      "/data-definitions/lookup-tables/download-url/",
    );
    expect(capturedUrls[0]).toContain("data-group-id=5");
  });

  it("test_uses_get_method", async () => {
    const capturedMethods: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedMethods.push(request.method);
      return {
        status: 200,
        json: { status: "ok", results: "https://example.com" },
      };
    });
    await client.getLookupDownloadUrl(5);
    expect(capturedMethods[0]).toBe("GET");
  });
});

describe("TestGetLookupUploadUrlMissingKeys", () => {
  it("test_get_lookup_upload_url_missing_keys", async () => {
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: { status: "ok", results: { url: "https://example.com" } },
    }));
    await expect(client.getLookupUploadUrl()).rejects.toBeInstanceOf(
      MixpanelHeadlessError,
    );
  });
});

describe("TestUploadToSignedUrlNetworkFailure", () => {
  it("test_upload_to_signed_url_network_failure", async () => {
    const { client } = createMockClient(oauthCredentials(), () => {
      throw new TypeError("Connection refused");
    });
    await expect(
      client.uploadToSignedUrl(
        "https://storage.example.com/upload",
        new TextEncoder().encode("col1,col2\na,b"),
      ),
    ).rejects.toBeInstanceOf(MixpanelHeadlessError);
  });
});

describe("TestRegisterLookupTableNonJsonResponse", () => {
  it("test_register_lookup_table_non_json_response", async () => {
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      text: "<html>Server Error</html>",
      headers: { "content-type": "text/html" },
    }));
    await expect(
      client.registerLookupTable({ name: "Test Table" }),
    ).rejects.toBeInstanceOf(MixpanelHeadlessError);
  });
});
