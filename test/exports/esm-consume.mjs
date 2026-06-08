// Verifies the built ESM artifacts resolve via import across all sub-paths.
// Run after `npm run build` via `npm run verify:dist`.
import assert from "node:assert";

import {
  createMap,
  serialize,
  toKebabCase,
  toPascalCase,
  toConstantCase,
  withDefault,
  forwardMany,
  safeForward,
  pick,
  omit,
  compose,
} from "../../dist/index.js";
import { deserialize, deserializeAsync } from "../../dist/serialize/index.js";
import { SKIP, createResolver, strategies } from "../../dist/resolver/index.js";
import { forwardAsync } from "../../dist/async/index.js";

assert.strictEqual(typeof SKIP, "symbol", "SKIP is a symbol");

for (const [name, fn] of [
  ["createMap", createMap],
  ["serialize", serialize],
  ["deserialize", deserialize],
  ["deserializeAsync", deserializeAsync],
  ["createResolver", createResolver],
  ["forwardAsync", forwardAsync],
  ["strategies", strategies],
  ["toKebabCase", toKebabCase],
  ["toPascalCase", toPascalCase],
  ["toConstantCase", toConstantCase],
  ["withDefault", withDefault],
  ["forwardMany", forwardMany],
  ["safeForward", safeForward],
  ["pick", pick],
  ["omit", omit],
  ["compose", compose],
]) {
  assert.strictEqual(typeof fn, "function", name);
}

console.log("ESM consume OK");
