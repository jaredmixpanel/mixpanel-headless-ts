// Reactive sequencing for the query panel: one run per engine (the spec,
// the `Call`s built from it — rendered and executed from the same objects
// — and what each produced), the engine whose run is on screen, and the
// discovery calls around them. A run is a list of call outcomes: one for
// the single-query engines, one per candidate or pair for the two loop
// reports, which settle them in order. The conversion matrix also keeps a
// cache of per-window sweeps, so a cell opened twice costs nothing the
// second time. Domain logic stays in model/; this composable only orders
// those calls and keeps stale responses from overwriting newer ones. Each
// outcome carries the call's wall time and a loop run names the call in
// flight, which is all the code panel's trace and the result's
// constellation need. Results are class instances, hence `shallowRef`.

import {
  computed,
  type ComputedRef,
  type Ref,
  ref,
  type ShallowRef,
  shallowRef,
} from "vue";

import type { Workspace } from "@mixpanel-headless/browser";

import { ahaCalls, type AhaSpec } from "../model/aha.js";
import { type Call, runCall } from "../model/call.js";
import { describeError, type ErrorContext } from "../model/errors.js";
import {
  matrixCalls,
  type MatrixPair,
  type MatrixSpec,
  sweepCalls,
} from "../model/matrix.js";
import {
  type ConversionWindow,
  eventsCall,
  propertiesCall,
  propertyValuesCall,
  type QuerySpec,
  reportLinkCall,
  toCall,
  topEventsCall,
  type TrendSpec,
} from "../model/query-spec.js";
import type { DemoError } from "../model/session-state.js";

/** `ws.query()`'s result type, via the facade. */
export type QueryResult = Awaited<ReturnType<Workspace["query"]>>;
/** `ws.queryFunnel()`'s result type. */
export type FunnelQueryResult = Awaited<ReturnType<Workspace["queryFunnel"]>>;
/** `ws.queryRetention()`'s result type. */
export type RetentionQueryResult = Awaited<
  ReturnType<Workspace["queryRetention"]>
>;
/** One `ws.topEvents()` row. */
export type TopEvent = Awaited<ReturnType<Workspace["topEvents"]>>[number];
/** `ws.createReportLink()`'s result type. */
export type ReportLink = Awaited<ReturnType<Workspace["createReportLink"]>>;
/** Anything the result panel can hold. */
export type AnyResult = QueryResult | FunnelQueryResult | RetentionQueryResult;
/** The reports that run a loop of calls rather than one query. */
export type LoopSpec = AhaSpec | MatrixSpec;
/** Every spec an engine runs: the single-call ones plus the loops. */
export type AnySpec = QuerySpec | LoopSpec;
/** The engines, one run kept per kind. */
export type EngineKind = AnySpec["kind"];

/** Property values loaded for a segment chip. */
export interface PropertyValues {
  readonly property: string;
  readonly values: readonly string[];
}

/** One call of a run and what it produced. */
export interface CallOutcome {
  readonly call: Call;
  /** `null` while the call is pending, or after it failed. */
  readonly result: AnyResult | null;
  readonly error: DemoError | null;
  /** Wall time of the call in milliseconds; `null` while it is pending. */
  readonly durationMs: number | null;
}

/**
 * One engine's latest run. The spec, the calls and their outcomes are
 * written together, so what the panel draws always came from the calls it
 * shows.
 */
export interface EngineRun {
  /** Identifies the run: an older run's late response cannot amend a newer one. */
  readonly ticket: number;
  readonly spec: AnySpec;
  /** In call order: one for a query, one per candidate or pair for a loop. */
  readonly outcomes: readonly CallOutcome[];
  /** Index into `outcomes` of the loop call in flight; `null` otherwise. */
  readonly current: number | null;
  /** `performance.now()` when the call in flight began; `null` otherwise. */
  readonly startedAt: number | null;
  readonly loading: boolean;
  /** The error that ended the run (a query's own, or the one that stopped the loop). */
  readonly error: DemoError | null;
  readonly link: ReportLink | null;
  readonly linkCall: Call | null;
}

type Runs = Readonly<Partial<Record<EngineKind, EngineRun>>>;

/** The matrix's sweep cache: {@link sweepKey} → the settled call. */
type Sweeps = Readonly<Record<string, CallOutcome>>;

