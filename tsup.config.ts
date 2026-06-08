import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "async/index": "src/async/index.ts",
    "serialize/index": "src/serialize/index.ts",
    "resolver/index": "src/resolver/index.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  treeshake: true,
  clean: true,
  sourcemap: true,
  outExtension({ format }) {
    return { js: format === "cjs" ? ".cjs" : ".js" };
  },
});
