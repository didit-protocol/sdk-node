import { describe, expect, it } from "vitest";

import { render } from "../lib/render.ts";
import { load } from "../lib/spec.ts";
import { naming, openapi, specDir } from "./helpers.ts";

function json(schema: unknown, status = "200") {
  return {
    responses: { [status]: { description: "ok", content: { "application/json": { schema } } } },
  };
}

const PAGE = {
  type: "object",
  properties: {
    count: { type: "integer" },
    next: { type: "string", nullable: true },
    previous: { type: "string", nullable: true },
    results: { type: "array", items: { $ref: "#/components/schemas/Thing" } },
  },
};

const THING = {
  type: "object",
  required: ["id"],
  properties: {
    id: { type: "string", readOnly: true },
    kind: { type: "string", enum: ["a", "b", null], nullable: true },
    created_at: { type: "string", format: "date-time" },
    when: { type: "string", format: "date" },
    tags: { type: "array", items: { type: "object", properties: { label: { type: "string" } } } },
    extra: { type: "object", additionalProperties: true, properties: { x: { type: "integer" } } },
    secret: { type: "string", writeOnly: true },
  },
};

function build() {
  const dir = specDir({
    verification: openapi(
      {
        "/v3/things/": {
          get: {
            ...json(PAGE),
            parameters: [{ in: "query", name: "limit", schema: { type: "integer" } }],
          },
          post: {
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["thing"],
                    properties: { thing: { $ref: "#/components/schemas/Thing" } },
                  },
                },
              },
            },
            parameters: [{ in: "header", name: "Idempotency-Key", schema: { type: "string" } }],
            ...json({ $ref: "#/components/schemas/Thing" }, "201"),
          },
        },
        "/v3/things/{thing_id}/": {
          parameters: [
            { in: "path", name: "thing_id", required: true, schema: { type: "string" } },
          ],
          get: json({ $ref: "#/components/schemas/Thing" }),
          delete: { responses: { "204": { description: "gone" } } },
        },
        "/v3/things/{thing_id}/report/": {
          get: {
            responses: {
              "200": {
                description: "pdf",
                content: { "application/pdf": { schema: { type: "string", format: "binary" } } },
              },
            },
          },
        },
        "/v3/upload/": {
          post: {
            requestBody: {
              content: {
                "application/json": {
                  schema: { type: "object", properties: { note: { type: "string" } } },
                },
                "multipart/form-data": {
                  schema: {
                    type: "object",
                    properties: {
                      note: { type: "string" },
                      file: { type: "string", format: "binary" },
                    },
                  },
                },
              },
            },
            ...json({ type: "object", properties: { ok: { type: "boolean" } } }),
          },
        },
        "/v3/organization/{organization_id}/application/{application_id}/cases/": {
          get: json({
            type: "array",
            items: { type: "object", properties: { uuid: { type: "string" } } },
          }),
        },
        "/v3/device/": { get: json({}) },
      },
      { Thing: THING },
    ),
    account: openapi({
      "/login/": {
        post: json({ type: "object", properties: { access_token: { type: "string" } } }),
      },
    }),
    overlay: {
      "GET /v3/things/": naming("things", "list"),
      "POST /v3/things/": naming("things", "create"),
      "GET /v3/things/{thing_id}/": naming("things", "retrieve"),
      "DELETE /v3/things/{thing_id}/": naming("things", "delete"),
      "GET /v3/things/{thing_id}/report/": naming("things.reports", "download"),
      "POST /v3/upload/": naming("uploads", "create"),
      "GET /v3/organization/{organization_id}/application/{application_id}/cases/": naming(
        "cases",
        "list",
        { scope: "application" },
      ),
      "GET /v3/device/": { resource: "device", method: "get", auth: "device_token", server: false },
      "account POST /login/": { resource: "account", method: "login", auth: "none", server: true },
    },
  });
  return render(load(dir));
}

