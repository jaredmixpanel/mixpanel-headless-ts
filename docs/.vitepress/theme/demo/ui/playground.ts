// Root of `/demo`: owns the page state (one `DemoState`), builds the
// offline workspace over the fixture transport, and wires the columns
// together. Offline and live share the same query controller; only the
// facade behind it differs, so the live states slot in by switching on
// `mode` without touching the columns.

import "./demo.css";

import {
  computed,
  defineComponent,
  h,
  onMounted,
  ref,
  shallowRef,
  type VNode,
} from "vue";

import {
  createBrowserWorkspace,
  type Workspace,
} from "@mixpanel-headless/browser";

import { DEMO_FIXTURES } from "../fixtures/demo-project.gen.js";
import { fixtureCoverage, fixtureFetch } from "../model/fixture-fetch.js";
import { toMarkdown } from "../model/markdown-table.js";
import type { QuerySpec, TimeRange, TrendSpec } from "../model/query-spec.js";
import type { DemoState, Region } from "../model/session-state.js";
import { LIVE_SETUP, OFFLINE_SETUP } from "../model/setup-snippets.js";
import { ErrorBlock, FooterNote, LiveIntro, OfflineBar } from "./banners.js";
import { FunnelBuilder, RetentionBuilder } from "./builders.js";
import CodePanel, { programText } from "./code-panel.js";
import { button } from "./el.js";
import EventList from "./event-list.js";
import QueryPanel from "./query-panel.js";
import ResultActions from "./result-actions.js";
import { useQuery } from "./use-query.js";

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
    const region = ref<Region>("us");
    const last = ref<TimeRange>(30);
    const linkPending = ref(false);
    const query = useQuery(() => {
      const ws = workspaceOf(state.value);
      if (ws === null) {
        throw new Error("playground: no workspace in this state");
      }
      return ws;
    });
    const offline = computed(() => state.value.mode === "offline");
    const selectedEvent = computed(() =>
      query.spec.value?.kind === "trend" ? query.spec.value.event : null,
    );
    const eventNames = computed(
      () => query.allEvents.value ?? query.topEvents.value.map((e) => e.event),
    );
    const setup = computed(() => (offline.value ? OFFLINE_SETUP : LIVE_SETUP));

    const run = (spec: QuerySpec): void => void query.run(spec);
    // Selecting an event keeps its math and range when it is already shown;
    // `groupBy` `null` clears the breakdown, `undefined` leaves it alone.
    const trend = (event: string, groupBy?: string | null): void => {
      const current = query.spec.value;
      const base: TrendSpec =
        current?.kind === "trend" && current.event === event
          ? current
          : { kind: "trend", event, math: "total", last: last.value };
      const next: TrendSpec = {
        kind: "trend",
        event,
        math: base.math,
        last: base.last,
      };
      const chosen = groupBy === undefined ? base.groupBy : groupBy;
      run(
        chosen === null || chosen === undefined
          ? next
          : { ...next, groupBy: chosen },
      );
    };
    const rerun = (patch: Partial<QuerySpec>): void => {
      const current = query.spec.value;
      if (current !== null) {
        run({ ...current, ...patch } as QuerySpec);
      }
    };
    const start = async (): Promise<void> => {
      await query.loadTopEvents();
      const first = query.topEvents.value[0];
      if (first !== undefined && query.spec.value === null) {
        trend(first.event);
      }
    };
    onMounted(() => void start());

    const buildLink = async (open: boolean): Promise<void> => {
      const spec = query.spec.value;
      if (spec === null) {
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

    const goLive = (): void => {
      state.value = { mode: "signed-out", region: region.value, notice: null };
    };
    const backToDemo = (): void => {
      state.value = { mode: "offline", ws: offlineWs };
    };

    const leftColumn = (): VNode =>
      h("aside", { class: "mp-col mp-col-left" }, [
        h("div", { class: "mp-col-head" }, [h("h2", "Events")]),
        h(EventList, {
          events: query.topEvents.value.map((e) => ({
            event: e.event,
            count: e.count,
            percentChange: e.percent_change,
          })),
          selected: selectedEvent.value,
          loading: query.topLoading.value,
          onSelect: (event: string) => trend(event),
        }),
        h("div", { class: "mp-col-head" }, [h("h2", "Funnel")]),
        h(FunnelBuilder, {
          events: offline.value ? coverage.funnelEvents : eventNames.value,
          seed: selectedEvent.value,
          ...(offline.value ? { maxSteps: OFFLINE_MAX_STEPS } : {}),
          complete: offline.value || query.allEvents.value !== null,
          onRun: ({ steps, conversionWindow }) =>
            run({ kind: "funnel", steps, last: last.value, conversionWindow }),
          onMoreEvents: () => void query.loadAllEvents(),
        }),
        h("div", { class: "mp-col-head" }, [h("h2", "Retention")]),
        h(RetentionBuilder, {
          events: eventNames.value,
          pairs: offline.value ? coverage.retentionPairs : null,
          seed: selectedEvent.value,
          onRun: ({ born, returnEvent, retentionUnit }) =>
            run({
              kind: "retention",
              born,
              returnEvent,
              retentionUnit,
              last: last.value,
            }),
        }),
      ]);

    const mainColumn = (): VNode =>
      h("section", { class: "mp-col mp-col-main" }, [
        h(
          QueryPanel,
          {
            spec: query.spec.value,
            result: query.result.value,
            loading: query.loading.value,
            error: query.error.value,
            properties: query.properties.value,
            values: query.values.value,
            onMath: (math) => rerun({ math }),
            onRange: (n) => {
              last.value = n;
              rerun({ last: n });
            },
            onBreakdownOpen: () => void query.openBreakdown(),
            onGroupBy: (property) => {
              const current = query.spec.value;
              if (current?.kind === "trend") {
                trend(current.event, property);
              }
            },
            onValues: (property) => void query.showValues(property),
          },
          {
            actions: () =>
              h(ResultActions, {
                offline: offline.value,
                linkUrl: query.link.value?.url ?? null,
                linkPending: linkPending.value,
                onLink: () => void buildLink(false),
                onOpen: () => void buildLink(true),
                onCopyMarkdown: () => void copyMarkdown(),
              }),
          },
        ),
      ]);

    const codeColumn = (): VNode =>
      h("section", { class: "mp-col mp-col-code" }, [
        h(CodePanel, {
          setup: setup.value,
          calls: query.calls.value,
          columns: query.result.value?.rowColumns() ?? null,
          resultBinding: query.specCall.value?.binding ?? null,
        }),
      ]);

    const body = (): VNode | VNode[] => {
      const current = state.value;
      switch (current.mode) {
        case "offline": {
          return [
            h(OfflineBar, {
              liveEnabled: __DEMO_LIVE_ENABLED__,
              onLive: goLive,
            }),
            h("div", { class: "mp-grid" }, [
              leftColumn(),
              mainColumn(),
              codeColumn(),
            ]),
          ];
        }
        case "signed-out": {
          return h(LiveIntro, {
            region: region.value,
            notice: current.notice,
            signInEnabled: false,
            onRegion: (r: Region) => {
              region.value = r;
              state.value = { ...current, region: r };
            },
            onSignIn: () => undefined,
            onBack: backToDemo,
          });
        }
        case "login-pending": {
          return h("p", { class: "mp-intro", role: "status" }, [
            "Redirecting to Mixpanel… If nothing happens, ",
            current.authorizeUrl === null
              ? "retry from the start."
              : h("a", { href: current.authorizeUrl }, "open the sign-in page"),
          ]);
        }
        case "callback": {
          return h(
            "p",
            { class: "mp-intro", role: "status" },
            "Completing sign-in…",
          );
        }
        case "project-picker":
        case "ready": {
          return h(
            "p",
            { class: "mp-intro" },
            "Live mode is not wired up in this build yet.",
          );
        }
        case "error": {
          return h("div", { class: "mp-intro" }, [
            h(ErrorBlock, { error: current.error }),
            h("div", { class: "mp-intro-actions" }, [
              button(
                current.retry === "offline" ? "Back to demo" : "Try again",
                current.retry === "offline" ? backToDemo : goLive,
              ),
            ]),
          ]);
        }
      }
    };

    return () => h("div", { class: "mp-demo" }, [body(), h(FooterNote)]);
  },
});
