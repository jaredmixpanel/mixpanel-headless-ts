/**
 * The 8 Python `Enum` classes from `src/mixpanel_headless/types.py`
 * (phase2-design C2, rulebook R4.3): the 7 `str` enums become TS string
 * enums (closed wire domains referenced by member NAME at Python call
 * sites), and the one `IntEnum` (`AlertFrequencyPreset`) becomes a
 * `const` object + numeric literal union, preserving numeric values.
 *
 * Hand-written source, machine-verified sync: the C8(d) lock test
 * (`conformance-runner/test/literal-alias-lock.test.ts`) asserts
 * member-set equality against the `enums` section of the generated
 * contract artifact
 * `conformance-runner/corpus/contract/literal-aliases.json`. Member
 * order mirrors Python declaration order.
 *
 * Enum snapshot/serialization compares VALUES, not the TS-side
 * representation (phase2-design C2 ruling on R4.3).
 */

/**
 * Lifecycle state of a feature flag.
 *
 * Members: `ENABLED` (active, serving variants), `DISABLED` (inactive,
 * default state), `ARCHIVED` (soft-deleted, excluded from default
 * listings).
 */
export enum FeatureFlagStatus {
  ENABLED = "enabled",
  DISABLED = "disabled",
  ARCHIVED = "archived",
}

/**
 * Controls how flag values are delivered to clients.
 *
 * Members: `CLIENT` (client-side evaluation, default), `SERVER`
 * (server-side only), `REMOTE_OR_LOCAL` (remote preferred, local
 * fallback), `REMOTE_ONLY` (remote evaluation only).
 */
export enum ServingMethod {
  CLIENT = "client",
  SERVER = "server",
  REMOTE_OR_LOCAL = "remote_or_local",
  REMOTE_ONLY = "remote_only",
}

/**
 * Account-level flag contract status.
 *
 * Members: `ACTIVE`, `GRACE_PERIOD`, `EXPIRED`.
 */
export enum FlagContractStatus {
  ACTIVE = "active",
  GRACE_PERIOD = "grace_period",
  EXPIRED = "expired",
}

/**
 * Lifecycle state of an experiment.
 *
 * State transitions: `draft` → `active` (launch) → `concluded`
 * (conclude) → `success` | `fail` (decide).
 */
export enum ExperimentStatus {
  DRAFT = "draft",
  ACTIVE = "active",
  CONCLUDED = "concluded",
  SUCCESS = "success",
  FAIL = "fail",
}

/**
 * Authentication type for webhooks.
 *
 * Members: `BASIC` (HTTP Basic authentication).
 */
export enum WebhookAuthType {
  BASIC = "basic",
}

/**
 * Preset frequency values for alert check intervals, in seconds.
 * Python `IntEnum` → `const` object + numeric literal union (R4.3),
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
export enum PropertyResourceType {
  EVENT = "event",
  USER = "user",
  GROUPPROFILE = "groupprofile",
}

/**
 * Resource type for custom properties.
 *
 * Members: `EVENTS`, `PEOPLE`, `GROUP_PROFILES`.
 */
export enum CustomPropertyResourceType {
  EVENTS = "events",
  PEOPLE = "people",
  GROUP_PROFILES = "group_profiles",
}

/** One entry of the {@link ENUM_TABLES} serialization view. */
export interface EnumTableEntry {
  /** `'str'` for the string enums, `'int'` for the IntEnum port. */
  readonly kind: "str" | "int";
  /** Member NAME → member VALUE, exactly as Python declares them. */
  readonly members: Readonly<Record<string, string | number>>;
}

/**
 * Serialization view of every ported enum class for the C8(d) lock
 * test: class name → `{kind, members}`. Built by spreading the live
 * enum objects so this registry cannot drift from the declarations
 * above. `ReadonlyMap` per R4.8.
 *
 * @internal
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
