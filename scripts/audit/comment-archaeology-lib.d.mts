// Hand-written declarations for comment-archaeology-lib.mjs so the TypeScript
// unit tests can import it under NodeNext without `allowJs`.
import type { ScriptKind } from "typescript";

export interface BannedToken {
  readonly name: string;
  readonly re: RegExp;
}

export interface WhitelistRule {
  readonly name: string;
  readonly files: RegExp;
  readonly pattern: RegExp;
}

export interface TokenMatch {
  readonly token: string;
  readonly index: number;
  readonly length: number;
  readonly match: string;
}

export type CommentKind = "line" | "block" | "jsdoc";

export interface CommentRange {
  readonly pos: number;
  readonly end: number;
  readonly kind: CommentKind;
  readonly text: string;
}

export interface TestTitle {
  readonly pos: number;
  readonly end: number;
  readonly text: string;
}

export interface Hit {
  readonly line: number;
  readonly col: number;
  readonly token: string;
  readonly kind: CommentKind | "title";
  readonly text: string;
  readonly pos: number;
}

export interface ScanOptions {
  readonly filePath?: string;
  readonly scriptKind?: ScriptKind;
}

export interface ScanResult {
  readonly hits: Hit[];
  readonly comments: CommentRange[];
  readonly titles: TestTitle[];
}

export interface LineFix {
  readonly line: string;
  readonly count: number;
}

export interface MarkerFix {
  readonly line: string | null;
  readonly changed: boolean;
  readonly deleted: boolean;
}

export interface Change {
  readonly line: number;
  readonly before: string;
  readonly after: string | null;
}

export interface RewriteResult {
  readonly text: string;
  readonly counts: Record<string, number>;
  readonly changes: Change[];
}

export const BANNED_TOKENS: readonly BannedToken[];
export const WHITELIST: readonly WhitelistRule[];
export const RATIONALE_RE: RegExp;
export const FIX_RULES: readonly string[];

export function hasRationale(text: string): boolean;
export function isDottedSegment(
  text: string,
  start: number,
  end: number,
): boolean;
export function findBannedTokens(
  line: string,
  options?: { readonly filePath?: string },
): TokenMatch[];
export function scriptKindFor(filePath: string): ScriptKind;
export function extractComments(
  text: string,
  scriptKind?: ScriptKind,
): CommentRange[];
export function extractTestTitles(
  text: string,
  scriptKind?: ScriptKind,
): TestTitle[];
export function scanSource(text: string, options?: ScanOptions): ScanResult;
export function fixBareIdParentheticals(line: string): LineFix;
export function fixPyLineRefs(line: string): LineFix;
export function fixOwnershipMarker(line: string): MarkerFix;
export function looksBroken(
  before: string,
  after: string,
  kind: CommentKind,
): boolean;
export function rewriteSource(
  text: string,
  options?: ScanOptions,
): RewriteResult;
