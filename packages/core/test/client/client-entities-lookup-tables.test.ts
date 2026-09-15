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

describe("List lookup tables", () => {
  // python: TestListLookupTables
  it("returns list", async () => {
    // python: test_returns_list
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

  it("uses maybe scoped path", async () => {
    // python: test_uses_maybe_scoped_path
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.listLookupTables();
    expect(capturedUrls[0]).toContain("/data-definitions/lookup-tables/");
  });

  it("data group ID param", async () => {
    // python: test_data_group_id_param
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.listLookupTables({ data_group_id: 5 });
    expect(capturedUrls[0]).toContain("data-group-id=5");
  });

  it("uses get method", async () => {
    // python: test_uses_get_method
    const capturedMethods: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedMethods.push(request.method);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.listLookupTables();
    expect(capturedMethods[0]).toBe("GET");
  });
});

describe("Get lookup upload URL", () => {
  // python: TestGetLookupUploadUrl
  it("returns dict", async () => {
    // python: test_returns_dict
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

  it("uses maybe scoped path", async () => {
    // python: test_uses_maybe_scoped_path
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

  it("content type param", async () => {
    // python: test_content_type_param
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

describe("Upload to signed URL", () => {
  // python: TestUploadToSignedUrl
  it("returns null", async () => {
    // python: test_returns_none
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

  it("targets external URL", async () => {
    // python: test_targets_external_url
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

describe("Register lookup table", () => {
  // python: TestRegisterLookupTable
  it("returns dict", async () => {
    // python: test_returns_dict
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

  it("uses maybe scoped path", async () => {
    // python: test_uses_maybe_scoped_path
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

describe("Mark lookup table ready", () => {
  // python: TestMarkLookupTableReady
  it("returns dict", async () => {
    // python: test_returns_dict
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

  it("uses maybe scoped path", async () => {
    // python: test_uses_maybe_scoped_path
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

describe("Get lookup upload status", () => {
  // python: TestGetLookupUploadStatus
  it("returns dict", async () => {
    // python: test_returns_dict
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

  it("uses maybe scoped path", async () => {
    // python: test_uses_maybe_scoped_path
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

describe("Update lookup table", () => {
  // python: TestUpdateLookupTable
  it("returns dict", async () => {
    // python: test_returns_dict
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

  it("uses maybe scoped path", async () => {
    // python: test_uses_maybe_scoped_path
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

describe("Delete lookup tables", () => {
  // python: TestDeleteLookupTables
  it("returns null", async () => {
    // python: test_returns_none
    const captured: Array<[string, unknown]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([request.method, parseBody(request.bodyText)]);
      return { status: 200, json: { status: "ok" } };
    });
    await client.deleteLookupTables([1, 2, 3]);
    expect(captured[0]?.[0]).toBe("DELETE");
    expect(captured[0]?.[1]).toStrictEqual({ "data-group-ids": [1, 2, 3] });
  });

  it("uses maybe scoped path", async () => {
    // python: test_uses_maybe_scoped_path
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok" } };
    });
    await client.deleteLookupTables([1]);
    expect(capturedUrls[0]).toContain("/data-definitions/lookup-tables/");
  });
});

describe("Download lookup table", () => {
  // python: TestDownloadLookupTable
  it("returns bytes", async () => {
    // python: test_returns_bytes
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      text: "col1,col2\nval1,val2",
      headers: { "content-type": "text/csv" },
    }));
    const result = await client.downloadLookupTable(5);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(result)).toContain("col1,col2");
  });

  it("uses maybe scoped path", async () => {
    // python: test_uses_maybe_scoped_path
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

  it("optional params", async () => {
    // python: test_optional_params
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

describe("Get lookup download URL", () => {
  // python: TestGetLookupDownloadUrl
  it("returns str", async () => {
    // python: test_returns_str
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

  it("uses maybe scoped path", async () => {
    // python: test_uses_maybe_scoped_path
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

  it("uses get method", async () => {
    // python: test_uses_get_method
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

describe("Get lookup upload URL missing keys", () => {
  // python: TestGetLookupUploadUrlMissingKeys
  it("get lookup upload URL missing keys", async () => {
    // python: test_get_lookup_upload_url_missing_keys
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: { status: "ok", results: { url: "https://example.com" } },
    }));
    await expect(client.getLookupUploadUrl()).rejects.toBeInstanceOf(
      MixpanelHeadlessError,
    );
  });
});

describe("Upload to signed URL network failure", () => {
  // python: TestUploadToSignedUrlNetworkFailure
  it("upload to signed URL network failure", async () => {
    // python: test_upload_to_signed_url_network_failure
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

describe("Register lookup table non JSON response", () => {
  // python: TestRegisterLookupTableNonJsonResponse
  it("register lookup table non JSON response", async () => {
    // python: test_register_lookup_table_non_json_response
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
