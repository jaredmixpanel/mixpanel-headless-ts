// Site theme: VitePress's default theme plus the pieces the plugins need on
// the client — twoslash's static hover styles, the prose-tabs runtime, and
// the llms plugin's "copy / open as Markdown" buttons above every page. Plain
// TypeScript with `h()` rather than an SFC, so no Vue tooling joins the lint
// chain. The playground components are client-only and code-split: the
// library chunk they import is loaded by the two demo pages and no other.

// The static renderer's popup layout, then the VitePress layer of the
// vitepress-twoslash package (its variables map the popup's colors and
// fonts onto the theme's `--vp-*` tokens, so the popup follows dark mode).
// The package's `style.css` bundles both with floating-vue's stylesheet,
// which only its floating renderer needs.
import "@shikijs/twoslash/style-rich.css";
import "@shikijs/vitepress-twoslash/style-core.css";
import "./mixpanel.css";

import { defineClientComponent, inBrowser, type Theme } from "vitepress";
import DefaultTheme from "vitepress/theme";
import CopyOrDownloadAsMarkdownButtons from "vitepress-plugin-llms/vitepress-components/CopyOrDownloadAsMarkdownButtons.vue";
import { enhanceAppWithTabs } from "vitepress-plugin-tabs/client";
import { h } from "vue";

/** Gap between a hovered token and its popup, in CSS pixels. */
const POPUP_GAP = 4;
/** Smallest distance the popup keeps from the viewport's edges. */
const POPUP_MARGIN = 16;

/**
 * Place each twoslash popup beside the token it belongs to as the pointer
 * reaches it. The popups are `position: fixed` (mixpanel.css) so the code
 * block's horizontal scroller cannot clip them, but a fixed box without
 * offsets sits at its static position in page coordinates: once the page
 * has scrolled, the popup lands that far below its token. Setting the
 * offsets from the token's viewport rectangle puts it where the static
 * layout meant it to be: below the token, above it when only that side
 * has the room, and capped to the roomier side (the container scrolls)
 * when a long docblock fits neither.
 */
function placeTwoslashPopups(): void {
  document.addEventListener("mouseover", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const hover = target.closest(".twoslash-hover");
    if (hover === null) {
      return;
    }
    const popup = hover.querySelector<HTMLElement>(
      ":scope > .twoslash-popup-container",
    );
    // Moving within an open popup keeps it where it is (and keeps its
    // scroll position).
    if (popup === null || popup.contains(target)) {
      return;
    }
    popup.style.maxHeight = "";
    const height = popup.offsetHeight;
    const token = hover.getBoundingClientRect();
    const below = token.bottom + POPUP_GAP;
    const roomBelow = window.innerHeight - POPUP_MARGIN - below;
    // The site's nav bars are fixed or sticky at the top; a popup opening
    // upwards stops under them.
    const chromeBottom = Math.max(
      0,
      ...[".VPNav", ".VPLocalNav"].map(
        (bar) =>
          document.querySelector(bar)?.getBoundingClientRect().bottom ?? 0,
      ),
    );
    const roomAbove = token.top - POPUP_GAP - chromeBottom - POPUP_MARGIN;
    const useBelow =
      height <= roomBelow || (height > roomAbove && roomBelow >= roomAbove);
    const room = useBelow ? roomBelow : roomAbove;
    if (height > room) {
      popup.style.maxHeight = `${String(room)}px`;
    }
    const shown = Math.min(height, room);
    const top = useBelow ? below : token.top - POPUP_GAP - shown;
    const left = Math.max(
      POPUP_MARGIN,
      Math.min(
        token.left,
        window.innerWidth - POPUP_MARGIN - popup.offsetWidth,
      ),
    );
    popup.style.top = `${String(top)}px`;
    popup.style.left = `${String(left)}px`;
  });
}

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
    if (inBrowser) {
      placeTwoslashPopups();
    }
  },
};

export default theme;
