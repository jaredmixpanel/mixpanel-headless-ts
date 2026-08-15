// CLI tests (src/cli.ts, task TS-5): argument parsing and a full-corpus
// smoke run of main() (design D12 reporting CLI).
import { describe, expect, it, vi } from "vitest";
import { main, parseArgs } from "../src/cli.js";

describe("parseArgs", () => {
  it("defaults to the json report", () => {
    expect(parseArgs([])).toEqual({ report: "json" });
  });

  it("accepts --report json and --filter", () => {
    expect(parseArgs(["--report", "json", "--filter", "compat/"])).toEqual({
      report: "json",
      filter: "compat/",
    });
  });

  it("rejects unknown flags and formats", () => {
    expect(() => parseArgs(["--nope"])).toThrow(/unknown argument/);
    expect(() => parseArgs(["--report", "xml"])).toThrow(/unsupported/);
    expect(() => parseArgs(["--report"])).toThrow(/requires a value/);
    expect(() => parseArgs(["--filter"])).toThrow(/requires a value/);
  });
});

describe("main", () => {
  it("replays the committed snapshot: zero failures, all UNPORTED at TS-5", async () => {
    const stdout: string[] = [];
    const outSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk) => {
        stdout.push(String(chunk));
        return true;
      });
    const errSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    try {
      const code = await main(["--report", "json"]);
      const report = JSON.parse(stdout.join("")) as {
        total: number;
        passed: number;
        failed: number;
        skipped_unported: number;
        failures: unknown[];
      };
      expect(code).toBe(0);
      expect(report.failed).toBe(0);
      expect(report.failures).toEqual([]);
      // PR-7's authored compat vectors are not yet in the snapshot, so
      // every vector is UNPORTED (TS-6 re-syncs and flips compat to PASS).
      expect(report.total).toBeGreaterThan(2000);
      expect(report.passed + report.skipped_unported).toBe(report.total);
    } finally {
      outSpy.mockRestore();
      errSpy.mockRestore();
    }
  });

  it("returns exit code 2 on bad arguments", async () => {
    const errSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    try {
      expect(await main(["--report", "xml"])).toBe(2);
    } finally {
      errSpy.mockRestore();
    }
  });
});