describe("render", () => {
  const { files, methods } = build();
  const things = files.get("src/resources/things.ts")!;
  const types = files.get("src/types/components.ts")!;

  it("generates one method per server operation and nothing for device operations", () => {
    expect(methods.map((m) => `${m.resource}.${m.name}`).sort()).toEqual([
      "account.login",
      "cases.list",
      "things.create",
      "things.delete",
      "things.list",
      "things.reports.download",
      "things.retrieve",
      "uploads.create",
    ]);
    expect([...files.keys()].some((f) => f.includes("device"))).toBe(false);
  });

  it("writes the DO NOT EDIT header on every file", () => {
    for (const [path, content] of files) {
      expect(
        content.startsWith("// Code generated by codegen from openapi/*.json. DO NOT EDIT."),
        path,
      ).toBe(true);
    }
  });

  it("renders typed methods with positional ids, a params object and request options", () => {
    expect(things).toContain(
      "retrieve(thingId: string, options?: RequestOptions): APIPromise<Thing>",
    );
    expect(things).toContain(
      "create(params: ThingsCreateParams, options?: RequestOptions): APIPromise<Thing>",
    );
    expect(files.get("src/types/things.ts")).toMatch(
      /export interface ThingsCreateParams \{\s+thing: ThingParam;\s+\}/,
    );
    expect(things).toContain(
      "list(params: ThingsListParams = {}, options?: RequestOptions): PagePromise<ThingsListResponse, Thing>",
    );
    expect(things).toContain("delete(thingId: string, options?: RequestOptions): APIPromise<void>");
    expect(things).toContain(
      "download(thingId: string, options?: RequestOptions): APIPromise<Blob>",
    );
    expect(things).toContain("readonly reports: ThingsReports = new ThingsReports(this._client);");
    expect(things).toContain("Accepts `options.idempotencyKey`");
  });

  it("describes each operation for the client", () => {
    expect(things).toContain(
      'const THINGS_LIST: OperationSpec = { method: "GET", path: "/v3/things/", query: ["limit"]',
    );
    expect(things).toContain('response: "binary", accept: "application/pdf"');
    expect(things).toContain('response: "none"');
    expect(files.get("src/resources/uploads.ts")).toContain('body: "auto", files: ["file"]');
    expect(files.get("src/resources/cases.ts")).toContain('scope: "application"');
    expect(files.get("src/resources/account.ts")).toContain('api: "account", auth: "none"');
  });

  it("separates response and parameter types where they differ", () => {
    expect(types).toMatch(
      /export interface Thing \{[\s\S]*?id: string;[\s\S]*?created_at\?: Date;[\s\S]*?\}/,
    );
    expect(types).toMatch(
      /export interface ThingParam \{[\s\S]*?created_at\?: string \| Date;[\s\S]*?secret\?: string;[\s\S]*?\}/,
    );
    expect(types).not.toMatch(/export interface ThingParam \{[^}]*\bid:/);
    expect(types).not.toMatch(/export interface Thing \{[^}]*secret/);
  });

  it("uses open enums, nullable unions, date strings, nested names and index signatures", () => {
    expect(types).toContain('kind?: "a" | "b" | (string & {}) | null;');
    expect(types).toContain("when?: string;");
    expect(types).toContain("tags?: ThingTags[];");
    expect(types).toContain("export interface ThingTags {");
    expect(types).toMatch(
      /export interface ThingExtra \{[\s\S]*?x\?: number;[\s\S]*?\[key: string\]: unknown;/,
    );
  });

  it("records where responses have date-times", () => {
    expect(files.get("src/resources/date-plans.ts")).toContain('Thing: {"p":{"created_at":1}},');
    expect(things).toContain('dates: {"p":{"results":{"i":"Thing"}}}');
    expect(things).toContain(
      'const THINGS_RETRIEVE: OperationSpec = { method: "GET", path: "/v3/things/{thing_id}/", dates: "Thing" };',
    );
  });

  it("generates one test per operation", () => {
    const tests = [...files.entries()].filter(([path]) => path.startsWith("tests/generated/"));
    const count = tests.reduce(
      (n, [, content]) => n + (content.match(/\n {2}it\(/g) ?? []).length,
      0,
    );
    expect(count).toBe(methods.length);
  });
});

describe("render deprecated methods", () => {
  const response = (ref: string) => ({
    responses: {
      "200": {
        description: "ok",
        content: { "application/json": { schema: { $ref: `#/components/schemas/${ref}` } } },
      },
    },
  });
  const entry = {
    "x-didit-sdk": naming("old", "list"),
    operation_key: "GET /v3/old/",
    reason: "removed",
    remove_in: "0.5.0",
    operation: response("OldPage"),
    components: {
      OldPage: {
        type: "object",
        properties: { items: { type: "array", items: { $ref: "#/components/schemas/OldItem" } } },
      },
      OldItem: { type: "object", properties: { id: { type: "string" } } },
    },
  };

  it("renders a deprecated method whose schemas left the live spec, keeping their names", () => {
    const { files } = render(load(specDir({ deprecated: { "old.list": entry } })));
    const types = files.get("src/types/components.ts")!;
    expect(types).toMatch(/export interface OldPage \{\s+items\?: OldItem\[\];/);
    expect(types).toContain("export interface OldItem {");
    expect(files.get("src/resources/old.ts")).toContain("@deprecated");
  });

  it("suffixes a deprecated schema whose name a live schema took", () => {
    const live = openapi(
      { "/v3/new/": { get: response("OldItem") } },
      { OldItem: { type: "object", properties: { other: { type: "integer" } } } },
    );
    const { files } = render(
      load(
        specDir({
          verification: live,
          overlay: { "GET /v3/new/": naming("fresh", "list") },
          deprecated: { "old.list": entry },
        }),
      ),
    );
    const types = files.get("src/types/components.ts")!;
    expect(types).toContain("export interface OldItem {");
    expect(types).toMatch(/export interface OldPage \{\s+items\?: OldItemDeprecated\[\];/);
    expect(types).toContain("export interface OldItemDeprecated {");
  });
});

describe("render errors", () => {
  it("refuses a generated type that would shadow a hand-written export", () => {
    const dir = specDir({
      verification: openapi(
        { "/v3/x/": { get: json({ $ref: "#/components/schemas/Didit" }) } },
        { Didit: { type: "string" } },
      ),
      overlay: { "GET /v3/x/": naming("x", "get") },
    });
    expect(() => render(load(dir))).toThrow(/shadow a hand-written export/);
  });

  it("refuses two different types with the same name", () => {
    const dir = specDir({
      verification: openapi(
        {
          "/v3/x/": {
            get: json({
              type: "object",
              properties: {
                a: { type: "object", properties: { b: { type: "string" } } },
                c: { $ref: "#/components/schemas/XGetResponseA" },
              },
            }),
          },
        },
        { XGetResponseA: { type: "object", properties: { z: { type: "string" } } } },
      ),
      overlay: { "GET /v3/x/": naming("x", "get") },
    });
    expect(() => render(load(dir))).toThrow(/both named XGetResponseA/);
  });
});
