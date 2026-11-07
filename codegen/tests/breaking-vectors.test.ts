// Every case of openapi/breaking-vectors.json (docs/DESIGN.md section 3.1): the shared
// vectors that hold the seven server SDKs' spec syncs to the same breaking changes.
// The file is generated in sdk-python (codegen/breaking_vectors.py) and copied here byte
// for byte; openapi/SOURCE.json records the commit it came from and its SHA-256. Never
// edit it: a rule change lands in sdk-python first.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { byCodePoint } from "../lib/naming.ts";
import { normalized, sync } from "../lib/sync.ts";

interface Case {
  name: string;
  rule: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  expect: { type: "feat(spec)" | "chore(spec)"; breaking: string[] };
}

const OPENAPI = new URL("../../openapi/", import.meta.url);
const raw = readFileSync(new URL("breaking-vectors.json", OPENAPI));
const vectors = JSON.parse(raw.toString("utf8")) as {
  version: number;
  rules: string;
  generator: string;
  cases: Case[];
};
const source = JSON.parse(readFileSync(new URL("SOURCE.json", OPENAPI), "utf8")) as Record<
  string,
  { sha256?: string; source?: string }
>;

const encoder = new TextEncoder();

/**
 * What the sync makes of verification.json changing from `before` to `after` (every
 * operation named by its own x-didit-sdk): the commit type and the counted changes,
 * normalized, distinct and sorted by code point, as the vectors write them.
 */
function classify(before: unknown, after: unknown): Case["expect"] {
  const result = sync({
    files: new Map([
      ["verification.json", encoder.encode(JSON.stringify(before))],
      ["overlay.json", encoder.encode(JSON.stringify({ operations: {} }))],
    ]),
    downloads: new Map([["verification.json", encoder.encode(JSON.stringify(after))]]),
    now: new Date("2026-01-01T00:00:00Z"),
    version: "1.0.0",
  });
  return {
    type: `${result.type}(spec)`,
    breaking: [...new Set(result.breaking.map(normalized))].sort(byCodePoint),
  };
}

describe("openapi/breaking-vectors.json", () => {
  it("is the byte-for-byte copy openapi/SOURCE.json records", () => {
    const entry = source["breaking-vectors.json"];
    expect(entry?.source).toMatch(/^didit-protocol\/sdk-python@[0-9a-f]{40} /);
    expect(createHash("sha256").update(raw).digest("hex")).toBe(entry?.sha256);
    expect(vectors.version).toBe(1);
    expect(vectors.rules).toBe("docs/DESIGN.md section 3.1");
    expect(new Set(vectors.cases.map((c) => c.name)).size).toBe(vectors.cases.length);
  });

  it.each(vectors.cases.map((c) => [`${c.rule}: ${c.name}`, c] as const))("%s", (_, c) => {
    expect(classify(c.before, c.after)).toEqual(c.expect);
  });
});
