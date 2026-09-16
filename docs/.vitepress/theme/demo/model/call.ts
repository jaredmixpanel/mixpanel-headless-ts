// The playground's single source of truth: one `Call` object is both
// rendered as TypeScript (`renderCall`) and executed against the facade
// (`runCall`). The UI never builds code strings, so "the code shown is the
// code that ran" is a property a test can check (tests/demo-calls.test.ts
// re-parses the printed arguments back into `args`).
//
// Arguments are JSON literals, plus two escape hatches that keep the
// round trip checkable: a `BindingRef` names the result of an earlier call
// (`createReportLink(result, …)` takes the `QueryResult` instance the
// previous call produced) and prints as the bare identifier; an `ExprArg`
// names a library constructor from a closed table (`Filter.equals`) and
// prints as that call over JSON-literal arguments. Both resolve at run
// time only, so `args` itself never holds a class instance.

import { Filter, type Workspace } from "@mixpanel-headless/browser";

/** A JSON value: what a playground control may put into a call. */
export type JsonLiteral =
  | string
  | number
  | boolean
  | null
  | readonly JsonLiteral[]
  | { readonly [key: string]: JsonLiteral };

/**
 * A reference to an earlier call's binding (printed as the identifier,
 * resolved from the run scope). The `$binding` key cannot collide with a
 * literal: no playground control emits `$`-prefixed keys.
 */
export interface BindingRef {
  readonly $binding: string;
}

/**
 * The library expressions a call may embed, each evaluated from JSON-literal
 * arguments. A closed table: `runCall` refuses any other `$expr` and
 * `tests/demo-calls.test.ts` pins the names. Each entry checks its own
 * arity and argument types, so a malformed expression fails here rather
 * than inside the library.
 */
const EXPRESSIONS = {
  "Filter.equals": (args: readonly JsonLiteral[]): Filter => {
    const [property, value] = args;
    if (
      args.length !== 2 ||
      typeof property !== "string" ||
      typeof value !== "string"
    ) {
      throw new Error(
        "playground: Filter.equals takes (property, value) strings",
      );
    }
    return Filter.equals(property, value);
  },
} as const;

/** The expression names the table knows. */
export const EXPR_NAMES = Object.keys(EXPRESSIONS) as readonly ExprName[];

/** Member of the expression table. */
export type ExprName = keyof typeof EXPRESSIONS;

/**
 * A library expression: printed as `<$expr>(<args>)`, evaluated through the
 * expression table at run time. Like {@link BindingRef}, the `$`-prefixed
 * key cannot collide with a literal.
 */
export interface ExprArg {
  readonly $expr: ExprName;
  readonly args: readonly JsonLiteral[];
}

/**
 * One call argument: a literal, a reference to a prior result, or an
 * expression — the latter two also anywhere inside a literal object or
 * array (an option bag holds `where: Filter.equals(…)`).
 */
export type CallArg =
  | JsonLiteral
  | BindingRef
  | ExprArg
  | readonly CallArg[]
  | { readonly [key: string]: CallArg };

/**
 * The facade methods the playground may invoke. A closed list of read
 * methods (plus `createReportLink`, the one POST — it creates an unsaved
 * report record under a slug, never a bookmark); `runCall` refuses anything
 * else at runtime and `tests/demo-calls.test.ts` pins the list.
 */
export const READ_METHODS = [
  "topEvents",
  "events",
  "properties",
  "propertyValues",
  "query",
  "queryFunnel",
  "queryRetention",
  "createReportLink",
] as const;

/** Member of {@link READ_METHODS}. */
export type ReadMethod = (typeof READ_METHODS)[number];

