// Root of `/demo/callback`, serving both login transports. As the popup
// a framed playground opened, it hands its own address back to the opener
// and has nothing left to do but close. As a top-level redirect return it
// completes the PKCE login once per document, moves the tokens into the
// in-memory singleton, wipes the hop store and the address bar, then hops
// client-side to `/demo` so the singleton carries the tokens into the
// project picker. When it is neither — the opener is gone, or the login
// started in a window this one cannot reach — it shows its address for
// the visitor to paste back, and never reads the code out of it.
// Outcomes live at module level: a remount (back button, client-side
// revisit) shows the same result instead of redeeming the code a second
// time.

import "./demo.css";

import { useRouter, withBase } from "vitepress";
import {
  defineComponent,
  h,
  onMounted,
  ref,
  shallowRef,
  type VNode,
} from "vue";

import { completeLogin, relayPopupReturn } from "@mixpanel-headless/browser";

import { describeError, noPendingLoginError } from "../model/errors.js";
import {
  type DemoError,
  type ErrorRetry,
  finishLogin,
  signOut,
  strandedReturn,
} from "../model/session-state.js";
import { ErrorBlock } from "./banners.js";
import { button } from "./el.js";
import LoadingCard from "./loading-card.js";
import {
  clearSession,
  forgetRegion,
  hopStore,
  markLive,
  memory,
  pendingRegion,
  session,
} from "./session.js";

type Phase =
  | { readonly kind: "working" }
  | { readonly kind: "done" }
  /** The popup: the return went to the opener; this window may close. */
  | { readonly kind: "relayed" }
  /** No opener and no login of its own: the address is for pasting back. */
  | { readonly kind: "paste-back"; readonly url: string }
  | { readonly kind: "error"; readonly error: DemoError };

const RELAYED_TITLE = "Signed in. You can close this window.";
const RELAYED_LINE =
  "The page you signed in from has picked up the result and is loading your projects.";
const PASTE_BACK_TITLE =
  "Copy this address back into the page you signed in from";
const PASTE_BACK_LINE =
  "This window could not reach the page that started the sign-in (it may have opened in another browser). Paste the address below into that page's “Signed in but nothing happened?” box.";

const phase = shallowRef<Phase>({ kind: "working" });
let started = false;

/**
 * The exchange, run once per document.
 *
 * @returns Resolves when the page has settled (redirected or failed).
 */
async function complete(): Promise<void> {
  // The relay comes first: the popup carries no pending record of its
  // own (that lives in the framed page's memory), so anything else this
  // page could do with the URL would be wrong.
  if (relayPopupReturn()) {
    phase.value = { kind: "relayed" };
    return;
  }
  const region = pendingRegion();
  if (region === null) {
    phase.value = strandedReturn({
      windowName: window.name,
      search: location.search,
    })
      ? { kind: "paste-back", url: location.href }
      : { kind: "error", error: noPendingLoginError() };
    return;
  }
  const hop = hopStore();
  try {
    await completeLogin({ region, returnUrl: location.href, store: hop });
    const { expiresAt } = await finishLogin(hop, memory, region);
    session.region = region;
    session.expiresAt = expiresAt;
    session.ws = null;
    session.me = null;
    markLive();
    forgetRegion();
    phase.value = { kind: "done" };
  } catch (error) {
    // Whatever failed, nothing usable may stay behind: the pending record
    // is single-use, the registration is per tab, and a half-written
    // token set must not be picked up by a later attempt.
    forgetRegion();
    clearSession();
    try {
      await signOut(memory, hop, region);
    } catch {
      // A hop store that cannot even delete is the storage failure the
      // mapped error below already explains; nothing readable is left.
    }
    phase.value = {
      kind: "error",
      error: describeError(error, { redirectUri: __DEMO_REDIRECT_URI__ }),
    };
  }
}

/** Callback page body. */
export default defineComponent({
  name: "DemoCallback",
  setup() {
    const router = useRouter();
    const leave = async (resume: ErrorRetry | null): Promise<void> => {
      session.resume = resume;
      await router.go(withBase("/demo/"));
    };
    const firstMount = async (): Promise<void> => {
      await complete();
      if (phase.value.kind === "relayed") {
        // The browser may refuse (a window the script did not open); the
        // card stays up either way.
        window.close();
        return;
      }
      if (phase.value.kind === "done") {
        // `?code=&state=` leave the address bar and history before the
        // hop, so neither a reload nor the back button replays them.
        history.replaceState(null, "", withBase("/demo/callback"));
        await leave(null);
      }
    };
    onMounted(() => {
      if (!started) {
        started = true;
        void firstMount();
      } else if (phase.value.kind === "done") {
        void leave(null);
      }
    });

    const link = (label: string, resume: ErrorRetry): VNode =>
      h(
        "a",
        {
          class: "mp-btn",
          href: withBase("/demo/"),
          onClick: (event: MouseEvent) => {
            event.preventDefault();
            void leave(resume);
          },
        },
        label,
      );

    const copied = ref(false);
    const copy = async (url: string): Promise<void> => {
      try {
        await navigator.clipboard.writeText(url);
        copied.value = true;
      } catch {
        // No clipboard access: the field is selectable and stays shown.
      }
    };

    return () => {
      const current = phase.value;
      if (current.kind === "relayed") {
        return h("div", { class: "mp-demo mp-callback" }, [
          h("section", { class: "mp-intro" }, [
            h(
              "p",
              { class: "mp-loading-title", role: "status" },
              RELAYED_TITLE,
            ),
            h("p", { class: "mp-muted" }, RELAYED_LINE),
          ]),
        ]);
      }
      if (current.kind === "paste-back") {
        return h("div", { class: "mp-demo mp-callback" }, [
          h("section", { class: "mp-intro" }, [
            h("p", { class: "mp-loading-title" }, PASTE_BACK_TITLE),
            h("p", { class: "mp-muted" }, PASTE_BACK_LINE),
            h("div", { class: "mp-paste" }, [
              h("input", {
                class: "mp-input mp-url",
                type: "text",
                readonly: true,
                value: current.url,
                "aria-label": "Address of this page",
                onFocus: (event: FocusEvent) => {
                  (event.target as HTMLInputElement).select();
                },
              }),
              button(
                copied.value ? "Copied" : "Copy address",
                () => void copy(current.url),
                { class: "mp-btn mp-btn-brand" },
              ),
            ]),
          ]),
        ]);
      }
      if (current.kind === "error") {
        return h("div", { class: "mp-demo mp-callback" }, [
          h(ErrorBlock, { error: current.error }),
          h("div", { class: "mp-intro-actions" }, [
            current.error.retry === "offline"
              ? null
              : link("Try again", "signed-out"),
            link("Back to demo", "offline"),
          ]),
        ]);
      }
      return h("div", { class: "mp-demo mp-callback" }, [
        h(LoadingCard, { phase: "sign-in" }),
      ]);
    };
  },
});
