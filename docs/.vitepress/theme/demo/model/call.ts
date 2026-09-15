// The playground's single source of truth: one `Call` object is both
// rendered as TypeScript (`renderCall`) and executed against the facade
// (`runCall`). The UI never builds code strings, so "the code shown is the
// code that ran" is a property a test can check (tests/demo-calls.test.ts
// re-parses the printed arguments back into `args`).
//
// Arguments are JSON literals, plus one escape hatch: a `BindingRef` names
// the result of an earlier call (`createReportLink(result, …)` takes the
// `QueryResult` instance the previous call produced). A ref prints as the
// bare identifier and resolves from the `scope` handed to `runCall`.

import type { Workspace } from "@mixpanel-headless/browser";

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

/** One call argument: a literal or a reference to a prior result. */
export type CallArg = JsonLiteral | BindingRef;

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
 * Print one argument as a TypeScript literal in the site's Prettier style:
 * double quotes, unquoted identifier keys, 2-space indent, trailing commas,
 * objects always one key per line, arrays inline when short.
 *
 * @param arg - The argument.
 * @param depth - Current indentation depth (nesting level).
 * @returns The literal text, without a trailing newline.
 */
function printArg(arg: CallArg, depth = 0): string {
  if (isBindingRef(arg)) {
    return arg.$binding;
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
 * Execute a call against a facade — the same object `renderCall` printed.
 *
 * @param ws - The workspace (offline or live; the UI never cares which).
 * @param call - The call.
 * @param scope - Earlier results by binding name, for {@link BindingRef} arguments.
 * @returns Whatever the facade method resolves to (`QueryResult`, `TopEvent[]`, …).
 * @throws Error - When the method is not in {@link READ_METHODS} or a ref is unbound.
 */
export async function runCall(
  ws: Workspace,
  call: Call,
  scope: Readonly<Record<string, unknown>> = {},
): Promise<unknown> {
  if (!(READ_METHODS as readonly string[]).includes(call.method)) {
    throw new Error(`playground: method ${call.method} is not allowed`);
  }
  const args = call.args.map((arg) => {
    if (!isBindingRef(arg)) {
      return arg;
    }
    if (!Object.hasOwn(scope, arg.$binding)) {
      throw new Error(`playground: no result bound to ${arg.$binding}`);
    }
    return scope[arg.$binding];
  });
  const method = ws[call.method] as (...a: unknown[]) => Promise<unknown>;
  return method.apply(ws, args);
}
