// Root of `/demo`: owns the page state (one `DemoState`), builds the
// offline workspace over the fixture transport, drives the live states
// (sign-in, project picker, session header, sign-out) and wires the
// workbench (tabs, strip, builders, result) to the code panel beside it.
// The two loop reports (ranking, matrix) keep their drafts here so a tab
// switch loses nothing, and hand a pair or a path to the single-query tabs.
// Offline and live share the same query controller; only the facade
// behind it differs, so the components never know the mode.

import "./demo.css";

import {
  computed,
  defineComponent,
  h,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  type VNode,
  watch,
} from "vue";

import {
  beginLogin,
  createBrowserWorkspace,
  createBrowserWorkspaceFromStore,
  type Workspace,
} from "@mixpanel-headless/browser";

import { DEMO_FIXTURES } from "../fixtures/demo-project.gen.js";
import {
  type AhaSpec,
  plannedBucket,
  RANK_BY_RETENTION_SOURCE,
  RANKING_COLUMNS,
  rankingRows,
  renderAhaProgram,
  seedCandidates,
} from "../model/aha.js";
import { describeError, type ErrorContext } from "../model/errors.js";
import { fixtureCoverage, fixtureFetch } from "../model/fixture-fetch.js";
import { toMarkdown } from "../model/markdown-table.js";
import {
  BEST_PATH_SOURCE,
  bestPath,
  matrixColumns,
  type MatrixPair,
  matrixRows,
  type MatrixSpec,
  PATH_STEPS,
  renderMatrixProgram,
  seedPool,
  sweepCalls,
} from "../model/matrix.js";
import {
  CONVERSION_WINDOWS,
  type ConversionWindow,
  type QuerySpec,
  type TimeRange,
  type TrendSpec,
  withWhere,
} from "../model/query-spec.js";
import { formatPct } from "../model/series.js";
import {
  type DemoError,
  type DemoState,
  type PickedProject,
  type PickedWorkspace,
  type Region,
  signOut,
} from "../model/session-state.js";
import {
  LIVE_SETUP,
  liveSetup,
  OFFLINE_SETUP,
} from "../model/setup-snippets.js";
import type { TracedCall } from "../model/trace.js";
import AhaBuilder, { type AhaDraft } from "./aha-builder.js";
import { rankOutcomes } from "./aha-result.js";
import {
  ErrorBlock,
  FooterNote,
  LiveIntro,
  OfflineBar,
  SessionBar,
} from "./banners.js";
import {
  FunnelBuilder,
  type FunnelDraft,
  RetentionBuilder,
  type RetentionDraft,
} from "./builders.js";
import CodePanel, {
  type CodeHelper,
  type CodeTrace,
  programText,
} from "./code-panel.js";
import { button } from "./el.js";
import EventStrip from "./event-list.js";
import LoadingBar from "./loading-bar.js";
import LoadingCard, { type SignInPhase } from "./loading-card.js";
import MatrixBuilder, { type MatrixDraft } from "./matrix-builder.js";
import { matrixResults, type SweepPoint } from "./matrix-result.js";
import ProjectPicker from "./project-picker.js";
import ResultActions from "./result-actions.js";
import ResultPanel from "./result-panel.js";
import {
  clearSession,
  forgetRegion,
  hopStore,
  memory,
  rememberRegion,
  session,
  wasLive,
} from "./session.js";
import EngineTabs, { type Engine, panelId, tabId } from "./tabs.js";
import TrendControls from "./trend-controls.js";
import {
  type AnySpec,
  type CallOutcome,
  type EngineRun,
  isLoopSpec,
  pairKey,
  sweepKey,
  useQuery,
} from "./use-query.js";

const DEMO_PROJECT = {
  token: "demo",
  projectId: "3141592",
  region: "us",
  workspaceId: 1,
} as const;
/** Jitter around the transport's nominal latency: visible, never flickering. */
const LATENCY_JITTER_MS = 60;
/** The recorded funnels cover two and three steps. */
const OFFLINE_MAX_STEPS = 3;
/** The header flips to its warning this long before the token expires. */
const EXPIRY_WARNING_MS = 60_000;

const RELOAD_NOTICE =
  "Your session ended with the page reload. Tokens are kept in memory only; sign in again to continue.";
const SIGNED_OUT_NOTICE =
  "Signed out. Tokens and the client registration were deleted from this tab.";
