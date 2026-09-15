/**
 * Barrel for the `types` module of @mixpanel-headless/core (D11
 * layout). Phase-2 P2-3 adds the literal-alias unions and the Python
 * Enum-class ports; later Phase-2 packets add query-params, results,
 * and entities.
 *
 * Naming: the shapes exported here mirror Python data 1:1, so their
 * property names keep Python's snake_case spelling — entity, result and
 * query-param fields, bookmark params, and the option bags that map onto a
 * Python method's keyword arguments. Everything that is an identifier
 * rather than data (classes, methods, builders, constructor/config option
 * bags such as `WorkspaceOptions`) is camelCase. See README "Naming".
 */
export * from "./entities/index.js";
export * from "./enums.js";
export * from "./literals.js";
export * from "./query-params/index.js";
export * from "./report-links.js";
export * from "./results/index.js";
