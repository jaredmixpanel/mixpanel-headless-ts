// Trivial skeleton test (TS-1): proves the vitest harness and NodeNext
// module resolution work for this package.
//
// Extended post-Phase-3 (QA 2026-08-17): the phase2-audit A1 deferral
// ledger assigned nine public exports to later batches; eight landed
// their barrel lines with their owner batch, but B6's one deferral —
// `Workspace` — shipped the class without the barrel export, so the
// README quick start (`import { Workspace } from "@mixpanel-headless/core"`)
// did not compile. This test locks every A1-deferred name onto the
// barrel so a missing line can never again hide behind "the symbol
// exists somewhere".
import { describe, expect, it } from "vitest";
import {
  CORE_PACKAGE_NAME,
  Workspace,
  validateBookmark,
  defaultLabelFn,
  selectorLabelFn,
  urlNormalizer,
} from "../src/index.js";

describe("@mixpanel-headless/core package skeleton", () => {
  it("exports its package name", () => {
    expect(CORE_PACKAGE_NAME).toBe("@mixpanel-headless/core");
  });

  it("exports every phase2-audit A1-deferred public name from the barrel", () => {
    // B6 deferral — the facade class itself (QA finding #1).
    expect(typeof Workspace).toBe("function");
    // B2 deferral.
    expect(typeof validateBookmark).toBe("function");
    // B5 deferrals (replay_labels __all__).
    expect(typeof defaultLabelFn).toBe("function");
    expect(typeof selectorLabelFn).toBe("function");
    expect(typeof urlNormalizer).toBe("function");
  });
});
