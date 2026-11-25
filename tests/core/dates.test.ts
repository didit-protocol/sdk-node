import { describe, expect, it } from "vitest";

import { decodeDates, type DatePlan } from "../../src/core/dates.js";

import { mockClient, responseExample } from "../helpers/mock-api.js";

const ISO = "2026-10-17T10:00:00Z";
const at = (s: string): number => new Date(s).getTime();

describe("decodeDates", () => {
  it("turns a planned date-time into a Date and leaves everything else", () => {
    const value = { created_at: ISO, name: ISO, n: 1 };
    decodeDates(value, { p: { created_at: 1 } }, {});
    expect(value.created_at).toBeInstanceOf(Date);
    expect(value.name).toBe(ISO);
  });

  it("follows arrays, maps and named plans, recursively", () => {
    const named: Record<string, DatePlan> = { Node: { p: { at: 1, children: { i: "Node" } } } };
    const value = {
      list: [{ at: ISO }, { at: "2026-10-18T00:00:00+02:00" }],
      map: { a: ISO, b: null },
      tree: { at: ISO, children: [{ at: ISO, children: [] }] },
    };
    decodeDates(
      value,
      { p: { list: { i: { p: { at: 1 } } }, map: { a: 1 }, tree: "Node" } },
      named,
    );
    expect(value.list.map((x) => (x.at as unknown as Date).getTime())).toEqual([
      at(ISO),
      at("2026-10-17T22:00:00Z"),
    ]);
    expect(value.map.a).toBeInstanceOf(Date);
    expect(value.map.b).toBeNull();
    expect((value.tree.children[0]!.at as unknown as Date).getTime()).toBe(at(ISO));
  });

  it("converts strings only when the plan allows a string (unions)", () => {
    expect(decodeDates(ISO, { s: 1 }, {})).toBeInstanceOf(Date);
    expect(decodeDates(ISO, { p: {} }, {})).toBe(ISO);
    expect(decodeDates({ x: ISO }, 1, {})).toEqual({ x: ISO });
  });

  it("keeps values that are not valid date-times", () => {
    for (const text of [
      "",
      "yesterday",
      "2026-10-17",
      "2026-13-45T99:00:00Z",
      "2026-13-45T99:00:00",
      "2026-10-17T10:00:00+00",
    ]) {
      expect(decodeDates(text, 1, {})).toBe(text);
    }
  });

  it("accepts fractional seconds, offsets and a space separator", () => {
    expect((decodeDates("2026-10-17T10:00:00.123456Z", 1, {}) as Date).toISOString()).toBe(
      "2026-10-17T10:00:00.123Z",
    );
    expect((decodeDates("2026-10-17 10:00:00+0000", 1, {}) as Date).getTime()).toBe(at(ISO));
    expect((decodeDates("2026-10-17T10:00Z", 1, {}) as Date).getTime()).toBe(at(ISO));
  });

  it("reads a date-time without a time zone as UTC, whatever the host's zone", () => {
    expect((decodeDates("2026-10-17T10:00:00", 1, {}) as Date).getTime()).toBe(at(ISO));
    expect((decodeDates("2026-10-17 10:00:00", 1, {}) as Date).getTime()).toBe(at(ISO));
    expect((decodeDates("2026-10-17T10:00:00.5", 1, {}) as Date).toISOString()).toBe(
      "2026-10-17T10:00:00.500Z",
    );
  });

  it("ignores an unknown named plan, a missing plan and absent fields", () => {
    expect(decodeDates({ a: ISO }, "Missing", {})).toEqual({ a: ISO });
    expect(decodeDates({ a: ISO }, undefined, {})).toEqual({ a: ISO });
    expect(decodeDates({}, { p: { a: 1 } }, {})).toEqual({});
    expect(decodeDates(null, 1, {})).toBeNull();
    expect(decodeDates([ISO], { p: { a: 1 } }, {})).toEqual([ISO]);
  });

  it("stops on a cycle of names", () => {
    const named: Record<string, DatePlan> = { A: "B", B: "A" };
    expect(decodeDates({ a: ISO }, "A", named)).toEqual({ a: ISO });
  });
});

describe("bank.refreshConnection", () => {
  const operation = "POST /v3/bank/connections/{id}/refresh/";

  it("decodes the completed sync dates on HTTP 200", async () => {
    const json = responseExample(operation, undefined, 200) as {
      started_at: string;
      finished_at: string;
    };
    const { client } = mockClient({ status: 200, json });
    expect(await client.bank.refreshConnection("id-1")).toMatchObject({
      started_at: new Date(json.started_at),
      finished_at: new Date(json.finished_at),
    });
  });

  it.each([null, ISO])("decodes next_refresh_at on HTTP 202 (%s)", async (nextRefreshAt) => {
    // The queued example has a null date. Exercise the populated form as well.
    const queued = responseExample(operation, undefined, 202) as { sync_id: string };
    const { client } = mockClient({
      status: 202,
      json: { ...queued, next_refresh_at: nextRefreshAt },
    });
    expect(await client.bank.refreshConnection("id-1")).toMatchObject({
      sync_id: queued.sync_id,
      next_refresh_at: nextRefreshAt === null ? null : new Date(nextRefreshAt),
    });
  });
});
