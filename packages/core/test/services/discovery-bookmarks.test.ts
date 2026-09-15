// Translated DiscoveryService.list_bookmarks tests (B5-S1, packet §4):
// assertion-for-assertion port of tests/unit/test_discovery_bookmarks.py
// — TestListBookmarks :28 (the file's only class).
//
// Translation notes:
// - The `MagicMock()` api-client fixture becomes a stub object carrying
//   only the method under test, cast to `MixpanelClient` (the service
//   touches nothing else on this path).
// - `mock_api_client.list_bookmarks.assert_called_once_with(
//   bookmark_type="insights")` -> the recorded call list; Python's
//   kwarg becomes the TS positional (`listBookmarks(bookmarkType)`).
// - `isinstance(result[0], BookmarkInfo)` translates to an
//   `instanceof` check on the same class.

import { describe, expect, it } from "vitest";

import type { MixpanelClient } from "../../src/client/client.js";
import type { JsonValue } from "../../src/client/json-value.js";
import { DiscoveryService } from "../../src/services/discovery.js";
import { BookmarkInfo } from "../../src/types/results/discovery.js";

/** The recorded `list_bookmarks` calls of a stub client. */
interface BookmarkStub {
  readonly service: DiscoveryService;
  readonly calls: Array<string | null>;
  setResponse: (value: JsonValue) => void;
}

/**
 * Build the `mock_api_client` + `discovery_service` fixture pair
 * (test_discovery_bookmarks.py).
 *
 * @returns The service plus the call log and a response setter.
 */
function bookmarkStub(): BookmarkStub {
  const calls: Array<string | null> = [];
  let response: JsonValue = { results: [] };
  const client = {
    listBookmarks: (bookmarkType?: string | null): Promise<JsonValue> => {
      calls.push(bookmarkType ?? null);
      return Promise.resolve(response);
    },
  } as unknown as MixpanelClient;
  return {
    service: new DiscoveryService(client),
    calls,
    setResponse(value: JsonValue): void {
      response = value;
    },
  };
}

