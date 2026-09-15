/**
 * The eight Python `Enum` classes of `mixpanel_headless.types`, each as
 * an `as const` object plus a literal union under the same name. Member
 * values are byte-identical to Python's; no TS `enum` syntax is used, so
 * the module is erasable (`erasableSyntaxOnly`), and the one `IntEnum`
 * (`AlertFrequencyPreset`) keeps its numeric values.
 *
 * Hand-written, machine-verified: `conformance-runner/test/literal-alias-lock.test.ts`
 * asserts member-set equality against the `enums` section of
 * `conformance-runner/corpus/contract/literal-aliases.json`. Member order
 * mirrors Python declaration order; serialization compares values only.
 *
 * @see mixpanel_headless.types.FeatureFlagStatus
 */

/**
 * Lifecycle state of a feature flag.
 *
 * Members: `ENABLED` (active, serving variants), `DISABLED` (inactive,
 * default state), `ARCHIVED` (soft-deleted, excluded from default
 * listings).
 */
export const FeatureFlagStatus = {
  ENABLED: "enabled",
  DISABLED: "disabled",
  ARCHIVED: "archived",
} as const;

/** String literal union of {@link FeatureFlagStatus} values. */
export type FeatureFlagStatus =
  (typeof FeatureFlagStatus)[keyof typeof FeatureFlagStatus];

/**
 * Controls how flag values are delivered to clients.
 *
 * Members: `CLIENT` (client-side evaluation, default), `SERVER`
 * (server-side only), `REMOTE_OR_LOCAL` (remote preferred, local
 * fallback), `REMOTE_ONLY` (remote evaluation only).
 */
export const ServingMethod = {
  CLIENT: "client",
  SERVER: "server",
  REMOTE_OR_LOCAL: "remote_or_local",
  REMOTE_ONLY: "remote_only",
} as const;

/** String literal union of {@link ServingMethod} values. */
export type ServingMethod = (typeof ServingMethod)[keyof typeof ServingMethod];

/**
 * Account-level flag contract status.
 *
 * Members: `ACTIVE`, `GRACE_PERIOD`, `EXPIRED`.
 */
export const FlagContractStatus = {
  ACTIVE: "active",
  GRACE_PERIOD: "grace_period",
  EXPIRED: "expired",
} as const;

/** String literal union of {@link FlagContractStatus} values. */
export type FlagContractStatus =
  (typeof FlagContractStatus)[keyof typeof FlagContractStatus];

/**
 * Lifecycle state of an experiment.
 *
 * State transitions: `draft` → `active` (launch) → `concluded`
 * (conclude) → `success` | `fail` (decide).
 */
export const ExperimentStatus = {
  DRAFT: "draft",
  ACTIVE: "active",
  CONCLUDED: "concluded",
  SUCCESS: "success",
  FAIL: "fail",
} as const;

/** String literal union of {@link ExperimentStatus} values. */
export type ExperimentStatus =
  (typeof ExperimentStatus)[keyof typeof ExperimentStatus];

/**
 * Authentication type for webhooks.
 *
 * Members: `BASIC` (HTTP Basic authentication).
 */
export const WebhookAuthType = {
  BASIC: "basic",
} as const;

/** String literal union of {@link WebhookAuthType} values. */
export type WebhookAuthType =
  (typeof WebhookAuthType)[keyof typeof WebhookAuthType];

/**
 * Preset frequency values for alert check intervals, in seconds.
 * Python `IntEnum` → `const` object + numeric literal union,
 * preserving the numeric values.
 *
 * Members: `HOURLY` (3600), `DAILY` (86400), `WEEKLY` (604800).
 */
export const AlertFrequencyPreset = {
  HOURLY: 3600,
  DAILY: 86400,
  WEEKLY: 604800,
} as const;

/** Numeric literal union of {@link AlertFrequencyPreset} values. */
export type AlertFrequencyPreset =
  (typeof AlertFrequencyPreset)[keyof typeof AlertFrequencyPreset];

/**
 * Resource type for property definitions.
 *
 * Members: `EVENT`, `USER`, `GROUPPROFILE` (wire format
 * `"groupprofile"`).
 */
export const PropertyResourceType = {
  EVENT: "event",
  USER: "user",
  GROUPPROFILE: "groupprofile",
} as const;

/** String literal union of {@link PropertyResourceType} values. */
export type PropertyResourceType =
  (typeof PropertyResourceType)[keyof typeof PropertyResourceType];

/**
 * Resource type for custom properties.
 *
 * Members: `EVENTS`, `PEOPLE`, `GROUP_PROFILES`.
 */
export const CustomPropertyResourceType = {
  EVENTS: "events",
  PEOPLE: "people",
  GROUP_PROFILES: "group_profiles",
} as const;

/** String literal union of {@link CustomPropertyResourceType} values. */
export type CustomPropertyResourceType =
  (typeof CustomPropertyResourceType)[keyof typeof CustomPropertyResourceType];

/** One entry of the {@link ENUM_TABLES} serialization view. */
export interface EnumTableEntry {
  /** `'str'` for the string enums, `'int'` for the IntEnum port. */
  readonly kind: "str" | "int";
  /** Member name → member value, exactly as Python declares them. */
  readonly members: Readonly<Record<string, string | number>>;
}

/**
 * Serialization view of every ported enum class for the lock test:
 * class name → `{kind, members}`. Built by spreading the live enum
 * objects so this registry cannot drift from the declarations above.
 */
export const ENUM_TABLES: ReadonlyMap<string, EnumTableEntry> = new Map<
  string,
  EnumTableEntry
>([
  ["FeatureFlagStatus", { kind: "str", members: { ...FeatureFlagStatus } }],
  ["ServingMethod", { kind: "str", members: { ...ServingMethod } }],
  ["FlagContractStatus", { kind: "str", members: { ...FlagContractStatus } }],
  ["ExperimentStatus", { kind: "str", members: { ...ExperimentStatus } }],
  ["WebhookAuthType", { kind: "str", members: { ...WebhookAuthType } }],
  [
    "AlertFrequencyPreset",
    { kind: "int", members: { ...AlertFrequencyPreset } },
  ],
  [
    "PropertyResourceType",
    { kind: "str", members: { ...PropertyResourceType } },
  ],
  [
    "CustomPropertyResourceType",
    { kind: "str", members: { ...CustomPropertyResourceType } },
  ],
]);
