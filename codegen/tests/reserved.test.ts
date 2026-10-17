// The generated types are exported from the package root next to the
// hand-written API, so codegen must know every hand-written name: a spec
// change that adds a clashing type then fails the generator with a clear
// message instead of a cryptic type error.

import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import { RESERVED_NAMES, render } from "../lib/render.ts";
import { load } from "../lib/spec.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

describe("reserved names", () => {
  it("lists every hand-written export of the package", () => {
    const program = ts.createProgram([`${ROOT}src/index.ts`], {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
      types: [],
      noEmit: true,
    });
    const checker = program.getTypeChecker();
    const source = program.getSourceFile(`${ROOT}src/index.ts`)!;
    const exported = checker.getExportsOfModule(checker.getSymbolAtLocation(source)!).map((s) => s.name);

    const { builder, methods } = render(load(`${ROOT}openapi`));
    const generated = new Set<string>([...builder.decls.keys(), "DiditResources", "DATE_PLANS"]);
    for (const method of methods) {
      const segments = method.resource.split(".");
      segments.forEach((_, i) => {
        generated.add(
          segments
            .slice(0, i + 1)
            .map((s) => s.replace(/(^|_)([a-z0-9])/g, (_m, _u, c: string) => c.toUpperCase()))
            .join(""),
        );
      });
    }
    const handWritten = exported.filter((name) => !generated.has(name) && name !== "default");
    const missing = handWritten.filter((name) => !RESERVED_NAMES.has(name)).sort();
    expect(missing, "add these names to RESERVED_NAMES in codegen/lib/render.ts").toEqual([]);
  });
});
