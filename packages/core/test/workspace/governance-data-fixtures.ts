import { Workspace } from "../../src/workspace.js";
import type { WorkspaceOptions } from "../../src/workspace-members/options.js";
import {
  type CannedHandler,
  type CannedResponse,
  CLIENT_SESSION,
  createMockClient,
  FACADE_SESSION,
  type FakeTransport,
} from "../../test-support/client-test-helpers.js";

/**
 * Build a Workspace whose client routes through `handler`
 * (`_make_workspace`, :97-116).
 *
 * @param handler - The canned-response handler.
 * @param options - Extra facade options (the W7-D1/D2 seams).
 * @param sleep - Optional client sleep override (the virtual clock).
 * @returns The facade plus the transport capture log.
 */
export function makeWorkspace(
  handler: CannedHandler,
  options: Partial<WorkspaceOptions> = {},
  sleep?: (ms: number) => Promise<void>,
): { ws: Workspace; transport: FakeTransport } {
  const { client, transport } = createMockClient(
    CLIENT_SESSION,
    handler,
    sleep === undefined ? {} : { sleep },
  );
  return {
    ws: new Workspace({ session: FACADE_SESSION, client, ...options }),
    transport,
  };
}

/**
 * A 200 App-API envelope with NO `results` key (the Python
 * `{"status": "ok"}` delete responses).
 *
 * @returns The canned response.
 */
export function okBare(): CannedResponse {
  return { status: 200, json: { status: "ok" } };
}

/**
 * A minimal custom property dict matching the API shape
 * (`_custom_property_json`, :208-230).
 *
 * @param customPropertyId - Custom property ID.
 * @param name - Property name.
 * @param resourceType - Resource type.
 * @returns The payload record.
 */
export function customPropertyJson(
  customPropertyId = 1,
  name = "Revenue",
  resourceType = "events",
): Record<string, unknown> {
  return {
    custom_property_id: customPropertyId,
    name,
    resource_type: resourceType,
    description: `Custom property ${name}`,
    display_formula: 'number(properties["amount"])',
    is_visible: true,
  };
}

/**
 * A minimal lookup table dict matching the API shape
 * (`_lookup_table_json`, :233-251).
 *
 * @param id - Lookup table ID.
 * @param name - Table name.
 * @returns The payload record.
 */
export function lookupTableJson(
  id = 1,
  name = "Products",
): Record<string, unknown> {
  return { id, name, token: "abc123", created_at: "2026-01-01T00:00:00Z" };
}