/** What the playground reads and drives. */
export interface QueryController {
  /** The engine whose run the panel shows (the selected tab). */
  readonly engine: Ref<EngineKind>;
  /** The latest run of each engine that has run. */
  readonly runs: ShallowRef<Runs>;
  /** The shown engine's spec, or `null` before its first run. */
  readonly spec: ComputedRef<AnySpec | null>;
  /** The shown single-query engine's result (`null` for a loop). */
  readonly result: ComputedRef<AnyResult | null>;
  /** The shown run's outcomes, call by call. */
  readonly outcomes: ComputedRef<readonly CallOutcome[]>;
  /** Index of the shown loop's call in flight, or `null`. */
  readonly current: ComputedRef<number | null>;
  readonly loading: ComputedRef<boolean>;
  /** The shown run's error, else the latest discovery error. */
  readonly error: ComputedRef<DemoError | null>;
  readonly topEvents: ShallowRef<readonly TopEvent[]>;
  readonly topLoading: Ref<boolean>;
  readonly allEvents: ShallowRef<readonly string[] | null>;
  readonly properties: ShallowRef<readonly string[] | null>;
  readonly values: ShallowRef<PropertyValues | null>;
  readonly link: ComputedRef<ReportLink | null>;
  /**
   * Every call behind what is on screen, in the order it was made — the
   * loops' calls excepted, which the panel prints as the loop.
   */
  readonly calls: ComputedRef<readonly Call[]>;
  /** The call that produced `result`. */
  readonly specCall: ComputedRef<Call | null>;
  /** The matrix's per-window sweeps, keyed by {@link sweepKey}. */
  readonly sweeps: ShallowRef<Sweeps>;
  /** The pair whose sweep is in flight, as {@link pairKey}, or `null`. */
  readonly sweeping: Ref<string | null>;
  loadTopEvents: () => Promise<void>;
  run: (spec: AnySpec) => Promise<void>;
  /** Run the matrix's pair at these windows, under the matrix run's range. */
  sweep: (
    pair: MatrixPair,
    windows: readonly ConversionWindow[],
  ) => Promise<void>;
  openBreakdown: () => Promise<void>;
  showValues: (property: string) => Promise<void>;
  loadAllEvents: () => Promise<void>;
  createLink: (name: string) => Promise<ReportLink | null>;
  reset: () => void;
}

/**
 * Whether a spec runs a loop of calls (the ranking report, the matrix).
 *
 * @param spec - Any spec.
 * @returns `true` for the loop reports.
 */
export function isLoopSpec(spec: AnySpec): spec is LoopSpec {
  return spec.kind === "aha" || spec.kind === "matrix";
}

/**
 * The cache key of one pair (a sweep in flight is named by it).
 *
 * @param pair - The pair.
 * @returns `from>to`.
 */
export function pairKey(pair: MatrixPair): string {
  return pair.join(">");
}

/**
 * The sweep cache key of one pair at one window under one range.
 *
 * @param pair - The pair.
 * @param window - Conversion window (days).
 * @param last - Time range (days).
 * @returns `last|window|from>to`.
 */
export function sweepKey(
  pair: MatrixPair,
  window: number,
  last: number,
): string {
  return `${String(last)}|${String(window)}|${pairKey(pair)}`;
}

/**
 * The calls a loop spec runs, in order.
 *
 * @param spec - The report.
 * @returns Its calls.
 */
function loopCalls(spec: LoopSpec): Call[] {
  return spec.kind === "aha" ? ahaCalls(spec) : matrixCalls(spec);
}

/**
 * Create the controller for one workspace getter (offline or live; the
 * panel never cares which).
 *
 * @param ws - Returns the current facade.
 * @param context - What the error copy quotes (the live session's expiry).
 * @returns The controller.
 */
