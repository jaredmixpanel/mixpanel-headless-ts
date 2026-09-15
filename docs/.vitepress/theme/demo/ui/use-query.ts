// Reactive sequencing for the query panel: the selected spec, the one `Call`
// built from it (rendered and executed from the same object), the result it
// produced and the discovery calls around it. Domain logic stays in model/;
// this composable only orders those calls and keeps stale responses from
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

/** Property values loaded for a segment chip. */
export interface PropertyValues {
  readonly property: string;
  readonly values: readonly string[];
}

/** What the playground reads and drives. */
export interface QueryController {
  readonly spec: ShallowRef<QuerySpec | null>;
  readonly result: ShallowRef<AnyResult | null>;
  readonly loading: Ref<boolean>;
  readonly error: ShallowRef<DemoError | null>;
  readonly topEvents: ShallowRef<readonly TopEvent[]>;
  readonly topLoading: Ref<boolean>;
  readonly allEvents: ShallowRef<readonly string[] | null>;
  readonly properties: ShallowRef<readonly string[] | null>;
  readonly values: ShallowRef<PropertyValues | null>;
  readonly link: ShallowRef<ReportLink | null>;
  /** Every call behind what is on screen, in the order it was made. */
  readonly calls: ComputedRef<readonly Call[]>;
  /** The call that produced `result`. */
  readonly specCall: ShallowRef<Call | null>;
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
  const spec = shallowRef<QuerySpec | null>(null);
  const result = shallowRef<AnyResult | null>(null);
  const loading = ref(false);
  const error = shallowRef<DemoError | null>(null);
  const topEvents = shallowRef<readonly TopEvent[]>([]);
  const topLoading = ref(false);
  const allEvents = shallowRef<readonly string[] | null>(null);
  const properties = shallowRef<readonly string[] | null>(null);
  const values = shallowRef<PropertyValues | null>(null);
  const link = shallowRef<ReportLink | null>(null);
  const topCall = shallowRef<Call | null>(null);
  const namesCall = shallowRef<Call | null>(null);
  const propsCall = shallowRef<Call | null>(null);
  const valuesCall = shallowRef<Call | null>(null);
  const specCall = shallowRef<Call | null>(null);
  const linkCall = shallowRef<Call | null>(null);
  let sequence = 0;

  const calls = computed(() =>
    [
      topCall.value,
      namesCall.value,
      propsCall.value,
      valuesCall.value,
      specCall.value,
      linkCall.value,
    ].filter((call): call is Call => call !== null),
  );

  const clearDiscovery = (): void => {
    properties.value = null;
    values.value = null;
    propsCall.value = null;
    valuesCall.value = null;
  };

  return {
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
        error.value = describeError(error_, context());
      } finally {
        topLoading.value = false;
      }
    },
    async run(next) {
      const previous = spec.value;
      const sameEvent =
        previous?.kind === "trend" &&
        next.kind === "trend" &&
        previous.event === next.event;
      if (!sameEvent) {
        clearDiscovery();
      }
      // The previous result stays on screen while a same-kind change loads
      // (no flicker on a math or range toggle); a different engine's result
      // would feed the wrong adapter, so it goes at once.
      if (previous?.kind !== next.kind) {
        result.value = null;
      }
      spec.value = next;
      link.value = null;
      linkCall.value = null;
      error.value = null;
      const call = toCall(next);
      specCall.value = call;
      const ticket = ++sequence;
      loading.value = true;
      try {
        const value = (await runCall(ws(), call)) as AnyResult;
        if (ticket === sequence) {
          result.value = value;
        }
      } catch (error_) {
        if (ticket === sequence) {
          result.value = null;
          error.value = describeError(error_, context());
        }
      } finally {
        if (ticket === sequence) {
          loading.value = false;
        }
      }
    },
    async openBreakdown() {
      const current = spec.value;
      if (current?.kind !== "trend" || properties.value !== null) {
        return;
      }
      const call = propertiesCall(current.event);
      propsCall.value = call;
      try {
        properties.value = (await runCall(ws(), call)) as readonly string[];
      } catch (error_) {
        error.value = describeError(error_, context());
      }
    },
    async showValues(property) {
      const current = spec.value;
      if (current?.kind !== "trend") {
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
        error.value = describeError(error_, context());
      }
    },
    async loadAllEvents() {
      const call = eventsCall();
      namesCall.value = call;
      try {
        allEvents.value = (await runCall(ws(), call)) as readonly string[];
      } catch (error_) {
        error.value = describeError(error_, context());
      }
    },
    async createLink(name) {
      const call = specCall.value;
      const bound = result.value;
      if (call === null || bound === null) {
        return null;
      }
      const request = reportLinkCall(call.binding, name);
      linkCall.value = request;
      try {
        const created = (await runCall(ws(), request, {
          [call.binding]: bound,
        })) as ReportLink;
        link.value = created;
        return created;
      } catch (error_) {
        error.value = describeError(error_, context());
        return null;
      }
    },
    reset() {
      sequence += 1;
      spec.value = null;
      result.value = null;
      loading.value = false;
      error.value = null;
      topEvents.value = [];
      allEvents.value = null;
      link.value = null;
      clearDiscovery();
      topCall.value = null;
      namesCall.value = null;
      specCall.value = null;
      linkCall.value = null;
    },
  };
}
