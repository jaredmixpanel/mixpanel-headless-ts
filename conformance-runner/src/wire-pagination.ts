/**
 * B4-C6 wire binding: `pagination.paginate_all` (packet C6 — the one
 * corpus name under the `pagination.` prefix; 39 vectors).
 *
 * Binding honesty (P3-5 §3): memoized `clientFromSession` + ONE call to
 * the ported `paginateAll` generator (drained like the recorder's
 * `list(paginate_all(...))`) + kwarg passthrough — no request assembly,
 * no path derivation.
 */

import { paginateAll } from "@mixpanel-headless/core/internal";
import type { JsonValue } from "./json-value.js";
import type { ImplementationRegistry, InvocationContext } from "./runner.js";
import { clientFromSession, requireWireKwarg, runWire } from "./wire-client.js";

/**
 * Register the B4-C6 pagination binding.
 *
 * @param implementations - The registry to extend.
 */
export function registerPaginationBindings(
  implementations: ImplementationRegistry,
): void {
  implementations.register(
    "pagination.paginate_all",
    async (context: InvocationContext): Promise<JsonValue> => {
      const client = clientFromSession(context);
      return runWire(async () => {
        const options: {
          params?: Record<string, string>;
          page_size?: number;
        } = {};
        if (Object.hasOwn(context.kwargs, "params")) {
          options.params = context.kwargs["params"] as Record<string, string>;
        }
        if (Object.hasOwn(context.kwargs, "page_size")) {
          options.page_size = context.kwargs["page_size"] as number;
        }
        const items: unknown[] = [];
        for await (const item of paginateAll(
          client,
          requireWireKwarg(context, "path") as string,
          options,
        )) {
          items.push(item);
        }
        return items;
      });
    },
  );
}
