// VectorFetch tests (src/vector-fetch.ts, task TS-5): ordered serving,
// keyed unordered_group serving (each-consumable-once), transport-error
// native rejection, body_stream chunk-boundary preservation (design
// D2/D7/D12).
import { describe, expect, it } from "vitest";
import { parseInteractions } from "../src/interactions.js";
import { parseLossless } from "../src/lossless-json.js";
import {
  VectorFetchSequenceError,
  createVectorFetch,
} from "../src/vector-fetch.js";

/**
 * Parse a JSON interactions array into typed interactions.
 *
 * @param json - The `expect.interactions` array as JSON text.
 * @returns The parsed interactions.
 */
function interactionsOf(json: string) {
  return parseInteractions(parseLossless(json), "test-vector");
}

describe("createVectorFetch — ordered serving", () => {
  it("serves recorded responses positionally and captures requests", async () => {
    const harness = createVectorFetch(
      interactionsOf(`[
        {"request": {"method": "GET", "path": "/api/query/segmentation",
                     "params": {"event": "Login"}},
         "response": {"status": 200, "body": {"data": {"values": {}}}}},
        {"request": {"method": "POST", "path": "/api/app/me"},
         "response": {"status": 201, "body": {"ok": true},
                      "headers": {"x-extra": "yes"}}}
      ]`),
    );
    const first = await harness.fetch(
      "https://mixpanel.com/api/query/segmentation?event=Login",
      { headers: { authorization: "Basic dGVzdA==" } },
    );
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ data: { values: {} } });
    const second = await harness.fetch("https://mixpanel.com/api/app/me", {
      method: "POST",
      body: JSON.stringify({ a: 1 }),
    });
    expect(second.status).toBe(201);
    expect(second.headers.get("x-extra")).toBe("yes");
    expect(harness.captures).toHaveLength(2);
    expect(harness.captures[0]?.method).toBe("GET");
    expect(harness.captures[0]?.params).toEqual({ event: "Login" });
    expect(harness.captures[0]?.headers["authorization"]).toBe(
      "Basic dGVzdA==",
    );
    expect(harness.captures[1]?.slotIndex).toBe(1);
    expect(harness.unservedSlots()).toEqual([]);
    expect(harness.violations).toEqual([]);
  });

  it("serves a mismatched ordered request anyway (diff is the runner's job)", async () => {
    const harness = createVectorFetch(
      interactionsOf(`[
        {"request": {"method": "GET", "path": "/expected"},
         "response": {"status": 200, "body": {}}}
      ]`),
    );
    const response = await harness.fetch("https://mixpanel.com/actual");
    expect(response.status).toBe(200);
    expect(harness.captures[0]?.slotIndex).toBe(0);
    expect(harness.violations).toEqual([]); // field mismatch != sequence violation
  });

  it("throws AND records a violation on overflow requests", async () => {
    const harness = createVectorFetch(
      interactionsOf(`[
        {"request": {"method": "GET", "path": "/one"},
         "response": {"status": 200, "body": {}}}
      ]`),
    );
    await harness.fetch("https://mixpanel.com/one");
    await expect(harness.fetch("https://mixpanel.com/two")).rejects.toThrow(
      VectorFetchSequenceError,
    );
    expect(harness.violations).toHaveLength(1);
    expect(harness.captures[1]?.slotIndex).toBeNull();
  });

  it("reports unserved slots (missing requests)", () => {
    const harness = createVectorFetch(
      interactionsOf(`[
        {"request": {"method": "GET", "path": "/never"},
         "response": {"status": 200, "body": {}}}
      ]`),
    );
    expect(harness.unservedSlots()).toEqual([0]);
  });
});

describe("createVectorFetch — unordered groups (keyed serving)", () => {
  const GROUP_JSON = `[
    {"unordered_group": 1,
     "request": {"method": "GET", "path": "/cdn/file-a"},
     "response": {"status": 200, "body": {"file": "a"}}},
    {"unordered_group": 1,
     "request": {"method": "GET", "path": "/cdn/file-b"},
     "response": {"status": 200, "body": {"file": "b"}}}
  ]`;

  it("serves by (method, path, params) key, not position (D2/D7)", async () => {
    const harness = createVectorFetch(interactionsOf(GROUP_JSON));
    // Request the SECOND recorded member first: keyed serving must hand
    // each URL its own body under async scheduling.
    const b = await harness.fetch("https://cdn.mixpanel.com/cdn/file-b");
    expect(await b.json()).toEqual({ file: "b" });
    const a = await harness.fetch("https://cdn.mixpanel.com/cdn/file-a");
    expect(await a.json()).toEqual({ file: "a" });
    expect(harness.captures[0]?.slotIndex).toBe(1);
    expect(harness.captures[1]?.slotIndex).toBe(0);
    expect(harness.unservedSlots()).toEqual([]);
  });

  it("consumes each group member exactly once", async () => {
    const harness = createVectorFetch(interactionsOf(GROUP_JSON));
    await harness.fetch("https://cdn.mixpanel.com/cdn/file-b");
    await expect(
      harness.fetch("https://cdn.mixpanel.com/cdn/file-b"),
    ).rejects.toThrow(VectorFetchSequenceError);
    expect(harness.violations).toHaveLength(1);
    expect(harness.unservedSlots()).toEqual([0]);
  });

  it("rejects a request matching no group member", async () => {
    const harness = createVectorFetch(interactionsOf(GROUP_JSON));
    await expect(
      harness.fetch("https://cdn.mixpanel.com/cdn/file-z"),
    ).rejects.toThrow(VectorFetchSequenceError);
    expect(harness.violations[0]).toContain("unordered_group 1");
  });
});

