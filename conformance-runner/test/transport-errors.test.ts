// transport-errors table (src/transport-errors.ts): native-fetch rejection
// shape (TypeError + cause).

import { describe, expect, it } from "vitest";

import {
  createTransportRejection,
  knownTransportErrorClass,
  UnknownTransportErrorClass,
} from "../src/transport-errors.js";

describe("createTransportRejection", () => {
  it("rejects ConnectError as a native TypeError with an ECONNREFUSED cause", () => {
    const rejection = createTransportRejection("ConnectError");
    expect(rejection).toBeInstanceOf(TypeError);
    expect(rejection.message).toBe("fetch failed");
    const cause = rejection.cause as Error & { code: string };
    expect(cause).toBeInstanceOf(Error);
    expect(cause.code).toBe("ECONNREFUSED");
  });

  it("rejects TimeoutException with an UND_ERR_CONNECT_TIMEOUT cause", () => {
    const rejection = createTransportRejection("TimeoutException");
    expect(rejection).toBeInstanceOf(TypeError);
    const cause = rejection.cause as Error & { code: string };
    expect(cause.name).toBe("ConnectTimeoutError");
    expect(cause.code).toBe("UND_ERR_CONNECT_TIMEOUT");
  });

  it("never produces a pre-mapped library error", () => {
    // The rejection must be a plain TypeError, exactly what undici throws —
    // classification into the library taxonomy is the port's job.
    const rejection = createTransportRejection("ReadError");
    expect(Object.getPrototypeOf(rejection)).toBe(TypeError.prototype);
    expect(rejection.name).toBe("TypeError");
  });

  it("builds a fresh error per call (no shared mutable cause)", () => {
    const first = createTransportRejection("ConnectError");
    const second = createTransportRejection("ConnectError");
    expect(first).not.toBe(second);
    expect(first.cause).not.toBe(second.cause);
  });

  it("covers the full httpx TransportError family", () => {
    for (const name of [
      "TimeoutException",
      "ConnectTimeout",
      "ReadTimeout",
      "WriteTimeout",
      "PoolTimeout",
      "ConnectError",
      "ReadError",
      "WriteError",
      "CloseError",
      "LocalProtocolError",
      "RemoteProtocolError",
      "ProxyError",
      "UnsupportedProtocol",
    ]) {
      expect(knownTransportErrorClass(name)).toBe(true);
      expect(createTransportRejection(name)).toBeInstanceOf(TypeError);
    }
  });

  it("throws loudly on an unknown httpx class (table gap)", () => {
    expect(knownTransportErrorClass("MadeUpError")).toBe(false);
    expect(() => createTransportRejection("MadeUpError")).toThrow(
      UnknownTransportErrorClass,
    );
  });
});
