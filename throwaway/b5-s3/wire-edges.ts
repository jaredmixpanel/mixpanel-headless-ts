/**
 * B5-S3 R10.9 harness, part 2 — the CDN-walker wire edges.
 *
 * The packet §5 "R10.9 harness spec (S3)" mandates a hand-built
 * interaction matrix over the walker (concurrency, the 404 sentinel,
 * the 403 re-sign rules, the credential redaction) plus EVERY owned
 * error branch and the mandated edge set. No Python side is needed:
 * each check asserts a shape read directly off `replays.py`, cited
 * inline.
 *
 *     npx vite-node throwaway/b5-s3/wire-edges.ts
 *
 * Throwaway (packet §7.5 removes `throwaway/b5-s3/` at the batch gate).
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- throwaway harness. */
import {
  createMixpanelClient,
  type MixpanelClient,
} from "../../packages/core/src/client/client.js";
import type { Session } from "../../packages/core/src/auth/session.js";
import { makeSession } from "../../packages/core/test/client/client-test-helpers.js";
import { ReplaysService } from "../../packages/core/src/services/replays.js";
import {
  MixpanelHeadlessError,
  ParamValidationError,
} from "../../packages/core/src/errors.js";
import { SignedReplay } from "../../packages/core/src/types/results/replays.js";
import { Workspace } from "../../packages/core/src/workspace.js";

const SESSION: Session = makeSession({ projectId: "12345" });

const CREDENTIAL = "URLPrefix=A&Expires=1&KeyName=K&Signature=SECRET";

let checks = 0;
let failures = 0;

/**
 * Record one assertion.
 *
 * @param label - The check name.
 * @param ok - Whether it held.
 * @param detail - Extra context printed on failure.
 */
function check(label: string, ok: boolean, detail = ""): void {
  checks += 1;
  if (!ok) {
    failures += 1;
    console.log(`FAIL ${label} ${detail}`);
  }
}

/** One canned CDN response. */
interface Canned {
  status: number;
  body?: string;
  throwMessage?: string;
}

/**
 * Build the App-API + CDN pair of fetch seams.
 *
 * @param cdn - File number → canned response (absent → 404).
 * @param signResponses - Successive `/replays/sign/bulk` payloads.
 * @returns The client, the CDN fetch, and the request logs.
 */
function rig(
  cdn: (fileNum: number, attempt: number) => Canned,
  signResponses: unknown[] = [
    [
      {
        replay_id: "r-1",
        url: "https://cdn.test/srr/",
        query_string: `${CREDENTIAL}&v=2`,
      },
    ],
  ],
): {
  client: MixpanelClient;
  cdnFetch: typeof fetch;
  cdnLog: number[];
  signCount: () => number;
  concurrentPeak: () => number;
} {
  let signCalls = 0;
  const appFetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : String((input as any).url);
    if (url.includes("/replays/sign/bulk")) {
      const payload =
        signResponses[Math.min(signCalls, signResponses.length - 1)];
      signCalls += 1;
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  const client = createMixpanelClient({
    session: SESSION,
    fetch: appFetch,
    sleep: async () => {},
    random: () => 0,
  });

  const cdnLog: number[] = [];
  const attempts = new Map<number, number>();
  let inflight = 0;
  let peak = 0;
  const cdnFetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : String((input as any).url);
    const path = new URL(url).pathname;
    const last = path.slice(path.lastIndexOf("/") + 1);
    const fileNum = Number(last.slice(0, last.indexOf("-")));
    cdnLog.push(fileNum);
    const attempt = (attempts.get(fileNum) ?? 0) + 1;
    attempts.set(fileNum, attempt);
    inflight += 1;
    peak = Math.max(peak, inflight);
    // Yield once so overlapping requests are observable.
    await Promise.resolve();
    inflight -= 1;
    const canned = cdn(fileNum, attempt);
    if (canned.throwMessage !== undefined) {
      throw new TypeError(canned.throwMessage.replaceAll("{URL}", url));
    }
    return new Response(canned.body ?? null, { status: canned.status });
  }) as typeof fetch;

  return {
    client,
    cdnFetch,
    cdnLog,
    signCount: () => signCalls,
    concurrentPeak: () => peak,
  };
}

