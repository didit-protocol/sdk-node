import { describe, expect, it } from "vitest";

import Didit, { APIResponseValidationError, DiditError, PagePromise } from "../../src/index.js";
import { fakeFetch, type RecordedRequest } from "../helpers/mock-api.js";

const API = "https://verification.didit.me";

function pages(handler: (req: RecordedRequest) => unknown) {
  const { fetch, calls } = fakeFetch((req) => ({ json: handler(req) }));
  return { didit: new Didit({ apiKey: "k", maxRetries: 0, fetch }), calls };
}

function page(offset: number, total: number, size = 2, origin = API) {
  const results = Array.from({ length: Math.min(size, total - offset) }, (_, i) => ({
    id: offset + i,
  }));
  const next =
    offset + size < total ? `${origin}/v3/workflows/?limit=${size}&offset=${offset + size}` : null;
  const previous =
    offset > 0 ? `${origin}/v3/workflows/?limit=${size}&offset=${offset - size}` : null;
  return { count: total, next, previous, results };
}

describe("pages", () => {
  it("resolves to the first page with its fields and helpers", async () => {
    const { didit, calls } = pages(() => page(0, 5));
    const first = await didit.workflows.list({ limit: 2 } as never);
    expect(first.count).toBe(5);
    expect(first.results).toEqual([{ id: 0 }, { id: 1 }]);
    expect(first.next).toBe(`${API}/v3/workflows/?limit=2&offset=2`);
    expect(first.previous).toBeNull();
    expect(first.hasNextPage()).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("keeps the extra fields of a list response", async () => {
    const { didit } = pages(() => ({ ...page(0, 1), total_transactions: 1 }));
    const first = await didit.transactions.list();
    expect(first.total_transactions).toBe(1);
  });

  it("walks every item of every page with for await, sending the key to the API only", async () => {
    const { didit, calls } = pages((req) => page(Number(req.query.offset ?? 0), 5));
    const ids: unknown[] = [];
    for await (const item of didit.workflows.list({ limit: 2 } as never))
      ids.push((item as { id: number }).id);
    expect(ids).toEqual([0, 1, 2, 3, 4]);
    expect(calls.map((c) => c.url.search)).toEqual([
      "?limit=2",
      "?limit=2&offset=2",
      "?limit=2&offset=4",
    ]);
    expect(calls.every((c) => c.headers.get("x-api-key") === "k" && c.origin === API)).toBe(true);
  });

  it("iterates pages and fetches the next page explicitly", async () => {
    const { didit } = pages((req) => page(Number(req.query.offset ?? 0), 3));
    const first = await didit.workflows.list({ limit: 2 } as never);
    const second = await first.getNextPage();
    expect(second.results).toEqual([{ id: 2 }]);
    expect(second.hasNextPage()).toBe(false);
    await expect(second.getNextPage()).rejects.toBeInstanceOf(DiditError);
    const sizes: number[] = [];
    for await (const p of first.iterPages()) sizes.push(p.results?.length ?? 0);
    expect(sizes).toEqual([2, 1]);
  });

  it("is a PagePromise with access to the raw response", async () => {
    const { didit } = pages(() => page(0, 1));
    const promise = didit.workflows.list();
    expect(promise).toBeInstanceOf(PagePromise);
    const { data, response } = await promise.withResponse();
    expect(response.status).toBe(200);
    expect(data.results).toHaveLength(1);
  });

  it("resolves a relative next link against the current page", async () => {
    const { didit, calls } = pages((req) =>
      req.query.offset
        ? { count: 2, next: null, previous: null, results: [{ id: 1 }] }
        : { count: 2, next: "?offset=1", previous: null, results: [{ id: 0 }] },
    );
    const ids: unknown[] = [];
    for await (const item of didit.workflows.list()) ids.push(item);
    expect(ids).toHaveLength(2);
    expect(calls[1]!.url.href).toBe(`${API}/v3/workflows/?offset=1`);
  });

  it("refuses a next link to another origin, before sending anything there", async () => {
    const { didit, calls } = pages(() => page(0, 5, 2, "https://evil.example"));
    const first = await didit.workflows.list();
    const error = await first.getNextPage().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(APIResponseValidationError);
    expect((error as Error).message).toMatch(/another origin/);
    expect(calls).toHaveLength(1);
  });

  it("refuses a next link with another scheme or an invalid URL", async () => {
    const { didit } = pages(() => ({
      count: 2,
      next: "javascript:alert(1)",
      previous: null,
      results: [],
    }));
    await expect((await didit.workflows.list()).getNextPage()).rejects.toBeInstanceOf(
      APIResponseValidationError,
    );
    const broken = pages(() => ({ count: 2, next: "http://[::1", previous: null, results: [] }));
    await expect((await broken.didit.workflows.list()).getNextPage()).rejects.toThrow(
      /invalid pagination link/,
    );
  });

  it("stops a next link that repeats an earlier page", async () => {
    const { didit } = pages(() => ({
      count: 9,
      next: `${API}/v3/workflows/?offset=2`,
      previous: null,
      results: [{ id: 0 }],
    }));
    const items: unknown[] = [];
    const error = await (async () => {
      for await (const item of didit.workflows.list()) items.push(item);
    })().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(APIResponseValidationError);
    expect(items).toHaveLength(2);
  });

  it("refuses a list response that is not an object", async () => {
    const { didit } = pages(() => [1, 2]);
    await expect(didit.workflows.list()).rejects.toBeInstanceOf(APIResponseValidationError);
    const later = pages((req) => (req.query.offset ? "nope" : page(0, 4)));
    await expect((await later.didit.workflows.list()).getNextPage()).rejects.toBeInstanceOf(
      APIResponseValidationError,
    );
  });

  it("treats an empty results list or a missing one as no items", async () => {
    const { didit } = pages(() => ({ count: 0, next: "", previous: null }));
    const items: unknown[] = [];
    for await (const item of didit.workflows.list()) items.push(item);
    expect(items).toEqual([]);
  });

  it("decodes the date-times of every page", async () => {
    const { didit } = pages((req) => ({
      count: 2,
      next: req.query.offset ? null : `${API}/v3/transactions/?offset=1`,
      previous: null,
      results: [
        { uuid: "t", created_at: "2026-01-01T00:00:00Z", txn_date: "2026-01-01T00:00:00Z" },
      ],
    }));
    let n = 0;
    for await (const item of didit.transactions.list()) {
      expect(item.created_at).toBeInstanceOf(Date);
      n++;
    }
    expect(n).toBe(2);
  });

  it("allows walking the same pages twice", async () => {
    const { didit, calls } = pages((req) => page(Number(req.query.offset ?? 0), 4));
    const first = await didit.workflows.list({ limit: 2 } as never);
    for (let i = 0; i < 2; i++) {
      const items: unknown[] = [];
      for await (const item of first) items.push(item);
      expect(items).toHaveLength(4);
    }
    expect(calls).toHaveLength(3);
  });
});
