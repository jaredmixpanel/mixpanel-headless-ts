// R10.9 harness — B9-R1 CredentialStore contract fuzz (b9-packets.md
// §2.7.2): fast-check, >=500 examples, random unicode-biased key/value
// strings through set/get/delete/overwrite command sequences against
// BOTH implementations — the in-memory store is the MODEL, the
// localStorage adapter over an in-test StorageLike is the SUT;
// asserting observational equivalence.
// Run: npx vite-node throwaway/b9-r1/store-fuzz.ts

import fc from "fast-check";

import {
  InMemoryCredentialStore,
  LocalStorageCredentialStore,
} from "../../packages/browser/src/index.js";

const SEED = 20260816;
const NUM_RUNS = 500;

type Command =
  | { readonly op: "set"; readonly key: string; readonly value: string }
  | { readonly op: "get"; readonly key: string }
  | { readonly op: "delete"; readonly key: string };

const keyArb = fc.oneof(
  fc.constantFrom("mp.tokens.us", "mp.tokens.eu", "mp.oauth_client.us", ""),
  fc.string({ maxLength: 20 }),
  fc.string({ unit: "binary", maxLength: 12 }),
);
const valueArb = fc.oneof(
  fc.constantFrom("18.0", "1.5", "true", "", "𝒳"),
  fc.string({ unit: "binary", maxLength: 40 }),
);
const commandArb: fc.Arbitrary<Command> = fc.oneof(
  fc.record({ op: fc.constant("set" as const), key: keyArb, value: valueArb }),
  fc.record({ op: fc.constant("get" as const), key: keyArb }),
  fc.record({ op: fc.constant("delete" as const), key: keyArb }),
);

function makeSut(): LocalStorageCredentialStore {
  const backing = new Map<string, string>();
  return new LocalStorageCredentialStore({
    getItem: (k) => backing.get(k) ?? null,
    setItem: (k, v) => void backing.set(k, v),
    removeItem: (k) => void backing.delete(k),
  });
}

fc.assert(
  fc.property(fc.array(commandArb, { maxLength: 40 }), (commands) => {
    const model = new InMemoryCredentialStore();
    const sut = makeSut();
    for (const command of commands) {
      if (command.op === "set") {
        model.set(command.key, command.value);
        sut.set(command.key, command.value);
      } else if (command.op === "delete") {
        model.delete(command.key);
        sut.delete(command.key);
      } else {
        const expected = model.get(command.key);
        const actual = sut.get(command.key);
        if (expected !== actual) {
          throw new Error(
            `divergence on get(${JSON.stringify(command.key)}): ` +
              `model=${JSON.stringify(expected)} sut=${JSON.stringify(actual)}`,
          );
        }
      }
    }
    // Terminal sweep: every key either store has seen must agree.
    for (const command of commands) {
      if (model.get(command.key) !== sut.get(command.key)) {
        throw new Error(
          `terminal divergence on ${JSON.stringify(command.key)}`,
        );
      }
    }
  }),
  { seed: SEED, numRuns: NUM_RUNS },
);

console.log(
  `store-fuzz: ${NUM_RUNS} runs @ seed ${SEED} — observational equivalence holds (0 divergences)`,
);
