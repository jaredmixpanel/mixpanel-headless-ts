// Root of `/demo/callback`. This build shows the working copy and a way
// back to the playground; the PKCE exchange (`completeLogin`, the move of
// the tokens into memory, the router hop to `/demo`) is wired in the live
// mode work and replaces this component's setup.

import "./demo.css";

import { withBase } from "vitepress";
import { defineComponent, h } from "vue";

/** Callback page body. */
export default defineComponent({
  name: "DemoCallback",
  setup() {
    return () =>
      h("div", { class: "mp-demo mp-callback", role: "status" }, [
        h("p", "Completing sign-in…"),
        h("p", { class: "mp-muted" }, [
          "If you were not redirected, ",
          h("a", { href: withBase("/demo/") }, "go to the playground"),
          ".",
        ]),
      ]);
  },
});
