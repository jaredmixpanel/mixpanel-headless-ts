// The framed page's sign-in card while a popup login is in flight: the
// wait itself, the way to give up, and the two fallbacks the popup flow
// documents — a retry from a real click plus a plain link to the authorize
// URL when the browser refused the window, and a paste box for the address
// of the page the visitor landed on when the popup could not report back
// (an Electron shell that handed the login to the system browser, the
// link's tab, a popup blocker that opened a tab instead). The box is
// always here, collapsed; a blocked popup opens it.

import { defineComponent, h, type PropType, ref, type VNode } from "vue";

import { POPUP_BLOCKED_MESSAGE } from "../model/errors.js";
import { button } from "./el.js";
import LoadingBar from "./loading-bar.js";

const WAITING_TITLE = "Waiting for the Mixpanel sign-in window…";
const WAITING_LINE =
  "Sign in to Mixpanel in the window that opened; this page picks up the result. Only the address the window comes back with crosses over — the tokens are exchanged here and stay in memory.";
const PASTE_SUMMARY =
  "Signed in but nothing happened? Paste the address of the page you landed on";

/** The framed pending card. */
export default defineComponent({
  name: "DemoPopupPending",
  props: {
    /**
     * The authorize URL to offer as a link once the browser refused the
     * popup; `null` while the popup is open.
     */
    blockedAuthorizeUrl: {
      type: String as PropType<string | null>,
      default: null,
    },
    busy: { type: Boolean, default: false },
  },
  emits: {
    cancel: () => true,
    retry: () => true,
    paste: (url: string) => typeof url === "string",
  },
  setup(props, { emit }) {
    const draft = ref("");
    const submit = (event: Event): void => {
      event.preventDefault();
      const url = draft.value.trim();
      if (url !== "" && !props.busy) {
        emit("paste", url);
      }
    };

    const waiting = (): VNode[] => [
      h("p", { class: "mp-loading-title", role: "status" }, WAITING_TITLE),
      h("p", { class: "mp-muted" }, WAITING_LINE),
    ];
    // "Try again" runs the popup flow from inside a click, the gesture
    // popup blockers honor where the first `window.open` — reached after
    // the registration round trip — was refused. The link is the plain
    // alternative: a tab with no opener, whose callback page shows its
    // address for the paste box below.
    const blocked = (authorizeUrl: string): VNode[] => [
      h("p", { class: "mp-warn", role: "alert" }, POPUP_BLOCKED_MESSAGE),
      h("div", { class: "mp-intro-actions" }, [
        button("Try again", () => emit("retry"), {
          class: "mp-btn mp-btn-brand",
          disabled: props.busy,
        }),
        h(
          "a",
          { href: authorizeUrl, target: "_blank", rel: "noopener" },
          "Open the sign-in page in a new tab",
        ),
      ]),
    ];
    const pasteBox = (open: boolean): VNode =>
      h("details", { class: "mp-details", open }, [
        h("summary", PASTE_SUMMARY),
        h("form", { class: "mp-paste", onSubmit: submit }, [
          h("input", {
            class: "mp-input mp-url",
            type: "url",
            required: true,
            placeholder: "https://…/demo/callback?code=…&state=…",
            "aria-label": "Address of the page you landed on",
            autocomplete: "off",
            spellcheck: false,
            value: draft.value,
            disabled: props.busy,
            onInput: (event: Event) => {
              draft.value = (event.target as HTMLInputElement).value;
            },
          }),
          h(
            "button",
            {
              type: "submit",
              class: "mp-btn",
              disabled: props.busy || draft.value.trim() === "",
            },
            "Complete sign-in",
          ),
        ]),
      ]);

    return () => {
      const url = props.blockedAuthorizeUrl;
      return h(
        "section",
        { class: "mp-intro mp-pending", "aria-busy": url === null },
        [
          h(LoadingBar, { active: url === null, label: null }),
          ...(url === null ? waiting() : blocked(url)),
          pasteBox(url !== null),
          h("div", { class: "mp-intro-actions" }, [
            button("Cancel", () => emit("cancel"), { disabled: props.busy }),
          ]),
        ],
      );
    };
  },
});
