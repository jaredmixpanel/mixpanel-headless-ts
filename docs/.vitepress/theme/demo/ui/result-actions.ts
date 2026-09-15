// The row under a result: "Open in Mixpanel" and "Copy as Markdown". The
// demo project does not exist on mixpanel.com, so offline the button stays
// disabled and its tooltip shows the URL the same call would produce —
// computed by actually running `createReportLink` through the fixture
// transport the first time the control is hovered or focused.

import { defineComponent, h, type PropType, ref } from "vue";

import { button } from "./el.js";

/** Result actions. */
export default defineComponent({
  name: "DemoResultActions",
  props: {
    offline: { type: Boolean, required: true },
    /** The report link's URL once built, or `null`. */
    linkUrl: { type: String as PropType<string | null>, default: null },
    linkPending: { type: Boolean, default: false },
  },
  emits: {
    // Build the link (offline: for the tooltip; live: `open` follows).
    link: () => true,
    open: () => true,
    copyMarkdown: () => true,
  },
  setup(props, { emit }) {
    const copied = ref(false);
    // Each new result clears the parent's link, so hovering asks again only
    // when there is nothing built and nothing in flight.
    const prepare = (): void => {
      if (props.linkUrl === null && !props.linkPending) {
        emit("link");
      }
    };
    const copy = (): void => {
      emit("copyMarkdown");
      copied.value = true;
      setTimeout(() => {
        copied.value = false;
      }, 1500);
    };
    return () =>
      h("div", { class: "mp-actions" }, [
        props.offline
          ? h(
              "span",
              {
                class: "mp-tip-anchor",
                tabindex: 0,
                onMouseenter: prepare,
                onFocus: prepare,
              },
              [
                button("Open in Mixpanel\u00A0↗", () => undefined, {
                  disabled: true,
                  "aria-describedby": "mp-open-tip",
                }),
                h(
                  "span",
                  { class: "mp-tip", role: "tooltip", id: "mp-open-tip" },
                  [
                    "The demo project does not exist on mixpanel.com. Sign in with your own project to open this report. URL the call would produce: ",
                    props.linkUrl === null
                      ? h(
                          "span",
                          { class: "mp-muted" },
                          props.linkPending ? "building…" : "…",
                        )
                      : h("code", props.linkUrl),
                  ],
                ),
              ],
            )
          : button("Open in Mixpanel\u00A0↗", () => emit("open"), {
              class: "mp-btn mp-btn-brand",
              disabled: props.linkPending,
            }),
        button(copied.value ? "Copied" : "Copy as Markdown", copy),
      ]);
  },
});
