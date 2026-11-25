// Replay the original signed deliveries from sdk-java#108 at 412c4a4 and synthetic variants.
import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { webhooks } from "../../src/webhooks/index.js";
import vectors from "./fixtures/bank-deliveries.json";

const deliveries = new Map(
  vectors.map((vector) => {
    const payload = JSON.parse(vector.body) as Record<string, unknown>;
    return [vector.name, { vector, payload }] as const;
  }),
);

async function receive(name: string) {
  const { vector } = deliveries.get(name)!;
  vi.setSystemTime(vector.now * 1000);
  return webhooks.verify(vector.body, vector.headers, vector.secret);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("bank link events", () => {
  it("parses bank.link.completed", async () => {
    const event = await receive("bank_link_completed");
    if (event.webhook_type !== "bank.link.completed") throw new Error("wrong event");
    expect(event.data.connection_id).toBe("cccccccc-0000-4000-8000-000000000001");
    expect(event.data.renews_connection_id).toBeUndefined();
    expect(event.data.check_id).toBe("dddddddd-0000-4000-8000-000000000001");
  });

  it("parses bank.link.cancelled", async () => {
    const event = await receive("bank_link_cancelled");
    if (event.webhook_type !== "bank.link.cancelled") throw new Error("wrong event");
    expect(event.data).toEqual(deliveries.get("bank_link_cancelled")!.payload.data);
  });

  it("parses bank.link.expired", async () => {
    const event = await receive("bank_link_expired");
    if (event.webhook_type !== "bank.link.expired") throw new Error("wrong event");
    expect(event.data.status).toBe("expired");
  });

  it("parses bank.link.failed", async () => {
    const event = await receive("bank_link_failed");
    if (event.webhook_type !== "bank.link.failed") throw new Error("wrong event");
    expect(event.data.error_code).toBe("duplicate_conflict");
    expect(event.data.connection_id).toBeNull();
  });
  const connection = "cccccccc-0000-4000-8000-000000000001";
  it.each([
    ["bank_link_failed_renewal", null, connection],
    ["bank_link_completed_renewal", connection, connection],
    ["bank_link_failed_legacy_renewal", connection, undefined],
    ["bank_link_completed_new_connection", connection, null],
  ] as const)("decodes %s", async (name, result, target) => {
    const event = await receive(name);
    if (event.webhook_type !== "bank.link.failed" && event.webhook_type !== "bank.link.completed")
      throw new Error("wrong event");
    expect(event.data.connection_id).toBe(result);
    expect(event.data.renews_connection_id).toBe(target);
  });
});

describe("bank connection events", () => {
  it("parses bank.connection.created", async () => {
    const event = await receive("bank_connection_created");
    if (event.webhook_type !== "bank.connection.created") throw new Error("wrong event");
    expect(event.connection_id).toBe("cccccccc-0000-4000-8000-000000000001");
    expect(event.initial_status).toBe("succeeded");
    expect(event.data).toBeUndefined();
  });

  it("parses bank.connection.updated", async () => {
    const event = await receive("bank_connection_updated");
    if (event.webhook_type !== "bank.connection.updated") throw new Error("wrong event");
    expect(event.status).toBe("active");
    expect(event.revocation_status).toBe("pending");
    expect(event.status_reason).toBeUndefined();
    expect(event.ends_at).toBeUndefined();
  });

  it.each([
    [
      "bank_connection_updated_insufficient_balance",
      "insufficient_balance",
      "2026-12-01T00:00:00Z",
    ],
    ["bank_connection_updated_no_end", null, null],
  ] as const)("decodes %s", async (name, reason, end) => {
    const event = await receive(name);
    if (event.webhook_type !== "bank.connection.updated") throw new Error("wrong event");
    expect(event.revocation_status).toBeUndefined();
    expect(event.status_reason).toBe(reason);
    expect(event.ends_at).toBe(end);
  });

  it("decodes an unpaid revocation", async () => {
    const event = await receive("bank_connection_revoked_unpaid");
    if (event.webhook_type !== "bank.connection.revoked") throw new Error("wrong event");
    expect(event.status_reason).toBe("unpaid");
    expect(event.ended_by).toBe("system");
  });

  it("parses bank.connection.consent_expiring", async () => {
    const event = await receive("bank_connection_consent_expiring");
    if (event.webhook_type !== "bank.connection.consent_expiring") throw new Error("wrong event");
    expect(event.days_left).toBe(7);
    expect(event.consent_expires_at).toBe("2026-11-29T09:00:00Z");
    expect(event.renew_by).toBe("2026-11-29T09:00:00Z");
  });

  it("parses bank.connection.renewal_required", async () => {
    const event = await receive("bank_connection_renewal_required");
    if (event.webhook_type !== "bank.connection.renewal_required") throw new Error("wrong event");
    expect(event.reason).toBe("consent_expired");
    expect(event.renew_by).toBe("2026-11-29T09:00:00Z");
    expect(event.renewable_until).toBe("2026-12-29T09:00:00Z");
  });

  it("parses bank.connection.renewed", async () => {
    const event = await receive("bank_connection_renewed");
    if (event.webhook_type !== "bank.connection.renewed") throw new Error("wrong event");
    expect(event.consent_version).toBe(2);
    expect(event.link_id).toBe("bbbbbbbb-0000-4000-8000-000000000005");
  });

  it("parses bank.connection.revoked", async () => {
    const event = await receive("bank_connection_revoked");
    if (event.webhook_type !== "bank.connection.revoked") throw new Error("wrong event");
    expect(event.ended_by).toBe("bank");
    expect(event.status_reason).toBe("revoked_by_bank");
    expect(event.retain_until).toBe("2027-02-20T09:00:00Z");
  });

  it("parses bank.connection.deleted", async () => {
    const event = await receive("bank_connection_deleted");
    if (event.webhook_type !== "bank.connection.deleted") throw new Error("wrong event");
    expect(event.erasure_status).toBe("erased");
    expect(event.reason).toBe("deleted_by_customer");
    expect(event.erased_at).toBe("2026-11-22T09:00:00Z");
  });

  it("parses bank.connection.history_complete", async () => {
    const event = await receive("bank_connection_history_complete");
    if (event.webhook_type !== "bank.connection.history_complete") throw new Error("wrong event");
    expect(event.status).toBe("complete");
  });
});

describe("bank data and sync events", () => {
  it("parses bank.data.updated", async () => {
    const event = await receive("bank_data_updated");
    if (event.webhook_type !== "bank.data.updated") throw new Error("wrong event");
    expect(event.trigger).toBe("scheduled");
    expect(event.accounts).toEqual([
      { account_id: "ffffffff-0000-4000-8000-000000000001", added: 3, modified: 1, removed: 0 },
    ]);
    expect(event.balances_changed).toBe(true);
  });

  it("parses bank.sync.completed", async () => {
    const event = await receive("bank_sync_completed");
    if (event.webhook_type !== "bank.sync.completed") throw new Error("wrong event");
    expect(event.outcome).toBe("partial");
    expect(event.changed).toBe(true);
  });

  it("parses bank.sync.failed", async () => {
    const event = await receive("bank_sync_failed");
    if (event.webhook_type !== "bank.sync.failed") throw new Error("wrong event");
    expect(event.error_code).toBe("bank_unavailable");
    expect(event.failing_since).toBe("2026-11-21T09:00:00Z");
  });

  it("parses bank.sync.recovered", async () => {
    const event = await receive("bank_sync_recovered");
    if (event.webhook_type !== "bank.sync.recovered") throw new Error("wrong event");
    expect(event.sync_id).toBe("eeeeeeee-0000-4000-8000-000000000002");
  });
});

interface Schema {
  $ref?: string;
  allOf?: Schema[];
  properties?: Record<string, Schema>;
  required?: string[];
}

describe("the payloads match the contract's event schemas", () => {
  const spec = JSON.parse(
    readFileSync(new URL("../../openapi/verification.json", import.meta.url), "utf-8"),
  ) as { components: { schemas: Record<string, Schema> } };
  const schemas = spec.components.schemas;
  const resolve = (schema: Schema): Schema =>
    schema.$ref ? schemas[schema.$ref.split("/").pop()!]! : schema;

  /** The property names and required names of a schema, through `allOf` and `$ref`. */
  function fields(schema: Schema): { properties: string[]; required: string[] } {
    const resolved = resolve(schema);
    const out = {
      properties: Object.keys(resolved.properties ?? {}),
      required: [...(resolved.required ?? [])],
    };
    for (const part of resolved.allOf ?? []) {
      const inner = fields(part);
      out.properties.push(...inner.properties);
      out.required.push(...inner.required);
    }
    return out;
  }

  const eventSchemas = Object.entries(schemas).filter(([name]) => /^Bank\w+Event$/.test(name));

  it("covers every bank.* event of the contract", () => {
    const types = eventSchemas.map(([, schema]) => {
      const typed = resolve(schema).allOf!.find((part) => part.properties?.webhook_type)!;
      return (typed.properties!.webhook_type as { enum: string[] }).enum[0];
    });
    expect(types.sort()).toEqual(
      [...new Set([...deliveries.values()].map(({ payload }) => payload.webhook_type))].sort(),
    );
  });

  for (const [name, schema] of eventSchemas) {
    it(`${name} has exactly its required fields`, () => {
      const typed = resolve(schema).allOf!.find((part) => part.properties?.webhook_type)!;
      const type = (typed.properties!.webhook_type as { enum: string[] }).enum[0]!;
      const { payload } = deliveries.get(type.replaceAll(".", "_"))!;
      const event = fields(schema);
      expect(Object.keys(payload).sort()).toEqual([...new Set(event.required)].sort());
      expect(event.properties).toEqual(expect.arrayContaining(Object.keys(payload)));
      if ("data" in payload) {
        const data = fields(typed.properties!.data!);
        expect(Object.keys(payload.data as object).sort()).toEqual(data.required.sort());
      }
    });
  }
});
