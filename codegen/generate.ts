// Regenerate src/types, src/resources and tests/generated from openapi/.
//
//   node codegen/generate.ts          write the generated files
//   node codegen/generate.ts --check  fail when the committed files differ
//
// Reads only openapi/ (docs/DESIGN.md section 5). Requires Node.js 22.18 or
// later (TypeScript type stripping).

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import * as prettier from "prettier";

import { render } from "./lib/render.ts";
import { CodegenError, load } from "./lib/spec.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const GENERATED_DIRS = ["src/resources", "src/types", "tests/generated"];

function listFiles(dir: string): string[] {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(abs, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) out.push(relative(ROOT, join(entry.parentPath, entry.name)));
  }
  return out;
}

export async function generate(): Promise<Map<string, string>> {
  const model = load(join(ROOT, "openapi"));
  const { files } = render(model);
  const config = (await prettier.resolveConfig(join(ROOT, "src/index.ts"))) ?? {};
  const out = new Map<string, string>();
  for (const [path, content] of [...files.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    out.set(path, await prettier.format(content, { ...config, filepath: join(ROOT, path) }));
  }
  return out;
}

async function main(): Promise<void> {
  const check = process.argv.includes("--check");
  let files: Map<string, string>;
  try {
    files = await generate();
  } catch (error) {
    if (error instanceof CodegenError) {
      console.error(`codegen: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
  const existing = new Set(GENERATED_DIRS.flatMap(listFiles));
  const stale = [...existing].filter((f) => !files.has(f)).sort();
  const changed: string[] = [];
  for (const [path, content] of files) {
    const abs = join(ROOT, path);
    const current = existsSync(abs) ? readFileSync(abs, "utf8") : undefined;
    if (current !== content) changed.push(path);
  }
  if (check) {
    if (changed.length || stale.length) {
      console.error("codegen: the generated code is out of date. Run `pnpm generate` and commit the result.");
      for (const path of changed) console.error(`  changed: ${path}`);
      for (const path of stale) console.error(`  not generated: ${path}`);
      process.exit(1);
    }
    console.log(`codegen: ${files.size} generated files are up to date.`);
    return;
  }
  for (const path of changed) {
    const abs = join(ROOT, path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, files.get(path)!);
  }
  for (const path of stale) rmSync(join(ROOT, path));
  console.log(`codegen: wrote ${changed.length} of ${files.size} files, removed ${stale.length}.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
