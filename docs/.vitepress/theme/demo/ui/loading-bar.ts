// The result panel's run indicator: a thin indeterminate bar along the
// panel's top edge and, for the single-query engines, a "Running query…"
// line beside the kicker. Dimming the previous chart alone reads as a
// stale result rather than a run in progress, so the run says so. The bar
// is decorative (`aria-hidden`); the text is the live region, and it stays
// mounted while idle (empty) so assistive technology announces the change
// rather than a freshly inserted node.

import { defineComponent, h, type PropType, type VNode } from "vue";

/** Run indicator. */
export default defineComponent({
  name: "DemoLoadingBar",
  props: {
    /** Whether a run is in flight. */
    active: { type: Boolean, required: true },
    /**
     * The status line; `null` for the loop reports, which report their
     * own progress under the grid.
     */
    label: { type: String as PropType<string | null>, default: null },
  },
  setup(props) {
    return (): Array<VNode | null> => [
      props.active
        ? h("div", { class: "mp-loading-bar", "aria-hidden": "true" })
        : null,
      h(
        "span",
        { class: "mp-result-status", role: "status", "aria-live": "polite" },
        props.active && props.label !== null ? props.label : "",
      ),
    ];
  },
});
