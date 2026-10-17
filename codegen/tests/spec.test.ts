import { describe, expect, it } from "vitest";

import { argName, camel, kebab, pascal, propKey, resourceClass } from "../lib/naming.ts";
import { CodegenError, load } from "../lib/spec.ts";
import { naming, openapi, specDir } from "./helpers.ts";

const ok = { responses: { "200": { description: "ok" } } };

describe("naming", () => {
  it("converts names to the TypeScript idiom", () => {
    expect(pascal("key_people_checks")).toBe("KeyPeopleChecks");
    expect(pascal("ID verification")).toBe("IdVerification");
    expect(pascal("3ds")).toBe("V3ds");
    expect(pascal("")).toBe("Value");
    expect(camel("retrieve_decision")).toBe("retrieveDecision");
    expect(camel("sessionId")).toBe("sessionId");
    expect(resourceClass("sessions.imports")).toBe("SessionsImports");
    expect(kebab("travel_rule")).toBe("travel-rule");
    expect(argName("session_id", new Set())).toBe("sessionId");
    expect(argName("options", new Set())).toBe("optionsValue");
    expect(argName("id", new Set(["id"]))).toBe("id_");
    expect(propKey("a_b")).toBe("a_b");
    expect(propKey("a-b")).toBe('"a-b"');
  });
});

describe("load", () => {
  it("merges the overlay naming and lets upstream x-didit-sdk win", () => {
    const dir = specDir({
      verification: openapi({
        "/v3/a/": { get: ok, post: { ...ok, "x-didit-sdk": naming("alpha", "create_upstream") } },
      }),
      overlay: { "GET /v3/a/": naming("alpha", "list"), "POST /v3/a/": naming("alpha", "create") },
    });
    const model = load(dir);
    expect(model.operations.map((o) => `${o.key} -> ${o.sdk.resource}.${o.sdk.method}`)).toEqual([
      "GET /v3/a/ -> alpha.list",
      "POST /v3/a/ -> alpha.create_upstream",
    ]);
  });

  it("names every operation that has no SDK naming", () => {
    const dir = specDir({
      verification: openapi({ "/v3/a/": { get: { ...ok, operationId: "listA" } } }),
      account: openapi({ "/b/": { post: ok } }),
    });
    expect(() => load(dir)).toThrow(CodegenError);
    expect(() => load(dir)).toThrow(/GET \/v3\/a\/ \(operationId listA\)[\s\S]*account POST \/b\//);
  });

  it("refuses overlay entries for operations that no longer exist", () => {
    const dir = specDir({ overlay: { "GET /v3/gone/": naming("gone", "list") } });
    expect(() => load(dir)).toThrow(/no longer exist upstream[\s\S]*GET \/v3\/gone\//);
  });

  it.each([
    [{ resource: "Bad", method: "x", auth: "api_key", server: true }, /snake_case/],
    [{ resource: "a", method: "X", auth: "api_key", server: true }, /method/],
    [{ resource: "a", method: "x", auth: "token", server: true }, /auth/],
    [{ resource: "a", method: "x", auth: "api_key", server: "yes" }, /server/],
    [{ resource: "a", method: "x", auth: "api_key", server: true, scope: "org" }, /scope/],
    [{ resource: "a", method: "x", auth: "api_key", server: true, extra: 1 }, /unknown x-didit-sdk keys/],
    [{ resource: "a", method: "x", auth: "api_key" }, /missing "server"/],
    ["nope", /must be an object/],
  ])("refuses invalid naming %j", (raw, message) => {
    const dir = specDir({ verification: openapi({ "/v3/a/": { get: ok } }), overlay: { "GET /v3/a/": raw } });
    expect(() => load(dir)).toThrow(message);
  });

  it("refuses two operations with the same SDK name, and a method named like a nested resource", () => {
    const dup = specDir({
      verification: openapi({ "/v3/a/": { get: ok }, "/v3/b/": { get: ok } }),
      overlay: { "GET /v3/a/": naming("x", "list"), "GET /v3/b/": naming("x", "list") },
    });
    expect(() => load(dup)).toThrow(/both map to x\.list/);
    const clash = specDir({
      verification: openapi({ "/v3/a/": { get: ok }, "/v3/b/": { get: ok } }),
      overlay: { "GET /v3/a/": naming("x", "notes"), "GET /v3/b/": naming("x.notes", "list") },
    });
    expect(() => load(clash)).toThrow(/clashes with the nested resource/);
  });

  it("checks that application-scoped operations have the application path", () => {
    const dir = specDir({
      verification: openapi({ "/v3/a/": { get: ok } }),
      overlay: { "GET /v3/a/": naming("x", "list", { scope: "application" }) },
    });
    expect(() => load(dir)).toThrow(/scope application/);
  });

  it("adds the deprecated methods with their note, and refuses one that is provided again", () => {
    const entry = {
      "x-didit-sdk": naming("old", "list"),
      operation_key: "GET /v3/old/",
      reason: "removed",
      remove_in: "0.2.0",
      operation: ok,
    };
    const model = load(specDir({ deprecated: { "old.list": entry } }));
    expect(model.operations).toHaveLength(1);
    expect(model.operations[0]!.deprecated).toBe(true);
    expect(model.operations[0]!.deprecationNote).toMatch(/removed in version 0\.2\.0/);
    const again = specDir({
      verification: openapi({ "/v3/old/": { get: ok } }),
      overlay: { "GET /v3/old/": naming("old", "list") },
      deprecated: { "old.list": entry },
    });
    expect(() => load(again)).toThrow(/provides old\.list again/);
    expect(() => load(specDir({ deprecated: { "wrong.name": entry } }))).toThrow(/entry name/);
    expect(() => load(specDir({ deprecated: { "old.list": { ...entry, operation_key: "nope" } } }))).toThrow(
      /operation_key/,
    );
  });

  it("loads the committed documents", () => {
    const model = load(new URL("../../openapi", import.meta.url).pathname);
    const server = model.operations.filter((o) => o.sdk.server);
    expect(server.length).toBeGreaterThan(200);
    expect(model.operations.filter((o) => o.api === "account").every((o) => o.sdk.server)).toBe(true);
  });
});
