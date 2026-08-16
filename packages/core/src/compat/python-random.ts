/**
 * CPython `random.Random` parity — the MT19937 core plus the two
 * methods the port needs (`getrandbits`, `_randbelow`, `sample`).
 *
 * Added at B5-S3 for `ReplayBundle.sample(n, seed)`
 * (`types.py:13808-13831`), the packet's **S3-D1** decision
 * (`b5-packets.md:529-540`): port CPython parity rather than
 * substituting a different PRNG, so a seeded sample produces the SAME
 * selection in both runtimes. The alternative — "same-seed
 * self-consistency only" — is all the Layer-3 test locks
 * (`test_replay_bundle.py:448-449`), but a divergent selection would be
 * a silent behavioural fork and would need a sanctioned-deviation
 * filing. Locked by pinned CPython probe outputs
 * (`test/compat/python-random.test.ts`).
 *
 * Scope: INTEGER (and `null`) seeds only — the `str`/`bytes` seeding
 * paths hash through CPython's SipHash and are unreachable from this
 * port's surface (`sample(n, seed: number | null)`). A `null` seed
 * means "unseeded"; the caller supplies the entropy source, matching
 * Python's `random.Random(None)` → `urandom`.
 *
 * Reference: CPython `Modules/_randommodule.c` (`init_genrand`,
 * `init_by_array`, `genrand_uint32`, `random_seed`,
 * `_random_Random_getrandbits_impl`) and `Lib/random.py`
 * (`_randbelow_with_getrandbits`, `Random.sample`).
 */

import { MixpanelHeadlessError } from "../errors.js";

/** MT19937 state size in 32-bit words (`N` in `_randommodule.c`). */
const N = 624;

/** MT19937 recurrence offset (`M`). */
const M = 397;

/** Constant vector `a` — `MATRIX_A`. */
const MATRIX_A = 0x9908b0df;

/** Most significant `w-r` bits — `UPPER_MASK`. */
const UPPER_MASK = 0x80000000;

/** Least significant `r` bits — `LOWER_MASK`. */
const LOWER_MASK = 0x7fffffff;

/** 2^32, for the unsigned wrap arithmetic. */
const TWO32 = 0x100000000n;

/**
 * The CPython Mersenne Twister, exposing exactly the surface
 * `random.Random` builds on.
 */
export class PythonRandom {
  /** The 624-word state vector (`self->state`). */
  readonly #mt = new Uint32Array(N);

  /** Index into {@link mt} (`self->index`). */
  #index = N + 1;

  /**
   * Seed the generator the way `random.Random(seed)` does.
   *
   * @param seed - A non-negative or negative integer (CPython takes the
   *   absolute value), or `null` for "unseeded" — in which case the
   *   caller MUST supply `entropy` (32-bit words) standing in for
   *   `os.urandom`.
   * @param entropy - The word array to seed with when `seed` is `null`.
   * @throws MixpanelHeadlessError - Code `PY_RANDOM_SEED_UNSUPPORTED`
   *   when `seed` is `null` and no entropy was supplied, or when the
   *   seed is not a safe integer.
   */
  constructor(seed: number | null, entropy?: readonly number[]) {
    if (seed === null) {
      if (entropy === undefined || entropy.length === 0) {
        throw new MixpanelHeadlessError(
          "PythonRandom(null) needs an explicit entropy array (the port has no os.urandom seam)",
          "PY_RANDOM_SEED_UNSUPPORTED",
        );
      }
      this.#initByArray(Uint32Array.from(entropy));
      return;
    }
    if (!Number.isSafeInteger(seed)) {
      throw new MixpanelHeadlessError(
        `PythonRandom seed must be a safe integer, got ${String(seed)}`,
        "PY_RANDOM_SEED_UNSUPPORTED",
      );
    }
    // CPython `random_seed`: `n = abs(arg)`, then the magnitude is
    // split into 32-bit little-endian words; a zero magnitude seeds
    // with the single word `[0]`.
    let n = BigInt(Math.abs(seed));
    const key: number[] = [];
    if (n === 0n) {
      key.push(0);
    } else {
      while (n > 0n) {
        key.push(Number(n & 0xffffffffn));
        n >>= 32n;
      }
    }
    this.#initByArray(Uint32Array.from(key));
  }

