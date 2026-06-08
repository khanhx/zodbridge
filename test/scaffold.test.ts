import { describe, expect, it } from "vitest";
import { VERSION } from "../src/index";

describe("scaffold", () => {
  it("exposes the root entry", () => {
    expect(VERSION).toBeDefined();
    expect(typeof VERSION).toBe("string");
  });
});
