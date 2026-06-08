import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import { createMap } from "../../src/map/createMap.js";
import {
  splitWords,
  toCamelCase,
  toCamelKey,
  toSnakeCase,
  toSnakeKey,
} from "../../src/map/case-convert.js";

describe("toSnakeCase / toCamelCase — strong return types", () => {
  it("snake-cases keys at the type level (common identifier case)", () => {
    const s = toSnakeCase({ firstName: 1, createdAt: new Date(), nested: { tagName: "x" } });
    expectTypeOf(s).toEqualTypeOf<{
      first_name: number;
      created_at: Date;
      nested: { tag_name: string };
    }>();
  });

  it("camel-cases keys at the type level, recursing arrays of objects", () => {
    const c = toCamelCase({ first_name: 1, post_tags: [{ tag_name: "y" }] });
    expectTypeOf(c).toEqualTypeOf<{ firstName: number; postTags: { tagName: string }[] }>();
  });

  it("preserves primitives and passes non-objects through", () => {
    expectTypeOf(toSnakeCase("x")).toEqualTypeOf<string>();
    expectTypeOf(toCamelCase(42)).toEqualTypeOf<number>();
  });
});

describe("splitWords tokenizer", () => {
  it("tokenizes every casing style to lowercase words", () => {
    expect(splitWords("firstName")).toEqual(["first", "name"]);
    expect(splitWords("first_name")).toEqual(["first", "name"]);
    expect(splitWords("FirstName")).toEqual(["first", "name"]);
    expect(splitWords("first-name")).toEqual(["first", "name"]);
    expect(splitWords("FIRST_NAME")).toEqual(["first", "name"]);
    expect(splitWords("first name")).toEqual(["first", "name"]);
  });

  it("handles acronym runs", () => {
    expect(splitWords("HTTPServer")).toEqual(["http", "server"]);
    expect(splitWords("parseHTTPResponse")).toEqual(["parse", "http", "response"]);
    expect(splitWords("userID")).toEqual(["user", "id"]);
  });

  it("handles digits", () => {
    expect(splitWords("v2Field")).toEqual(["v", "2", "field"]);
    expect(splitWords("address2")).toEqual(["address", "2"]);
    expect(splitWords("oauth2Token")).toEqual(["oauth", "2", "token"]);
  });

  it("ignores empty segments and leading/trailing delimiters", () => {
    expect(splitWords("__proto__")).toEqual(["proto"]);
    expect(splitWords("_leading")).toEqual(["leading"]);
    expect(splitWords("trailing_")).toEqual(["trailing"]);
    expect(splitWords("")).toEqual([]);
    expect(splitWords("___")).toEqual([]);
  });
});

describe("single-key converters", () => {
  it("toSnakeKey", () => {
    expect(toSnakeKey("firstName")).toBe("first_name");
    expect(toSnakeKey("HTTPServer")).toBe("http_server");
    expect(toSnakeKey("already_snake")).toBe("already_snake");
    expect(toSnakeKey("v2Field")).toBe("v_2_field");
  });

  it("toCamelKey", () => {
    expect(toCamelKey("first_name")).toBe("firstName");
    expect(toCamelKey("FirstName")).toBe("firstName");
    expect(toCamelKey("alreadyCamel")).toBe("alreadyCamel");
    expect(toCamelKey("http_server")).toBe("httpServer");
    expect(toCamelKey("")).toBe("");
  });

  it("leaves unconvertible keys untouched (no word tokens)", () => {
    // No letters/digits to tokenize -> return the original key, never "".
    expect(toSnakeKey("$$$")).toBe("$$$");
    expect(toCamelKey("$$$")).toBe("$$$");
    expect(toSnakeKey("___")).toBe("___");
    expect(toCamelKey("")).toBe("");
  });
});

