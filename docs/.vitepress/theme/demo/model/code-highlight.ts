// A tokenizer for the TypeScript subset the playground emits (imports,
// `const … = await ws.method(…)`, object and array literals, comments).
// Shiki is a build-time dependency of the site and far too large to ship
// for a dozen lines of generated code; this covers exactly what
// `renderCall` and the setup snippets can produce, and degrades to `punct`
// for anything else rather than failing.

/** What a token is, for colouring. */
export type TokenType =
  "keyword" | "string" | "number" | "punct" | "ident" | "comment" | "space";

/** One token; concatenating `text` over a token list restores the input. */
export interface Token {
  readonly type: TokenType;
  readonly text: string;
}

const KEYWORDS: ReadonlySet<string> = new Set([
  "import",
  "from",
  "const",
  "let",
  "await",
  "async",
  "declare",
  "typeof",
  "new",
  "true",
  "false",
  "null",
  "undefined",
  "export",
  "type",
  "function",
  "return",
]);

/** Sticky patterns, tried in order at the current position. */
const RULES: ReadonlyArray<readonly [TokenType, RegExp]> = [
  ["comment", /\/\/[^\n]*|\/\*[\s\S]*?\*\//y],
  ["string", /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/y],
  ["number", /\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?/y],
  ["ident", /[\p{ID_Start}_$][\p{ID_Continue}$]*/uy],
  ["space", /\s+/y],
  ["punct", /[^\s\w$"'`]+/y],
];

/**
 * Tokenize a program.
 *
 * @param code - The program text.
 * @returns Tokens whose `text` concatenates back to `code`.
 */
export function tokenize(code: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < code.length) {
    let matched = false;
    for (const [type, pattern] of RULES) {
      pattern.lastIndex = index;
      const match = pattern.exec(code);
      if (match !== null && match[0].length > 0) {
        const text = match[0];
        tokens.push({
          type: type === "ident" && KEYWORDS.has(text) ? "keyword" : type,
          text,
        });
        index += text.length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      // An unterminated string or a stray character: emit it as-is so the
      // output always round-trips to the input.
      tokens.push({ type: "punct", text: code[index] ?? "" });
      index += 1;
    }
  }
  return tokens;
}
