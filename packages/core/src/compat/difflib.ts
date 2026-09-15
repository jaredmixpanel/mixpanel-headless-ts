/**
 * Faithful port of the `difflib` surface `get_close_matches` needs:
 * `SequenceMatcher` restricted to `isjunk=None, autojunk=True`, and
 * `get_close_matches` itself with its `heapq.nlargest` result order.
 *
 * Reference: CPython 3.14 `Lib/difflib.py`. Sequences are codepoint
 * arrays (Python `str` indexing is by codepoint). Autojunk is
 * implemented verbatim — it only activates when the query string is
 * >= 200 codepoints, irrelevant at enum sizes but kept for faithfulness.
 *
 * @internal
 */

import { codepoints, compareCodepoints } from "./codepoint.js";

/**
 * Faithful port of `difflib.SequenceMatcher` restricted to the
 * surface `get_close_matches` uses (`isjunk=None`, `autojunk=True`):
 * `set_seq1`/`set_seq2`, `find_longest_match`, `get_matching_blocks`,
 * `ratio`, `quick_ratio`, `real_quick_ratio`. Sequences are codepoint
 * arrays (Python `str` indexing is by codepoint, R11.6).
 *
 * Reference: CPython 3.14 `Lib/difflib.py`.
 *
 * @internal
 */
class SequenceMatcher {
  /** Sequence 1 (the candidate) as codepoints. */
  private a: readonly string[] = [];

  /** Sequence 2 (the query word) as codepoints. */
  private b: readonly string[] = [];

  /** Element → ascending indices in `b` (popular entries removed). */
  private b2j = new Map<string, number[]>();

  /** Autojunk "popular" elements excluded from `b2j`. */
  private bpopular = new Set<string>();

  /** Element → occurrence count over the FULL `b` (for quick_ratio). */
  private fullbcount: Map<string, number> | null = null;

  /** Cached matching blocks for the current (a, b) pair. */
  private matchingBlocks: ReadonlyArray<
    readonly [number, number, number]
  > | null = null;

  /**
   * Set the first sequence (the candidate string).
   *
   * @param a - Candidate string.
   */
  setSeq1(a: string): void {
    this.a = codepoints(a);
    this.matchingBlocks = null;
  }

  /**
   * Set the second sequence (the query word) and chain its index map
   * (`__chain_b`), applying the autojunk rule verbatim: when
   * `len(b) >= 200`, elements occurring more than `len(b)//100 + 1`
   * times are "popular" and dropped from `b2j`.
   *
   * @param b - Query string.
   */
  setSeq2(b: string): void {
    this.b = codepoints(b);
    this.matchingBlocks = null;
    this.fullbcount = null;
    const b2j = new Map<string, number[]>();
    for (let i = 0; i < this.b.length; i++) {
      const elt = this.b[i] as string;
      const indices = b2j.get(elt);
      if (indices === undefined) {
        b2j.set(elt, [i]);
      } else {
        indices.push(i);
      }
    }
    this.bpopular = new Set();
    const n = this.b.length;
    if (n >= 200) {
      const ntest = Math.floor(n / 100) + 1;
      for (const [elt, idxs] of b2j) {
        if (idxs.length > ntest) {
          this.bpopular.add(elt);
        }
      }
      for (const elt of this.bpopular) {
        b2j.delete(elt);
      }
    }
    this.b2j = b2j;
  }

  /**
   * Find the longest matching block in `a[alo:ahi]` / `b[blo:bhi]` —
   * verbatim port of `find_longest_match` (with `bjunk` empty, the
   * junk-extension loops reduce to no-ops and are omitted; the
   * non-junk extension loops are kept).
   *
   * @param alo - Start index in `a`.
   * @param ahi - End index (exclusive) in `a`.
   * @param blo - Start index in `b`.
   * @param bhi - End index (exclusive) in `b`.
   * @returns `[besti, bestj, bestsize]`.
   */
  private findLongestMatch(
    alo: number,
    ahi: number,
    blo: number,
    bhi: number,
  ): readonly [number, number, number] {
    const { a, b, b2j } = this;
    let besti = alo;
    let bestj = blo;
    let bestsize = 0;
    let j2len = new Map<number, number>();
    for (let i = alo; i < ahi; i++) {
      const newj2len = new Map<number, number>();
      const indices = b2j.get(a[i] as string);
      if (indices !== undefined) {
        for (const j of indices) {
          if (j < blo) {
            continue;
          }
          if (j >= bhi) {
            break;
          }
          const k = (j2len.get(j - 1) ?? 0) + 1;
          newj2len.set(j, k);
          if (k > bestsize) {
            besti = i - k + 1;
            bestj = j - k + 1;
            bestsize = k;
          }
        }
      }
      j2len = newj2len;
    }
    while (besti > alo && bestj > blo && a[besti - 1] === b[bestj - 1]) {
      besti -= 1;
      bestj -= 1;
      bestsize += 1;
    }
    while (
      besti + bestsize < ahi &&
      bestj + bestsize < bhi &&
      a[besti + bestsize] === b[bestj + bestsize]
    ) {
      bestsize += 1;
    }
    return [besti, bestj, bestsize];
  }

