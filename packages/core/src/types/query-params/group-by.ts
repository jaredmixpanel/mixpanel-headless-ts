/**
 * Property-breakdown query-param type — TS port of `types.GroupBy`
 * (phase2-design C7, packet P2-5a).
 *
 * Guard blocks are transcribed from the Python `__post_init__` IN SOURCE
 * ORDER (Risk #1), one comment per registry code.
 */

import { pythonStrip } from "../../compat/index.js";
import { ParamValidationError } from "../../errors.js";
import type { CustomPropertyType } from "../literals.js";
import { ListItemGroupMode, type PropertySpec } from "./filter.js";

/** Declared constructor fields of {@link GroupBy} (Python field order). */
export interface GroupByFields {
  /** Property to break down by (name, ref, or inline). */
  readonly property: PropertySpec;
  /** Data type of the property. Default: `"string"`. */
  readonly property_type?: CustomPropertyType;
  /** Bucket width for numeric properties. Default: `null`. */
  readonly bucket_size?: number | null;
  /** Minimum value for numeric buckets. Default: `null`. */
  readonly bucket_min?: number | null;
  /** Maximum value for numeric buckets. Default: `null`. */
  readonly bucket_max?: number | null;
  /** List-item breakdown discriminator. Default: `null`. */
  readonly _list_item_mode?: ListItemGroupMode | null;
}

/**
 * Specifies a property breakdown with optional numeric bucketing — TS
 * port of `types.GroupBy`.
 *
 * String properties are broken down by distinct values; numeric
 * properties can be bucketed into ranges. List-item breakdowns are
 * constructed via {@link listItem}.
 */
export class GroupBy {
  /** Property to break down by (name, ref, or inline). */
  readonly property: PropertySpec;

  /**
   * Data type of the property (one of the four scalar types).
   *
   * List-item breakdowns set `_list_item_mode` instead — the wire
   * builder hardcodes `propertyType: "object"` for that branch
   * independently of this field.
   */
  readonly property_type: CustomPropertyType;

  /** Bucket width for numeric properties. */
  readonly bucket_size: number | null;

  /** Minimum value for numeric buckets. */
  readonly bucket_min: number | null;

  /** Maximum value for numeric buckets. */
  readonly bucket_max: number | null;

  /**
   * List-item breakdown discriminator; set by {@link listItem}.
   *
   * @internal Codec-visible under its exact Python spelling.
   */
  readonly _list_item_mode: ListItemGroupMode | null;

  /**
   * Create a breakdown (guards fire exactly as Python's
   * `__post_init__`).
   *
   * @param fields - Declared fields; absent optionals take the Python
   *   defaults.
   * @throws ParamValidationError - `GB1_EMPTY_PROPERTY`,
   *   `V12_BUCKET_SIZE_POSITIVE`, `V18_BUCKET_ORDER`,
   *   `GB4_LIST_ITEM_BUCKETING`, `GB5_LIST_ITEM_PROPERTY_TYPE`
   *   (transcribed in Python source order).
   */
  constructor(fields: GroupByFields) {
    this.property = fields.property;
    this.property_type = fields.property_type ?? "string";
    this.bucket_size = fields.bucket_size ?? null;
    this.bucket_min = fields.bucket_min ?? null;
    this.bucket_max = fields.bucket_max ?? null;
    this._list_item_mode = fields._list_item_mode ?? null;
    // GB1_EMPTY_PROPERTY: a plain-string property must be non-blank.
    if (typeof this.property === "string" && !pythonStrip(this.property)) {
      throw new ParamValidationError(
        "GroupBy.property must be a non-empty string",
        "GB1_EMPTY_PROPERTY",
      );
    }
    // V12_BUCKET_SIZE_POSITIVE: bucket_size must be positive when set.
    if (this.bucket_size !== null && this.bucket_size <= 0) {
      throw new ParamValidationError(
        `GroupBy.bucket_size must be positive, got ${String(this.bucket_size)}`,
        "V12_BUCKET_SIZE_POSITIVE",
      );
    }
    // V18_BUCKET_ORDER: bucket_min must be less than bucket_max.
    if (
      this.bucket_min !== null &&
      this.bucket_max !== null &&
      this.bucket_min >= this.bucket_max
    ) {
      throw new ParamValidationError(
        `GroupBy.bucket_min (${String(this.bucket_min)}) must be less than ` +
          `bucket_max (${String(this.bucket_max)})`,
        "V18_BUCKET_ORDER",
      );
    }
    if (this._list_item_mode !== null) {
      // GB4_LIST_ITEM_BUCKETING: list-item mode excludes bucketing.
      if (
        [this.bucket_size, this.bucket_min, this.bucket_max].some(
          (bucket) => bucket !== null,
        )
      ) {
        throw new ParamValidationError(
          "GroupBy.list_item is incompatible with bucketing",
          "GB4_LIST_ITEM_BUCKETING",
        );
      }
      // GB5_LIST_ITEM_PROPERTY_TYPE: list-item mode requires a plain
      // string property.
      if (typeof this.property !== "string") {
        throw new ParamValidationError(
          "GroupBy.list_item requires property to be a plain str, " +
            `got ${this.property.constructor.name}`,
          "GB5_LIST_ITEM_PROPERTY_TYPE",
        );
      }
    }
  }

  /**
   * Break down by a subproperty of objects inside a list property —
   * port of `GroupBy.list_item`.
   *
   * @param property - Name of the list-of-object property.
   * @param sub - Subproperty name to break down by.
   * @param options - Optional bag: `sub_type` (default `"string"`).
   * @returns GroupBy whose serialization emits a `listItemGroup`
   *   structure in the bookmark JSON.
   * @throws ParamValidationError - `LG1_EMPTY_SUB`/`LG2_INVALID_SUB_TYPE`
   *   via the `ListItemGroupMode` constructor, or any `GroupBy`
   *   constructor guard.
   * @example
   * ```typescript
   * const g = GroupBy.listItem("cart", "Brand");
   * // g._list_item_mode: ListItemGroupMode { sub: "Brand", sub_type: "string" }
   * ```
   */
  static listItem(
    property: string,
    sub: string,
    options?: { readonly sub_type?: CustomPropertyType },
  ): GroupBy {
    return new GroupBy({
      property,
      _list_item_mode: new ListItemGroupMode({
        sub,
        sub_type: options?.sub_type ?? "string",
      }),
    });
  }
}
