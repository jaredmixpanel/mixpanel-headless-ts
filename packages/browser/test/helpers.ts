// Browser-only test doubles. The canned-fetch transport lives in
// `packages/core/test-support/client-test-helpers.ts`; this file keeps
// only the `StorageLike` double the credential-store suites inject.

/** A minimal Storage-shaped double backed by a Map (StorageLike twin). */
export interface FakeStorage {
  /** The injectable Storage-shaped object. */
  readonly storage: {
    getItem: (key: string) => string | null;
    setItem: (key: string, value: string) => void;
    removeItem: (key: string) => void;
  };
  /** The backing map, for direct assertions. */
  readonly map: Map<string, string>;
}

/**
 * Build an injectable `StorageLike` double over a plain Map.
 *
 * @returns The storage double plus its backing map.
 */
export function fakeStorage(): FakeStorage {
  const map = new Map<string, string>();
  return {
    map,
    storage: {
      getItem: (key: string): string | null => map.get(key) ?? null,
      setItem: (key: string, value: string): void => {
        map.set(key, value);
      },
      removeItem: (key: string): void => {
        map.delete(key);
      },
    },
  };
}
