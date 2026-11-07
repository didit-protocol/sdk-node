import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";

export type Doc = Record<string, unknown>;

export function openapi(paths: Doc, schemas: Doc = {}): Doc {
  return { openapi: "3.0.0", info: { title: "t", version: "1" }, paths, components: { schemas } };
}

const created: string[] = [];

// Registered in the root suite of each test file that imports this module.
afterAll(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A temporary openapi/ directory with the given documents, removed after the test file. */
export function specDir(options: {
  verification?: Doc;
  account?: Doc;
  overlay?: Doc;
  deprecated?: Doc;
}): string {
  const dir = mkdtempSync(join(tmpdir(), "didit-codegen-"));
  created.push(dir);
  writeFileSync(
    join(dir, "verification.json"),
    JSON.stringify(options.verification ?? openapi({})),
  );
  writeFileSync(join(dir, "account.json"), JSON.stringify(options.account ?? openapi({})));
  writeFileSync(join(dir, "overlay.json"), JSON.stringify({ operations: options.overlay ?? {} }));
  if (options.deprecated) {
    writeFileSync(
      join(dir, "deprecated-operations.json"),
      JSON.stringify({ methods: options.deprecated }),
    );
  }
  return dir;
}

export function naming(resource: string, method: string, extra: Doc = {}): Doc {
  return { resource, method, auth: "api_key", server: true, ...extra };
}
