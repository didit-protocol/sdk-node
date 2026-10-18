import { describe, expect, it } from "vitest";

import {
  boundSummary,
  checkOpenAPI,
  detach,
  nextMinor,
  removalVersion,
  SpecSyncError,
  sync,
} from "../lib/sync.ts";
import { naming, openapi, type Doc } from "./helpers.ts";

const enc = new TextEncoder();
const dec = new TextDecoder();
const bytes = (doc: unknown): Uint8Array => enc.encode(JSON.stringify(doc, null, 1));
const NOW = new Date("2026-10-18T06:37:00Z");

function json(schema: unknown) {
  return {
    responses: { "200": { description: "ok", content: { "application/json": { schema } } } },
  };
}

const ITEM = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "string" }, name: { type: "string" } },
};

function base(): Doc {
  return openapi(
    {
      "/v3/items/": { get: json({ type: "array", items: { $ref: "#/components/schemas/Item" } }) },
      "/v3/items/{id}/": { get: json({ $ref: "#/components/schemas/Item" }) },
    },
    { Item: structuredClone(ITEM) },
  );
}

const OVERLAY = {
  description: "x",
  version: 1,
  operations: {
    "GET /v3/items/": naming("items", "list"),
    "GET /v3/items/{id}/": naming("items", "retrieve"),
  },
};

function run(next: Doc, overlay: Doc = OVERLAY, deprecated?: Doc, account?: Doc) {
  const current = base();
  const files = new Map<string, Uint8Array | undefined>([
    ["verification.json", bytes(current)],
    ["account.json", bytes(account ?? openapi({ "/x/": { get: json({}) } }))],
    ["overlay.json", bytes(overlay)],
    ["SOURCE.json", bytes({ "verification.json": { url: "u", sha256: "0", fetched_at: "t" } })],
    ["deprecated-operations.json", deprecated ? bytes(deprecated) : undefined],
  ]);
  const downloads = new Map([
    ["verification.json", bytes(next)],
    ["account.json", files.get("account.json")!],
  ]);
  return sync({ files, downloads, now: NOW, version: "0.3.1" });
}

function written(result: ReturnType<typeof run>, name: string): Doc {
  return JSON.parse(dec.decode(result.writes.get(name))) as Doc;
}

