import { describe, expect, it } from "vitest";

// Imports go through the SOURCE entry points (mirroring the published sub-paths)
// to assert every public symbol is exported and is the right kind.
import * as root from "../../src/index.js";
import * as asyncEntry from "../../src/async/index.js";
import * as serializeEntry from "../../src/serialize/index.js";
import * as resolverEntry from "../../src/resolver/index.js";

describe("public API surface", () => {
  it("root entry exports the core mapper + serialize", () => {
    expect(typeof root.createMap).toBe("function");
    expect(typeof root.serialize).toBe("function");
    expect(typeof root.deserialize).toBe("function");
    expect(typeof root.fromResolver).toBe("function");
    expect(typeof root.OneWayRuleError).toBe("function");
    expect(typeof root.toSnakeCase).toBe("function");
    expect(typeof root.toCamelCase).toBe("function");
    expect(typeof root.VERSION).toBe("string");
  });

  it("./serialize entry exports the codec", () => {
    expect(typeof serializeEntry.serialize).toBe("function");
    expect(typeof serializeEntry.deserialize).toBe("function");
    expect(typeof serializeEntry.CodecError).toBe("function");
    expect(typeof serializeEntry.AsyncSchemaError).toBe("function");
  });

  it("./resolver entry exports createResolver", () => {
    expect(typeof resolverEntry.createResolver).toBe("function");
    expect(typeof resolverEntry.GraphContext).toBe("function");
  });

  it("./async entry exports forwardAsync", () => {
    expect(typeof asyncEntry.forwardAsync).toBe("function");
    expect(typeof asyncEntry.normalizeSelect).toBe("function");
    expect(typeof asyncEntry.UnknownSelectKeyError).toBe("function");
  });
});
