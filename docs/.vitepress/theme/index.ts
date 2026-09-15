// Site theme: VitePress's default theme plus the pieces the plugins need on
// the client — floating-vue for twoslash hovers, the prose-tabs runtime, and
// the llms plugin's "copy / open as Markdown" buttons above every page. Plain
// TypeScript with `h()` rather than an SFC, so no Vue tooling joins the lint
// chain.

import "@shikijs/vitepress-twoslash/style.css";
import "./mixpanel.css";

import TwoslashFloatingVue from "@shikijs/vitepress-twoslash/client";
import type { Theme } from "vitepress";
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
    app.use(TwoslashFloatingVue);
    enhanceAppWithTabs(app);
  },
};

export default theme;