/**
 * The signed handle every walk starts from.
 *
 * @returns The fixture.
 */
function signed(): SignedReplay {
  return new SignedReplay({
    replay_id: "r-1",
    url: "https://cdn.test/srr/",
    query_string: CREDENTIAL,
    env: "prod",
    signed_at: 1716810000.0,
  });
}

/**
 * Serve `events` as a 200 JSON body.
 *
 * @param events - The events to encode.
 * @returns The canned response.
 */
function ok(events: unknown): Canned {
  return { status: 200, body: JSON.stringify(events) };
}

/**
 * Run a walk and capture the outcome.
 *
 * @param cdn - The CDN behaviour.
 * @param options - Walker knobs.
 * @param signResponses - Successive sign payloads.
 * @returns The events (or the thrown error) plus the rig handles.
 */
async function walk(
  cdn: (fileNum: number, attempt: number) => Canned,
  options: {
    retentionDays?: number;
    maxFiles?: number;
    concurrency?: number;
    reSignOnExpiry?: boolean;
  } = {},
  signResponses?: unknown[],
): Promise<{
  events: Array<Record<string, unknown>> | null;
  error: unknown;
  cdnLog: number[];
  signCount: number;
  peak: number;
}> {
  const r = rig(cdn, signResponses);
  const service = new ReplaysService(r.client, { fetchImpl: r.cdnFetch });
  try {
    const events = await service.fetchFiles(signed(), {
      retentionDays: options.retentionDays ?? 30,
      maxFiles: options.maxFiles ?? 500,
      concurrency: options.concurrency ?? 50,
      ...(options.reSignOnExpiry === undefined
        ? {}
        : { reSignOnExpiry: options.reSignOnExpiry }),
    });
    return {
      events,
      error: null,
      cdnLog: r.cdnLog,
      signCount: r.signCount(),
      peak: r.concurrentPeak(),
    };
  } catch (error) {
    return {
      events: null,
      error,
      cdnLog: r.cdnLog,
      signCount: r.signCount(),
      peak: r.concurrentPeak(),
    };
  }
}

/**
 * Read the registry code off a thrown error.
 *
 * @param error - The caught value.
 * @returns The code, or the class name / `"<none>"`.
 */
function codeOf(error: unknown): string {
  if (error instanceof MixpanelHeadlessError) {
    return error.code;
  }
  return error instanceof Error ? error.constructor.name : "<none>";
}

/**
 * An rrweb-shaped event.
 *
 * @param ts - The timestamp (any CPython-`int()`-able value).
 * @returns The event.
 */
function ev(ts: unknown): Record<string, unknown> {
  return { type: 3, data: {}, timestamp: ts };
}