/** Closes the code panel's program while the shown engine has not run. */
const RUN_HINT = "// run a query to see the call here";
/** The ranking report's default born event, when the project has it. */
const DEFAULT_BORN = "Signup";
/** Candidates a born event needs offline for a ranking to mean anything. */
const MIN_OFFLINE_CANDIDATES = 2;
/** The matrix's default window (the fixtures hold all four). */
const DEFAULT_WINDOW: ConversionWindow = 7;

/**
 * Where a loop run is while it runs, or `null` when it is not running.
 *
 * @param run - The engine's run.
 * @returns Settled and total counts.
 */
const progressOf = (
  run: EngineRun | null,
): { done: number; total: number } | null => {
  if (run === null || !run.loading) {
    return null;
  }
  return {
    done: run.outcomes.filter(
      (outcome) => outcome.result !== null || outcome.error !== null,
    ).length,
    total: run.outcomes.length,
  };
};

/**
 * Whether a finished loop run was made under another time range than the
 * one now selected (it is never repeated unasked).
 *
 * @param run - The engine's run.
 * @param last - The selected range.
 * @returns `true` when the run's range differs.
 */
const staleOf = (run: EngineRun | null, last: TimeRange): boolean =>
  run !== null && !run.loading && run.spec.last !== last;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * The offline facade: the real library over recorded responses.
 *
 * @returns A `Workspace` whose `fetch` is the fixture transport.
 */
function createOfflineWorkspace(): Workspace {
  return createBrowserWorkspace({
    ...DEMO_PROJECT,
    fetch: fixtureFetch(DEMO_FIXTURES, {
      today: () => new Date(),
      sleep: (ms) => sleep(ms + (Math.random() - 0.5) * LATENCY_JITTER_MS),
    }),
  });
}

/**
 * Why signing in cannot work from this document, or `null` when it can:
 * Mixpanel returns the visitor to the redirect URI this build was made
 * with, so a page served from any other origin (a LAN address, another
 * port, a static preview of a Pages build) would complete the login on a
 * different site.
 *
 * @returns The note, or `null`.
 */
function hostNote(): string | null {
  const target = new URL(__DEMO_REDIRECT_URI__);
  if (target.origin === location.origin) {
    return null;
  }
  return `Live mode needs this page served from ${target.origin} (the redirect URI this build was made with); it is open on ${location.origin}, where Mixpanel cannot return you. Locally, run npm run docs:dev and open http://localhost:5173/demo/.`;
}

const workspaceOf = (state: DemoState): Workspace | null =>
  state.mode === "offline" ||
  state.mode === "ready" ||
  state.mode === "project-picker"
    ? state.ws
    : null;

const describeSpec = (spec: QuerySpec): string => {
  switch (spec.kind) {
    case "trend": {
      return spec.event;
    }
    case "funnel": {
      return spec.steps.join(" → ");
    }
    case "retention": {
      return `${spec.born} → ${spec.returnEvent}`;
    }
  }
};