export function useQuery(
  ws: () => Workspace,
  context: () => ErrorContext = () => ({}),
): QueryController {
  const engine = ref<EngineKind>("trend");
  const runs = shallowRef<Runs>({});
  const sweeps = shallowRef<Sweeps>({});
  const sweeping = ref<string | null>(null);
  const discoveryError = shallowRef<DemoError | null>(null);
  const topEvents = shallowRef<readonly TopEvent[]>([]);
  const topLoading = ref(false);
  const allEvents = shallowRef<readonly string[] | null>(null);
  const properties = shallowRef<readonly string[] | null>(null);
  const values = shallowRef<PropertyValues | null>(null);
  const topCall = shallowRef<Call | null>(null);
  const namesCall = shallowRef<Call | null>(null);
  const propsCall = shallowRef<Call | null>(null);
  const valuesCall = shallowRef<Call | null>(null);
  let sequence = 0;

  const active = computed(() => runs.value[engine.value] ?? null);
  const spec = computed(() => active.value?.spec ?? null);
  const single = computed(() =>
    active.value === null || isLoopSpec(active.value.spec)
      ? null
      : (active.value.outcomes[0] ?? null),
  );
  const result = computed(() => single.value?.result ?? null);
  const outcomes = computed(() => active.value?.outcomes ?? []);
  const inFlight = computed(() => active.value?.current ?? null);
  const loading = computed(() => active.value?.loading ?? false);
  const error = computed(() => active.value?.error ?? discoveryError.value);
  const link = computed(() => active.value?.link ?? null);
  const specCall = computed(() => single.value?.call ?? null);
  const trendSpec = (): TrendSpec | null => {
    const current = runs.value.trend?.spec;
    return current?.kind === "trend" ? current : null;
  };

  // The breakdown properties and value chips belong to the trend tab, so
  // they leave the panel's code with it.
  const calls = computed(() => {
    const run = active.value;
    const discovery =
      engine.value === "trend"
        ? [topCall.value, namesCall.value, propsCall.value, valuesCall.value]
        : [topCall.value, namesCall.value];
    return [
      ...discovery,
      single.value?.call ?? null,
      run?.linkCall ?? null,
    ].filter((call): call is Call => call !== null);
  });

  const store = (kind: EngineKind, run: EngineRun): void => {
    runs.value = { ...runs.value, [kind]: run };
  };
  // Amend a run only while it is still the engine's latest; a run that has
  // been replaced (or cleared by `reset`) takes nothing more.
  const patch = (
    kind: EngineKind,
    ticket: number,
    changes: Partial<EngineRun>,
  ): boolean => {
    const current = runs.value[kind];
    if (current?.ticket !== ticket) {
      return false;
    }
    store(kind, { ...current, ...changes });
    return true;
  };
  // Timed around the call itself, so the trace reports what the request
  // took and not what the panel took to draw it.
  const settle = async (call: Call): Promise<CallOutcome> => {
    const started = performance.now();
    try {
      const value = (await runCall(ws(), call)) as AnyResult;
      return {
        call,
        result: value,
        error: null,
        durationMs: performance.now() - started,
      };
    } catch (error_) {
      return {
        call,
        result: null,
        error: describeError(error_, context()),
        durationMs: performance.now() - started,
      };
    }
  };

  const clearDiscovery = (): void => {
    properties.value = null;
    values.value = null;
    propsCall.value = null;
    valuesCall.value = null;
  };

  /**
   * A loop report: one request at a time, on purpose — the Query API
   * allows five concurrent requests per project, and the sequential loop
   * is the code the panel prints. A failed call keeps its error and the
   * loop goes on; an error that ends the session stops it.
   *
   * @param next - The report to run.
   * @param ticket - This run's ticket.
   */
  const runLoop = async (next: LoopSpec, ticket: number): Promise<void> => {
    const kind = next.kind;
    const loop = loopCalls(next);
    store(kind, {
      ticket,
      spec: next,
      outcomes: loop.map((call) => ({
        call,
        result: null,
        error: null,
        durationMs: null,
      })),
      current: 0,
      startedAt: performance.now(),
      loading: true,
      error: null,
      link: null,
      linkCall: null,
    });
    for (const [i, call] of loop.entries()) {
      const outcome = await settle(call);
      const current = runs.value[kind];
      if (current?.ticket !== ticket) {
        return;
      }
      const settled = current.outcomes.map((o, k) => (k === i ? outcome : o));
      if (outcome.error?.fatal === true) {
        store(kind, {
          ...current,
          outcomes: settled,
          current: null,
          startedAt: null,
          loading: false,
          error: outcome.error,
        });
        return;
      }
      // The next call starts as soon as this one is stored.
      const more = i + 1 < loop.length;
      store(kind, {
        ...current,
        outcomes: settled,
        current: more ? i + 1 : null,
        startedAt: more ? performance.now() : null,
      });
    }
    patch(kind, ticket, { loading: false, current: null, startedAt: null });
  };

  return {
    engine,
    runs,
    spec,
    result,
    outcomes,
    current: inFlight,
    loading,
    error,
    topEvents,
    topLoading,
    allEvents,
    properties,
    values,
    link,
    calls,
    specCall,
    sweeps,
    sweeping,
    async loadTopEvents() {
      const call = topEventsCall();
      topCall.value = call;
      topLoading.value = true;
      try {
        topEvents.value = (await runCall(ws(), call)) as readonly TopEvent[];
      } catch (error_) {
        discoveryError.value = describeError(error_, context());
      } finally {
        topLoading.value = false;
      }
    },
    async run(next) {
      discoveryError.value = null;
      const ticket = ++sequence;
      if (isLoopSpec(next)) {
        await runLoop(next, ticket);
        return;
      }
      const kind = next.kind;
      if (kind === "trend" && trendSpec()?.event !== next.event) {
        clearDiscovery();
      }
      const call = toCall(next);
      // The engine's previous result stays on screen while the new one
      // loads (no flicker on a math or range toggle); being the same
      // engine's, it fits the adapter the new spec selects.
      store(kind, {
        ticket,
        spec: next,
        outcomes: [
          {
            call,
            result: runs.value[kind]?.outcomes[0]?.result ?? null,
            error: null,
            durationMs: null,
          },
        ],
        current: null,
        startedAt: null,
        loading: true,
        error: null,
        link: null,
        linkCall: null,
      });
      const outcome = await settle(call);
      patch(kind, ticket, {
        outcomes: [outcome],
        loading: false,
        error: outcome.error,
      });
    },
    // Sequential like the loops, and cached as each window settles so the
    // panel fills in; a fatal error lands on the matrix run, where the
    // page's watcher picks it up.
    async sweep(pair, windows) {
      const run = runs.value.matrix;
      if (run?.spec.kind !== "matrix" || sweeping.value !== null) {
        return;
      }
      const { ticket } = run;
      const last = run.spec.last;
      sweeping.value = pairKey(pair);
      try {
        for (const [i, call] of sweepCalls(pair, windows, last).entries()) {
          const window = windows[i];
          const outcome = await settle(call);
          if (runs.value.matrix?.ticket !== ticket || window === undefined) {
            return;
          }
          sweeps.value = {
            ...sweeps.value,
            [sweepKey(pair, window, last)]: outcome,
          };
          if (outcome.error?.fatal === true) {
            patch("matrix", ticket, { error: outcome.error });
            return;
          }
        }
      } finally {
        sweeping.value = null;
      }
    },
    async openBreakdown() {
      const current = trendSpec();
      if (current === null || properties.value !== null) {
        return;
      }
      const call = propertiesCall(current.event);
      propsCall.value = call;
      try {
        properties.value = (await runCall(ws(), call)) as readonly string[];
      } catch (error_) {
        discoveryError.value = describeError(error_, context());
      }
    },
    async showValues(property) {
      const current = trendSpec();
      if (current === null) {
        return;
      }
      const call = propertyValuesCall(property, current.event);
      valuesCall.value = call;
      try {
        values.value = {
          property,
          values: (await runCall(ws(), call)) as readonly string[],
        };
      } catch (error_) {
        discoveryError.value = describeError(error_, context());
      }
    },
    async loadAllEvents() {
      const call = eventsCall();
      namesCall.value = call;
      try {
        allEvents.value = (await runCall(ws(), call)) as readonly string[];
      } catch (error_) {
        discoveryError.value = describeError(error_, context());
      }
    },
    async createLink(name) {
      const current = active.value;
      const shown = single.value;
      if (current === null || shown === null || shown.result === null) {
        return null;
      }
      const kind = current.spec.kind;
      const request = reportLinkCall(shown.call.binding, name);
      patch(kind, current.ticket, { linkCall: request });
      try {
        const created = (await runCall(ws(), request, {
          [shown.call.binding]: shown.result,
        })) as ReportLink;
        patch(kind, current.ticket, { link: created });
        return created;
      } catch (error_) {
        patch(kind, current.ticket, {
          error: describeError(error_, context()),
        });
        return null;
      }
    },
    reset() {
      runs.value = {};
      sweeps.value = {};
      sweeping.value = null;
      discoveryError.value = null;
      topEvents.value = [];
      allEvents.value = null;
      clearDiscovery();
      topCall.value = null;
      namesCall.value = null;
    },
  };
}
