/**
 * The `pagination.paginate_all` wire binding — the one corpus name under
 * the `pagination.` prefix.
 *
 * The binding is the memoized `clientFromSession` plus one call to the
 * ported `paginateAll` generator (drained like the recorder's
 * `list(paginate_all(...))`) and kwarg passthrough — no request
 * assembly, no path derivation. See `wire-client.ts` for the shared
 * client-construction and honesty rules.
 */

import { paginateAll } from "@mixpanel-headless/core/internal";

import type { JsonValue } from "./json-value.js";
import type { ImplementationRegistry, InvocationContext } from "./runner.js";
import { clientFromSession, requireWireKwarg, runWire } from "./wire-client.js";

/**
 * Register the pagination binding.
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
