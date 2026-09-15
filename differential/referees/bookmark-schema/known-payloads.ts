/**
 * Known referee payloads — a positive/negative triple taken from recorded
 * `build_params` outputs and verified against the live schema with
 * Python's `jsonschema.Draft202012Validator`. The TS referee's unit test
 * replays exactly this triple; any verdict flip means the ajv harness
 * diverges from the verified Python behavior or the vendored schema
 * changed.
 */

/** JSON-shaped payload type (the referee accepts any JSON value). */
export type JsonObject = Record<string, unknown>;

/**
 * Minimal valid insights payload. Note the explicit `"type": "metric"` on
 * the show clause — required in practice because the `ShowClause` `oneOf`
 * can multi-match when `type` is omitted.
 */
export const KNOWN_VALID_INSIGHTS_PAYLOAD: JsonObject = {
  displayOptions: { chartType: "line" },
  sections: {
    show: [
      {
        type: "metric",
        behavior: { type: "event", name: "Login" },
        measurement: { math: "total" },
      },
    ],
    time: [
      {
        dateRangeType: "in the last",
        unit: "day",
        window: { unit: "day", value: 30 },
      },
    ],
  },
};

/**
 * Deep-clone a JSON object (payload derivation helper).
 *
 * @param value - JSON object to clone.
 * @returns An independent structural copy.
 */
function cloneJson(value: JsonObject): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

/**
 * Negative control 1: `displayOptions.chartType` set to a value outside the
 * `ChartType` enum. Expected verdict: REJECT (enum violation).
 */
export const KNOWN_INVALID_CHART_TYPE_PAYLOAD: JsonObject = (() => {
  const bad = cloneJson(KNOWN_VALID_INSIGHTS_PAYLOAD);
  (bad["displayOptions"] as JsonObject)["chartType"] = "nonsense-chart";
  return bad;
})();

/**
 * Negative control 2: an extra unknown root key. Expected verdict: REJECT
 * (root `additionalProperties: false`).
 */
export const KNOWN_INVALID_EXTRA_ROOT_KEY_PAYLOAD: JsonObject = (() => {
  const bad = cloneJson(KNOWN_VALID_INSIGHTS_PAYLOAD);
  bad["surprise"] = 1;
  return bad;
})();