  /**
   * `init_genrand` — the scalar seeding routine `init_by_array` builds
   * on.
   *
   * @param s - The 32-bit scalar seed.
   */
  #initGenrand(s: number): void {
    const mt = this.#mt;
    mt[0] = s >>> 0;
    for (let i = 1; i < N; i += 1) {
      const prev = mt[i - 1] as number;
      const x = prev ^ (prev >>> 30);
      // 1812433253 * x + i, in unsigned 32-bit arithmetic. The product
      // overflows the float53 mantissa, so it runs through BigInt.
      mt[i] = Number((1812433253n * BigInt(x >>> 0) + BigInt(i)) % TWO32);
    }
    this.#index = N;
  }

  /**
   * `init_by_array` — CPython's array seeding.
   *
   * @param initKey - The 32-bit key words.
   */
  #initByArray(initKey: Uint32Array): void {
    const mt = this.#mt;
    this.#initGenrand(19650218);
    let i = 1;
    let j = 0;
    let k = Math.max(N, initKey.length);
    for (; k > 0; k -= 1) {
      const prev = mt[i - 1] as number;
      const mixed = BigInt((prev ^ (prev >>> 30)) >>> 0) * 1664525n;
      mt[i] = Number(
        ((BigInt(mt[i] as number) ^ (mixed % TWO32)) +
          BigInt(initKey[j] as number) +
          BigInt(j)) %
          TWO32,
      );
      i += 1;
      j += 1;
      if (i >= N) {
        mt[0] = mt[N - 1] as number;
        i = 1;
      }
      if (j >= initKey.length) {
        j = 0;
      }
    }
    for (k = N - 1; k > 0; k -= 1) {
      const prev = mt[i - 1] as number;
      const mixed = BigInt((prev ^ (prev >>> 30)) >>> 0) * 1566083941n;
      let value = (BigInt(mt[i] as number) ^ (mixed % TWO32)) - BigInt(i);
      value = ((value % TWO32) + TWO32) % TWO32;
      mt[i] = Number(value);
      i += 1;
      if (i >= N) {
        mt[0] = mt[N - 1] as number;
        i = 1;
      }
    }
    mt[0] = 0x80000000; // MSB is 1; assuring non-zero initial array
  }

  /**
   * `genrand_uint32` — one tempered 32-bit output.
   *
   * @returns The next unsigned 32-bit word.
   */
  genrandUint32(): number {
    const mt = this.#mt;
    if (this.#index >= N) {
      for (let kk = 0; kk < N - M; kk += 1) {
        const y =
          (((mt[kk] as number) & UPPER_MASK) |
            ((mt[kk + 1] as number) & LOWER_MASK)) >>>
          0;
        mt[kk] =
          ((mt[kk + M] as number) ^ (y >>> 1) ^ (y & 1 ? MATRIX_A : 0)) >>> 0;
      }
      for (let kk = N - M; kk < N - 1; kk += 1) {
        const y =
          (((mt[kk] as number) & UPPER_MASK) |
            ((mt[kk + 1] as number) & LOWER_MASK)) >>>
          0;
        mt[kk] =
          ((mt[kk + (M - N)] as number) ^
            (y >>> 1) ^
            (y & 1 ? MATRIX_A : 0)) >>>
          0;
      }
      const y =
        (((mt[N - 1] as number) & UPPER_MASK) |
          ((mt[0] as number) & LOWER_MASK)) >>>
        0;
      mt[N - 1] =
        ((mt[M - 1] as number) ^ (y >>> 1) ^ (y & 1 ? MATRIX_A : 0)) >>> 0;
      this.#index = 0;
    }

    let y = mt[this.#index] as number;
    this.#index += 1;
    y = (y ^ (y >>> 11)) >>> 0;
    y = (y ^ ((y << 7) & 0x9d2c5680)) >>> 0;
    y = (y ^ ((y << 15) & 0xefc60000)) >>> 0;
    y = (y ^ (y >>> 18)) >>> 0;
    return y >>> 0;
  }

  /**
   * `getrandbits(k)` — `_random_Random_getrandbits_impl`.
   *
   * @param k - How many bits to draw (`0 <= k`).
   * @returns The drawn value as a `bigint` (Python ints are unbounded).
   * @throws MixpanelHeadlessError - Code `PY_RANDOM_NEGATIVE_BITS` for
   *   `k < 0` (CPython raises `ValueError`).
   */
  getrandbits(k: number): bigint {
    if (k < 0) {
      throw new MixpanelHeadlessError(
        "number of bits must be non-negative",
        "PY_RANDOM_NEGATIVE_BITS",
      );
    }
    if (k === 0) {
      return 0n;
    }
    if (k <= 32) {
      return BigInt(this.genrandUint32() >>> (32 - k));
    }
    // Words are laid down LITTLE-ENDIAN, the final (most significant)
    // word shifted right by the leftover bit count.
    const words = Math.floor((k - 1) / 32) + 1;
    let result = 0n;
    let remaining = k;
    for (let i = 0; i < words; i += 1) {
      let r = this.genrandUint32();
      if (remaining < 32) {
        r = r >>> (32 - remaining);
      }
      result |= BigInt(r >>> 0) << BigInt(32 * i);
      remaining -= 32;
    }
    return result;
  }

  /**
   * `_randbelow_with_getrandbits(n)` — a uniform integer in `[0, n)`.
   *
   * @param n - The exclusive upper bound. `0` returns `0`, exactly as
   *   CPython's `if not n: return 0` guard does.
   * @returns The drawn index.
   */
  randbelow(n: number): number {
    if (n === 0) {
      return 0;
    }
    const bound = BigInt(n);
    const k = bound.toString(2).length; // Python `int.bit_length()`
    let r = this.getrandbits(k);
    while (r >= bound) {
      r = this.getrandbits(k);
    }
    return Number(r);
  }
}

