/**
 * Pair-A lens-1 reviewer crash-window probes (3 fresh probes beyond the
 * RUN-record rows) — b8-reviewA-semantics.md. Throwaway; removed with
 * the rest of throwaway/ at the gate.
 */
import { strict as assert } from "node:assert";
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { atomicWriteBytes } from "../packages/node/src/io-utils.js";
import { ConfigManager } from "../packages/node/src/config.js";

const dir = mkdtempSync(join(tmpdir(), "b8-revA-"));
let checks = 0;
const ok = (cond: boolean, label: string): void => {
  checks += 1;
  assert.ok(cond, label);
};

// ---- Probe 1: close() failure AFTER a fully successful write --------
// Python: close runs in finally; a close error propagates, rename is
// skipped, tmp unlinked, original intact.
{
  const target = join(dir, "p1.json");
  writeFileSync(target, "ORIGINAL", { mode: 0o600 });
  let threw = false;
  try {
    atomicWriteBytes(target, new TextEncoder().encode("NEW"), {
      fsOps: {
        closeSync: (): void => {
          throw Object.assign(new Error("EIO close"), { code: "EIO" });
        },
      },
    });
  } catch (exc) {
    threw = true;
    ok(
      (exc as Error).message.includes("EIO close"),
      "p1: close error propagates",
    );
  }
  ok(threw, "p1: threw");
  ok(readFileSync(target, "utf-8") === "ORIGINAL", "p1: original intact");
  ok(
    readdirSync(dir).filter((n) => n.startsWith("p1.json.tmp.")).length === 0,
    "p1: tmp cleaned",
  );
}

// ---- Probe 2: rename failure with a NON-default mode (0o400) --------
// Original's mode must be untouched (0o600), tmp gone, error propagated.
{
  const target = join(dir, "p2.json");
  writeFileSync(target, "KEEP", { mode: 0o600 });
  let threw = false;
  try {
    atomicWriteBytes(target, new TextEncoder().encode("NEW"), {
      mode: 0o400,
      fsOps: {
        renameSync: (): void => {
          throw Object.assign(new Error("EXDEV rename"), { code: "EXDEV" });
        },
      },
    });
  } catch {
    threw = true;
  }
  ok(threw, "p2: threw");
  ok(readFileSync(target, "utf-8") === "KEEP", "p2: original bytes intact");
  ok((statSync(target).mode & 0o7777) === 0o600, "p2: original mode untouched");
  ok(
    readdirSync(dir).filter((n) => n.startsWith("p2.json.tmp.")).length === 0,
    "p2: tmp cleaned",
  );
}

// ---- Probe 3: symlink planted BETWEEN transaction read and write ----
// Python parity: _write_raw has no symlink probe; os.replace/renameSync
// replace the LINK inode itself (never write through it). The link's
// TARGET must stay untouched and the config path must become a regular
// 0o600 file. (Verified against CPython semantics — os.replace(2)
// rename() does not follow the destination symlink.)
{
  const victim = join(dir, "victim.txt");
  writeFileSync(victim, "VICTIM", { mode: 0o600 });
  const cfg = join(dir, "swap-config.toml");
  const manager = new ConfigManager({ configPath: cfg });
  manager.transaction((raw) => {
    // Attack lands mid-transaction: the path becomes a symlink to the
    // victim after readRaw but before writeRaw.
    symlinkSync(victim, cfg);
    raw["settings"] = { custom_header: { name: "X-A", value: "b" } };
  });
  ok(
    readFileSync(victim, "utf-8") === "VICTIM",
    "p3: symlink target untouched",
  );
  const st = lstatSync(cfg);
  ok(!st.isSymbolicLink(), "p3: link replaced by regular file");
  ok((st.mode & 0o7777) === 0o600, "p3: replacement file is 0600");
  ok(
    readFileSync(cfg, "utf-8").includes("custom_header"),
    "p3: write landed at the path, not the target",
  );
  // And the NEXT read refuses nothing (regular file now) — parity with
  // Python where the subsequent _read_raw sees a regular file.
  const pair = manager.getCustomHeader();
  ok(pair !== null && pair[0] === "X-A", "p3: round-trip after swap");
  chmodSync(cfg, 0o600);
}

console.log(`b8-reviewA-semantics-probes: ${checks} checks, 0 failures`);
