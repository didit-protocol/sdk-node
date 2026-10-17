// Contract test (docs/DESIGN.md section 11): every `server: true` operation in
// openapi/ has exactly one SDK method, and the SDK has no other API method.
// The expected set is computed from openapi/ itself, so it follows every sync.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { camel } from "../codegen/lib/naming.ts";
import { load } from "../codegen/lib/spec.ts";
import { APIResource } from "../src/core/resource.js";
import { Didit } from "../src/index.js";
import { WebhookHelpers } from "../src/webhooks/resource.js";

const OPENAPI = fileURLToPath(new URL("../openapi", import.meta.url));
const model = load(OPENAPI);

/** `resource.path.method` for every API method reachable from the client. */
function sdkMethods(root: object): Map<string, unknown> {
  const out = new Map<string, unknown>();
  const walk = (resource: object, path: string[]): void => {
    for (const [key, value] of Object.entries(resource)) {
      if (value instanceof APIResource) walk(value, [...path, key]);
    }
    if (!path.length) return;
    // Generated classes only: the hand-written WebhookHelpers (verify, verifyParsed) are not API operations.
    let proto: object | null = Object.getPrototypeOf(resource) as object | null;
    while (proto && proto !== APIResource.prototype && proto !== WebhookHelpers.prototype) {
      for (const name of Object.getOwnPropertyNames(proto)) {
        if (name === "constructor") continue;
        const value = (resource as Record<string, unknown>)[name];
        if (typeof value === "function") out.set([...path, name].join("."), value);
      }
      proto = Object.getPrototypeOf(proto) as object | null;
    }
  };
  walk(root, []);
  return out;
}

function expectedMethods(): Map<string, string> {
  const out = new Map<string, string>();
  for (const op of model.operations) {
    if (!op.sdk.server) continue;
    const name = [...op.sdk.resource.split(".").map(camel), camel(op.sdk.method)].join(".");
    expect(out.has(name), `${name} is provided by two operations`).toBe(false);
    out.set(name, op.key);
  }
  return out;
}

describe("contract", () => {
  const client = new Didit({ apiKey: "test-api-key" });
  const actual = sdkMethods(client);
  const expected = expectedMethods();

  it("maps every server operation to exactly one SDK method, and nothing else", () => {
    const missing = [...expected.keys()].filter((name) => !actual.has(name)).sort();
    const extra = [...actual.keys()].filter((name) => !expected.has(name)).sort();
    expect(missing, "operations without an SDK method").toEqual([]);
    expect(extra, "SDK methods without an operation").toEqual([]);
    expect(actual.size).toBe(expected.size);
  });

  it("counts the operations from openapi/", () => {
    const verification = model.operations.filter((op) => op.api === "verification");
    const account = model.operations.filter((op) => op.api === "account");
    const server = model.operations.filter((op) => op.sdk.server);
    // Every account operation is a server operation; the device and end-user token
    // operations of the verification API are not exposed.
    expect(account.every((op) => op.sdk.server)).toBe(true);
    expect(server.length).toBe(verification.filter((op) => op.sdk.server).length + account.length);
    expect(actual.size).toBe(server.length);
  });

  it("agrees with a count made from the raw documents, without the generator's loader", () => {
    // Read the JSON directly, so a loader bug that dropped operations would show here.
    const read = (name: string): Record<string, unknown> =>
      JSON.parse(readFileSync(`${OPENAPI}/${name}`, "utf8")) as Record<string, unknown>;
    const overlay = (read("overlay.json").operations ?? {}) as Record<string, { server?: boolean }>;
    const deprecated = (read("deprecated-operations.json").methods ?? {}) as Record<
      string,
      unknown
    >;
    let server = 0;
    for (const [name, prefix] of [
      ["verification.json", ""],
      ["account.json", "account "],
    ] as const) {
      const paths = read(name).paths as Record<string, Record<string, Record<string, unknown>>>;
      for (const [path, item] of Object.entries(paths)) {
        for (const [method, op] of Object.entries(item)) {
          if (
            !["get", "post", "put", "patch", "delete", "head", "options", "trace"].includes(method)
          )
            continue;
          const naming = (op["x-didit-sdk"] ??
            overlay[`${prefix}${method.toUpperCase()} ${path}`]) as
            { server?: boolean } | undefined;
          if (naming?.server === true) server++;
        }
      }
    }
    expect(server).toBeGreaterThan(200);
    expect(actual.size).toBe(server + Object.keys(deprecated).length);
  });

  it("never exposes device, end-user token or public operations", () => {
    for (const op of model.operations.filter((o) => !o.sdk.server)) {
      expect(["device_token", "public", "none"]).toContain(op.sdk.auth);
      expect(op.api).toBe("verification");
    }
  });

  it("keeps the hand-written webhook helpers next to the generated destinations", () => {
    expect(typeof client.webhooks.verify).toBe("function");
    expect(typeof client.webhooks.verifyParsed).toBe("function");
    expect(client.webhooks.destinations).toBeInstanceOf(APIResource);
  });

  it("drops each deprecated method in the release its entry names", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      version: string;
    };
    const doc = JSON.parse(
      readFileSync(new URL("../openapi/deprecated-operations.json", import.meta.url), "utf8"),
    ) as { methods: Record<string, { remove_in?: string }> };
    const parse = (v: string): number[] => v.split(".").map((x) => Number.parseInt(x, 10));
    const atLeast = (a: number[], b: number[]): boolean => {
      for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
      return true;
    };
    for (const [name, entry] of Object.entries(doc.methods)) {
      expect(
        entry.remove_in !== undefined && atLeast(parse(pkg.version), parse(entry.remove_in)),
        `${name} must be removed in ${entry.remove_in ?? "?"}: delete its entry from openapi/deprecated-operations.json and run pnpm generate`,
      ).toBe(false);
    }
  });
});