/** The playground page. */
export default defineComponent({
  name: "DemoPlayground",
  setup() {
    const offlineWs = createOfflineWorkspace();
    const coverage = fixtureCoverage(DEMO_FIXTURES);
    const state = shallowRef<DemoState>({ mode: "offline", ws: offlineWs });
    const region = ref<Region>(session.region ?? "us");
    const last = ref<TimeRange>(30);
    // The loop reports' drafts once the visitor has edited them (`null`
    // seeds from the top events), the pair a ranking row hands to the
    // Retention tab, the path the matrix hands to the Funnel tab, and the
    // matrix cell open in its side panel.
    const ahaDraft = shallowRef<AhaDraft | null>(null);
    const matrixDraft = shallowRef<MatrixDraft | null>(null);
    const retentionPreset = shallowRef<RetentionDraft | null>(null);
    const funnelPreset = shallowRef<FunnelDraft | null>(null);
    const selectedPair = shallowRef<MatrixPair | null>(null);
    const linkPending = ref(false);
    const busy = ref(false);
    // Which step of the sign-in the loading card names while the state is
    // `callback`; set before each await rather than inferred afterwards.
    const signInPhase = ref<SignInPhase>("sign-in");
    const expiring = ref(false);
    let expiryTimer: ReturnType<typeof setTimeout> | null = null;

    const errorContext = (): ErrorContext =>
      session.expiresAt === null
        ? { redirectUri: __DEMO_REDIRECT_URI__ }
        : { redirectUri: __DEMO_REDIRECT_URI__, expiresAt: session.expiresAt };
    const query = useQuery(() => {
      const ws = workspaceOf(state.value);
      if (ws === null) {
        throw new Error("playground: no workspace in this state");
      }
      return ws;
    }, errorContext);
    const { engine } = query;
    const offline = computed(() => state.value.mode === "offline");
    // The trend tab's own spec: the strip's selection and the seed the
    // other builders start from, whichever tab is open.
    const trendSpec = computed(() => {
      const current = query.runs.value.trend?.spec;
      return current?.kind === "trend" ? current : null;
    });
    const selectedEvent = computed(() => trendSpec.value?.event ?? null);
    const eventNames = computed(
      () => query.allEvents.value ?? query.topEvents.value.map((e) => e.event),
    );
    const setup = computed(() => {
      const current = state.value;
      switch (current.mode) {
        case "offline": {
          return OFFLINE_SETUP;
        }
        case "ready": {
          return liveSetup({
            region: current.region,
            project: current.project.id,
            workspace: current.workspace?.id ?? null,
          });
        }
        default: {
          return LIVE_SETUP;
        }
      }
    });

    const run = (spec: AnySpec): void => void query.run(spec);
    const resetQuery = (): void => {
      query.reset();
      ahaDraft.value = null;
      matrixDraft.value = null;
      retentionPreset.value = null;
      funnelPreset.value = null;
      selectedPair.value = null;
    };
    // Selecting an event keeps its math, range and filter when it is
    // already shown (a new event starts unfiltered); `groupBy` `null` clears
    // the breakdown, `undefined` leaves it alone.
    const trend = (event: string, groupBy?: string | null): void => {
      const current = trendSpec.value;
      const base: TrendSpec =
        current !== null && current.event === event
          ? current
          : { kind: "trend", event, math: "total", last: last.value };
      const next: TrendSpec = withWhere(
        { kind: "trend", event, math: base.math, last: base.last },
        base.where ?? null,
      );
      const chosen = groupBy === undefined ? base.groupBy : groupBy;
      run(
        chosen === null || chosen === undefined
          ? next
          : { ...next, groupBy: chosen },
      );
    };
    // A loop is never repeated on the visitor's behalf: it costs one query
    // per candidate or pair, so its button says so and only it runs it.
    const rerun = (patch: Partial<QuerySpec>): void => {
      const current = query.spec.value;
      if (current !== null && !isLoopSpec(current)) {
        run({ ...current, ...patch } as QuerySpec);
      }
    };
    // Each engine keeps its last result across tab switches; only a run
    // made under an older time range is repeated, so the result always
    // matches the range control.
    const selectEngine = (next: Engine): void => {
      engine.value = next;
      const shown = query.runs.value[next]?.spec;
      if (
        shown !== undefined &&
        !isLoopSpec(shown) &&
        shown.last !== last.value
      ) {
        run({ ...shown, last: last.value });
      }
    };

    // --- ranking report ---
    const topNames = computed(() => query.topEvents.value.map((e) => e.event));
    // Offline, only pairs the fixtures answer; live, any event.
    const allowedFor = (born: string): readonly string[] | null =>
      offline.value ? (coverage.retentionPairs[born] ?? []) : null;
    const bornEvents = computed(() =>
      offline.value
        ? Object.keys(coverage.retentionPairs).filter(
            (born) =>
              (coverage.retentionPairs[born]?.length ?? 0) >=
              MIN_OFFLINE_CANDIDATES,
          )
        : eventNames.value,
    );
    const ahaDraftShown = computed((): AhaDraft => {
      if (ahaDraft.value !== null) {
        return ahaDraft.value;
      }
      const born = bornEvents.value.includes(DEFAULT_BORN)
        ? DEFAULT_BORN
        : (bornEvents.value[0] ?? "");
      return {
        born,
        candidates: seedCandidates(topNames.value, born, allowedFor(born)),
        retentionUnit: "week",
      };
    });
    // A new born event reseeds the candidates (the old ones may include it).
    const updateAhaDraft = (next: AhaDraft): void => {
      ahaDraft.value =
        next.born === ahaDraftShown.value.born
          ? next
          : {
              ...next,
              candidates: seedCandidates(
                topNames.value,
                next.born,
                allowedFor(next.born),
              ),
            };
    };
    const ahaAddable = computed(() => {
      const draft = ahaDraftShown.value;
      const pool = offline.value
        ? (allowedFor(draft.born) ?? [])
        : (query.allEvents.value ?? topNames.value);
      return pool.filter(
        (event) => event !== draft.born && !draft.candidates.includes(event),
      );
    });
    const ahaSpec = computed((): AhaSpec => ({
      kind: "aha",
      ...ahaDraftShown.value,
      last: last.value,
    }));
    const ahaBlocked = computed(() => {
      const spec = ahaSpec.value;
      if (plannedBucket(spec) >= 1) {
        return null;
      }
      return `The last ${String(spec.last)} days hold a single ${spec.retentionUnit}, so there is no ${spec.retentionUnit} 1 to rank by. Pick a longer range or daily buckets.`;
    });
    const ahaRun = computed(() => query.runs.value.aha ?? null);
    const ahaProgress = computed(() => progressOf(ahaRun.value));
    const ahaStale = computed(() => staleOf(ahaRun.value, last.value));
    const ahaProgram = computed(() => {
      const spec = ahaRun.value?.spec;
      return spec?.kind === "aha" ? renderAhaProgram(spec) : null;
    });
    // A ranking row opens its pair in the Retention tab and runs it: the
    // row already names a complete query, so a second click would only be
    // ceremony.
    const openRetention = (event: string): void => {
      const spec = ahaRun.value?.spec;
      if (spec?.kind !== "aha") {
        return;
      }
      retentionPreset.value = {
        born: spec.born,
        returnEvent: event,
        retentionUnit: spec.retentionUnit,
      };
      selectEngine("retention");
      run({
        kind: "retention",
        born: spec.born,
        returnEvent: event,
        retentionUnit: spec.retentionUnit,
        last: last.value,
      });
    };

    // --- conversion matrix ---
    // Offline, only the events the fixtures record funnels for; live, any.
    const poolAllowed = computed(() =>
      offline.value ? coverage.funnelEvents : null,
    );
    const matrixDraftShown = computed(
      (): MatrixDraft =>
        matrixDraft.value ?? {
          events: seedPool(topNames.value, poolAllowed.value),
          conversionWindow: DEFAULT_WINDOW,
        },
    );
    const matrixAddable = computed(() => {
      const pool = poolAllowed.value ?? query.allEvents.value ?? topNames.value;
      return pool.filter(
        (event) => !matrixDraftShown.value.events.includes(event),
      );
    });
    const matrixSpec = computed((): MatrixSpec => ({
      kind: "matrix",
      ...matrixDraftShown.value,
      last: last.value,
    }));
    const matrixRun = computed(() => query.runs.value.matrix ?? null);
    const matrixRunSpec = computed((): MatrixSpec | null => {
      const spec = matrixRun.value?.spec;
      return spec?.kind === "matrix" ? spec : null;
    });
    const matrixProgress = computed(() => progressOf(matrixRun.value));
    const matrixStale = computed(() => staleOf(matrixRun.value, last.value));
    // The selected pair at each window: the matrix's own cell at its
    // window, the sweep cache elsewhere, `null` where nothing has run.
    const sweepPoints = computed((): SweepPoint[] => {
      const pair = selectedPair.value;
      const spec = matrixRunSpec.value;
      const current = matrixRun.value;
      if (pair === null || spec === null || current === null) {
        return [];
      }
      const own =
        current.outcomes.find(
          (outcome) =>
            JSON.stringify(outcome.call.args[0]) === JSON.stringify(pair),
        ) ?? null;
      return CONVERSION_WINDOWS.map((window) => {
        const cached: CallOutcome | null =
          query.sweeps.value[sweepKey(pair, window, spec.last)] ?? null;
        const fromRun =
          window === spec.conversionWindow && own?.result != null ? own : null;
        return { window, outcome: fromRun ?? cached };
      });
    });
    // Unfetched and failed windows alike: a failed one is offered again.
    const sweepMissing = computed(() =>
      sweepPoints.value
        .filter((point) => point.outcome?.result == null)
        .map((point) => point.window),
    );
    // The sweep calls that have run for the selected pair, in window
    // order — printed under the loop as plain statements.
    const sweepShown = computed(() => {
      const pair = selectedPair.value;
      const spec = matrixRunSpec.value;
      if (pair === null || spec === null) {
        return [];
      }
      const fetched = sweepPoints.value
        .filter(
          (point) =>
            point.window !== spec.conversionWindow &&
            point.outcome?.result != null,
        )
        .map((point) => point.window);
      return sweepCalls(pair, fetched, spec.last);
    });
    const matrixProgram = computed(() => {
      const spec = matrixRunSpec.value;
      return spec === null ? null : renderMatrixProgram(spec, sweepShown.value);
    });
    const matrixSweeping = computed(
      () =>
        selectedPair.value !== null &&
        query.sweeping.value === pairKey(selectedPair.value),
    );
    const runMatrix = (): void => {
      selectedPair.value = null;
      run(matrixSpec.value);
    };
    const runSweep = (): void => {
      const pair = selectedPair.value;
      if (pair !== null && sweepMissing.value.length > 0) {
        void query.sweep(pair, sweepMissing.value);
      }
    };
    // The matrix's best path (or one cell's pair) opens in the Funnel tab
    // and runs: the steps and window already name a complete query.
    const openFunnel = (
      steps: readonly string[],
      conversionWindow: ConversionWindow,
    ): void => {
      funnelPreset.value = { steps, conversionWindow };
      selectEngine("funnel");
      run({ kind: "funnel", steps, last: last.value, conversionWindow });
    };
    const start = async (): Promise<void> => {
      await query.loadTopEvents();
      const first = query.topEvents.value[0];
      if (first !== undefined && trendSpec.value === null) {
        trend(first.event);
      }
    };

    const clearExpiry = (): void => {
      if (expiryTimer !== null) {
        clearTimeout(expiryTimer);
        expiryTimer = null;
      }
      expiring.value = false;
    };
    const armExpiry = (expiresAt: string): void => {
      clearExpiry();
      const delay = Date.parse(expiresAt) - EXPIRY_WARNING_MS - Date.now();
      if (delay <= 0) {
        expiring.value = true;
      } else {
        expiryTimer = setTimeout(() => {
          expiring.value = true;
        }, delay);
      }
    };
    onBeforeUnmount(clearExpiry);

    /**
     * Leave the live session: every credential key out of both stores,
     * the facade and `/me` dropped, the query columns emptied.
     *
     * @param from - The region whose keys go first.
     */
    const wipe = async (from: Region): Promise<void> => {
      clearExpiry();
      resetQuery();
      clearSession();
      forgetRegion();
      await signOut(memory, hopStore(), from);
    };
    const liveRegion = (): Region => {
      const current = state.value;
      return "region" in current && current.region !== null
        ? current.region
        : region.value;
    };
    const toError = async (error: DemoError): Promise<void> => {
      const from = liveRegion();
      await wipe(from);
      state.value = {
        mode: "error",
        region: from,
        error,
        retry: error.retry ?? "signed-out",
      };
    };
    const fail = (error: unknown): Promise<void> =>
      toError(describeError(error, errorContext()));
    // A fatal query error (401, expiry) ends the session; inline errors
    // stay in the result panel.
    watch(query.error, (error) => {
      if (error?.fatal === true && !offline.value) {
        void toError(error);
      }
    });

    const goLive = (): void => {
      state.value = { mode: "signed-out", region: region.value, notice: null };
    };
    const backToDemo = async (): Promise<void> => {
      await wipe(liveRegion());
      state.value = { mode: "offline", ws: offlineWs };
      await start();
    };
    const doSignOut = async (): Promise<void> => {
      await wipe(liveRegion());
      state.value = {
        mode: "signed-out",
        region: region.value,
        notice: SIGNED_OUT_NOTICE,
      };
    };
    const signIn = async (): Promise<void> => {
      const chosen = region.value;
      busy.value = true;
      try {
        rememberRegion(chosen);
        state.value = {
          mode: "login-pending",
          region: chosen,
          authorizeUrl: null,
        };
        const { authorizeUrl } = await beginLogin({
          region: chosen,
          redirectUri: __DEMO_REDIRECT_URI__,
          store: hopStore(),
        });
        state.value = { mode: "login-pending", region: chosen, authorizeUrl };
        location.assign(authorizeUrl);
      } catch (error) {
        await fail(error);
      } finally {
        busy.value = false;
      }
    };
    const enterPicker = async (from: Region): Promise<void> => {
      const expiresAt = session.expiresAt;
      if (expiresAt === null) {
        await wipe(from);
        goLive();
        return;
      }
      signInPhase.value = "sign-in";
      state.value = { mode: "callback" };
      try {
        const ws =
          session.ws ??
          (await createBrowserWorkspaceFromStore({
            region: from,
            projectId: "0",
            store: memory,
          }));
        signInPhase.value = "projects";
        const me = session.me ?? (await ws.me());
        session.ws = ws;
        session.me = me;
        state.value = {
          mode: "project-picker",
          region: from,
          ws,
          me,
          expiresAt,
        };
      } catch (error) {
        await fail(error);
      }
    };
    const pick = async (
      project: PickedProject,
      workspace: PickedWorkspace | null,
    ): Promise<void> => {
      const current = state.value;
      if (current.mode !== "project-picker") {
        return;
      }
      busy.value = true;
      try {
        await current.ws.use({
          project: project.id,
          workspace: workspace?.id ?? null,
        });
        resetQuery();
        state.value = {
          mode: "ready",
          region: current.region,
          ws: current.ws,
          project,
          workspace,
          user: current.me.user_email,
          expiresAt: current.expiresAt,
        };
        armExpiry(current.expiresAt);
        await start();
      } catch (error) {
        await fail(error);
      } finally {
        busy.value = false;
      }
    };
    const switchProject = (): void => {
      const current = state.value;
      if (current.mode === "ready" && session.me !== null) {
        clearExpiry();
        resetQuery();
        state.value = {
          mode: "project-picker",
          region: current.region,
          ws: current.ws,
          me: session.me,
          expiresAt: current.expiresAt,
        };
      }
    };

    onMounted(() => {
      const resume = session.resume;
      session.resume = null;
      if (session.region !== null) {
        void enterPicker(session.region);
        return;
      }
      // A fresh document after a live session: the in-memory tokens are
      // gone with it, so say why the demo project is not what shows.
      const reloaded = wasLive();
      if (reloaded || resume === "signed-out") {
        void wipe(region.value);
        state.value = {
          mode: "signed-out",
          region: region.value,
          notice: reloaded ? RELOAD_NOTICE : null,
        };
        return;
      }
      void start();
    });

    const buildLink = async (open: boolean): Promise<void> => {
      const spec = query.spec.value;
      if (spec === null || isLoopSpec(spec)) {
        return;
      }
      linkPending.value = true;
      const link = await query.createLink(
        `Playground: ${describeSpec(spec)}, last ${spec.last} days`,
      );
      linkPending.value = false;
      if (open && link !== null) {
        window.open(link.url, "_blank", "noopener");
      }
    };
    const copyMarkdown = async (): Promise<void> => {
      const spec = query.spec.value;
      if (spec?.kind === "matrix") {
        // The copied program is complete: the loop, any sweep, the helper;
        // the best path follows the table since a table cannot hold it.
        const program = `${programText(setup.value, [], renderMatrixProgram(spec, sweepShown.value))}\n${BEST_PATH_SOURCE}`;
        const results = matrixResults(spec, query.outcomes.value);
        const path = bestPath(spec.events, results, { steps: PATH_STEPS });
        const table = toMarkdown({
          code: program,
          columns: matrixColumns(spec.events),
          rows: matrixRows(spec.events, results),
        });
        const best =
          path.events.length < 2
            ? ""
            : `\nBest path: ${path.events.join(" → ")} · ≈ ${formatPct(path.estimate)} overall (the product of the pairwise rates)\n`;
        await navigator.clipboard.writeText(`${table}${best}`);
        return;
      }
      if (spec?.kind === "aha") {
        // The copied program is complete: the loop plus the helper it ends with.
        const program = `${programText(setup.value, [], renderAhaProgram(spec))}\n${RANK_BY_RETENTION_SOURCE}`;
        await navigator.clipboard.writeText(
          toMarkdown({
            code: program,
            columns: RANKING_COLUMNS,
            rows: rankingRows(rankOutcomes(spec, query.outcomes.value)),
          }),
        );
        return;
      }
      const result = query.result.value;
      const call = query.specCall.value;
      if (result === null || call === null) {
        return;
      }
      const code = programText(setup.value, [call]);
      await navigator.clipboard.writeText(
        toMarkdown({
          code,
          columns: result.rowColumns(),
          rows: result.toRows(),
        }),
      );
    };

    const trendTab = (): VNode[] => {
      const spec = trendSpec.value;
      return [
        h(EventStrip, {
          events: query.topEvents.value.map((e) => ({
            event: e.event,
            count: e.count,
            percentChange: e.percent_change,
          })),
          selected: selectedEvent.value,
          loading: query.topLoading.value,
          names: query.allEvents.value,
          complete: offline.value,
          onSelect: (event: string) => trend(event),
          onMoreEvents: () => void query.loadAllEvents(),
        }),
        spec === null
          ? null
          : h(TrendControls, {
              spec,
              properties: query.properties.value,
              values: query.values.value,
              onMath: (math) => rerun({ math }),
              onBreakdownOpen: () => void query.openBreakdown(),
              onGroupBy: (property) => trend(spec.event, property),
              onValues: (property) => void query.showValues(property),
              onWhere: (where) => run(withWhere(spec, where)),
            }),
      ].filter((node): node is VNode => node !== null);
    };

    const funnelTab = (): VNode =>
      h(FunnelBuilder, {
        events: offline.value ? coverage.funnelEvents : eventNames.value,
        seed: selectedEvent.value,
        preset: funnelPreset.value,
        ...(offline.value ? { maxSteps: OFFLINE_MAX_STEPS } : {}),
        complete: offline.value || query.allEvents.value !== null,
        onRun: ({ steps, conversionWindow }) =>
          run({ kind: "funnel", steps, last: last.value, conversionWindow }),
        onMoreEvents: () => void query.loadAllEvents(),
      });

    const retentionTab = (): VNode =>
      h(RetentionBuilder, {
        events: eventNames.value,
        pairs: offline.value ? coverage.retentionPairs : null,
        seed: selectedEvent.value,
        preset: retentionPreset.value,
        onRun: ({ born, returnEvent, retentionUnit }) =>
          run({
            kind: "retention",
            born,
            returnEvent,
            retentionUnit,
            last: last.value,
          }),
      });

    const ahaTab = (): VNode =>
      h(AhaBuilder, {
        draft: ahaDraftShown.value,
        bornEvents: bornEvents.value,
        addable: ahaAddable.value,
        complete: offline.value || query.allEvents.value !== null,
        running: ahaProgress.value,
        blocked: ahaBlocked.value,
        stale: ahaStale.value,
        onUpdate: updateAhaDraft,
        onRun: () => run(ahaSpec.value),
        onMoreEvents: () => void query.loadAllEvents(),
      });

    const matrixTab = (): VNode =>
      h(MatrixBuilder, {
        draft: matrixDraftShown.value,
        addable: matrixAddable.value,
        complete: offline.value || query.allEvents.value !== null,
        running: matrixProgress.value,
        stale: matrixStale.value,
        onUpdate: (next: MatrixDraft) => {
          matrixDraft.value = next;
        },
        onRun: runMatrix,
        onMoreEvents: () => void query.loadAllEvents(),
      });

    const tabPanel = (): VNode => {
      const current = engine.value;
      const tabs: Readonly<Record<Engine, () => VNode[]>> = {
        trend: trendTab,
        funnel: () => [funnelTab()],
        retention: () => [retentionTab()],
        aha: () => [ahaTab()],
        matrix: () => [matrixTab()],
      };
      const content = tabs[current]();
      return h(
        "div",
        {
          key: current,
          class: `mp-tabpanel mp-tabpanel-${current}`,
          role: "tabpanel",
          id: panelId(current),
          "aria-labelledby": tabId(current),
        },
        content,
      );
    };

    const workbench = (): VNode =>
      h("section", { class: "mp-col mp-col-work" }, [
        h(EngineTabs, {
          engine: engine.value,
          last: last.value,
          onSelect: selectEngine,
          onRange: (n: TimeRange) => {
            last.value = n;
            rerun({ last: n });
          },
        }),
        tabPanel(),
        h(
          ResultPanel,
          {
            engine: engine.value,
            spec: query.spec.value,
            result: query.result.value,
            outcomes: query.outcomes.value,
            loading: query.loading.value,
            error: query.error.value,
            blocked: engine.value === "aha" ? ahaBlocked.value : null,
            selectedPair: selectedPair.value,
            sweep: sweepPoints.value,
            sweeping: matrixSweeping.value,
            current: query.current.value,
            onOpenRetention: openRetention,
            onSelectPair: (pair: MatrixPair | null) => {
              selectedPair.value = pair;
            },
            onSweep: runSweep,
            onOpenFunnel: openFunnel,
          },
          {
            actions: () =>
              h(ResultActions, {
                offline: offline.value,
                linkable: engine.value !== "aha" && engine.value !== "matrix",
                linkUrl: query.link.value?.url ?? null,
                linkPending: linkPending.value,
                onLink: () => void buildLink(false),
                onOpen: () => void buildLink(true),
                onCopyMarkdown: () => void copyMarkdown(),
              }),
          },
        ),
      ]);

    // The loop reports print their program and the helper it ends with.
    const loopCode = computed(
      (): { program: string; helper: CodeHelper } | null => {
        if (engine.value === "aha" && ahaProgram.value !== null) {
          return {
            program: ahaProgram.value,
            helper: {
              summary: "Show rankByRetention",
              source: RANK_BY_RETENTION_SOURCE,
            },
          };
        }
        if (engine.value === "matrix" && matrixProgram.value !== null) {
          return {
            program: matrixProgram.value,
            helper: { summary: "Show bestPath", source: BEST_PATH_SOURCE },
          };
        }
        return null;
      },
    );
    // The shown loop's trace: what each call took and which is in flight,
    // from the run itself; the panel turns it into the comment lines.
    const loopTrace = computed((): CodeTrace | null => {
      const shown = query.runs.value[engine.value];
      if (
        shown === undefined ||
        !isLoopSpec(shown.spec) ||
        loopCode.value === null
      ) {
        return null;
      }
      const traced: TracedCall[] = shown.outcomes.map((outcome) => ({
        call: outcome.call,
        durationMs: outcome.durationMs,
        failed: outcome.error !== null,
      }));
      return {
        calls: traced,
        current: shown.current,
        startedAt: shown.startedAt,
      };
    });
    const codeColumn = (): VNode =>
      h("aside", { class: "mp-col mp-col-code" }, [
        h(CodePanel, {
          setup: setup.value,
          calls: query.calls.value,
          columns: query.result.value?.rowColumns() ?? null,
          resultBinding: query.specCall.value?.binding ?? null,
          placeholder: query.spec.value === null ? RUN_HINT : null,
          program: loopCode.value?.program ?? null,
          helper: loopCode.value?.helper ?? null,
          trace: loopTrace.value,
        }),
      ]);

    const grid = (): VNode =>
      h("div", { class: "mp-grid" }, [workbench(), codeColumn()]);

    const body = (): VNode | VNode[] => {
      const current = state.value;
      switch (current.mode) {
        case "offline": {
          return [
            h(OfflineBar, {
              liveEnabled: __DEMO_LIVE_ENABLED__,
              onLive: goLive,
            }),
            grid(),
          ];
        }
        case "signed-out": {
          return h(LiveIntro, {
            region: region.value,
            notice: current.notice,
            hostNote: hostNote(),
            busy: busy.value,
            onRegion: (r: Region) => {
              region.value = r;
              state.value = { ...current, region: r };
            },
            onSignIn: () => void signIn(),
            onBack: () => void backToDemo(),
          });
        }
        case "login-pending": {
          return h(
            "section",
            { class: "mp-intro mp-pending", "aria-busy": "true" },
            [
              h(LoadingBar, { active: true, label: null }),
              h(
                "p",
                { class: "mp-loading-title", role: "status" },
                "Redirecting to Mixpanel…",
              ),
              h("p", { class: "mp-muted" }, [
                "If nothing happens, ",
                current.authorizeUrl === null
                  ? "retry from the start."
                  : h(
                      "a",
                      { href: current.authorizeUrl },
                      "open the sign-in page",
                    ),
              ]),
            ],
          );
        }
        case "callback": {
          return h(LoadingCard, { phase: signInPhase.value });
        }
        case "project-picker": {
          return h(ProjectPicker, {
            me: current.me,
            busy: busy.value,
            onPick: (
              project: PickedProject,
              workspace: PickedWorkspace | null,
            ) => void pick(project, workspace),
            onSignOut: () => void doSignOut(),
            onBack: () => void backToDemo(),
          });
        }
        case "ready": {
          return [
            h(SessionBar, {
              region: current.region,
              user: current.user,
              project: current.project,
              workspace: current.workspace,
              expiresAt: current.expiresAt,
              expiring: expiring.value,
              onSwitchProject: switchProject,
              onSignOut: () => void doSignOut(),
            }),
            grid(),
          ];
        }
        case "error": {
          return h("div", { class: "mp-intro" }, [
            h(ErrorBlock, { error: current.error }),
            h("div", { class: "mp-intro-actions" }, [
              current.retry === "offline"
                ? null
                : button("Try again", goLive, { class: "mp-btn mp-btn-brand" }),
              button("Back to demo", () => void backToDemo()),
            ]),
          ]);
        }
      }
    };

    return () => h("div", { class: "mp-demo" }, [body(), h(FooterNote)]);
  },
});
