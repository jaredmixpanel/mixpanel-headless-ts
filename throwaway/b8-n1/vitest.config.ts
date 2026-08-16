// Throwaway vitest config for the B8-N1 swap-in run (not part of the
// root include set; run with `npx vitest run -c throwaway/b8-n1/vitest.config.ts`).
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["throwaway/b8-n1/**/*.test.ts"],
    root: new URL("../..", import.meta.url).pathname,
  },
});
