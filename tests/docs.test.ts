// The generated API reference and the README that points at it. The number of
// methods in api.md's header must match the method rows below it, and a method
// count stated in the README must match it too, so the docs cannot drift from
// the generated reference as the API grows.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const api = readFileSync(new URL("../api.md", import.meta.url), "utf8");
const design = readFileSync(new URL("../docs/DESIGN.md", import.meta.url), "utf8");

/** The count in "Every method of ...: N methods, generated from openapi/". */
const declared = /Every method of `@didit-protocol\/sdk-node`: (\d+) methods/.exec(api)?.[1];

/** One row per method in the api.md tables. */
const rows = api.split("\n").filter((line) => line.startsWith("| `didit."));

/** One section per resource in api.md. */
const sections = api.split("\n").filter((line) => line.startsWith("## `didit."));

describe("API reference", () => {
  it("declares the number of methods it lists", () => {
    expect(declared).toBeDefined();
    expect(Number(declared)).toBe(rows.length);
  });

  it("is linked from the README", () => {
    expect(readme).toContain("[api.md](api.md)");
  });

  it("does not state a method count the reference disagrees with", () => {
    // The README deliberately names no count: the spec sync regenerates api.md
    // and the tables above, so a number copied into the README goes stale.
    // If one is added, it has to be right.
    const claimed = /(\d+) methods/.exec(readme)?.[1];
    if (claimed !== undefined) expect(Number(claimed)).toBe(rows.length);
  });
});

describe("Design document", () => {
  it("does not state server operation or resource counts the reference disagrees with", () => {
    // DESIGN.md's resource-tree paragraph is where a reader is told how large
    // the contract is. It deliberately names no size, because a spec sync
    // regenerates api.md; if a size is added back, it has to be right.
    const claimed = /(\d+) server operations in (\d+) resources/.exec(design);
    if (claimed !== null) {
      expect(Number(claimed[1])).toBe(rows.length);
      expect(Number(claimed[2])).toBe(sections.length);
    }
  });
});
