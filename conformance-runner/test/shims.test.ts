// Shim tests (src/shims.ts, task TS-5): frozen clock, deterministic UUID
// stream, and VIRTUAL sleep semantics per design D1.4/D12.
import { describe, expect, it } from "vitest";

import { createShims } from "../src/shims.js";

const RECORD_EPOCH = "2026-01-15T12:00:00Z";

describe("createShims", () => {
  it("freezes now()/today() at the record epoch", () => {
    const shims = createShims(RECORD_EPOCH);
    expect(shims.now().toISOString()).toBe("2026-01-15T12:00:00.000Z");
    expect(shims.today()).toBe("2026-01-15");
  });

  it("emits the deterministic UUID stream starting at sequence 0", () => {
    const shims = createShims(RECORD_EPOCH);
    expect(shims.uuid()).toBe("00000000-0000-4000-8000-000000000000");
    expect(shims.uuid()).toBe("00000000-0000-4000-8000-000000000001");
    expect(shims.uuid()).toBe("00000000-0000-4000-8000-000000000002");
  });

  it("resets the UUID counter per shims instance (per vector)", () => {
    const first = createShims(RECORD_EPOCH);
    first.uuid();
    first.uuid();
    const second = createShims(RECORD_EPOCH);
    expect(second.uuid()).toBe("00000000-0000-4000-8000-000000000000");
  });

  it("virtual sleep advances the frozen clock and resolves immediately", async () => {
    const shims = createShims(RECORD_EPOCH);
    const wallBefore = Date.now();
    await shims.sleep(3600);
    const wallElapsed = Date.now() - wallBefore;
    expect(wallElapsed).toBeLessThan(1000); // no real waiting
    expect(shims.now().toISOString()).toBe("2026-01-15T13:00:00.000Z");
    expect(shims.monotonic()).toBe(3600);
  });

  it("virtual sleep terminates monotonic-deadline poll loops deterministically", async () => {
    // Mirror of the lookup-table poll pattern (workspace.py:7857-7860,
    // design D1.4): deadline = monotonic() + max_poll_seconds; the loop
    // must run a machine-independent number of iterations.
    const shims = createShims(RECORD_EPOCH);
    const deadline = shims.monotonic() + 0.05;
    let polls = 0;
    while (shims.monotonic() < deadline) {
      polls += 1;
      await shims.sleep(0.02);
    }
    expect(polls).toBe(3); // ceil(0.05 / 0.02)
  });

  it("today() rolls over after enough virtual sleep", async () => {
    const shims = createShims(RECORD_EPOCH);
    await shims.sleep(13 * 3600);
    expect(shims.today()).toBe("2026-01-16");
  });

  it("rejects an unparseable record epoch", () => {
    expect(() => createShims("not-a-date")).toThrow(/invalid recordEpoch/);
  });
});
