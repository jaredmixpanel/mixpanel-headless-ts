// B8-N1 R10.9 harness — deterministic rows (b8-packets.md §2.5 rows
// 1, 2, 3, 5 + the enumerated ConfigManager error branches of row 4).
// Run: npx vite-node throwaway/b8-n1/io-config-probes.ts
//
// Every probe asserts and counts; any failure throws immediately.

import {
  chmodSync,
  existsSync,
  openSync as realOpenSync,
  writeSync as realWriteSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

import {
  AccountInUseError,
  ConfigError,
  ParamValidationError,
} from "../../packages/core/src/errors.js";
import { Secret } from "../../packages/core/src/secret.js";
import {
  CredentialPathError,
  atomicWriteBytes,
  readCredentialBytes,
} from "../../packages/node/src/io-utils.js";
import { ConfigManager } from "../../packages/node/src/config.js";
import { createNodeConfigSource } from "../../packages/node/src/config-writes.js";

const ROOT = mkdtempSync(join(tmpdir(), "mp-b8n1-probes-"));
const home = resolve(homedir());
if (ROOT === home || ROOT.startsWith(home + sep)) {
  throw new Error(`real-home guard tripped: ${ROOT}`);
}
let caseSeq = 0;
function freshDir(): string {
  caseSeq += 1;
  const dir = join(ROOT, `c${caseSeq}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

let checks = 0;
function ok(cond: boolean, label: string): void {
  checks += 1;
  if (!cond) {
    throw new Error(`PROBE FAIL: ${label}`);
  }
}
function expectThrow(
  fn: () => unknown,
  klass: abstract new (...args: never[]) => object,
  label: string,
): Error {
  checks += 1;
  try {
    fn();
  } catch (exc) {
    if (exc instanceof klass) {
      return exc as Error;
    }
    throw new Error(
      `PROBE FAIL: ${label} threw wrong class ${String(
        (exc as Error).constructor?.name,
      )}: ${(exc as Error).message}`,
    );
  }
  throw new Error(`PROBE FAIL: ${label} did not throw`);
}

const utf8 = (t: string): Uint8Array => new TextEncoder().encode(t);
const tmpSiblings = (dir: string, name: string): string[] =>
  readdirSync(dir).filter((e) => e.startsWith(`${name}.tmp.`));

// ── Row 1: atomic-write crash-window fault injection ─────────────────
{
  // (a) tmp create fails EEXIST — pre-existing FOREIGN tmp survives.
  const dir = freshDir();
  const target = join(dir, "t.bin");
  writeFileSync(target, "orig");
  const seen: string[] = [];
  atomicWriteBytes(join(dir, "probe"), utf8("p"), {
    fsOps: {
      openSync: (p, f, m) => {
        seen.push(p);
        return realOpenSync(p, f, m);
      },
    },
  });
  const probeTmp = seen[0] as string;
  const m = /\.tmp\.(\d+)\.(\d+)$/.exec(probeTmp);
  ok(m !== null, "row1a tmp naming <name>.tmp.<pid>.<counter>");
  const pid = Number(m?.[1]);
  const counter = Number(m?.[2]);
  ok(pid === process.pid, "row1a tmp embeds pid");
  const nextTmp = join(dir, `t.bin.tmp.${pid}.${counter + 1}`);
  writeFileSync(nextTmp, "foreign");
  const err = expectThrow(
    () => atomicWriteBytes(target, utf8("new")),
    Error,
    "row1a EEXIST propagates",
  );
  ok(
    (err as NodeJS.ErrnoException).code === "EEXIST",
    "row1a error code EEXIST",
  );
  ok(readFileSync(target, "utf-8") === "orig", "row1a original intact");
  ok(
    readFileSync(nextTmp, "utf-8") === "foreign",
    "row1a foreign tmp SURVIVES",
  );
  rmSync(nextTmp);

  // (b) fchmod fails.
  const t2 = join(dir, "b.bin");
  writeFileSync(t2, "orig-b");
  expectThrow(
    () =>
      atomicWriteBytes(t2, utf8("x"), {
        fsOps: {
          fchmodSync: () => {
            throw Object.assign(new Error("EPERM sim"), { code: "EPERM" });
          },
        },
      }),
    Error,
    "row1b fchmod failure propagates",
  );
  ok(readFileSync(t2, "utf-8") === "orig-b", "row1b original intact");
  ok(tmpSiblings(dir, "b.bin").length === 0, "row1b tmp cleaned");

  // (c) write fails mid-loop (first chunk short-writes, second throws).
  const t3 = join(dir, "c.bin");
  writeFileSync(t3, "orig-c");
  let call = 0;
  expectThrow(
    () =>
      atomicWriteBytes(t3, utf8("0123456789"), {
        fsOps: {
          writeSync: (fd, data, offset) => {
            call += 1;
            if (call === 1) {
              // Short write of 3 bytes via the real writeSync.
              return realWriteSync(fd, data, offset, 3);
            }
            throw Object.assign(new Error("ENOSPC sim"), { code: "ENOSPC" });
          },
        },
      }),
    Error,
    "row1c mid-loop write failure propagates",
  );
  ok(call === 2, "row1c short-write loop retried before failing");
  ok(readFileSync(t3, "utf-8") === "orig-c", "row1c original intact");
  ok(tmpSiblings(dir, "c.bin").length === 0, "row1c tmp cleaned");

  // (d) rename fails.
  const t4 = join(dir, "d.bin");
  writeFileSync(t4, "orig-d");
  expectThrow(
    () =>
      atomicWriteBytes(t4, utf8("x"), {
        fsOps: {
          renameSync: () => {
            throw Object.assign(new Error("EXDEV sim"), { code: "EXDEV" });
          },
        },
      }),
    Error,
    "row1d rename failure propagates",
  );
  ok(readFileSync(t4, "utf-8") === "orig-d", "row1d original intact");
  ok(tmpSiblings(dir, "d.bin").length === 0, "row1d tmp cleaned");

  // Post-success: content + mode 0o600, and 0o400 when requested.
  const t5 = join(dir, "e.bin");
  atomicWriteBytes(t5, utf8("payload"));
  ok(readFileSync(t5, "utf-8") === "payload", "row1 success content");
  ok((statSync(t5).mode & 0o7777) === 0o600, "row1 success mode 0600");
  const t6 = join(dir, "f.bin");
  atomicWriteBytes(t6, utf8("ro"), { mode: 0o400 });
  ok((statSync(t6).mode & 0o7777) === 0o400, "row1 success mode 0400");
}

// ── Row 2: 0600 on every write path + mode-guard rows ────────────────
{
  const dir = freshDir();
  const cm = new ConfigManager({ configPath: join(dir, "config.toml") });
  cm.addAccount("a", {
    type: "service_account",
    region: "us",
    username: "u",
    secret: new Secret("s"),
  });
  ok(
    (statSync(cm.configPath).mode & 0o7777) === 0o600,
    "row2 config file 0600",
  );
  ok(
    (statSync(dir + "").mode & 0o7777) !== 0, // parent exists (pre-made)
    "row2 parent dir present",
  );
  // Fresh parent created by writeRaw gets 0700.
  const nested = join(dir, "nest", "config.toml");
  const cm2 = new ConfigManager({ configPath: nested });
  cm2.setCustomHeader({ name: "X", value: "y" });
  ok(
    (statSync(join(dir, "nest")).mode & 0o7777) === 0o700,
    "row2 created parent dir 0700",
  );
  for (const bad of [0o644, 0o640, 0o601]) {
    const t = join(dir, `g${bad}.bin`);
    expectThrow(
      () => atomicWriteBytes(t, utf8("x"), { mode: bad }),
      ParamValidationError,
      `row2 mode guard 0o${bad.toString(8)}`,
    );
    ok(
      tmpSiblings(dir, `g${bad}.bin`).length === 0 && !existsSync(t),
      `row2 mode guard 0o${bad.toString(8)} no FS touch`,
    );
  }
}

// ── Row 3: symlink refusal (read + write entry points) ───────────────
{
  const dir = freshDir();
  // Live symlinked config target.
  const real = join(dir, "attacker.toml");
  writeFileSync(real, '[active]\naccount = "evil"\n');
  chmodSync(real, 0o600);
  const link = join(dir, "config.toml");
  symlinkSync(real, link);
  const cm = new ConfigManager({ configPath: link });
  const e1 = expectThrow(
    () => cm.listAccounts(),
    ConfigError,
    "row3 symlinked config read refused",
  );
  ok(/symlink/.test(e1.message), "row3 refusal names symlink");
  // Write entry: mutator refuses at the transaction's read leg.
  expectThrow(
    () => cm.setCustomHeader({ name: "X", value: "y" }),
    ConfigError,
    "row3 symlinked config write refused (read leg)",
  );
  ok(
    readFileSync(real, "utf-8") === '[active]\naccount = "evil"\n',
    "row3 attacker file untouched",
  );
  // Dangling symlink.
  const dangling = join(dir, "dangling.toml");
  symlinkSync(join(dir, "nope.toml"), dangling);
  expectThrow(
    () => new ConfigManager({ configPath: dangling }).listAccounts(),
    ConfigError,
    "row3 dangling symlink refused (not ENOENT-hidden)",
  );
  expectThrow(
    () => readCredentialBytes(dangling),
    CredentialPathError,
    "row3 readCredentialBytes dangling symlink refused",
  );
  // Symlinked PARENT dir: the retained lstat layer probes the LEAF only
  // (Python's leaf `reject_if_symlink` likewise; parent traversal
  // hardening was the DROPPED dirfd-walk layer — sanctioned R9.2
  // deviation, io-utils.ts module header). Assert the ported behavior:
  // a file under a symlinked parent still reads (parity with Python's
  // retained layer).
  const realParent = join(dir, "realdir");
  mkdirSync(realParent);
  const inner = join(realParent, "cred.txt");
  writeFileSync(inner, "v");
  chmodSync(inner, 0o600);
  const linkParent = join(dir, "linkdir");
  symlinkSync(realParent, linkParent);
  ok(
    new TextDecoder().decode(
      readCredentialBytes(join(linkParent, "cred.txt")),
    ) === "v",
    "row3 symlinked PARENT allowed at the retained lstat layer (documented drop)",
  );
}

// ── Row 4 (deterministic half): ConfigManager error branches ─────────
{
  const dir = freshDir();
  const path = join(dir, "config.toml");
  const cm = new ConfigManager({ configPath: path });
  expectThrow(
    () => cm.getAccount("ghost"),
    ConfigError,
    "row4 unknown account",
  );
  expectThrow(() => cm.getTarget("ghost"), ConfigError, "row4 unknown target");
  expectThrow(
    () => cm.removeAccount("ghost"),
    ConfigError,
    "row4 remove unknown account",
  );
  expectThrow(
    () => cm.removeTarget("ghost"),
    ConfigError,
    "row4 remove unknown target",
  );
  expectThrow(() => cm.applyTarget("ghost"), ConfigError, "row4 apply unknown");
  cm.addAccount("a", {
    type: "service_account",
    region: "us",
    username: "u",
    secret: new Secret("s"),
  });
  expectThrow(
    () => cm.addAccount("a", { type: "oauth_browser", region: "us" }),
    ConfigError,
    "row4 duplicate add (PLAIN ConfigError)",
  );
  ok(
    expectThrow(
      () => cm.addAccount("a", { type: "oauth_browser", region: "us" }),
      ConfigError,
      "row4 duplicate add code",
    ) instanceof
      AccountInUseError ===
      false,
    "row4 duplicate is NOT AccountInUseError",
  );
  cm.addTarget("t1", { account: "a", project: "1" });
  expectThrow(
    () => cm.removeAccount("a"),
    AccountInUseError,
    "row4 remove referenced without force",
  );
  ok(
    cm.removeAccount("a", { force: true }).join(",") === "t1",
    "row4 force remove returns orphans",
  );
  expectThrow(
    () => cm.applySession({ project: "5" }),
    ConfigError,
    "row4 apply_session project without account",
  );
  expectThrow(
    () => cm.applySession({ workspace: 3, clear_workspace: true }),
    ParamValidationError,
    "row4 workspace XOR clear_workspace",
  );
  for (const w of [0, -1, 1.5]) {
    expectThrow(
      () => cm.setActive({ workspace: w }),
      ConfigError,
      `row4 invalid workspace ${w}`,
    );
  }
  // 2^53 is a positive integer on BOTH sides (Python int / JS
  // Number.isInteger) — accepted, not rejected.
  cm.setActive({ workspace: 2 ** 53 });
  ok(cm.getActive().workspace === 2 ** 53, "row4 2^53 accepted (both sides)");
  // Malformed TOML → coded parse error.
  writeFileSync(path, "this is not = [ toml", { mode: 0o600 });
  chmodSync(path, 0o600);
  expectThrow(
    () => cm.listAccounts(),
    ConfigError,
    "row4 malformed TOML wrapped in ConfigError",
  );
  // Unknown account type in block.
  writeFileSync(path, '[accounts.z]\ntype = "wat"\nregion = "us"\n');
  chmodSync(path, 0o600);
  expectThrow(
    () => cm.getAccount("z"),
    ConfigError,
    "row4 unknown account type in block",
  );
  // Transaction atomicity on failing op: file byte-identical.
  writeFileSync(path, '[accounts.k]\ntype = "oauth_browser"\nregion = "us"\n');
  chmodSync(path, 0o600);
  const before = readFileSync(path);
  expectThrow(
    () => cm.addTarget("bad", { account: "nope", project: "1" }),
    ConfigError,
    "row4 failing op",
  );
  ok(
    Buffer.compare(before, readFileSync(path)) === 0,
    "row4 failing op leaves file byte-identical",
  );
}

// ── Row 5: edge set through annotation-admitting params ──────────────
{
  const dir = freshDir();
  const cm = new ConfigManager({ configPath: join(dir, "config.toml") });
  // Account names: pattern-invalid members refuse with ConfigError.
  for (const name of ["", "18.0", "1.5", "bad name", "𝒳", "[]"]) {
    expectThrow(
      () =>
        cm.addAccount(name, {
          type: "service_account",
          region: "us",
          username: "u",
          secret: new Secret("s"),
        }),
      ConfigError,
      `row5 invalid account name ${JSON.stringify(name)}`,
    );
  }
  // "true"/"null" ARE pattern-valid names (letters only) — accepted.
  for (const name of ["true", "null"]) {
    cm.addAccount(name, { type: "oauth_browser", region: "us" });
    ok(cm.getAccount(name).name === name, `row5 name ${name} accepted`);
  }
  // default_project: digit-string only.
  for (const project of ["18.0", "1.5", "", "𝒳"]) {
    expectThrow(
      () => cm.updateAccount("true", { default_project: project }),
      ConfigError,
      `row5 invalid default_project ${JSON.stringify(project)}`,
    );
  }
  // Header values: unicode + NFC/NFD preserved VERBATIM through the
  // TOML round-trip (no normalization).
  const nfc = "café";
  const nfd = "café";
  ok(nfc !== nfd, "row5 NFC/NFD are distinct inputs");
  cm.setCustomHeader({ name: "X-𝒳", value: nfc });
  ok(
    new ConfigManager({ configPath: cm.configPath }).getCustomHeader()?.[1] ===
      nfc,
    "row5 NFC preserved verbatim",
  );
  cm.setCustomHeader({ name: "X-𝒳", value: nfd });
  const back = new ConfigManager({
    configPath: cm.configPath,
  }).getCustomHeader();
  ok(back?.[0] === "X-𝒳" && back?.[1] === nfd, "row5 NFD + 𝒳 preserved");
  // Secret round-trip with the 𝒳 member.
  cm.addAccount("uni", {
    type: "service_account",
    region: "eu",
    username: "𝒳-user",
    secret: new Secret("𝒳-secret"),
  });
  const uni = new ConfigManager({ configPath: cm.configPath }).getAccount(
    "uni",
  );
  ok(
    uni.type === "service_account" && uni.secret.reveal() === "𝒳-secret",
    "row5 𝒳 secret round-trips revealed",
  );
}

// ── Adapter promotion probes (FR-045 layering, B-E2E-N1) ─────────────
{
  const dir = freshDir();
  const src = createNodeConfigSource({
    configPath: join(dir, "config.toml"),
  });
  src.addAccount("first", { type: "oauth_browser", region: "us" });
  ok(
    src.getActive().account === "first",
    "adapter promotes FIRST account to [active]",
  );
  src.addAccount("second", { type: "oauth_browser", region: "us" });
  ok(
    src.getActive().account === "first",
    "adapter does not promote subsequent accounts",
  );
  // Manager layer never promotes.
  const dir2 = freshDir();
  const cm = new ConfigManager({ configPath: join(dir2, "config.toml") });
  cm.addAccount("solo", { type: "oauth_browser", region: "us" });
  ok(
    (cm.getActive().account ?? null) === null,
    "manager layer does NOT promote (B-E2E-N1)",
  );
}

rmSync(ROOT, { recursive: true, force: true });
console.log(`io-config-probes: ${checks} checks, 0 failures`);
