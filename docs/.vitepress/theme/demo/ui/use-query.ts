// Reactive sequencing for the query panel: one run per engine (the spec,
// the one `Call` built from it — rendered and executed from the same
// object — and the result it produced), the engine whose run is on screen,
// and the discovery calls around them. Domain logic stays in model/; this
// composable only orders those calls and keeps stale responses from
// overwriting newer ones. Results are class instances, hence `shallowRef`.

import {
  computed,
  type ComputedRef,
  type Ref,
  ref,
  type ShallowRef,
  shallowRef,
} from "vue";

import type { Workspace } from "@mixpanel-headless/browser";

import { type Call, runCall } from "../model/call.js";
import { describeError, type ErrorContext } from "../model/errors.js";
import {
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
/** The engines, one run kept per kind. */
export type EngineKind = QuerySpec["kind"];

/** Property values loaded for a segment chip. */
export interface PropertyValues {
  readonly property: string;
  readonly values: readonly string[];
}

/**
 * One engine's latest run. The spec, the call and the result are written
 * together, so what the panel draws always came from the call it shows.
 */
interface EngineRun {
  readonly spec: QuerySpec;
  readonly call: Call;
  /** `null` until the first run of this engine returns, or after it failed. */
  readonly result: AnyResult | null;
  readonly loading: boolean;
  readonly error: DemoError | null;
  readonly link: ReportLink | null;
  readonly linkCall: Call | null;
}

type Runs = Readonly<Partial<Record<EngineKind, EngineRun>>>;

/** What the playground reads and drives. */
export interface QueryController {
  /** The engine whose run the panel shows (the selected tab). */
  readonly engine: Ref<EngineKind>;
  /** The latest run of each engine that has run. */
  readonly runs: ShallowRef<Runs>;
  /** The shown engine's spec, or `null` before its first run. */
  readonly spec: ComputedRef<QuerySpec | null>;
  readonly result: ComputedRef<AnyResult | null>;
  readonly loading: ComputedRef<boolean>;
  /** The shown run's error, else the latest discovery error. */
  readonly error: ComputedRef<DemoError | null>;
  readonly topEvents: ShallowRef<readonly TopEvent[]>;
  readonly topLoading: Ref<boolean>;
  readonly allEvents: ShallowRef<readonly string[] | null>;
  readonly properties: ShallowRef<readonly string[] | null>;
  readonly values: ShallowRef<PropertyValues | null>;
  readonly link: ComputedRef<ReportLink | null>;
  /** Every call behind what is on screen, in the order it was made. */
  readonly calls: ComputedRef<readonly Call[]>;
  /** The call that produced `result`. */
  readonly specCall: ComputedRef<Call | null>;
  loadTopEvents: () => Promise<void>;
  run: (spec: QuerySpec) => Promise<void>;
  openBreakdown: () => Promise<void>;
  showValues: (property: string) => Promise<void>;
  loadAllEvents: () => Promise<void>;
  createLink: (name: string) => Promise<ReportLink | null>;
  reset: () => void;
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
  // Per engine, the ticket of its latest run: an older run of the same
  // engine that resolves later is dropped, while another engine's run in
  // flight is left alone.
  const latest: Partial<Record<EngineKind, number>> = {};
  let sequence = 0;

  const active = computed(() => runs.value[engine.value] ?? null);
  const spec = computed(() => active.value?.spec ?? null);
  const result = computed(() => active.value?.result ?? null);
  const loading = computed(() => active.value?.loading ?? false);
  const error = computed(() => active.value?.error ?? discoveryError.value);
  const link = computed(() => active.value?.link ?? null);
  const specCall = computed(() => active.value?.call ?? null);
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
    return [...discovery, run?.call ?? null, run?.linkCall ?? null].filter(
      (call): call is Call => call !== null,
    );
  });

  const store = (kind: EngineKind, run: EngineRun): void => {
    runs.value = { ...runs.value, [kind]: run };
  };
  // Amend a run only while it is still the engine's latest; a run that has
  // been replaced (or cleared by `reset`) takes nothing more.
  const patch = (
    kind: EngineKind,
    call: Call,
    changes: Partial<EngineRun>,
  ): void => {
    const current = runs.value[kind];
    if (current?.call === call) {
      store(kind, { ...current, ...changes });
    }
  };

  const clearDiscovery = (): void => {
    properties.value = null;
    values.value = null;
    propsCall.value = null;
    valuesCall.value = null;
  };

  return {
    engine,
    runs,
    spec,
    result,
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
      const kind = next.kind;
      if (kind === "trend" && trendSpec()?.event !== next.event) {
        clearDiscovery();
      }
      discoveryError.value = null;
      const call = toCall(next);
      // The engine's previous result stays on screen while the new one
      // loads (no flicker on a math or range toggle); being the same
      // engine's, it fits the adapter the new spec selects.
      store(kind, {
        spec: next,
        call,
        result: runs.value[kind]?.result ?? null,
        loading: true,
        error: null,
        link: null,
        linkCall: null,
      });
      const ticket = ++sequence;
      latest[kind] = ticket;
      try {
        const value = (await runCall(ws(), call)) as AnyResult;
        if (latest[kind] === ticket) {
          patch(kind, call, { result: value, loading: false });
        }
      } catch (error_) {
        if (latest[kind] === ticket) {
          patch(kind, call, {
            result: null,
            loading: false,
            error: describeError(error_, context()),
          });
        }
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
      if (current === null || current.result === null) {
        return null;
      }
      const kind = current.spec.kind;
      const request = reportLinkCall(current.call.binding, name);
      patch(kind, current.call, { linkCall: request });
      try {
        const created = (await runCall(ws(), request, {
          [current.call.binding]: current.result,
        })) as ReportLink;
        patch(kind, current.call, { link: created });
        return created;
      } catch (error_) {
        patch(kind, current.call, {
          error: describeError(error_, context()),
        });
        return null;
      }
    },
    reset() {
      runs.value = {};
      discoveryError.value = null;
      topEvents.value = [];
      allEvents.value = null;
      clearDiscovery();
      topCall.value = null;
      namesCall.value = null;
    },
  };
}
