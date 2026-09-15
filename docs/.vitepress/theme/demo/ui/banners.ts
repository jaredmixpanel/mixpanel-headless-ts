// The playground's banners: the mode bar, the live-mode intro with its
// region picker, the footer note, and the inline error block. Copy lives
// here verbatim; the components only choose which line to show.

import { withBase } from "vitepress";
import { defineComponent, h, type PropType, ref, type VNode } from "vue";

import type { DemoError, Region } from "../model/session-state.js";
import { button, segmented } from "./el.js";

const REGIONS: ReadonlyArray<{ value: Region; label: string }> = [
  { value: "us", label: "US" },
  { value: "eu", label: "EU" },
  { value: "in", label: "IN" },
];

/** The offline mode bar: what the demo project is, and the way out of it. */
export const OfflineBar = defineComponent({
  name: "DemoOfflineBar",
  props: {
    liveEnabled: { type: Boolean, required: true },
  },
  emits: { live: () => true },
  setup(props, { emit }) {
    return () =>
      h("div", { class: "mp-modebar" }, [
        h("p", { class: "mp-modebar-text" }, [
          h("strong", "Demo project. "),
          "“Northwind Notes” is a synthetic project served from recorded responses through the library's ",
          h("code", "fetch"),
          " seam — the code on the right is real and runs in your browser; only the data is canned.",
        ]),
        props.liveEnabled
          ? button("Use my own project ▸", () => emit("live"), {
              class: "mp-btn mp-btn-brand",
            })
          : null,
      ]);
  },
});

/** The signed-out panel: what live mode does, the region picker, the CTA. */
export const LiveIntro = defineComponent({
  name: "DemoLiveIntro",
  props: {
    region: { type: String as PropType<Region>, required: true },
    notice: { type: String as PropType<string | null>, default: null },
    signInEnabled: { type: Boolean, default: true },
  },
  emits: {
    region: (region: Region) => typeof region === "string",
    signIn: () => true,
    back: () => true,
  },
  setup(props, { emit }) {
    return () =>
      h("section", { class: "mp-intro" }, [
        props.notice === null
          ? null
          : h("p", { class: "mp-notice", role: "status" }, props.notice),
        h("p", [
          h("strong", "Use your own Mixpanel project. "),
          "You will be sent to Mixpanel to sign in (OAuth with PKCE, no backend). This page only reads: event lists, queries, and report links. Tokens live in memory and are gone when you close or reload the tab. Choose your data-residency region first — it is part of the login URL.",
        ]),
        h("div", { class: "mp-intro-actions" }, [
          segmented(
            REGIONS,
            props.region,
            (region) => emit("region", region),
            "Data-residency region",
          ),
          button("Sign in with Mixpanel", () => emit("signIn"), {
            class: "mp-btn mp-btn-brand",
            disabled: !props.signInEnabled,
          }),
          button("Back to demo", () => emit("back")),
        ]),
        props.signInEnabled
          ? null
          : h(
              "p",
              { class: "mp-muted" },
              "Signing in is not wired up in this build yet; the offline demo runs the same code.",
            ),
        h("details", { class: "mp-details" }, [
          h("summary", "Having trouble?"),
          h("p", [
            "Some enterprise SSO configurations cannot complete a third-party OAuth flow; if Mixpanel returns you with an error, use the Node package with ",
            h("code", "loginUnified"),
            " on your machine instead (",
            h(
              "a",
              { href: withBase("/guide/accounts-sessions-targets") },
              "accounts, sessions and targets",
            ),
            ").",
          ]),
        ]),
      ]);
  },
});

/** The footer note under the grid. */
export const FooterNote = defineComponent({
  name: "DemoFooterNote",
  setup() {
    return () =>
      h("p", { class: "mp-footnote" }, [
        "ⓘ Streaming (",
        h("code", "streamEvents"),
        ") and session replay are Node-only — the Export API serves no CORS headers. This page uses pre-release packages (0.1.0); APIs may change before 1.0. ",
        h(
          "a",
          { href: withBase("/guide/browser") },
          "Read the browser guide →",
        ),
      ]);
  },
});

/** An inline error: class, code, status, message, details behind a disclosure. */
export const ErrorBlock = defineComponent({
  name: "DemoErrorBlock",
  props: {
    error: { type: Object as PropType<DemoError>, required: true },
  },
  setup(props) {
    const open = ref(false);
    return (): VNode => {
      const { error } = props;
      const head = [
        h("code", error.className),
        error.code === null
          ? null
          : [
              " (",
              h("code", error.code),
              error.statusCode === null ? "" : `, HTTP ${error.statusCode}`,
              ")",
            ],
        ": ",
        error.message,
      ];
      return h("div", { class: "mp-error", role: "alert" }, [
        h("p", head),
        error.details === undefined || error.details === null
          ? null
          : h("div", [
              button(
                open.value ? "Hide details" : "Show details",
                () => {
                  open.value = !open.value;
                },
                { class: "mp-btn mp-btn-small", "aria-expanded": open.value },
              ),
              open.value
                ? h(
                    "pre",
                    { class: "mp-error-details" },
                    JSON.stringify(error.details, null, 2),
                  )
                : null,
            ]),
      ]);
    };
  },
});