async function main(): Promise<void> {
  // -------------------------------------------------------------------
  // 404 sentinel matrix (`replays.py:348-368`)
  // -------------------------------------------------------------------

  {
    // First-file 404 → ReplayNotFoundError (`:355-360`).
    const r = await walk(() => ({ status: 404 }));
    check(
      "404@file0 → REPLAY_NOT_FOUND",
      codeOf(r.error) === "REPLAY_NOT_FOUND",
      codeOf(r.error),
    );
    const details = (r.error as any)?.details ?? {};
    check("404@file0 details.replay_id", details["replay_id"] === "r-1");
    check("404@file0 details.retention_days", details["retention_days"] === 30);
    check(
      "404@file0 details.cdn_url_prefix",
      String(details["cdn_url_prefix"]).endsWith("/"),
    );
  }

  {
    // Mid-BATCH 404 with survivors AFTER it in the same batch: the
    // survivors before the sentinel yield, everything after is dropped
    // (`:363-368` then `:370-390`).
    const r = await walk(
      (n) => (n === 2 ? { status: 404 } : ok([ev(n * 10)])),
      { concurrency: 8 },
    );
    check(
      "mid-batch 404 yields only pre-sentinel files",
      JSON.stringify(r.events?.map((e) => e["timestamp"])) === "[0,10]",
      JSON.stringify(r.events?.map((e) => e["timestamp"])),
    );
    check(
      "mid-batch 404 still ISSUED the whole batch (gather semantics)",
      r.cdnLog.length === 8,
      String(r.cdnLog.length),
    );
  }

  {
    // 404 exactly at a batch BOUNDARY: batch 0 is complete, so the walk
    // advances and the sentinel lands at index 0 of batch 1 — which is
    // NOT absolute file 0, so it terminates cleanly (`:356`).
    const r = await walk((n) => (n === 4 ? { status: 404 } : ok([ev(n)])), {
      concurrency: 4,
    });
    check(
      "404 at batch boundary terminates cleanly",
      r.error === null,
      codeOf(r.error),
    );
    check(
      "404 at batch boundary keeps batch 0",
      JSON.stringify(r.events?.map((e) => e["timestamp"])) === "[0,1,2,3]",
      JSON.stringify(r.events?.map((e) => e["timestamp"])),
    );
  }

  // -------------------------------------------------------------------
  // 403 re-sign matrix (`replays.py:337-352`)
  // -------------------------------------------------------------------

  {
    // 403-then-success: exactly ONE re-sign, whole batch refetched.
    const r = await walk((n, attempt) => {
      if (n >= 2) return { status: 404 };
      return attempt === 1 ? { status: 403 } : ok([ev(n * 10)]);
    });
    check("403 → re-sign once", r.signCount === 1, String(r.signCount));
    check(
      "403 → batch refetched and yielded",
      JSON.stringify(r.events?.map((e) => e["timestamp"])) === "[0,10]",
      JSON.stringify(r.events?.map((e) => e["timestamp"])),
    );
  }

  {
    // 403-re-sign-then-403 → SIGNED_URL_EXPIRED built from the ORIGINAL
    // handle (packet §9 Caution #4: `_build_expired_error(signed)`).
    const r = await walk(() => ({ status: 403 }));
    check(
      "403 twice → SIGNED_URL_EXPIRED",
      codeOf(r.error) === "SIGNED_URL_EXPIRED",
      codeOf(r.error),
    );
    check(
      "403 twice → exactly one re-sign attempt",
      r.signCount === 1,
      String(r.signCount),
    );
    const details = (r.error as any)?.details ?? {};
    check(
      "expired details carry the ORIGINAL signed_at",
      details["signed_at"] === 1716810000.0,
      String(details["signed_at"]),
    );
    check(
      "expired details carry expired_at",
      details["expired_at"] === 1716810000.0 + 300,
      String(details["expired_at"]),
    );
    check("expired status_code is 403", (r.error as any)?.statusCode === 403);
  }

  {
    // reSignOnExpiry=false → raise immediately, ZERO sign calls.
    const r = await walk(() => ({ status: 403 }), { reSignOnExpiry: false });
    check(
      "reSignOnExpiry=false → SIGNED_URL_EXPIRED",
      codeOf(r.error) === "SIGNED_URL_EXPIRED",
      codeOf(r.error),
    );
    check(
      "reSignOnExpiry=false → no sign call",
      r.signCount === 0,
      String(r.signCount),
    );
  }

  // -------------------------------------------------------------------
  // Bounds + concurrency (`replays.py:334-336`, `:394`)
  // -------------------------------------------------------------------

  {
    // maxFiles < batch size: the batch is CLAMPED, not truncated after
    // the fact (`batch_end = min(file_num + concurrency, max_files)`).
    const r = await walk(() => ok([ev(1)]), { maxFiles: 3, concurrency: 50 });
    check(
      "maxFiles clamps the batch",
      r.cdnLog.length === 3,
      String(r.cdnLog.length),
    );
    check(
      "maxFiles bounds the yield",
      r.events?.length === 3,
      String(r.events?.length),
    );
  }

  {
    // concurrency=1 vs 50 equivalence on an IDENTICAL interaction set.
    const behaviour = (n: number): Canned =>
      n >= 5 ? { status: 404 } : ok([ev(n * 100 + 1), ev(n * 100)]);
    const slow = await walk(behaviour, { concurrency: 1 });
    const fast = await walk(behaviour, { concurrency: 50 });
    check(
      "concurrency 1 == 50 (same events)",
      JSON.stringify(slow.events) === JSON.stringify(fast.events),
    );
    check("concurrency=1 is serial", slow.peak === 1, String(slow.peak));
    check("concurrency=50 overlaps", fast.peak > 1, String(fast.peak));
  }

  // -------------------------------------------------------------------
  // Body handling + the mandated edge set (`replays.py:464-471`)
  // -------------------------------------------------------------------

  {
    // Empty file (200 `[]`) is NOT a terminator; the walk continues.
    const r = await walk(
      (n) => (n === 0 ? ok([]) : n === 1 ? ok([ev(7)]) : { status: 404 }),
      { concurrency: 1 },
    );
    check(
      "200 [] continues the walk",
      JSON.stringify(r.events?.map((e) => e["timestamp"])) === "[7]",
      JSON.stringify(r.events),
    );
  }

  {
    // A 200 scalar / dict body is an EMPTY file, not an error
    // (`payload if isinstance(payload, list) else []`, Caution #5).
    for (const body of ["42", '"text"', "{}", "null", "true", "NaN"]) {
      const r = await walk(
        (n) => (n === 0 ? { status: 200, body } : { status: 404 }),
        { concurrency: 1 },
      );
      check(
        `200 non-list body (${body}) → empty file`,
        r.error === null && r.events?.length === 0,
        `${codeOf(r.error)} ${JSON.stringify(r.events)}`,
      );
    }
  }

  {
    // parseLossless(pythonConstants) accepts CPython's JSON constants.
    const r = await walk(
      (n) =>
        n === 0
          ? { status: 200, body: '[{"type":3,"data":{"x":NaN},"timestamp":5}]' }
          : { status: 404 },
      { concurrency: 1 },
    );
    check(
      "NaN inside a 200 body parses (pythonConstants)",
      r.error === null && r.events?.length === 1,
      codeOf(r.error),
    );
  }

  {
    // Float + string timestamps sort via the CPython `int()` LADDER:
    // 18.9 truncates to 18 (NOT 19), -1.9 to -1, "300" parses.
    const r = await walk(
      (n) =>
        n === 0
          ? ok([ev(18.9), ev("300"), ev(-1.9), ev(18.0), ev(true)])
          : { status: 404 },
      { concurrency: 1 },
    );
    check(
      "int() ladder orders float/str/bool timestamps",
      JSON.stringify(r.events?.map((e) => e["timestamp"])) ===
        JSON.stringify([-1.9, true, 18.9, 18.0, "300"]),
      JSON.stringify(r.events?.map((e) => e["timestamp"])),
    );
  }

  {
    // Non-BMP strings survive the body round-trip byte-for-byte.
    const r = await walk(
      (n) =>
        n === 0
          ? ok([{ type: 3, data: { label: "\u{1d4b3}" }, timestamp: 1 }])
          : { status: 404 },
      { concurrency: 1 },
    );
    check(
      "non-BMP body content preserved",
      (r.events?.[0]?.["data"] as any)?.label === "\u{1d4b3}",
    );
  }

  // -------------------------------------------------------------------
  // Mobile detection (`replays.py:376-390`)
  // -------------------------------------------------------------------

  {
    const r = await walk(
      (n) => (n === 0 ? ok([{ mobile: "tap" }]) : { status: 404 }),
      { concurrency: 1 },
    );
    check(
      "non-rrweb first event → UNSUPPORTED_REPLAY_FORMAT",
      codeOf(r.error) === "UNSUPPORTED_REPLAY_FORMAT",
      codeOf(r.error),
    );
    check(
      "unsupported details.format",
      (r.error as any)?.details?.["format"] === "non-rrweb",
    );
  }

  {
    // The check runs ONCE, on the first YIELDED file — a leading empty
    // file is skipped, so file 1's first event is the one inspected.
    const r = await walk(
      (n) =>
        n === 0 ? ok([]) : n === 1 ? ok([{ mobile: "tap" }]) : { status: 404 },
      { concurrency: 1 },
    );
    check(
      "mobile check skips empty files",
      codeOf(r.error) === "UNSUPPORTED_REPLAY_FORMAT",
      codeOf(r.error),
    );
  }

  {
    // …and it does NOT re-fire on a later non-rrweb event.
    const r = await walk(
      (n) =>
        n === 0
          ? ok([ev(1)])
          : n === 1
            ? ok([{ mobile: "tap" }])
            : { status: 404 },
      { concurrency: 1 },
    );
    check("mobile check is once-only", r.error === null, codeOf(r.error));
  }

  // -------------------------------------------------------------------
  // Transport + status error branches (`replays.py:453-478`)
  // -------------------------------------------------------------------

  {
    const r = await walk(() => ({
      throwMessage: "connection failed for {URL}",
      status: 0,
    }));
    check(
      "transport failure → CDN_FETCH_ERROR",
      codeOf(r.error) === "CDN_FETCH_ERROR",
      codeOf(r.error),
    );
    const message = String((r.error as Error).message);
    check(
      "credential scrubbed from the message",
      !message.includes(CREDENTIAL),
      message.slice(0, 160),
    );
    check("redaction marker present", message.includes("<redacted>"));
    check(
      "no credential in the serialized error",
      !JSON.stringify((r.error as any)?.details ?? {}).includes(
        "Signature=SECRET",
      ),
    );
  }

  {
    const r = await walk(
      (n) =>
        n === 0 ? { status: 200, body: "not json at all" } : { status: 404 },
      { concurrency: 1 },
    );
    check(
      "non-JSON 200 → CDN_INVALID_RESPONSE",
      codeOf(r.error) === "CDN_INVALID_RESPONSE",
      codeOf(r.error),
    );
  }

  {
    for (const status of [500, 502, 429, 301, 418]) {
      const r = await walk((n) => (n === 0 ? { status } : { status: 404 }), {
        concurrency: 1,
      });
      check(
        `unexpected ${status} → CDN_UNEXPECTED_STATUS`,
        codeOf(r.error) === "CDN_UNEXPECTED_STATUS",
        `${status} ${codeOf(r.error)}`,
      );
    }
  }

  // -------------------------------------------------------------------
  // Workspace-level guard codes (TestCodedReplayGuardCodes)
  // -------------------------------------------------------------------

  {
    const r = rig(() => ({ status: 404 }));
    const ws = new Workspace({ session: SESSION, client: r.client });
    const guards: Array<[string, () => Promise<unknown>, string]> = [
      ["no selector", () => ws.listReplays(), "WR4_REPLAY_SELECTOR_REQUIRED"],
      [
        "empty replay_ids",
        () => ws.listReplays({ replay_ids: [] }),
        "WR4_REPLAY_SELECTOR_REQUIRED",
      ],
      [
        "both selectors",
        () => ws.listReplays({ distinct_id: "u", replay_ids: ["r"] }),
        "WR4_REPLAY_SELECTOR_REQUIRED",
      ],
      [
        "no window",
        () => ws.listReplays({ distinct_id: "u" }),
        "WR5_DATE_RANGE_REQUIRED",
      ],
      [
        "half window",
        () => ws.listReplays({ distinct_id: "u", from_date: "2026-01-01" }),
        "WR5_DATE_RANGE_REQUIRED",
      ],
      [
        "6 props (single)",
        () =>
          ws.eventsForReplay("r", {
            event_properties: ["a", "b", "c", "d", "e", "f"],
          }),
        "WR1_TOO_MANY_EVENT_PROPERTIES",
      ],
      [
        "6 props (batched)",
        () =>
          ws.eventsForReplays(["r"], {
            event_properties: ["a", "b", "c", "d", "e", "f"],
          }),
        "WR1_TOO_MANY_EVENT_PROPERTIES",
      ],
      [
        "6 props (fetchReplay)",
        () =>
          ws.fetchReplay("r", {
            event_properties: ["a", "b", "c", "d", "e", "f"],
          }),
        "WR1_TOO_MANY_EVENT_PROPERTIES",
      ],
      [
        "6 props (fetchReplays)",
        () =>
          ws.fetchReplays(["r"], {
            event_properties: ["a", "b", "c", "d", "e", "f"],
          }),
        "WR1_TOO_MANY_EVENT_PROPERTIES",
      ],
      [
        "6 props (replaysForUser)",
        () =>
          ws.replaysForUser("u", {
            from_date: "2026-01-01",
            to_date: "2026-01-02",
            event_properties: ["a", "b", "c", "d", "e", "f"],
          }),
        "WR1_TOO_MANY_EVENT_PROPERTIES",
      ],
    ];
    for (const [label, thunk, expected] of guards) {
      const before = r.cdnLog.length;
      let caught: unknown;
      try {
        await thunk();
      } catch (exc) {
        caught = exc;
      }
      check(
        `guard ${label} → ${expected}`,
        caught instanceof ParamValidationError && codeOf(caught) === expected,
        codeOf(caught),
      );
      check(
        `guard ${label} makes NO wire call`,
        r.cdnLog.length === before,
        String(r.cdnLog.length - before),
      );
    }
    // Exactly 5 properties is inclusive — no raise.
    let fiveOk = true;
    try {
      await ws.eventsForReplays([], {
        event_properties: ["a", "b", "c", "d", "e"],
      });
    } catch {
      fiveOk = false;
    }
    check("exactly 5 props is allowed", fiveOk);
  }

  {
    // fetch_replay's own zero-event REPLAY_NOT_FOUND (`workspace.py:10943`)
    // — distinct from the walker's first-file 404 branch.
    const r = rig((n) => (n === 0 ? ok([]) : { status: 404 }));
    const ws = new Workspace({ session: SESSION, client: r.client });
    ws.replaysService = new ReplaysService(r.client, {
      fetchImpl: r.cdnFetch,
    });
    let caught: unknown;
    try {
      await ws.fetchReplay("r-1", { retention_days: 30 });
    } catch (exc) {
      caught = exc;
    }
    check(
      "fetchReplay zero events → REPLAY_NOT_FOUND",
      codeOf(caught) === "REPLAY_NOT_FOUND",
      codeOf(caught),
    );
  }

  {
    // streamReplay is a TRUE generator: the first event arrives before
    // the walk finishes (R6.6 — nothing buffers).
    const r = rig((n) => (n < 20 ? ok([ev(n)]) : { status: 404 }));
    const ws = new Workspace({ session: SESSION, client: r.client });
    ws.replaysService = new ReplaysService(r.client, { fetchImpl: r.cdnFetch });
    const iterator = ws.streamReplay("r-1", {
      retention_days: 30,
      cdn_concurrency: 4,
    });
    const first = await iterator.next();
    check(
      "streamReplay yields before exhausting the walk",
      first.done === false && r.cdnLog.length <= 4,
      `${String(first.done)} ${String(r.cdnLog.length)}`,
    );
    // `return()` must close the generator cleanly (the `aclose()` twin).
    await iterator.return(undefined);
    check("streamReplay closes cleanly on early return", true);
  }

  console.log(`\n${String(checks)} checks / ${String(failures)} failures`);
  process.exitCode = failures === 0 ? 0 : 1;
}

await main();