  /**
   * Compute (and cache) the matching blocks — verbatim port of the
   * iterative-queue `get_matching_blocks`, including the
   * adjacent-block merge and the terminating `(la, lb, 0)` sentinel.
   *
   * @returns The merged, sorted matching blocks.
   */
  private getMatchingBlocks(): ReadonlyArray<
    readonly [number, number, number]
  > {
    if (this.matchingBlocks !== null) {
      return this.matchingBlocks;
    }
    const la = this.a.length;
    const lb = this.b.length;
    const queue: Array<[number, number, number, number]> = [[0, la, 0, lb]];
    const blocks: Array<[number, number, number]> = [];
    while (queue.length > 0) {
      const [alo, ahi, blo, bhi] = queue.pop() as [
        number,
        number,
        number,
        number,
      ];
      const [i, j, k] = this.findLongestMatch(alo, ahi, blo, bhi);
      if (k > 0) {
        blocks.push([i, j, k]);
        if (alo < i && blo < j) {
          queue.push([alo, i, blo, j]);
        }
        if (i + k < ahi && j + k < bhi) {
          queue.push([i + k, ahi, j + k, bhi]);
        }
      }
    }
    blocks.sort((x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2]);
    let i1 = 0;
    let j1 = 0;
    let k1 = 0;
    const nonAdjacent: Array<readonly [number, number, number]> = [];
    for (const [i2, j2, k2] of blocks) {
      if (i1 + k1 === i2 && j1 + k1 === j2) {
        k1 += k2;
      } else {
        if (k1 > 0) {
          nonAdjacent.push([i1, j1, k1]);
        }
        i1 = i2;
        j1 = j2;
        k1 = k2;
      }
    }
    if (k1 > 0) {
      nonAdjacent.push([i1, j1, k1]);
    }
    nonAdjacent.push([la, lb, 0]);
    this.matchingBlocks = nonAdjacent;
    return nonAdjacent;
  }

  /**
   * `_calculate_ratio(matches, length)` — `2.0*M/T`, or 1.0 for two
   * empty sequences.
   *
   * @param matches - Matched element count.
   * @param length - `len(a) + len(b)`.
   * @returns The similarity ratio.
   */
  private static calculateRatio(matches: number, length: number): number {
    if (length > 0) {
      return (2.0 * matches) / length;
    }
    return 1.0;
  }

  /**
   * Exact similarity ratio over the matching blocks.
   *
   * @returns `2.0*M/T` where M sums the matched block sizes.
   */
  ratio(): number {
    let matches = 0;
    for (const block of this.getMatchingBlocks()) {
      matches += block[2];
    }
    return SequenceMatcher.calculateRatio(
      matches,
      this.a.length + this.b.length,
    );
  }

  /**
   * Upper bound on {@link ratio} from element multisets (verbatim
   * `quick_ratio`, including the `avail` bookkeeping).
   *
   * @returns The quick upper bound.
   */
  quickRatio(): number {
    if (this.fullbcount === null) {
      const counts = new Map<string, number>();
      for (const elt of this.b) {
        counts.set(elt, (counts.get(elt) ?? 0) + 1);
      }
      this.fullbcount = counts;
    }
    const fullbcount = this.fullbcount;
    const avail = new Map<string, number>();
    let matches = 0;
    for (const elt of this.a) {
      const numb = avail.has(elt)
        ? (avail.get(elt) as number)
        : (fullbcount.get(elt) ?? 0);
      avail.set(elt, numb - 1);
      if (numb > 0) {
        matches += 1;
      }
    }
    return SequenceMatcher.calculateRatio(
      matches,
      this.a.length + this.b.length,
    );
  }

  /**
   * Fastest upper bound on {@link ratio} from lengths alone.
   *
   * @returns `2*min(la, lb) / (la + lb)`.
   */
  realQuickRatio(): number {
    const la = this.a.length;
    const lb = this.b.length;
    return SequenceMatcher.calculateRatio(Math.min(la, lb), la + lb);
  }
}

/**
 * Faithful port of `difflib.get_close_matches(word, possibilities,
 * n, cutoff)` (CPython 3.14), including the `heapq.nlargest` result
 * order: descending `(ratio, candidate)` tuple comparison — ratio
 * first, then candidate string descending by codepoint on ties.
 *
 * @param word - The query word.
 * @param possibilities - Candidate strings, in the caller's order.
 * @param n - Maximum number of close matches (must be > 0).
 * @param cutoff - Similarity threshold in [0, 1].
 * @returns The best (at most `n`) matches, best first.
 * @throws RangeError - When `n <= 0` or `cutoff` is outside [0, 1]
 *   (Python raises `ValueError`; RangeError is the TS analog and no
 *   caller in this module can trigger it).
 */
export function getCloseMatches(
  word: string,
  possibilities: readonly string[],
  n = 3,
  cutoff = 0.6,
): string[] {
  if (!(n > 0)) {
    throw new RangeError(`n must be > 0: ${String(n)}`);
  }
  if (!(cutoff >= 0.0 && cutoff <= 1.0)) {
    throw new RangeError(`cutoff must be in [0.0, 1.0]: ${String(cutoff)}`);
  }
  const result: Array<[number, string]> = [];
  const s = new SequenceMatcher();
  s.setSeq2(word);
  for (const x of possibilities) {
    s.setSeq1(x);
    if (
      s.realQuickRatio() >= cutoff &&
      s.quickRatio() >= cutoff &&
      s.ratio() >= cutoff
    ) {
      result.push([s.ratio(), x]);
    }
  }
  // heapq.nlargest(n, result) == sorted(result, reverse=True)[:n];
  // tuple comparison breaks ratio ties by candidate string, and
  // Python string comparison is codepoint-wise (`compareCodepoints`
  // is 0 only for identical strings, so equal candidates keep their
  // relative order exactly like `sorted`'s stable tie).
  result.sort((p, q) => {
    if (p[0] !== q[0]) {
      return q[0] - p[0];
    }
    return compareCodepoints(q[1], p[1]);
  });
  return result.slice(0, n).map(([, x]) => x);
}
