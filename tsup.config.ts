import { defineConfig } from "tsup";

// One entry point, built as ESM and CommonJS with matching declarations
// (dist/index.d.ts and dist/index.d.cts). A single entry keeps one copy of the
// error classes in each format, so `instanceof` always works.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: { compilerOptions: { composite: false } },
  tsconfig: "tsconfig.build.json",
  target: "es2022",
  platform: "neutral",
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  minify: false,
  outExtension({ format }) {
    return { js: format === "cjs" ? ".cjs" : ".js" };
  },
});
