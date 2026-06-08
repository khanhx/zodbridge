import { describe, expect, it } from "vitest";
import {
  toConstantCase,
  toConstantKey,
  toKebabCase,
  toKebabKey,
  toPascalCase,
  toPascalKey,
} from "../../src/map/case-convert.js";

describe("kebab/Pascal/CONSTANT key converters", () => {
  it("toKebabKey", () => {
    expect(toKebabKey("firstName")).toBe("first-name");
    expect(toKebabKey("HTTP_Server")).toBe("http-server");
    expect(toKebabKey("$$$")).toBe("$$$"); // unconvertible left as-is
  });
  it("toPascalKey", () => {
    expect(toPascalKey("first_name")).toBe("FirstName");
    expect(toPascalKey("http-server")).toBe("HttpServer");
    expect(toPascalKey("$$$")).toBe("$$$");
  });
  it("toConstantKey", () => {
    expect(toConstantKey("firstName")).toBe("FIRST_NAME");
    expect(toConstantKey("http-server")).toBe("HTTP_SERVER");
    expect(toConstantKey("$$$")).toBe("$$$");
  });
});

describe("recursive kebab/Pascal/CONSTANT object converters", () => {
  it("toKebabCase recurses", () => {
    expect(toKebabCase({ firstName: 1, nested: { tagName: 2 } })).toEqual({
      "first-name": 1,
      nested: { "tag-name": 2 },
    });
  });
  it("toPascalCase recurses", () => {
    expect(toPascalCase({ first_name: 1, post_tags: [{ tag_name: "x" }] })).toEqual({
      FirstName: 1,
      PostTags: [{ TagName: "x" }],
    });
  });
  it("toConstantCase recurses", () => {
    expect(toConstantCase({ firstName: 1 })).toEqual({ FIRST_NAME: 1 });
  });
});