describe("spec sync", () => {
  it("does nothing when upstream did not change", () => {
    const result = run(base());
    expect(result).toEqual({
      changed: false,
      breaking: false,
      release: "none",
      summary: "No upstream change.\n",
      writes: new Map(),
    });
  });

  it("refuses a download that is not an OpenAPI 3 document with paths", () => {
    expect(() => checkOpenAPI("v", enc.encode("<html>"))).toThrow(SpecSyncError);
    expect(() => checkOpenAPI("v", enc.encode("[]"))).toThrow(/not a JSON object/);
    expect(() => checkOpenAPI("v", enc.encode('{"swagger":"2.0","paths":{"/":{}}}'))).toThrow(
      /OpenAPI 3/,
    );
    expect(() => checkOpenAPI("v", enc.encode('{"openapi":"3.0.0","paths":{}}'))).toThrow(
      /no paths/,
    );
    expect(() => run({ openapi: "3.0.0", paths: {} })).toThrow(SpecSyncError);
  });

  it("writes the files byte for byte and records their SHA-256 and fetch time", () => {
    const next = base();
    (next.info as Doc).version = "2";
    const result = run(next);
    expect(result.changed).toBe(true);
    expect(dec.decode(result.writes.get("verification.json"))).toBe(JSON.stringify(next, null, 1));
    const source = written(result, "SOURCE.json") as Record<string, Doc>;
    expect(source["verification.json"]).toMatchObject({
      url: "https://docs.didit.me/openapi-25.json",
      fetched_at: "2026-10-18T06:37:00Z",
    });
    expect(source["verification.json"]!.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.breaking).toBe(false);
  });

  it("lists added operations, and flags one without SDK naming", () => {
    const next = base();
    (next.paths as Doc)["/v3/items/{id}/archive/"] = { post: json({}) };
    (next.paths as Doc)["/v3/new/"] = {
      get: { ...json({}), "x-didit-sdk": naming("fresh", "list") },
    };
    const { summary } = run(next);
    expect(summary).toContain("## Added operations (2)");
    expect(summary).toContain("`POST /v3/items/{id}/archive/`: **no SDK naming**");
    expect(summary).toContain("`GET /v3/new/` -> `fresh.list`");
  });

  it("keeps a removed server method as deprecated, with the components it uses", () => {
    const next = base();
    delete (next.paths as Doc)["/v3/items/{id}/"];
    const result = run(next);
    // Kept as a deprecated method, so nothing breaks yet: a feature release ships it.
    expect(result.breaking).toBe(false);
    expect(result.release).toBe("feature");
    const deprecations = result.summary.slice(result.summary.indexOf("## Deprecated methods"));
    expect(deprecations).toContain(
      "`items.retrieve` was removed upstream (GET /v3/items/{id}/); kept as a deprecated method until version 0.5.0",
    );
    const deprecated = written(result, "deprecated-operations.json") as {
      methods: Record<string, Doc>;
    };
    const entry = deprecated.methods["items.retrieve"]!;
    expect(entry).toMatchObject({
      reason: "removed",
      operation_key: "GET /v3/items/{id}/",
      deprecated_since: "0.3.1",
      remove_in: "0.5.0",
      "x-didit-sdk": naming("items", "retrieve"),
    });
    expect(entry.components).toEqual({ Item: ITEM });
    expect(
      (written(result, "overlay.json").operations as Doc)["GET /v3/items/{id}/"],
    ).toBeUndefined();
  });

  it("treats a name that moved to another path as moved, not removed", () => {
    const next = base();
    const paths = next.paths as Doc;
    paths["/v3/items/{id}/detail/"] = paths["/v3/items/{id}/"];
    delete paths["/v3/items/{id}/"];
    const overlay = {
      ...OVERLAY,
      operations: {
        ...OVERLAY.operations,
        "GET /v3/items/{id}/detail/": naming("items", "retrieve"),
      },
    };
    const result = run(next, overlay);
    expect(result.summary).toContain(
      "moved to `GET /v3/items/{id}/detail/`; `items.retrieve` keeps its name",
    );
    expect(result.summary).toContain(
      "`items.retrieve` moved from `GET /v3/items/{id}/` to `GET /v3/items/{id}/detail/`: same parameters, body and response",
    );
    expect(
      (written(result, "deprecated-operations.json").methods as Doc)["items.retrieve"],
    ).toBeUndefined();
  });

  it("keeps the old name of a renamed method as a deprecated alias", () => {
    const next = base();
    ((next.paths as Doc)["/v3/items/{id}/"] as Doc).get = {
      ...json({ $ref: "#/components/schemas/Item" }),
      "x-didit-sdk": naming("items", "get"),
    };
    const result = run(next);
    expect(result.breaking).toBe(false);
    expect(result.release).toBe("feature");
    expect(result.summary).toContain("`items.retrieve` renamed to `items.get`");
    const entry = (written(result, "deprecated-operations.json").methods as Record<string, Doc>)[
      "items.retrieve"
    ]!;
    expect(entry).toMatchObject({ reason: "renamed", replacement: "items.get" });
    // Upstream carries the naming now, so the overlay entry goes.
    expect(
      (written(result, "overlay.json").operations as Doc)["GET /v3/items/{id}/"],
    ).toBeUndefined();
    expect(result.summary).toContain(
      "upstream x-didit-sdk differs from the overlay; upstream wins",
    );
  });

  it("keeps a method whose operation is no longer a server operation as deprecated", () => {
    const next = base();
    ((next.paths as Doc)["/v3/items/{id}/"] as Doc).get = {
      ...json({ $ref: "#/components/schemas/Item" }),
      "x-didit-sdk": { resource: "items", method: "retrieve", auth: "device_token", server: false },
    };
    const result = run(next);
    expect(result.summary).toContain("is no longer a server operation (auth device_token)");
    expect(
      (written(result, "deprecated-operations.json").methods as Record<string, Doc>)[
        "items.retrieve"
      ],
    ).toMatchObject({ reason: "removed" });
  });

  it("drops overlay entries that upstream now carries identically", () => {
    const next = base();
    ((next.paths as Doc)["/v3/items/"] as Doc).get = {
      ...json({ type: "array", items: { $ref: "#/components/schemas/Item" } }),
      "x-didit-sdk": naming("items", "list"),
    };
    const result = run(next);
    expect(result.summary).toContain("Dropped 1 overlay entries that upstream now carries.");
    expect(result.summary).not.toContain("upstream wins");
    expect((written(result, "overlay.json").operations as Doc)["GET /v3/items/"]).toBeUndefined();
  });

  it("describes breaking and harmless changes of an operation and its schemas", () => {
    const next = base();
    const item = (next.components as { schemas: Record<string, Doc> }).schemas.Item!;
    item.properties = { id: { type: "integer" }, extra: { type: "string" } };
    ((next.paths as Doc)["/v3/items/"] as Doc).get = {
      ...json({ type: "array", items: { $ref: "#/components/schemas/Item" } }),
      parameters: [
        { in: "query", name: "status", required: true, schema: { type: "string", enum: ["a"] } },
      ],
    };
    const result = run(next);
    expect(result.breaking).toBe(true);
    const changed = result.summary.slice(result.summary.indexOf("## Changed operations"));
    expect(changed).toContain("parameter added: status (query), required (breaking)");
    expect(changed).toContain("response[].id: type string -> integer (breaking)");
    expect(changed).toContain("response[].name: removed (breaking)");
    expect(changed).toContain("response[].extra: added");
    expect(result.summary).toContain("verification.json changed: `Item`");
  });

  it("drops a deprecation entry once the name is provided again", () => {
    const next = base();
    (next.info as Doc).version = "3";
    const deprecated = {
      description: "d",
      methods: {
        "items.list": {
          reason: "removed",
          operation_key: "GET /v3/old/",
          "x-didit-sdk": naming("items", "list"),
        },
      },
    };
    const result = run(next, OVERLAY, deprecated);
    expect(result.summary).toContain(
      "`items.list` is provided again by `GET /v3/items/`; its deprecation entry was dropped.",
    );
    expect(written(result, "deprecated-operations.json").methods).toEqual({});
  });

  it("detaches an operation from its document but keeps component names", () => {
    const doc = openapi(
      {},
      {
        A: { type: "object", properties: { b: { $ref: "#/components/schemas/B" } } },
        B: { type: "string" },
      },
    );
    (doc.components as Doc).responses = { NotFound: { description: "nope" } };
    const op = {
      responses: {
        "404": { $ref: "#/components/responses/NotFound" },
        "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/A" } } } },
      },
    };
    const { node, components } = detach(doc, op);
    expect((node as { responses: Doc }).responses["404"]).toEqual({ description: "nope" });
    expect(Object.keys(components).sort()).toEqual(["A", "B"]);
    expect(detach(doc, { $ref: "#/components/missing" }).node).toEqual({
      "x-unresolved-ref": "#/components/missing",
    });
  });

  it("leaves sample data out of a detached operation, but not properties named like it", () => {
    const doc = openapi(
      {},
      {
        A: {
          type: "object",
          example: { api_key: "sample" },
          properties: {
            example: { type: "string", example: "sample" },
            examples: { type: "array", items: { type: "string" } },
            "x-note": { type: "string" },
          },
          "x-readme-id": "1",
        },
      },
    );
    const op = {
      "x-didit-sdk": naming("a", "create"),
      "x-codeSamples": [{ lang: "curl", source: "curl -H 'x-api-key: sample'" }],
      parameters: [{ in: "query", name: "q", schema: { type: "string" }, example: "sample" }],
      requestBody: {
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/A", example: { api_key: "sample" } },
            examples: { one: { value: { api_key: "sample" } } },
          },
        },
      },
      responses: { "200": { description: "ok" } },
    };
    const { node, components } = detach(doc, op);
    expect(JSON.stringify([node, components])).not.toContain("sample");
    expect(node).toEqual({
      "x-didit-sdk": naming("a", "create"),
      parameters: [{ in: "query", name: "q", schema: { type: "string" } }],
      requestBody: {
        content: { "application/json": { schema: { $ref: "#/components/schemas/A" } } },
      },
      responses: { "200": { description: "ok" } },
    });
    expect(components.A).toEqual({
      type: "object",
      properties: {
        example: { type: "string" },
        examples: { type: "array", items: { type: "string" } },
        "x-note": { type: "string" },
      },
    });
  });

  it("records a removed method without the upstream examples and code samples", () => {
    const next = base();
    const current = base();
    const retrieve = ((current.paths as Doc)["/v3/items/{id}/"] as Record<string, Doc>).get!;
    retrieve["x-codeSamples"] = [{ lang: "curl", source: "curl -H 'x-api-key: sample-key'" }];
    (current.components as { schemas: Record<string, Doc> }).schemas.Item!.example = {
      id: "sample-id",
    };
    delete (next.paths as Doc)["/v3/items/{id}/"];
    const files = new Map<string, Uint8Array | undefined>([
      ["verification.json", bytes(current)],
      ["account.json", bytes(openapi({ "/x/": { get: json({}) } }))],
      ["overlay.json", bytes(OVERLAY)],
    ]);
    const downloads = new Map([
      ["verification.json", bytes(next)],
      ["account.json", files.get("account.json")!],
    ]);
    const result = sync({ files, downloads, now: NOW, version: "0.3.1" });
    const text = dec.decode(result.writes.get("deprecated-operations.json"));
    expect(text).toContain('"items.retrieve"');
    expect(text).not.toContain("sample");
  });

  it("releases nothing for changes to operations that server SDKs do not expose", () => {
    const hidden = (name: string): Doc => ({
      ...json({}),
      "x-didit-sdk": { resource: "pickup", method: name, auth: "device_token", server: false },
    });
    const current = base();
    (current.paths as Doc)["/v3/pickup/"] = { get: hidden("retrieve"), delete: hidden("delete") };
    const next = base();
    (next.paths as Doc)["/v3/pickup/"] = {
      get: {
        ...hidden("retrieve"),
        parameters: [{ in: "query", name: "token", required: true, schema: { type: "string" } }],
      },
      post: hidden("create"),
    };
    const files = new Map<string, Uint8Array | undefined>([
      ["verification.json", bytes(current)],
      ["account.json", bytes(openapi({ "/x/": { get: json({}) } }))],
      ["overlay.json", bytes(OVERLAY)],
    ]);
    const downloads = new Map([
      ["verification.json", bytes(next)],
      ["account.json", files.get("account.json")!],
    ]);
    const result = sync({ files, downloads, now: NOW, version: "0.3.1" });
    expect(result.changed).toBe(true);
    expect(result.release).toBe("none");
    expect(result.summary).toContain("## Breaking changes\nNone detected.");
    expect(result.summary).toContain(
      "`GET /v3/pickup/` (not exposed by server SDKs): parameter added: token (query), required",
    );
    expect(result.summary).toContain(
      "`POST /v3/pickup/` (not exposed by server SDKs: device_token)",
    );
    expect(result.summary).toContain("`DELETE /v3/pickup/` (not exposed by server SDKs)");
  });

  it("moves the overlay naming with an operation that keeps its operationId on a new path", () => {
    const current = base();
    ((current.paths as Doc)["/v3/items/{id}/"] as Record<string, Doc>).get!.operationId =
      "items_retrieve";
    const next = structuredClone(current);
    const paths = next.paths as Doc;
    paths["/v3/items/{id}/detail/"] = paths["/v3/items/{id}/"];
    delete paths["/v3/items/{id}/"];
    const files = new Map<string, Uint8Array | undefined>([
      ["verification.json", bytes(current)],
      ["account.json", bytes(openapi({ "/x/": { get: json({}) } }))],
      ["overlay.json", bytes(OVERLAY)],
    ]);
    const downloads = new Map([
      ["verification.json", bytes(next)],
      ["account.json", files.get("account.json")!],
    ]);
    const result = sync({ files, downloads, now: NOW, version: "0.3.1" });
    expect(result.summary).toContain(
      "`GET /v3/items/{id}/detail/` -> `items.retrieve` (moved from `GET /v3/items/{id}/`, same operationId",
    );
    expect(result.summary).toContain(
      "`items.retrieve` moved from `GET /v3/items/{id}/` to `GET /v3/items/{id}/detail/`: same parameters, body and response",
    );
    expect(result.summary).toContain("## Deprecated methods\nNone.");
    expect(result.summary).not.toContain("no SDK naming");
    expect(written(result, "overlay.json").operations).toEqual({
      "GET /v3/items/": naming("items", "list"),
      "GET /v3/items/{id}/detail/": naming("items", "retrieve"),
    });
    expect(written(result, "deprecated-operations.json").methods).toEqual({});
  });

  it("cuts a long summary at a line, with a note that says where the rest is", () => {
    expect(boundSummary("short\n", 100, "the job summary")).toBe("short\n");
    const long = Array.from({ length: 5000 }, (_, i) => `- line ${i}`).join("\n");
    const cut = boundSummary(long, 1000, "the job summary");
    expect(cut.length).toBeLessThanOrEqual(1000);
    expect(cut).toMatch(/^- line 0\n/);
    expect(cut).toContain(`it has ${long.length} characters`);
    expect(cut).toContain("The full summary is in the job summary.");
    expect(
      cut
        .split("\n")
        .filter((l) => l.startsWith("- line"))
        .every((l) => /^- line \d+$/.test(l)),
    ).toBe(true);
  });

  it("computes the next minor version and the removal version two minors on", () => {
    expect(nextMinor("0.3.1")).toBe("0.4.0");
    expect(nextMinor("1.9.0")).toBe("1.10.0");
    expect(nextMinor("garbage")).toBe("0.1.0");
    expect(removalVersion("0.3.1")).toBe("0.5.0");
    expect(removalVersion("1.9.2")).toBe("1.11.0");
  });

  it("changes nothing in the SDK when upstream takes over the overlay's naming as it is", () => {
    const next = base();
    const paths = next.paths as Record<string, Record<string, Doc>>;
    paths["/v3/items/"]!.get!["x-didit-sdk"] = naming("items", "list");
    paths["/v3/items/{id}/"]!.get!["x-didit-sdk"] = naming("items", "retrieve");
    const result = run(next);
    expect(result.release).toBe("none");
    expect(result.summary).toContain("## Changed operations (0)");
    expect(result.summary).toContain("## Overlay\nDropped 2 overlay entries");
    expect(written(result, "overlay.json").operations).toEqual({});
  });

  it("calls a scope or credentials change of a method breaking", () => {
    const next = base();
    (next.paths as Record<string, Record<string, Doc>>)["/v3/items/"]!.get!["x-didit-sdk"] = naming(
      "items",
      "list",
      { scope: "application" },
    );
    const result = run(next);
    expect(result.release).toBe("breaking");
    expect(result.summary).toContain('x-didit-sdk scope null -> "application" (breaking)');
  });

  it("keeps the types of removed schemas that a deprecated method still uses", () => {
    const next = base();
    delete (next.paths as Doc)["/v3/items/{id}/"];
    delete (next.paths as Doc)["/v3/items/"];
    (next.paths as Doc)["/v3/other/"] = {
      get: { ...json({}), "x-didit-sdk": naming("o", "list") },
    };
    delete (next.components as { schemas: Doc }).schemas.Item;
    const result = run(next);
    expect(result.release).toBe("feature");
    expect(result.summary).toContain(
      "verification.json removed upstream, type kept for the deprecated methods that use it: `Item`",
    );
    expect(result.summary).not.toContain("its type leaves the SDK");
  });

  it("calls a removed schema that nothing uses any more breaking", () => {
    const current = base();
    (current.components as { schemas: Doc }).schemas.Orphan = { type: "string" };
    const files = new Map<string, Uint8Array | undefined>([
      ["verification.json", bytes(current)],
      ["account.json", bytes(openapi({ "/x/": { get: json({}) } }))],
      ["overlay.json", bytes(OVERLAY)],
    ]);
    const downloads = new Map([
      ["verification.json", bytes(base())],
      ["account.json", files.get("account.json")!],
    ]);
    const result = sync({ files, downloads, now: NOW, version: "0.3.1" });
    expect(result.release).toBe("breaking");
    expect(result.summary).toContain("schema `Orphan` removed (its type leaves the SDK)");
  });

  it("releases nothing for a change of descriptions only", () => {
    const next = base();
    const item = (next.components as { schemas: Record<string, Doc> }).schemas.Item!;
    item.description = "An item.";
    ((next.paths as Doc)["/v3/items/"] as Record<string, Doc>).get!.summary = "List items";
    const result = run(next);
    expect(result.changed).toBe(true);
    expect(result.release).toBe("none");
    expect(result.summary).toContain("verification.json descriptions or examples changed: `Item`");
  });
});
