/**
 * Barrel of the `types` module: three families of data shapes plus the
 * vocabulary they share. Entities (`./entities`) are the App API request
 * and response dataclasses (`Dashboard`, `CreateDashboardParams`);
 * results (`./results`, exported from the package barrel) are the shaped
 * return values of the query methods (`QueryResult` with `toRows()`);
 * query params (`./query-params`) are what callers pass into a query
 * (`Filter`, `CohortDefinition`). Literal unions, enum tables and the
 * report-link types complete the set.
 *
 * Naming: these shapes mirror Python data 1:1, so their property names
 * keep Python's snake_case — entity, result and query-param fields,
 * bookmark params, and the option bags that map onto a Python method's
 * keyword arguments. Identifiers rather than data (classes, methods,
 * builders, constructor/config bags such as `WorkspaceOptions`) are
 * camelCase. See README "Naming".
 *
 * @see mixpanel_headless.types
 */
export * from "./entities/index.js";
export * from "./enums.js";
export * from "./literals.js";
export * from "./query-params/index.js";
export * from "./report-links.js";