describe("List bookmarks", () => {
  // python: TestListBookmarks
  it("returns a list of BookmarkInfo", async () => {
    const stub = bookmarkStub();
    stub.setResponse({
      results: [
        {
          id: 63877017,
          name: "Weekly Active Users",
          type: "insights",
          project_id: 12345,
          created: "2024-01-01T00:00:00",
          modified: "2024-06-15T10:30:00",
        },
      ],
    });

    const result = await stub.service.listBookmarks();

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
    expect(result[0]).toBeInstanceOf(BookmarkInfo);
  });

  it("parses all required BookmarkInfo fields", async () => {
    const stub = bookmarkStub();
    stub.setResponse({
      results: [
        {
          id: 63877017,
          name: "Monthly Revenue",
          type: "insights",
          project_id: 12345,
          created: "2024-01-01T00:00:00",
          modified: "2024-06-15T10:30:00",
        },
      ],
    });

    const bookmark = (await stub.service.listBookmarks())[0];

    expect(bookmark?.id).toBe(63877017);
    expect(bookmark?.name).toBe("Monthly Revenue");
    expect(bookmark?.type).toBe("insights");
    expect(bookmark?.project_id).toBe(12345);
    expect(bookmark?.created).toBe("2024-01-01T00:00:00");
    expect(bookmark?.modified).toBe("2024-06-15T10:30:00");
  });

  it("parses the optional BookmarkInfo fields", async () => {
    const stub = bookmarkStub();
    stub.setResponse({
      results: [
        {
          id: 63877017,
          name: "Monthly Revenue",
          type: "insights",
          project_id: 12345,
          created: "2024-01-01T00:00:00",
          modified: "2024-06-15T10:30:00",
          workspace_id: 100,
          dashboard_id: 200,
          description: "Track monthly revenue",
          creator_id: 42,
          creator_name: "John Doe",
        },
      ],
    });

    const bookmark = (await stub.service.listBookmarks())[0];

    expect(bookmark?.workspace_id).toBe(100);
    expect(bookmark?.dashboard_id).toBe(200);
    expect(bookmark?.description).toBe("Track monthly revenue");
    expect(bookmark?.creator_id).toBe(42);
    expect(bookmark?.creator_name).toBe("John Doe");
  });

  it("defaults the optional fields to None when missing", async () => {
    const stub = bookmarkStub();
    stub.setResponse({
      results: [
        {
          id: 63877017,
          name: "Monthly Revenue",
          type: "insights",
          project_id: 12345,
          created: "2024-01-01T00:00:00",
          modified: "2024-06-15T10:30:00",
        },
      ],
    });

    const bookmark = (await stub.service.listBookmarks())[0];

    expect(bookmark?.workspace_id).toBeNull();
    expect(bookmark?.dashboard_id).toBeNull();
    expect(bookmark?.description).toBeNull();
    expect(bookmark?.creator_id).toBeNull();
    expect(bookmark?.creator_name).toBeNull();
  });

  it("handles multiple bookmarks", async () => {
    const stub = bookmarkStub();
    stub.setResponse({
      results: [
        {
          id: 1,
          name: "Report A",
          type: "insights",
          project_id: 12345,
          created: "2024-01-01T00:00:00",
          modified: "2024-01-01T00:00:00",
        },
        {
          id: 2,
          name: "Report B",
          type: "funnels",
          project_id: 12345,
          created: "2024-01-01T00:00:00",
          modified: "2024-01-01T00:00:00",
        },
        {
          id: 3,
          name: "Report C",
          type: "retention",
          project_id: 12345,
          created: "2024-01-01T00:00:00",
          modified: "2024-01-01T00:00:00",
        },
      ],
    });

    const result = await stub.service.listBookmarks();

    expect(result).toHaveLength(3);
    expect(result[0]?.name).toBe("Report A");
    expect(result[1]?.type).toBe("funnels");
    expect(result[2]?.id).toBe(3);
  });

  it("handles empty results", async () => {
    const stub = bookmarkStub();
    stub.setResponse({ results: [] });
    await expect(stub.service.listBookmarks()).resolves.toStrictEqual([]);
  });

  it("passes bookmark_type to the API client", async () => {
    const stub = bookmarkStub();
    stub.setResponse({ results: [] });

    await stub.service.listBookmarks("insights");

    expect(stub.calls).toStrictEqual(["insights"]);
  });

  it("parses every bookmark type", async () => {
    const bookmarkTypes = [
      "insights",
      "funnels",
      "retention",
      "flows",
      "launch-analysis",
    ] as const;

    for (const bmType of bookmarkTypes) {
      const stub = bookmarkStub();
      stub.setResponse({
        results: [
          {
            id: 1,
            name: `${bmType} report`,
            type: bmType,
            project_id: 12345,
            created: "2024-01-01T00:00:00",
            modified: "2024-01-01T00:00:00",
          },
        ],
      });

      const result = await stub.service.listBookmarks();

      expect(result[0]?.type).toBe(bmType);
    }
  });

  it("handles explicit null values for the optional fields", async () => {
    const stub = bookmarkStub();
    stub.setResponse({
      results: [
        {
          id: 1,
          name: "Report",
          type: "insights",
          project_id: 12345,
          created: "2024-01-01T00:00:00",
          modified: "2024-01-01T00:00:00",
          workspace_id: null,
          dashboard_id: null,
          description: null,
          creator_id: null,
          creator_name: null,
        },
      ],
    });

    const bookmark = (await stub.service.listBookmarks())[0];

    expect(bookmark?.workspace_id).toBeNull();
    expect(bookmark?.dashboard_id).toBeNull();
    expect(bookmark?.description).toBeNull();
    expect(bookmark?.creator_id).toBeNull();
    expect(bookmark?.creator_name).toBeNull();
  });

  it('handles the nested {"results": {"results": [...]}} structure', async () => {
    const stub = bookmarkStub();
    stub.setResponse({
      status: "ok",
      results: {
        results: [
          {
            id: 12345,
            name: "Nested Report",
            type: "insights",
            project_id: 8,
            created: "2024-01-01T00:00:00",
            modified: "2024-01-02T00:00:00",
          },
        ],
      },
    });

    const result = await stub.service.listBookmarks();

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe(12345);
    expect(result[0]?.name).toBe("Nested Report");
  });
});
