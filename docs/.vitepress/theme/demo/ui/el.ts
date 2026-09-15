// Typed `h()` helpers for the playground's controls so the components read
// as lists of buttons, selects and fields instead of option-bag plumbing.
// Not a template DSL: each helper wraps exactly one element and takes the
// handler as a plain function.

import { h, type VNode, type VNodeChild } from "vue";

/** One entry of a select or segmented control. */
export interface Option<T extends string | number> {
  readonly value: T;
  readonly label: string;
}

/** Extra attributes a helper forwards to its element. */
export type Attrs = Readonly<Record<string, unknown>>;

/**
 * Render a `<button type="button">`.
 *
 * @param label - Button content.
 * @param onClick - Click handler.
 * @param attrs - Extra attributes (`class`, `disabled`, `title`, …).
 * @returns The button node.
 */
export function button(
  label: VNodeChild,
  onClick: () => void,
  attrs: Attrs = {},
): VNode {
  return h("button", { type: "button", class: "mp-btn", ...attrs, onClick }, [
    label,
  ]);
}

/**
 * Render a `<select>` whose change handler receives the typed option value
 * rather than the DOM string.
 *
 * @param options - The choices, in display order.
 * @param value - The selected value (`null` selects the placeholder).
 * @param onChange - Called with the picked option's value.
 * @param attrs - Extra attributes; `placeholder` adds a disabled first option.
 * @returns The select node.
 */
export function select<T extends string | number>(
  options: ReadonlyArray<Option<T>>,
  value: T | null,
  onChange: (value: T) => void,
  attrs: Attrs & { readonly placeholder?: string } = {},
): VNode {
  const { placeholder, ...rest } = attrs;
  const children = options.map((option) =>
    h(
      "option",
      { value: String(option.value), selected: option.value === value },
      option.label,
    ),
  );
  if (placeholder !== undefined) {
    children.unshift(
      h(
        "option",
        { value: "", disabled: true, selected: value === null },
        placeholder,
      ),
    );
  }
  return h(
    "select",
    {
      class: "mp-select",
      ...rest,
      onChange: (event: Event) => {
        const raw = (event.target as HTMLSelectElement).value;
        const picked = options.find((option) => String(option.value) === raw);
        if (picked !== undefined) {
          onChange(picked.value);
        }
      },
    },
    children,
  );
}

/**
 * Render a segmented control: one pressed button per option, `aria-pressed`
 * carrying the selection for assistive technology.
 *
 * @param options - The choices, in display order.
 * @param value - The selected value.
 * @param onChange - Called with the picked value.
 * @param label - Accessible name of the group.
 * @returns The group node.
 */
export function segmented<T extends string | number>(
  options: ReadonlyArray<Option<T>>,
  value: T,
  onChange: (value: T) => void,
  label: string,
): VNode {
  return h(
    "div",
    { class: "mp-segmented", role: "group", "aria-label": label },
    options.map((option) =>
      button(option.label, () => onChange(option.value), {
        class: "mp-btn mp-seg",
        "aria-pressed": option.value === value,
      }),
    ),
  );
}

/**
 * Render a caption followed by a control.
 *
 * @param caption - The visible caption.
 * @param control - The control node.
 * @returns A `<label>` wrapping both.
 */
export function field(caption: string, control: VNode): VNode {
  return h("label", { class: "mp-field" }, [
    h("span", { class: "mp-field-caption" }, caption),
    control,
  ]);
}
