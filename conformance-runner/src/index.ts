/**
 * conformance-runner — replays the Python-extracted conformance corpus
 * against the TS port (design D12). Loader/codecs/api-map are TS-4;
 * VectorFetch + runner + reporting land in TS-5.
 */

/** Package name constant exercised by the skeleton smoke test. */
export const RUNNER_PACKAGE_NAME = "@mixpanel-headless/conformance-runner";

export * from "./api-map-types.js";
export * from "./api-map.js";
export * from "./bindings.js";
export * from "./codecs.js";
export * from "./interactions.js";
export * from "./json-value.js";
export * from "./loader.js";
export * from "./lossless-json.js";
export * from "./naming.js";
export * from "./request-diff.js";
export * from "./runner.js";
export * from "./shims.js";
export * from "./transport-errors.js";
export * from "./vector-fetch.js";
export * from "./vector-types.js";
export * from "./verdicts.js";
