// Root of `/demo`: owns the page state (one `DemoState`), builds the
// offline workspace over the fixture transport, drives the live states
// (sign-in, project picker, session header, sign-out) and wires the
// columns together. Offline and live share the same query controller;
// only the facade behind it differs, so the columns never know the mode.

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
import { describeError, type ErrorContext } from "../model/errors.js";
import { fixtureCoverage, fixtureFetch } from "../model/fixture-fetch.js";
import { toMarkdown } from "../model/markdown-table.js";
import type { QuerySpec, TimeRange, TrendSpec } from "../model/query-spec.js";
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
import {
  ErrorBlock,
  FooterNote,
  LiveIntro,
  OfflineBar,
  SessionBar,
} from "./banners.js";
import { FunnelBuilder, RetentionBuilder } from "./builders.js";
import CodePanel, { programText } from "./code-panel.js";
import { button } from "./el.js";
import EventList from "./event-list.js";
import ProjectPicker from "./project-picker.js";
import QueryPanel from "./query-panel.js";
import ResultActions from "./result-actions.js";
import {
  clearSession,
  forgetRegion,
  hopStore,
  memory,
  rememberRegion,
  session,
  wasLive,
} from "./session.js";
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
/** The header flips to its warning this long before the token expires. */
const EXPIRY_WARNING_MS = 60_000;

const RELOAD_NOTICE =
  "Your session ended with the page reload. Tokens are kept in memory only; sign in again to continue.";
const SIGNED_OUT_NOTICE =
  "Signed out. Tokens and the client registration were deleted from this tab.";

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
    const linkPending = ref(false);
    const busy = ref(false);
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
    const offline = computed(() => state.value.mode === "offline");
    const selectedEvent = computed(() =>
      query.spec.value?.kind === "trend" ? query.spec.value.event : null,
    );
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
      query.reset();
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
      state.value = { mode: "callback" };
      try {
        const ws =
          session.ws ??
          (await createBrowserWorkspaceFromStore({
            region: from,
            projectId: "0",
            store: memory,
          }));
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
        query.reset();
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
        query.reset();
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

    const grid = (): VNode =>
      h("div", { class: "mp-grid" }, [
        leftColumn(),
        mainColumn(),
        codeColumn(),
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
