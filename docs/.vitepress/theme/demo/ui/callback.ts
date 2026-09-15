// Root of `/demo/callback`: completes the redirect PKCE login once per
// document, moves the tokens into the in-memory singleton, wipes the hop
// store and the address bar, then hops client-side to `/demo` so the
// singleton carries the tokens into the project picker. Outcomes live at
// module level: a remount (back button, client-side revisit) shows the
// same result instead of redeeming the code a second time.

import "./demo.css";

import { useRouter, withBase } from "vitepress";
import { defineComponent, h, onMounted, shallowRef, type VNode } from "vue";

import { completeLogin } from "@mixpanel-headless/browser";

import { describeError, noPendingLoginError } from "../model/errors.js";
import {
  type DemoError,
  type ErrorRetry,
  finishLogin,
  signOut,
} from "../model/session-state.js";
import { ErrorBlock } from "./banners.js";
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
  | { readonly kind: "error"; readonly error: DemoError };

const phase = shallowRef<Phase>({ kind: "working" });
let started = false;

/**
 * The exchange, run once per document.
 *
 * @returns Resolves when the page has settled (redirected or failed).
 */
async function complete(): Promise<void> {
  const region = pendingRegion();
  if (region === null) {
    phase.value = { kind: "error", error: noPendingLoginError() };
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

    return () => {
      const current = phase.value;
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
      return h("div", { class: "mp-demo mp-callback", role: "status" }, [
        h("p", "Completing sign-in…"),
      ]);
    };
  },
});
