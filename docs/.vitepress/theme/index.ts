// Site theme: VitePress's default theme plus the pieces the plugins need on
// the client — twoslash's static hover styles, the prose-tabs runtime, and
// the llms plugin's "copy / open as Markdown" buttons above every page. Plain
// TypeScript with `h()` rather than an SFC, so no Vue tooling joins the lint
// chain. The playground components are client-only and code-split: the
// library chunk they import is loaded by the two demo pages and no other.

import "@shikijs/twoslash/style-rich.css";
import "./mixpanel.css";

import { defineClientComponent, type Theme } from "vitepress";
import DefaultTheme from "vitepress/theme";
import CopyOrDownloadAsMarkdownButtons from "vitepress-plugin-llms/vitepress-components/CopyOrDownloadAsMarkdownButtons.vue";
import { enhanceAppWithTabs } from "vitepress-plugin-tabs/client";
import { h } from "vue";

const theme: Theme = {
  extends: DefaultTheme,
  Layout: () =>
    h(DefaultTheme.Layout, null, {
      "doc-before": () => h(CopyOrDownloadAsMarkdownButtons),
    }),
  enhanceApp({ app }) {
    enhanceAppWithTabs(app);
    app.component(
      "DemoPlayground",
      defineClientComponent(() => import("./demo/ui/playground.js")),
    );
    app.component(
      "DemoCallback",
      defineClientComponent(() => import("./demo/ui/callback.js")),
    );
  },
};

export default theme;
