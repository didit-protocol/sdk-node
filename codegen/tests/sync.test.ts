import { describe, expect, it } from "vitest";

import { checkOpenAPI, detach, nextMinor, SpecSyncError, sync } from "../lib/sync.ts";
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
    expect(result.breaking).toBe(true);
    expect(result.summary).toContain(
      "`items.retrieve` was removed upstream (GET /v3/items/{id}/); kept as a deprecated method until version 0.4.0",
    );
    const deprecated = written(result, "deprecated-operations.json") as {
      methods: Record<string, Doc>;
    };
    const entry = deprecated.methods["items.retrieve"]!;
    expect(entry).toMatchObject({
      reason: "removed",
      operation_key: "GET /v3/items/{id}/",
      deprecated_since: "0.3.1",
      remove_in: "0.4.0",
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
    expect(result.breaking).toBe(true);
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

  it("computes the next minor version", () => {
    expect(nextMinor("0.3.1")).toBe("0.4.0");
    expect(nextMinor("1.9.0")).toBe("1.10.0");
    expect(nextMinor("garbage")).toBe("0.1.0");
  });
});
