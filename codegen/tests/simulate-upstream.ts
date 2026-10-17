// Write an upstream release of the API contract that renames every server method
// and removes one server operation, for the CI check that a spec sync never
// needs a hand edit (docs/DESIGN.md section 3.1):
//
//   node codegen/tests/simulate-upstream.ts DIR
//   node codegen/spec-sync.ts --from-dir DIR
//
// After the sync, regenerating, the linter, the type check and every test must
// pass: the hand-written tests and examples still call the old names, which stay
// as deprecated methods until their removal version.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { HTTP_METHODS, isObject, operationKey, type JsonObject } from "../lib/spec.ts";

const OPENAPI = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "openapi");

function read(name: string): JsonObject {
  return JSON.parse(readFileSync(join(OPENAPI, name), "utf8")) as JsonObject;
}

const out = process.argv[2];
if (!out) {
  console.error("usage: node codegen/tests/simulate-upstream.ts DIR");
  process.exit(2);
}
mkdirSync(out, { recursive: true });

const overlay = read("overlay.json").operations as Record<string, JsonObject | undefined>;
let renamed = 0;
let removed: string | undefined;
for (const api of ["verification", "account"] as const) {
  const doc = read(`${api}.json`);
  for (const [path, item] of Object.entries(doc.paths as Record<string, JsonObject>)) {
    for (const method of HTTP_METHODS) {
      const op = item[method];
      if (!isObject(op)) continue;
      const key = operationKey(api, method, path);
      const naming = (op["x-didit-sdk"] ?? overlay[key]) as JsonObject | undefined;
      if (naming?.server !== true) continue;
      if (!removed && method === "post") {
        // The first server POST leaves the contract; its method keeps its request and response types.
        Reflect.deleteProperty(item, method);
        removed = key;
        continue;
      }
      op["x-didit-sdk"] = { ...naming, method: `${String(naming.method)}_v2` };
      renamed++;
    }
  }
  writeFileSync(join(out, `${api}.json`), JSON.stringify(doc, null, 2));
}
console.log(`Renamed ${renamed} server methods to <name>_v2 and removed ${removed ?? "nothing"}.`);
