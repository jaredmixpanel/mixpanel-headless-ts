// The funnel and retention tabs' builders, each one wrapping row. Each
// keeps its own draft (steps, window, born/return, unit) and emits a
// complete request when the user presses Run; the playground adds the
// shared time range and turns it into the spec it executes. Both accept a
// preset from the loop reports, which open a pair or a path here and run
// it at once.

import {
  computed,
  defineComponent,
  h,
  type PropType,
  ref,
  type VNode,
} from "vue";

import {
  CONVERSION_WINDOWS,
  type ConversionWindow,
  RETENTION_UNITS,
  type RetentionUnit,
} from "../model/query-spec.js";
import { button, field, segmented, select } from "./el.js";

/** What the funnel builder emits. */
export interface FunnelDraft {
  readonly steps: readonly string[];
  readonly conversionWindow: ConversionWindow;
}

/** What the retention builder emits. */
export interface RetentionDraft {
  readonly born: string;
  readonly returnEvent: string;
  readonly retentionUnit: RetentionUnit;
}

const MAX_STEPS = 5;
const INLINE = { class: "mp-field mp-field-inline" } as const;

const eventOptions = (
  events: readonly string[],
): ReadonlyArray<{ value: string; label: string }> =>
  events.map((event) => ({ value: event, label: event }));

/** Funnel builder. */
export const FunnelBuilder = defineComponent({
  name: "DemoFunnelBuilder",
  props: {
    events: { type: Array as PropType<readonly string[]>, required: true },
    /** The event selected in the strip, offered as the first step. */
    seed: { type: String as PropType<string | null>, default: null },
    /** Whether the full event list has been loaded (hides "more events"). */
    complete: { type: Boolean, default: false },
    maxSteps: { type: Number, default: MAX_STEPS },
    /**
     * Steps and window to open with (the conversion matrix hands its best
     * path over here); read once, when the builder mounts with its tab.
     */
    preset: { type: Object as PropType<FunnelDraft | null>, default: null },
  },
  emits: {
    run: (draft: FunnelDraft) => draft.steps.length >= 2,
    moreEvents: () => true,
  },
  setup(props, { emit }) {
    const steps = ref<string[]>([...(props.preset?.steps ?? [])]);
    const window = ref<ConversionWindow>(props.preset?.conversionWindow ?? 7);
    const shown = computed(() =>
      steps.value.length === 0 && props.seed !== null
        ? [props.seed]
        : steps.value,
    );
    const setStep = (index: number, event: string): void => {
      const next = [...shown.value];
      next[index] = event;
      steps.value = next;
    };
    const removeStep = (index: number): void => {
      steps.value = shown.value.filter((_, i) => i !== index);
    };
    const step = (event: string, i: number): VNode =>
      h("li", { key: i, class: "mp-step" }, [
        h("span", { class: "mp-step-n", "aria-hidden": "true" }, String(i + 1)),
        select(eventOptions(props.events), event, (next) => setStep(i, next), {
          class: "mp-select mp-select-bare",
          "aria-label": `Step ${i + 1}`,
        }),
        button("×", () => removeStep(i), {
          class: "mp-btn mp-btn-icon mp-step-remove",
          "aria-label": `Remove step ${i + 1}`,
        }),
      ]);
    return (): VNode =>
      h("div", { class: "mp-builder" }, [
        h(
          "ol",
          { class: "mp-steps" },
          shown.value.map((event, i) => step(event, i)),
        ),
        shown.value.length < props.maxSteps
          ? select(
              eventOptions(props.events),
              null,
              (event) => {
                steps.value = [...shown.value, event];
              },
              {
                // Remount after each pick so the placeholder shows again.
                key: shown.value.length,
                class: "mp-select mp-step-add",
                placeholder: "+ add step",
                "aria-label": "Add step",
              },
            )
          : null,
        props.complete
          ? null
          : button("more events…", () => emit("moreEvents"), {
              class: "mp-btn mp-btn-link",
            }),
        field(
          "Window",
          select(
            CONVERSION_WINDOWS.map((n) => ({
              value: n,
              label: `${n} day${n === 1 ? "" : "s"}`,
            })),
            window.value,
            (n) => {
              window.value = n;
            },
          ),
          INLINE,
        ),
        button(
          "Run funnel",
          () =>
            emit("run", { steps: shown.value, conversionWindow: window.value }),
          {
            class: "mp-btn mp-btn-brand",
            disabled: shown.value.length < 2,
          },
        ),
      ]);
  },
});

/** Retention builder. */
export const RetentionBuilder = defineComponent({
  name: "DemoRetentionBuilder",
  props: {
    events: { type: Array as PropType<readonly string[]>, required: true },
    /** Born event → return events with data; `null` allows any pair. */
    pairs: {
      type: Object as PropType<Readonly<
        Record<string, readonly string[]>
      > | null>,
      default: null,
    },
    seed: { type: String as PropType<string | null>, default: null },
    /**
     * A pair to open with (a row of the ranking report hands its pair over
     * here); read once, when the builder mounts with its tab.
     */
    preset: {
      type: Object as PropType<RetentionDraft | null>,
      default: null,
    },
  },
  emits: {
    run: (draft: RetentionDraft) =>
      draft.born !== "" && draft.returnEvent !== "",
  },
  setup(props, { emit }) {
    const born = ref<string | null>(props.preset?.born ?? null);
    const returnEvent = ref<string | null>(props.preset?.returnEvent ?? null);
    const unit = ref<RetentionUnit>(props.preset?.retentionUnit ?? "week");
    return (): VNode => {
      const bornEvents =
        props.pairs === null ? props.events : Object.keys(props.pairs);
      const bornValue = born.value ?? bornEvents[0] ?? null;
      const returnEvents =
        props.pairs === null || bornValue === null
          ? props.events
          : (props.pairs[bornValue] ?? []);
      const preferred = returnEvent.value ?? props.seed;
      const returnValue =
        preferred !== null && returnEvents.includes(preferred)
          ? preferred
          : (returnEvents[0] ?? null);
      return h("div", { class: "mp-builder" }, [
        field(
          "Born",
          select(eventOptions(bornEvents), bornValue, (event) => {
            born.value = event;
            returnEvent.value = null;
          }),
          INLINE,
        ),
        field(
          "Return",
          select(eventOptions(returnEvents), returnValue, (event) => {
            returnEvent.value = event;
          }),
          INLINE,
        ),
        segmented(
          RETENTION_UNITS.map((u) => ({ value: u, label: u })),
          unit.value,
          (u) => {
            unit.value = u;
          },
          "Retention unit",
        ),
        button(
          "Run retention",
          () => {
            if (bornValue !== null && returnValue !== null) {
              emit("run", {
                born: bornValue,
                returnEvent: returnValue,
                retentionUnit: unit.value,
              });
            }
          },
          {
            class: "mp-btn mp-btn-brand",
            disabled: bornValue === null || returnValue === null,
          },
        ),
      ]);
    };
  },
});