describe("createVectorFetch — transport errors", () => {
  it("rejects as native fetch does (TypeError + cause), after capturing", async () => {
    const harness = createVectorFetch(
      interactionsOf(`[
        {"request": {"method": "GET", "path": "/flaky"},
         "response": {"transport_error": "ConnectError"}}
      ]`),
    );
    let thrown: unknown;
    try {
      await harness.fetch("https://mixpanel.com/flaky");
    } catch (cause) {
      thrown = cause;
    }
    expect(thrown).toBeInstanceOf(TypeError);
    expect((thrown as TypeError).message).toBe("fetch failed");
    expect(((thrown as TypeError).cause as Error & { code: string }).code).toBe(
      "ECONNREFUSED",
    );
    expect(harness.captures).toHaveLength(1);
    expect(harness.unservedSlots()).toEqual([]);
  });
});

describe("createVectorFetch — response bodies", () => {
  it("rebuilds body_stream into a ReadableStream preserving chunk boundaries", async () => {
    const harness = createVectorFetch(
      interactionsOf(`[
        {"request": {"method": "GET", "path": "/export"},
         "response": {"status": 200,
                      "body_stream": [
                        {"encoding": "utf8", "data": "{\\"line\\": 1}\\n{\\"li"},
                        {"encoding": "utf8", "data": "ne\\": 2}\\n"},
                        {"encoding": "base64", "data": "eyJsaW5lIjogM30K"}
                      ]}}
      ]`),
    );
    const response = await harness.fetch("https://mixpanel.com/export");
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    const chunks: string[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      chunks.push(new TextDecoder().decode(value));
    }
    // Chunk boundaries are contract (D2): three reads, split mid-JSON-line.
    expect(chunks).toEqual(['{"line": 1}\n{"li', 'ne": 2}\n', '{"line": 3}\n']);
  });

  it("serves body_text and body_base64 bodies", async () => {
    const harness = createVectorFetch(
      interactionsOf(`[
        {"request": {"method": "POST", "path": "/upload"},
         "response": {"status": 200, "body_text": "ok,done"}},
        {"request": {"method": "GET", "path": "/download"},
         "response": {"status": 200, "body_base64": "aGVsbG8="}}
      ]`),
    );
    const text = await harness.fetch("https://gcs.example.com/upload", {
      method: "POST",
      body: "col_a,col_b",
    });
    expect(await text.text()).toBe("ok,done");
    const binary = await harness.fetch("https://gcs.example.com/download");
    expect(new Uint8Array(await binary.arrayBuffer())).toEqual(
      new TextEncoder().encode("hello"),
    );
  });

  it("defaults content-type to application/json for JSON bodies only", async () => {
    const harness = createVectorFetch(
      interactionsOf(`[
        {"request": {"method": "GET", "path": "/json"},
         "response": {"status": 200, "body": {"a": 1}}},
        {"request": {"method": "GET", "path": "/json-typed"},
         "response": {"status": 200, "body": {"a": 1},
                      "headers": {"content-type": "application/json; charset=utf-8"}}}
      ]`),
    );
    const plain = await harness.fetch("https://mixpanel.com/json");
    expect(plain.headers.get("content-type")).toBe("application/json");
    const typed = await harness.fetch("https://mixpanel.com/json-typed");
    expect(typed.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
  });

  it("serves null-body statuses without throwing", async () => {
    const harness = createVectorFetch(
      interactionsOf(`[
        {"request": {"method": "DELETE", "path": "/thing"},
         "response": {"status": 204}}
      ]`),
    );
    const response = await harness.fetch("https://mixpanel.com/thing", {
      method: "DELETE",
    });
    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
  });

  it("preserves lossless JSON body tokens (18.0 stays 18.0)", async () => {
    const harness = createVectorFetch(
      interactionsOf(`[
        {"request": {"method": "GET", "path": "/nums"},
         "response": {"status": 200, "body": {"value": 18.0}}}
      ]`),
    );
    const response = await harness.fetch("https://mixpanel.com/nums");
    // The canned body must carry the raw token, not JSON.parse's collapse.
    expect(await response.text()).toBe('{"value":18.0}');
  });
});