/** A facade call: rendered and executed from the same object. */
export interface Call {
  /** Facade method name. */
  readonly method: ReadMethod;
  /** Positional arguments, in call order. */
  readonly args: readonly CallArg[];
  /** The `const` name the rendered line binds the result to. */
  readonly binding: string;
  /**
   * Names the setup's import line must add for the rendered statement to
   * compile (`Filter` for a filtered query); empty for a plain call.
   */
  readonly imports: readonly string[];
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/u;
const INLINE_ARRAY_MAX = 60;

/**
 * Whether a call argument is a {@link BindingRef}.
 *
 * @param arg - The argument.
 * @returns `true` for a binding reference.
 */
export function isBindingRef(arg: CallArg): arg is BindingRef {
  return (
    typeof arg === "object" &&
    arg !== null &&
    !Array.isArray(arg) &&
    "$binding" in arg &&
    typeof arg["$binding"] === "string"
  );
}

/**
 * Whether a call argument is an {@link ExprArg}.
 *
 * @param arg - The argument.
 * @returns `true` for an expression.
 */
export function isExprArg(arg: CallArg): arg is ExprArg {
  return (
    typeof arg === "object" &&
    arg !== null &&
    !Array.isArray(arg) &&
    "$expr" in arg &&
    typeof arg["$expr"] === "string" &&
    Array.isArray((arg as { readonly args?: unknown }).args)
  );
}

/**
 * Print one argument as a TypeScript literal in the site's Prettier style:
 * double quotes, unquoted identifier keys, 2-space indent, trailing commas,
 * objects always one key per line, arrays inline when short.
 *
 * @param arg - The argument.
 * @param depth - Indentation depth of the line the literal starts on (a
 *   literal nested two calls deep prints its keys at depth 3).
 * @returns The literal text, without a trailing newline.
 * @example
 * ```ts
 * printArg({ retention_unit: "week", last: 30 }, 1);
 * // "{\n    retention_unit: \"week\",\n    last: 30,\n  }"
 * ```
 */
export function printArg(arg: CallArg, depth = 0): string {
  if (isBindingRef(arg)) {
    return arg.$binding;
  }
  if (isExprArg(arg)) {
    return `${arg.$expr}(${arg.args.map((item) => printArg(item, depth)).join(", ")})`;
  }
  if (arg === null || typeof arg !== "object") {
    return JSON.stringify(arg);
  }
  const pad = "  ".repeat(depth + 1);
  const close = "  ".repeat(depth);
  if (Array.isArray(arg)) {
    const items = (arg as readonly CallArg[]).map((item) =>
      printArg(item, depth + 1),
    );
    const inline = `[${items.join(", ")}]`;
    if (inline.length <= INLINE_ARRAY_MAX && !inline.includes("\n")) {
      return inline;
    }
    return `[\n${items.map((item) => `${pad}${item},\n`).join("")}${close}]`;
  }
  const entries = Object.entries(arg as Record<string, CallArg>);
  if (entries.length === 0) {
    return "{}";
  }
  const lines = entries.map(([key, value]) => {
    const printedKey = IDENTIFIER.test(key) ? key : JSON.stringify(key);
    return `${pad}${printedKey}: ${printArg(value, depth + 1)},\n`;
  });
  return `{\n${lines.join("")}${close}}`;
}

/**
 * Print a call's argument list (the text between the parentheses).
 *
 * @param args - The arguments.
 * @returns Comma-separated literals.
 */
export function printArgs(args: readonly CallArg[]): string {
  return args.map((arg) => printArg(arg)).join(", ");
}

/**
 * Render a call as the one TypeScript statement the playground shows.
 *
 * @param call - The call.
 * @returns `const <binding> = await ws.<method>(<args>);`
 */
export function renderCall(call: Call): string {
  return `const ${call.binding} = await ws.${call.method}(${printArgs(call.args)});`;
}

/**
 * Turn one printed argument into the value the facade receives: refs from
 * the scope, expressions through the table, literals copied with their
 * nested refs and expressions resolved.
 *
 * @param arg - The argument.
 * @param scope - Earlier results by binding name.
 * @returns The runtime value.
 * @throws Error - When a ref is unbound or an expression name is unknown.
 */
function resolveArg(
  arg: CallArg,
  scope: Readonly<Record<string, unknown>>,
): unknown {
  if (isBindingRef(arg)) {
    if (!Object.hasOwn(scope, arg.$binding)) {
      throw new Error(`playground: no result bound to ${arg.$binding}`);
    }
    return scope[arg.$binding];
  }
  if (isExprArg(arg)) {
    if (!Object.hasOwn(EXPRESSIONS, arg.$expr)) {
      throw new Error(
        `playground: expression ${String(arg.$expr)} is not allowed`,
      );
    }
    return EXPRESSIONS[arg.$expr](arg.args);
  }
  if (arg === null || typeof arg !== "object") {
    return arg;
  }
  if (Array.isArray(arg)) {
    return (arg as readonly CallArg[]).map((item) => resolveArg(item, scope));
  }
  return Object.fromEntries(
    Object.entries(arg as Record<string, CallArg>).map(([key, value]) => [
      key,
      resolveArg(value, scope),
    ]),
  );
}

/**
 * Execute a call against a facade — the same object `renderCall` printed.
 *
 * @param ws - The workspace (offline or live; the UI never cares which).
 * @param call - The call.
 * @param scope - Earlier results by binding name, for {@link BindingRef} arguments.
 * @returns Whatever the facade method resolves to (`QueryResult`, `TopEvent[]`, …).
 * @throws Error - When the method is not in {@link READ_METHODS}, a ref is
 *   unbound or an expression is not in the table.
 */
export async function runCall(
  ws: Workspace,
  call: Call,
  scope: Readonly<Record<string, unknown>> = {},
): Promise<unknown> {
  if (!(READ_METHODS as readonly string[]).includes(call.method)) {
    throw new Error(`playground: method ${call.method} is not allowed`);
  }
  const args = call.args.map((arg) => resolveArg(arg, scope));
  const method = ws[call.method] as (...a: unknown[]) => Promise<unknown>;
  return method.apply(ws, args);
}