describe("toSnakeCase / toCamelCase (recursive object key transforms)", () => {
  it("converts top-level keys regardless of original casing", () => {
    expect(toSnakeCase({ firstName: 1, CreatedAt: 2, ["kebab-key"]: 3 })).toEqual({
      first_name: 1,
      created_at: 2,
      kebab_key: 3,
    });
    expect(toCamelCase({ first_name: 1, created_at: 2 })).toEqual({
      firstName: 1,
      createdAt: 2,
    });
  });

  it("normalizes a MIXED-casing object per key (each key converted independently)", () => {
    // Some snake, some camel, some Pascal, one unconvertible — convert what we
    // can, leave the rest in place.
    expect(
      toSnakeCase({ firstName: 1, last_name: 2, MiddleName: 3, $$$: 4 }),
    ).toEqual({ first_name: 1, last_name: 2, middle_name: 3, $$$: 4 });
    expect(
      toCamelCase({ first_name: 1, lastName: 2, "created-at": 3, $$$: 4 }),
    ).toEqual({ firstName: 1, lastName: 2, createdAt: 3, $$$: 4 });
  });

  it("is idempotent (already-target casing is preserved)", () => {
    const snake = { first_name: 1 };
    expect(toSnakeCase(snake)).toEqual(snake);
    const camel = { firstName: 1 };
    expect(toCamelCase(camel)).toEqual(camel);
  });

  it("recurses into nested objects", () => {
    expect(toSnakeCase({ userProfile: { firstName: "Ada", lastName: "L" } })).toEqual({
      user_profile: { first_name: "Ada", last_name: "L" },
    });
  });

  it("recurses into arrays of objects, preserves arrays of primitives", () => {
    expect(toCamelCase({ post_tags: [{ tag_name: "x" }, { tag_name: "y" }] })).toEqual({
      postTags: [{ tagName: "x" }, { tagName: "y" }],
    });
    expect(toSnakeCase({ rawList: [1, 2, 3] })).toEqual({ raw_list: [1, 2, 3] });
  });

  it("only keys change — values pass through unchanged", () => {
    const at = new Date("2024-01-01T00:00:00.000Z");
    const tally = new Map([["a", 1]]);
    const out = toSnakeCase({ createdAt: at, theTally: tally, bigId: 9n }) as Record<
      string,
      unknown
    >;
    expect(out.created_at).toBe(at); // same Date instance, not reshaped
    expect(out.the_tally).toBe(tally); // same Map instance
    expect(out.big_id).toBe(9n);
  });

  it("does not recurse into class instances", () => {
    class Box {
      innerValue = 1;
    }
    const box = new Box();
    const out = toCamelCase({ my_box: box }) as Record<string, unknown>;
    expect(out.myBox).toBe(box);
    expect((out.myBox as Box).innerValue).toBe(1); // untouched
  });

  it("returns non-object inputs unchanged", () => {
    expect(toSnakeCase("hello")).toBe("hello");
    expect(toCamelCase(42)).toBe(42);
    expect(toSnakeCase(null)).toBeNull();
    expect(toCamelCase(undefined)).toBeUndefined();
    expect(toSnakeCase(true)).toBe(true);
  });

  it("never emits prototype-polluting keys", () => {
    // A normal own key that tokenizes to a forbidden word is dropped, not emitted.
    const withCtor: Record<string, unknown> = {};
    Object.defineProperty(withCtor, "constructor", {
      value: 1,
      enumerable: true,
      configurable: true,
      writable: true,
    });
    const out = toSnakeCase(withCtor) as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(out, "constructor")).toBe(false);
    // And conversion never mutates Object.prototype.
    toSnakeCase({ ["__proto__.polluted"]: true });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe("mapper instance methods", () => {
  const m = createMap(z.object({ id: z.number() }));

  it("every instance exposes toSnakeCase and toCamelCase", () => {
    expect(typeof m.toSnakeCase).toBe("function");
    expect(typeof m.toCamelCase).toBe("function");
  });

  it("instance methods convert output keys to the target case", () => {
    expect(m.toSnakeCase({ firstName: 1, lastName: 2 })).toEqual({
      first_name: 1,
      last_name: 2,
    });
    expect(m.toCamelCase({ first_name: 1, last_name: 2 })).toEqual({
      firstName: 1,
      lastName: 2,
    });
  });

  it("instance methods are the standalone utilities", () => {
    expect(m.toSnakeCase).toBe(toSnakeCase);
    expect(m.toCamelCase).toBe(toCamelCase);
  });
});
