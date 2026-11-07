import { describe, expect, it } from "vitest";

import {
  boundSummary,
  checkOpenAPI,
  commitMessage,
  detach,
  nextMinor,
  normalized,
  releaseSection,
  removalVersion,
  SpecSyncError,
  sync,
  syncTitle,
  type BreakingChange,
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
      type: "chore",
      breaking: [],
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
    expect(result.breaking).toEqual([]);
    expect(result.type).toBe("chore");
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
    // The operation left the API, which can break typed code; the method stays deprecated.
    expect(result.type).toBe("feat");
    expect(result.breaking).toEqual([
      {
        operation: "GET /v3/items/{id}/",
        in: "operation",
        field: "",
        kind: "operation removed",
        text: "`GET /v3/items/{id}/` was removed (`items.retrieve` stays as a deprecated method until version 0.5.0)",
      },
    ]);
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
    expect(result.breaking).toEqual([]);
    expect(result.type).toBe("feat");
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
    // Its method goes from server SDKs, which counts like a removed operation.
    expect(result.breaking.map(normalized)).toEqual(["GET /v3/items/{id}/: operation removed"]);
    expect(result.breaking[0]!.text).toBe(
      "`GET /v3/items/{id}/` is no longer a server operation: it now needs device_token (`items.retrieve` stays as a deprecated method until version 0.5.0)",
    );
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
    expect(result.type).toBe("feat");
    expect(result.breaking.map((b) => [b.operation, b.in, b.field, b.kind])).toEqual([
      ["GET /v3/items/", "response", "[].id", "type string -> integer"],
      ["GET /v3/items/", "response", "[].name", "removed"],
      ["GET /v3/items/", "query", "status", "now required"],
      ["GET /v3/items/{id}/", "response", "id", "type string -> integer"],
      ["GET /v3/items/{id}/", "response", "name", "removed"],
    ]);
    expect(result.summary).toMatch(
      /^## Breaking changes\n- `GET \/v3\/items\/` response field `\[\]\.id` changed type from string to integer\n/,
    );
    expect(result.summary).toContain(
      "- `GET /v3/items/` query parameter `status` was added and is required\n",
    );
    const changed = result.summary.slice(result.summary.indexOf("## Changed operations"));
    expect(changed).toContain("parameter added: status (query), required (breaking)");
    expect(changed).toContain("response[].id: type string -> integer (breaking)");
    expect(changed).toContain("response[].name: removed (breaking)");
    expect(changed).toContain("response[].extra: added");
    expect(changed).not.toContain("response[].extra: added (breaking)");
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
      "x-codeSamples": [{ lang: "curl", source: "curl https://example.invalid/sample" }],
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
    retrieve["x-codeSamples"] = [{ lang: "curl", source: "curl https://example.invalid/sample" }];
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

  it("lists changes to operations that server SDKs do not expose, never counting them", () => {
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
    // A caller can observe them (DESIGN section 3.1), but no server SDK method calls them.
    expect(result.type).toBe("feat");
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

  it("moves naming only between operations of the same document", () => {
    const account = openapi({ "/x/": { get: { ...json({}), operationId: "shared_id" } } });
    const nextAccount = openapi({ "/y/": { get: json({}) } });
    const next = base();
    (next.paths as Doc)["/v3/new/"] = { get: { ...json({}), operationId: "shared_id" } };
    const files = new Map<string, Uint8Array | undefined>([
      ["verification.json", bytes(base())],
      ["account.json", bytes(account)],
      [
        "overlay.json",
        bytes({
          ...OVERLAY,
          operations: { ...OVERLAY.operations, "account GET /x/": naming("account.x", "list") },
        }),
      ],
    ]);
    const downloads = new Map([
      ["verification.json", bytes(next)],
      ["account.json", bytes(nextAccount)],
    ]);
    const result = sync({ files, downloads, now: NOW, version: "0.3.1" });
    expect(result.summary).toContain("`GET /v3/new/`: **no SDK naming**");
    expect((written(result, "overlay.json").operations as Doc)["GET /v3/new/"]).toBeUndefined();
  });

  it("cuts a long summary at a line, with a note that says where the rest is", () => {
    expect(boundSummary("short\n", 100, "the job summary")).toBe("short\n");
    const long = Array.from({ length: 5000 }, (_, i) => `- line ${i}`).join("\n");
    const cut = boundSummary(long, 1000, "the job summary");
    expect(cut.length).toBeLessThanOrEqual(1000);
    for (let max = 200; max < 260; max++) {
      expect(boundSummary(long, max, "x").length).toBeLessThanOrEqual(max);
    }
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
    expect(result.type).toBe("chore");
    expect(result.summary).toContain("## Changed operations (0)");
    expect(result.summary).toContain("## Overlay\nDropped 2 overlay entries");
    expect(written(result, "overlay.json").operations).toEqual({});
  });

  it("releases a scope or credentials change of a method as a feature, not as breaking", () => {
    const next = base();
    (next.paths as Record<string, Record<string, Doc>>)["/v3/items/"]!.get!["x-didit-sdk"] = naming(
      "items",
      "list",
      { scope: "application" },
    );
    const result = run(next);
    expect(result.type).toBe("feat");
    expect(result.breaking).toEqual([]);
    expect(result.summary).toContain('`GET /v3/items/`: x-didit-sdk scope null -> "application"');
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
    expect(result.type).toBe("feat");
    expect(result.summary).toContain(
      "verification.json removed upstream, type kept for the deprecated methods that use it: `Item`",
    );
    expect(result.summary).not.toContain("its type leaves the SDK");
  });

  it("releases a removed schema that nothing uses any more as a feature", () => {
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
    expect(result.type).toBe("feat");
    expect(result.breaking).toEqual([]);
    expect(result.summary).toContain(
      "verification.json removed (its type leaves the SDK): `Orphan`",
    );
  });

  it("releases nothing for a change of descriptions only", () => {
    const next = base();
    const item = (next.components as { schemas: Record<string, Doc> }).schemas.Item!;
    item.description = "An item.";
    ((next.paths as Doc)["/v3/items/"] as Record<string, Doc>).get!.summary = "List items";
    const result = run(next);
    expect(result.changed).toBe(true);
    expect(result.type).toBe("chore");
    expect(result.breaking).toEqual([]);
    expect(result.summary).toContain("verification.json descriptions or examples changed: `Item`");
  });
});

// The changes that can break typed code (DESIGN section 3.1) -----------------------

const ACCOUNT = openapi({ "/x/": { get: json({}) } });

/** Sync `before` to `after` (verification.json), every operation named upstream. */
function classify(before: Doc, after: Doc, extra: [string, Doc, Doc][] = []) {
  const files = new Map<string, Uint8Array | undefined>([
    ["verification.json", bytes(before)],
    ["account.json", bytes(ACCOUNT)],
    ["overlay.json", bytes({ operations: {} })],
  ]);
  const downloads = new Map([
    ["verification.json", bytes(after)],
    ["account.json", bytes(ACCOUNT)],
  ]);
  for (const [name, old, next] of extra) {
    files.set(name, bytes(old));
    downloads.set(name, bytes(next));
  }
  return sync({ files, downloads, now: NOW, version: "2.1.0" });
}

function places(breaking: BreakingChange[]): string[][] {
  return breaking.map((b) => [b.operation, b.in, b.field, b.kind]);
}

/** An operation with a JSON body and response, named `things.<method>` upstream. */
function thing(method: string, request: unknown, response: unknown, parameters: unknown[] = []) {
  return {
    "x-didit-sdk": naming("things", method),
    parameters,
    requestBody: { content: { "application/json": { schema: request } } },
    ...json(response),
  };
}

function object(properties: Doc, required: string[] = []): Doc {
  return { type: "object", required, properties };
}

describe("changes that can break typed code", () => {
  it("lists a type change of a field or parameter in either direction", () => {
    const before = openapi({
      "/v3/things/": {
        post: thing(
          "create",
          object({
            count: { type: "integer" },
            tags: { type: "array", items: { type: "string" } },
          }),
          object({ score: { type: "number" } }),
          [{ in: "query", name: "limit", schema: { type: "integer" } }],
        ),
      },
    });
    const after = openapi({
      "/v3/things/": {
        post: thing(
          "create",
          object({
            count: { type: "number" },
            tags: { type: "array", items: { type: "integer" } },
          }),
          object({ score: { type: "integer" } }),
          [{ in: "query", name: "limit", schema: { type: "string" } }],
        ),
      },
    });
    const result = classify(before, after);
    expect(result.type).toBe("feat");
    expect(places(result.breaking)).toEqual([
      ["POST /v3/things/", "request", "count", "type integer -> number"],
      ["POST /v3/things/", "query", "limit", "type integer -> string"],
      ["POST /v3/things/", "response", "score", "type number -> integer"],
      ["POST /v3/things/", "request", "tags[]", "type string -> integer"],
    ]);
    expect(result.breaking[0]!.text).toBe(
      "`POST /v3/things/` request field `count` changed type from integer to number",
    );
    expect(result.breaking[1]!.text).toBe(
      "`POST /v3/things/` query parameter `limit` changed type from integer to string",
    );
  });

  it("lists a type change through a string format with its own type, a union or no type", () => {
    const before = openapi({
      "/v3/things/": {
        post: thing(
          "create",
          object({ file: { type: "string" } }),
          object({
            at: { type: "string" },
            on: { type: "string", format: "date" },
            value: { type: "string" },
            since: { type: "string" },
            meta: {},
          }),
        ),
      },
    });
    const after = openapi({
      "/v3/things/": {
        post: thing(
          "create",
          object({ file: { type: "string", format: "binary" } }),
          object({
            at: { type: "string", format: "date-time" },
            on: { type: "string" },
            value: { oneOf: [{ type: "integer" }, { type: "boolean" }] },
            // A union of the same type is the same type.
            since: { anyOf: [{ type: "string" }, { type: "string", pattern: "^[0-9]+$" }] },
            meta: { type: "object" },
          }),
        ),
      },
    });
    const result = classify(before, after);
    expect(result.type).toBe("feat");
    expect(places(result.breaking)).toEqual([
      ["POST /v3/things/", "response", "at", "type string -> string (date-time)"],
      ["POST /v3/things/", "request", "file", "type string -> string (binary)"],
      ["POST /v3/things/", "response", "meta", "type any -> object"],
      ["POST /v3/things/", "response", "on", "type string (date) -> string"],
      ["POST /v3/things/", "response", "value", "type string -> boolean|integer"],
    ]);
    expect(result.breaking[0]!.text).toBe(
      "`POST /v3/things/` response field `at` changed type from string to string (date-time)",
    );
    expect(result.breaking[4]!.text).toBe(
      "`POST /v3/things/` response field `value` changed type from string to boolean or integer",
    );
  });

  it("lists a field or parameter that can now be null, through $refs, array items and every null notation", () => {
    const company = object({
      registry_data: object({}),
      owner: object({}),
      channel: { type: "string" },
      status: { type: "string", enum: ["open"] },
    });
    const before = openapi(
      {
        "/v3/things/{id}/": {
          get: {
            "x-didit-sdk": naming("things", "retrieve"),
            parameters: [{ in: "query", name: "q", schema: { type: "string" } }],
            ...json(
              object({
                checks: { type: "array", items: { $ref: "#/components/schemas/Company" } },
              }),
            ),
          },
        },
        "/v3/things/": { post: thing("create", object({ note: { type: "string" } }), object({})) },
      },
      { Company: company },
    );
    const after = structuredClone(before);
    const schemas = (after.components as { schemas: Record<string, Doc> }).schemas;
    schemas.Company = object({
      registry_data: { ...object({}), nullable: true },
      owner: { anyOf: [object({}), { type: "null" }] },
      channel: { type: ["string", "null"] },
      status: { type: "string", enum: ["open", null] },
    });
    const paths = after.paths as Record<string, Record<string, Doc>>;
    paths["/v3/things/{id}/"]!.get!.parameters = [
      { in: "query", name: "q", schema: { type: "string", nullable: true } },
    ];
    paths["/v3/things/"]!.post = thing(
      "create",
      object({ note: { type: "string", nullable: true } }),
      object({}),
    );
    const result = classify(before, after);
    expect(places(result.breaking)).toEqual([
      ["GET /v3/things/{id}/", "response", "checks[].channel", "can now be null"],
      ["GET /v3/things/{id}/", "response", "checks[].owner", "can now be null"],
      ["GET /v3/things/{id}/", "response", "checks[].registry_data", "can now be null"],
      ["GET /v3/things/{id}/", "response", "checks[].status", "can now be null"],
    ]);
    // A request that accepts null only widens what a caller may send: listed, not counted.
    expect(result.summary).toContain("parameter q (query): can now be null\n");
    expect(result.summary).toContain("body.note: can now be null");
    expect(result.summary).not.toContain("body.note: can now be null (breaking)");
    expect(result.summary).not.toContain("checks[].owner: removed");
  });

  it("lists a removed operation, field or enum value", () => {
    const status = (values: string[]): Doc => ({ type: "string", enum: values });
    const before = openapi({
      "/v3/things/": {
        post: thing(
          "create",
          object({ kind: status(["x", "y"]), legacy: { type: "string" } }),
          object({ id: { type: "string" }, status: status(["a", "b", "c"]) }),
          [{ in: "query", name: "old", schema: { type: "string" } }],
        ),
      },
      "/v3/things/{id}/": { delete: thing("delete", object({}), object({})) },
    });
    const after = openapi({
      "/v3/things/": {
        post: thing(
          "create",
          object({ kind: status(["x"]) }),
          object({ status: status(["a", "b", "d"]) }),
        ),
      },
    });
    const result = classify(before, after);
    expect(places(result.breaking)).toEqual([
      ["DELETE /v3/things/{id}/", "operation", "", "operation removed"],
      ["POST /v3/things/", "response", "id", "removed"],
      ["POST /v3/things/", "request", "kind", 'enum value "y" removed'],
      ["POST /v3/things/", "request", "legacy", "removed"],
      ["POST /v3/things/", "query", "old", "removed"],
      ["POST /v3/things/", "response", "status", 'enum value "c" removed'],
    ]);
    expect(result.breaking.map((b) => b.text)).toEqual([
      "`DELETE /v3/things/{id}/` was removed (`things.delete` stays as a deprecated method until version 2.3.0)",
      "`POST /v3/things/` response field `id` was removed",
      '`POST /v3/things/` request field `kind` no longer has the enum value `"y"`',
      "`POST /v3/things/` request field `legacy` was removed",
      "`POST /v3/things/` query parameter `old` was removed",
      '`POST /v3/things/` response field `status` no longer has the enum value `"c"`',
    ]);
    expect(result.breaking.map(normalized)).toEqual([
      "DELETE /v3/things/{id}/: operation removed",
      "POST /v3/things/ response id: removed",
      'POST /v3/things/ request body kind: enum value "y" removed',
      "POST /v3/things/ request body legacy: removed",
      "POST /v3/things/ query old: removed",
      'POST /v3/things/ response status: enum value "c" removed',
    ]);
    // An added enum value is not on the list: enums are open.
    expect(result.summary).toContain("parameter removed: old (query) (breaking)");
    expect(result.summary).toContain('response.status: values added ["d"]');
  });

  it("lists a newly required parameter, request field or body, and a response field no longer required", () => {
    const before = openapi({
      "/v3/things/": {
        post: thing(
          "create",
          object({ name: { type: "string" }, email: { type: "string" } }, ["email"]),
          object({ id: { type: "string" } }, ["id"]),
          [{ in: "query", name: "mode", schema: { type: "string" } }],
        ),
      },
    });
    const after = openapi({
      "/v3/things/": {
        post: thing(
          "create",
          object(
            { name: { type: "string" }, email: { type: "string" }, phone: { type: "string" } },
            ["name", "phone"],
          ),
          object({ id: { type: "string" } }),
          [
            { in: "query", name: "mode", required: true, schema: { type: "string" } },
            { in: "header", name: "x-tenant", required: true, schema: { type: "string" } },
          ],
        ),
      },
    });
    (
      (after.paths as Doc)["/v3/things/"] as { post: { requestBody: Doc } }
    ).post.requestBody.required = true;
    const result = classify(before, after);
    expect(places(result.breaking)).toEqual([
      ["POST /v3/things/", "request", "", "body now required"],
      ["POST /v3/things/", "response", "id", "no longer required"],
      ["POST /v3/things/", "query", "mode", "now required"],
      ["POST /v3/things/", "request", "name", "now required"],
      ["POST /v3/things/", "request", "phone", "now required"],
      ["POST /v3/things/", "header", "x-tenant", "now required"],
    ]);
    expect(normalized(result.breaking[0]!)).toBe("POST /v3/things/: body now required");
    expect(result.breaking[0]!.text).toBe("`POST /v3/things/` the request body is now required");
    expect(result.breaking[1]!.text).toBe(
      "`POST /v3/things/` response field `id` is no longer required (it can be missing)",
    );
    // A request field that stops being required only widens what a caller may send.
    expect(result.summary).toContain("body.email: now optional\n");
  });

  it("lists a removed oneOf or anyOf variant as a type change, in a response and a request", () => {
    const value = (variants: Doc[]): Doc => object({ value: { oneOf: variants } });
    const before = openapi({
      "/v3/things/": {
        post: thing(
          "create",
          value([{ type: "string" }]),
          value([{ type: "string" }, { type: "integer" }]),
        ),
      },
    });
    const after = openapi({
      "/v3/things/": {
        post: thing(
          "create",
          value([{ type: "string" }, { type: "integer" }]),
          value([{ type: "string" }]),
        ),
      },
    });
    const result = classify(before, after);
    // A type change counts in either direction, also where it widens a request.
    expect(places(result.breaking)).toEqual([
      ["POST /v3/things/", "response", "value", "type integer|string -> string"],
      ["POST /v3/things/", "request", "value", "type string -> integer|string"],
    ]);
    expect(result.breaking[0]!.text).toBe(
      "`POST /v3/things/` response field `value` changed type from integer or string to string",
    );
    // A union that keeps several variants loses one as a type change of its own.
    const three = classify(
      openapi({
        "/v3/things/": {
          post: thing("create", object({}), value([{ type: "string" }, object({}), object({})])),
        },
      }),
      openapi({
        "/v3/things/": {
          post: thing("create", object({}), value([{ type: "string" }, object({})])),
        },
      }),
    );
    expect(three.breaking.map(normalized)).toEqual([
      "POST /v3/things/ response value: type object|object|string -> object|string",
    ]);
    expect(three.breaking[0]!.text).toBe(
      "`POST /v3/things/` response field `value` lost 1 of its oneOf variants (changed type from object or object or string to object or string)",
    );
  });

  it("pairs union variants, so a change inside one counts even when others are added or reordered", () => {
    const card = (last4: string): Doc =>
      object({ kind: { type: "string", enum: ["card"] }, last4: { type: last4 } }, ["kind"]);
    const bank = object({ kind: { type: "string", enum: ["bank"] }, iban: { type: "string" } }, [
      "kind",
    ]);
    const wallet = object({
      kind: { type: "string", enum: ["wallet"] },
      address: { type: "string" },
    });
    const before = openapi({
      "/v3/things/": { post: thing("create", object({}), { oneOf: [card("string"), bank] }) },
    });
    const after = openapi({
      "/v3/things/": {
        post: thing("create", object({}), {
          oneOf: [bank, wallet, { ...card("integer"), title: "Card" }],
        }),
      },
    });
    const result = classify(before, after);
    expect(result.breaking.map(normalized)).toEqual([
      "POST /v3/things/ response (oneOf 3).last4: type string -> integer",
    ]);
    const changed = result.summary.slice(result.summary.indexOf("## Changed operations"));
    expect(changed).toContain("response: 1 oneOf variant(s) added");
    expect(changed).toContain("response: oneOf variants reordered");
    // The title names the variant's generated type: listed, not counted.
    expect(changed).toContain(
      "response(oneOf 3): variant type renamed from a numbered name to Card",
    );
  });

  it("compares the fields a union shares beside its variants, also the last one or the first", () => {
    const card = object({ last4: { type: "string" } });
    const bank = object({ iban: { type: "string" } });
    const union = (shared: Doc | undefined): Doc => ({
      ...(shared ? object(shared, Object.keys(shared)) : {}),
      oneOf: [card, bank],
    });
    const shared = { id: { type: "string" } };
    const removed = classify(
      openapi({ "/v3/things/": { post: thing("create", union(shared), union(shared)) } }),
      openapi({ "/v3/things/": { post: thing("create", union(undefined), union(undefined)) } }),
    );
    expect(removed.breaking.map(normalized)).toEqual([
      "POST /v3/things/ request body id: removed",
      "POST /v3/things/ response id: removed",
    ]);
    // A shared field that comes is listed in a response, and counts in a request when required.
    const added = classify(
      openapi({ "/v3/things/": { post: thing("create", union(undefined), union(undefined)) } }),
      openapi({ "/v3/things/": { post: thing("create", union(shared), union(shared)) } }),
    );
    expect(added.breaking.map(normalized)).toEqual(["POST /v3/things/ request body id: now required"]);
    expect(added.summary).toContain("response.id: added");
    // A plain object that becomes a union is still compared as one of its variants.
    const split = classify(
      openapi({ "/v3/things/": { post: thing("create", object({}), card) } }),
      openapi({ "/v3/things/": { post: thing("create", object({}), union(undefined)) } }),
    );
    expect(split.breaking).toEqual([]);
  });

  it("lists everything else in the summary only, and releases it as a feature", () => {
    const before = openapi({
      "/v3/things/": {
        post: thing(
          "create",
          object({ note: { type: "string", nullable: true }, kind: { type: "string" } }),
          object({ at: { type: "string" } }),
        ),
      },
    });
    const after = openapi({
      "/v3/things/": {
        post: {
          ...thing(
            "create",
            object({ note: { type: "string" }, kind: { type: "string", enum: ["a"] } }),
            object({ at: { type: "string", format: "email" } }),
          ),
          deprecated: true,
        },
      },
    });
    const result = classify(before, after);
    expect(result.type).toBe("feat");
    expect(result.breaking).toEqual([]);
    expect(result.summary).toContain("## Breaking changes\nNone detected.");
    for (const note of [
      "body.note: no longer accepts null",
      'body.kind: now limited to ["a"]',
      "response.at: format changed",
      "marked deprecated upstream",
    ])
      expect(result.summary).toContain(note);
  });

  it("releases a change of an error response as a feature, and documentation alone as nothing", () => {
    const op = (error: Doc, extra: Doc = {}): Doc => {
      const base = thing("create", object({}), object({ id: { type: "string" } }));
      return {
        ...base,
        ...extra,
        responses: {
          ...(base.responses as Doc),
          "400": { description: "bad", content: { "application/json": { schema: error } } },
        },
      };
    };
    const before = openapi({ "/v3/things/": { post: op(object({ detail: { type: "string" } })) } });
    const errors = openapi({ "/v3/things/": { post: op(object({ code: { type: "string" } })) } });
    const docs = openapi({
      "/v3/things/": {
        post: op(object({ detail: { type: "string", description: "Why." } }), {
          summary: "Create a thing",
          tags: ["Things"],
          operationId: "things_create",
        }),
      },
    });
    const changed = classify(before, errors);
    expect(changed.type).toBe("feat");
    expect(changed.summary).toContain(
      "`POST /v3/things/`: other request or response details changed",
    );
    expect(classify(before, docs).type).toBe("chore");
  });

  it("releases a change of a referenced error response as a feature when the operation is the same", () => {
    const doc = (error: Doc, description = "bad"): Doc => {
      const base = thing("create", object({}), object({ id: { type: "string" } }));
      return {
        ...openapi({
          "/v3/things/": {
            post: {
              ...base,
              responses: {
                ...(base.responses as Doc),
                "400": { $ref: "#/components/responses/Error" },
              },
            },
          },
        }),
        components: {
          schemas: {},
          responses: {
            Error: { description, content: { "application/json": { schema: error } } },
          },
        },
      };
    };
    const before = doc(object({ code: { type: "string" } }));
    const changed = classify(before, doc(object({ code: { type: "integer" } })));
    expect(changed.type).toBe("feat");
    expect(changed.summary).toContain("## Changed operations (1)");
    expect(changed.summary).toContain(
      "`POST /v3/things/`: other request or response details changed",
    );
    const docs = classify(before, doc(object({ code: { type: "string" } }), "Bad request."));
    expect(docs.type).toBe("chore");
    expect(docs.summary).toContain("## Changed operations (0)");
  });

  it("compares fields named like documentation keywords as fields", () => {
    const op = (fields: Doc): Doc =>
      openapi({ "/v3/things/": { post: thing("create", object({}), object(fields)) } });
    const before = op({
      description: { type: "string", description: "What matched." },
      title: { type: "string" },
      "x-id": { type: "string" },
    });
    const after = op({
      description: { type: "integer", description: "What matched." },
      title: { type: "string" },
    });
    const result = classify(before, after);
    expect(result.type).toBe("feat");
    expect(places(result.breaking)).toEqual([
      ["POST /v3/things/", "response", "description", "type string -> integer"],
      ["POST /v3/things/", "response", "x-id", "removed"],
    ]);
    // Only the description of the field named description changed: documentation.
    const docs = op({
      description: { type: "string", description: "Other words." },
      title: { type: "string" },
      "x-id": { type: "string" },
    });
    expect(classify(before, docs).type).toBe("chore");
  });

  it("compares a form request body like a JSON one", () => {
    const op = (count: Doc): Doc =>
      openapi({
        "/v3/things/": {
          post: {
            ...thing("create", object({}), object({})),
            requestBody: {
              content: {
                "application/x-www-form-urlencoded": { schema: object({ count }, ["count"]) },
              },
            },
          },
        },
      });
    const result = classify(op({ type: "string" }), op({ type: "integer" }));
    expect(result.type).toBe("feat");
    expect(places(result.breaking)).toEqual([
      ["POST /v3/things/", "request", "count", "type string -> integer"],
    ]);
  });

  it("follows a $ref to a request body or a response", () => {
    const doc = (request: Doc, response: Doc): Doc => ({
      ...openapi({
        "/v3/things/": {
          post: {
            "x-didit-sdk": naming("things", "create"),
            requestBody: { $ref: "#/components/requestBodies/Create" },
            responses: { "201": { $ref: "#/components/responses/Created" } },
          },
        },
      }),
      components: {
        schemas: {},
        requestBodies: { Create: { content: { "application/json": { schema: request } } } },
        responses: {
          Created: {
            description: "ok",
            content: { "application/json": { schema: response } },
          },
        },
      },
    });
    const before = doc(object({ name: { type: "string" } }), object({ id: { type: "string" } }));
    const after = doc(
      object({ name: { type: "string" }, email: { type: "string" } }, ["email"]),
      object({ id: { type: "integer" } }),
    );
    const result = classify(before, after);
    expect(result.type).toBe("feat");
    expect(places(result.breaking)).toEqual([
      ["POST /v3/things/", "request", "email", "now required"],
      ["POST /v3/things/", "response", "id", "type string -> integer"],
    ]);
  });

  it("compares every success response, lists a change they share once, and counts an added one without a body", () => {
    const op = (ok: Doc, accepted: Doc, extra: Doc = {}): Doc =>
      openapi({
        "/v3/things/": {
          post: {
            ...thing("create", object({}), ok),
            responses: {
              "200": { description: "ok", content: { "application/json": { schema: ok } } },
              "202": {
                description: "accepted",
                content: { "application/json": { schema: accepted } },
              },
              ...extra,
            },
          },
        },
      });
    const report = (id: string, status: string): Doc =>
      object({ id: { type: id }, status: { type: status } });
    const before = op(report("string", "string"), report("string", "string"));
    const after = op(report("integer", "string"), report("integer", "integer"), {
      "207": { description: "partial" },
    });
    const result = classify(before, after);
    expect(places(result.breaking)).toEqual([
      ["POST /v3/things/", "response", "", "can now be null"],
      ["POST /v3/things/", "response", "id", "type string -> integer"],
      ["POST /v3/things/", "response", "status", "type string -> integer"],
    ]);
    expect(result.summary).toContain("response 202.status: type string -> integer (breaking)");
    // The method returns every 2xx body: one without a body makes it nullable.
    expect(result.summary).toContain(
      "response: can now be null (status 207 has no body) (breaking)",
    );
    expect(result.breaking[0]!.text).toBe(
      "`POST /v3/things/` the response can now be null (success status 207 has no body)",
    );
  });

  it("counts a removed success status whose body no other one returns as a type change", () => {
    const op = (responses: Doc): Doc =>
      openapi({ "/v3/things/": { post: { ...thing("create", object({}), {}), responses } } });
    const body = (schema: Doc): Doc => ({
      description: "ok",
      content: { "application/json": { schema } },
    });
    const before = op({
      "200": body(object({ id: { type: "string" } })),
      "202": body({ type: "string" }),
    });
    const result = classify(before, op({ "200": body(object({ id: { type: "string" } })) }));
    expect(result.breaking.map(normalized)).toEqual([
      "POST /v3/things/ response: type object|string -> object",
    ]);
    // When no success status returns a body any more, the method returns null.
    const empty = classify(before, op({ "204": { description: "none" } }));
    expect([...new Set(empty.breaking.map(normalized))]).toEqual([
      "POST /v3/things/ response: can now be null",
      "POST /v3/things/ response: type object|string -> null",
    ]);
  });
});

describe("the hand-written Authentication document", () => {
  const auth = (paths: Doc): Doc => openapi(paths);
  const op = (method: string, extra: Doc = {}): Doc => ({
    ...json(object({ id: { type: "string" } })),
    "x-didit-sdk": {
      resource: "authentication",
      method,
      auth: "access_token",
      server: true,
      ...extra,
    },
  });

  it("lists its changes without naming, generating or deprecating a method", () => {
    const before = auth({
      "/session/": { get: op("get_session"), delete: op("revoke_session") },
      "/step-up/": { post: op("create_step_up") },
    });
    const after = auth({
      "/session/": { get: op("get_session") },
      "/step-up/": { post: op("start_step_up") },
      "/monitoring-token/": { post: op("create_monitoring_token", { server: false }) },
      "/userinfo/": { get: op("get_user_info") },
    });
    const result = classify(base(), base(), [["authentication.json", before, after]]);
    expect(result.type).toBe("feat");
    expect(places(result.breaking)).toEqual([
      ["authentication DELETE /session/", "operation", "", "operation removed"],
    ]);
    const follow =
      "the hand-written `authentication` module must follow (its contract test fails until it does)";
    expect(result.summary).toContain(
      `- \`authentication GET /userinfo/\` -> \`authentication.get_user_info\`: ${follow}`,
    );
    expect(result.summary).toContain(
      "- `authentication POST /monitoring-token/` (not exposed by server SDKs: access_token)",
    );
    expect(result.summary).toContain(
      `- \`authentication DELETE /session/\` (\`authentication.revoke_session\`): ${follow}`,
    );
    expect(result.summary).toContain(
      `- \`authentication POST /step-up/\`: \`authentication.create_step_up\` is now \`authentication.start_step_up\` upstream; ${follow}`,
    );
    expect(result.summary).toContain("## Deprecated methods\nNone.");
    expect(written(result, "deprecated-operations.json").methods).toEqual({});
    expect(written(result, "overlay.json").operations).toEqual({});
    expect(
      (written(result, "SOURCE.json") as Record<string, Doc>)["authentication.json"],
    ).toMatchObject({
      url: "https://docs.didit.me/openapi-authentication.json",
    });
  });
});

describe("the release section and title", () => {
  const change = (n: number): BreakingChange => ({
    operation: `GET /v3/things/${n}/`,
    in: "response",
    field: "value",
    kind: "can now be null",
    text: `\`GET /v3/things/${n}/\` response field \`value\` can now be null`,
  });

  it("titles the sync with its type, never with !", () => {
    expect(syncTitle("feat", "2026-11-07")).toBe("feat(spec): sync API spec 2026-11-07");
    expect(syncTitle("chore", "2026-11-07")).toBe("chore(spec): sync API spec 2026-11-07");
  });

  it("is empty for a chore(spec) sync, which releases nothing", () => {
    expect(releaseSection("chore", [], "2026-11-07")).toBe("");
  });

  it("overrides the commits with one feat(spec) line and one api(spec) line per change", () => {
    const section = releaseSection("feat", [change(1), change(2)], "2026-11-07");
    const block = section.slice(
      section.indexOf("BEGIN_COMMIT_OVERRIDE\n") + "BEGIN_COMMIT_OVERRIDE\n".length,
      section.indexOf("\nEND_COMMIT_OVERRIDE"),
    );
    expect(block).toBe(
      [
        "feat(spec): sync API spec 2026-11-07",
        "",
        "BEGIN_NESTED_COMMIT",
        "api(spec): `GET /v3/things/1/` response field `value` can now be null",
        "END_NESTED_COMMIT",
        "BEGIN_NESTED_COMMIT",
        "api(spec): `GET /v3/things/2/` response field `value` can now be null",
        "END_NESTED_COMMIT",
      ].join("\n"),
    );
    expect(section).toMatch(/^\n## Release\n/);
    expect(section).toContain('under "API changes that can break typed code"');
    // The markers appear once, so release-please reads exactly this block.
    expect(section.split("BEGIN_COMMIT_OVERRIDE")).toHaveLength(2);
    expect(section).not.toMatch(/BREAKING[ -]CHANGE|!:/);
    expect(releaseSection("feat", [], "2026-11-07")).not.toContain("BEGIN_NESTED_COMMIT");
    // The block is the sync commit's message.
    expect(block).toBe(commitMessage("feat", [change(1), change(2)], "2026-11-07").trimEnd());
  });

  it("lists every change, with no cap: a block too long for the description leaves it to the commit message", () => {
    const many = Array.from({ length: 500 }, (_, i) => change(i));
    const message = commitMessage("feat", many, "2026-11-07");
    expect(message.split("BEGIN_NESTED_COMMIT\napi(spec): ")).toHaveLength(501);
    expect(message).toMatch(/^feat\(spec\): sync API spec 2026-11-07\n\n/);
    expect(message).not.toMatch(/BREAKING[ -]CHANGE|!:|more changes/);
    // A few hundred fit the description's block.
    const some = many.slice(0, 200);
    expect(releaseSection("feat", some, "2026-11-07")).toContain(
      commitMessage("feat", some, "2026-11-07").trimEnd(),
    );
    const section = releaseSection("feat", many, "2026-11-07", 5_000);
    expect(section.length).toBeLessThanOrEqual(5_000);
    expect(section).not.toContain("BEGIN_COMMIT_OVERRIDE");
    expect(section).not.toContain("BEGIN_NESTED_COMMIT");
    expect(section).toContain(
      "The 500 changes that can break typed code do not fit this description",
    );
    expect(section).toContain(
      "keep the message of this branch's sync commit as the commit message",
    );
    expect(commitMessage("chore", [], "2026-11-07")).toBe(
      "chore(spec): sync API spec 2026-11-07\n",
    );
  });
});
