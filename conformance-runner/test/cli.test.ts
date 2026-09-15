// CLI (src/cli.ts): argument parsing and a full-corpus smoke run of main().

import { describe, expect, it, vi } from "vitest";

import { main, parseArgs } from "../src/cli.js";

describe("parseArgs", () => {
  it("defaults to the json report", () => {
    expect(parseArgs([])).toStrictEqual({ report: "json" });
  });

  it("accepts --report json and --filter", () => {
    expect(
      parseArgs(["--report", "json", "--filter", "compat/"]),
    ).toStrictEqual({
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
  it("replays the committed snapshot with zero failures and zero UNPORTED", async () => {
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
      expect(report.failures).toStrictEqual([]);
      // With every module ported, no vector may report UNPORTED at all.
      expect(report.skipped_unported).toBe(0);
      expect(report.total).toBeGreaterThan(2000);
      expect(report.passed).toBe(report.total);
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
      await expect(main(["--report", "xml"])).resolves.toBe(2);
    } finally {
      errSpy.mockRestore();
    }
  });
});
