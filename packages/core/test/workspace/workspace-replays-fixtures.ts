// Translated Workspace replay-member tests (packet B5-S3,
// `b5-packets.md` §5): assertion-for-assertion ports of ALL
// THIRTEEN classes of
//   tests/unit/test_workspace_replays.py
//     TestListReplaysValidation        :97
//     TestListReplaysQueryCall         :148
//     TestRetentionWarning             :237
//     TestEventsForReplayValidation    :284
//     TestFetchReplay                  :317
//     TestReplaysForUser               :432
//     TestSignReplaysWiring            :465
//     TestEventsForReplaysWindow       :493
//     TestFetchReplaysResilience       :522
//     TestReplaysForUserLimit          :560
//     TestFetchReplaysBatching         :578
//     TestReplaysForUserThreadsRetention :634
//     TestCodedReplayGuardCodes        :664
//
// Translation notes:
// - `ws._replays_svc = MagicMock()` → `ws.replaysService = stub` (the
//   settable accessor mirrors Python's attribute write); the stub is a
//   recording object cast to `ReplaysService`.
// - `svc.discover.assert_called_once_with(distinct_id=…, replay_ids=…,
//   from_date=…, to_date=…, limit=…)` → an assertion on the recorded
//   options bag, whose keys are the camelCase service spellings
//   (`ReplaysService.discover` is `_internal`; only the FACADE keeps
//   Python's snake_case, R3.2).
// - `pytest.raises(ValueError, match=…)` on the WR* guards → the
//   `{class, code}` assertion (R5.4). The Python file asserts BOTH the
//   message (TestListReplaysValidation) and the code
//   (TestCodedReplayGuardCodes); the port keeps the code assertions and
//   the message-substring ones become the same code, since
//   `ParamValidationError` IS the `ValueError` subclass Python's
//   `test_wr_guards_stay_catchable_as_value_error` pins.
// - `warnings.catch_warnings(record=True)` → the injected
//   {@link WarningSink} threaded through the Workspace constructor.
// - `ws.fetch_replay = MagicMock(side_effect=…)` → a method override on
//   the instance; `call.kwargs[...]` → the recorded options bag.
// - Every member is `async` in the port (R6.1), so every call awaits.
import { expect } from "vitest";

import { ParamValidationError } from "../../src/errors.js";
import type { ReplaysService } from "../../src/services/replays.js";
import {
  type ReplayEvent,
  ReplaySummary,
  type SignedReplay,
} from "../../src/types/results/replay-models.js";
import { Workspace } from "../../src/workspace.js";
import type { WorkspaceLogger } from "../../src/workspace-members/options.js";
import {
  type CannedResponse,
  type CapturedFetchRequest,
  createMockClient,
  makeSession,
} from "../../test-support/client-test-helpers.js";

/** One recorded stub-service call. */
interface ServiceCall {
  readonly method: string;
  readonly args: readonly unknown[];
}

/** The recording stand-in for `ReplaysService` (the MagicMock twin). */
interface StubService {
  readonly calls: ServiceCall[];
  discoverResult: ReplaySummary[];
  signResult: SignedReplay[];
  fetchFilesResult: Array<Record<string, unknown>>;
  eventsForResult: Map<string, ReplayEvent[]>;
}

/**
 * Build a `Workspace` bound to a fake session (`_make_workspace`,
 * `test_workspace_replays.py`).
 *
 * @param options - Optional `warn` sink and App-API handler.
 * @returns The workspace under test.
 */
export function makeWorkspace(
  options: {
    warn?: (message: string) => void;
    logger?: WorkspaceLogger;
    handler?: (request: CapturedFetchRequest) => CannedResponse;
  } = {},
): Workspace {
  const { client } = createMockClient(
    makeSession({ projectId: "12345" }),
    options.handler ?? (() => ({ status: 200, json: [] })),
  );
  return new Workspace({
    session: client.session,
    client,
    ...(options.warn === undefined ? {} : { warn: options.warn }),
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  });
}

/**
 * Replace the workspace's lazy `ReplaysService` with a recording stub
 * (`_install_mock_replays_service`, `:47-51`).
 *
 * @param ws - The workspace to patch.
 * @returns The stub, with its call log.
 */
export function installStubService(ws: Workspace): StubService {
  const stub: StubService = {
    calls: [],
    discoverResult: [],
    signResult: [],
    fetchFilesResult: [],
    eventsForResult: new Map(),
  };
  const impl = {
    discover: (...args: unknown[]): Promise<ReplaySummary[]> => {
      stub.calls.push({ method: "discover", args });
      return Promise.resolve(stub.discoverResult);
    },
    sign: (...args: unknown[]): Promise<SignedReplay[]> => {
      stub.calls.push({ method: "sign", args });
      return Promise.resolve(stub.signResult);
    },
    fetchFiles: (
      ...args: unknown[]
    ): Promise<Array<Record<string, unknown>>> => {
      stub.calls.push({ method: "fetchFiles", args });
      return Promise.resolve(stub.fetchFilesResult);
    },
    eventsFor: (...args: unknown[]): Promise<Map<string, ReplayEvent[]>> => {
      stub.calls.push({ method: "eventsFor", args });
      return Promise.resolve(stub.eventsForResult);
    },
  };
  ws.replaysService = impl as unknown as ReplaysService;
  return stub;
}

/**
 * Pull the recorded calls for one stub method.
 *
 * @param stub - The stub service.
 * @param method - The method name.
 * @returns The matching calls.
 */
export function callsTo(
  stub: StubService,
  method: string,
): readonly ServiceCall[] {
  return stub.calls.filter((c) => c.method === method);
}

/**
 * Build a `ReplaySummary` for fixture seeding (`_summary`, `:54-64`).
 *
 * @param replayId - The replay id (default `"r-1"`).
 * @param options - `retentionDays` / `distinctId` overrides.
 * @returns The summary.
 */
export function summary(
  replayId = "r-1",
  options: { retentionDays?: number; distinctId?: string | null } = {},
): ReplaySummary {
  return new ReplaySummary({
    replay_id: replayId,
    distinct_id: options.distinctId === undefined ? "u-42" : options.distinctId,
    project_id: 12345,
    start_time: 1716810000000,
    retention_days: options.retentionDays ?? 30,
  });
}

/**
 * Assert a rejected promise carries the expected guard `{class, code}`.
 *
 * @param thunk - The call under test.
 * @param code - The expected registry code.
 */
export async function expectGuard(
  thunk: () => Promise<unknown>,
  code: string,
): Promise<void> {
  let caught: unknown;
  try {
    await thunk();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ParamValidationError);
  expect((caught as ParamValidationError).code).toBe(code);
}
