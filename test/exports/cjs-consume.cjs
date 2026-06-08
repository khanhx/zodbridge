// Verifies the built CJS artifacts resolve via require() across all sub-paths.
// Run after `npm run build` via `npm run verify:dist`.
const assert = require("node:assert");

const root = require("../../dist/index.cjs");
const serializeEntry = require("../../dist/serialize/index.cjs");
const resolverEntry = require("../../dist/resolver/index.cjs");
const asyncEntry = require("../../dist/async/index.cjs");

const checks = [
  ["root.createMap", root.createMap],
  ["root.compose", root.compose],
  ["root.pick", root.pick],
  ["root.toKebabCase", root.toKebabCase],
  ["root.withDefault", root.withDefault],
  ["serialize.deserializeAsync", serializeEntry.deserializeAsync],
  ["serialize.setToArray", serializeEntry.setToArray],
  ["resolver.createResolver", resolverEntry.createResolver],
  ["resolver.strategies", resolverEntry.strategies],
  ["async.forwardAsync", asyncEntry.forwardAsync],
];
for (const [name, fn] of checks) {
  assert.strictEqual(typeof fn, "function", name);
}

console.log("CJS consume OK");