/**
 * `random.Random(seed).sample(population, k)` — CPython's selection
 * algorithm, verbatim (`Lib/random.py`).
 *
 * @param population - The sequence to sample from (not mutated).
 * @param k - How many elements to draw.
 * @param seed - The integer seed, or `null` with `entropy`.
 * @param entropy - Seed words when `seed` is `null`.
 * @returns The `k` selected elements, in SELECTION order.
 * @throws MixpanelHeadlessError - Code `PY_RANDOM_SAMPLE_RANGE` when
 *   `k` is negative or larger than the population (CPython raises
 *   `ValueError`).
 */
export function pythonSample<T>(
  population: readonly T[],
  k: number,
  seed: number | null,
  entropy?: readonly number[],
): T[] {
  const n = population.length;
  if (!(k >= 0 && k <= n)) {
    throw new MixpanelHeadlessError(
      "Sample larger than population or is negative",
      "PY_RANDOM_SAMPLE_RANGE",
    );
  }
  const rng = new PythonRandom(seed, entropy);
  const result: T[] = new Array<T>(k);
  let setsize = 21; // size of a small set minus size of an empty list
  if (k > 5) {
    // `setsize += 4 ** ceil(log(k * 3, 4))`
    setsize += 4 ** Math.ceil(Math.log(k * 3) / Math.log(4));
  }
  if (n <= setsize) {
    // An n-length list is smaller than a k-length set.
    const pool = [...population];
    for (let i = 0; i < k; i += 1) {
      const j = rng.randbelow(n - i);
      result[i] = pool[j] as T;
      pool[j] = pool[n - i - 1] as T; // move non-selected item into vacancy
    }
  } else {
    const selected = new Set<number>();
    for (let i = 0; i < k; i += 1) {
      let j = rng.randbelow(n);
      while (selected.has(j)) {
        j = rng.randbelow(n);
      }
      selected.add(j);
      result[i] = population[j] as T;
    }
  }
  return result;
}
