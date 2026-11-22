// Typed bank.* events (docs/DESIGN.md sections 9.4 and 16.3). The payloads
// follow the event schemas of openapi/verification.json: the bank.link.* events
// carry their fields in `data`, every other bank.* event carries them next to
// the envelope fields. The last test checks each payload's keys against those
// schemas, so a payload here cannot drift from the contract. Ids are obviously
// fake.

import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { webhooks } from "../../src/webhooks/index.js";
import { delivery, NOW, SECRET } from "./helpers.js";

const CONNECTION = "22222222-3333-4444-8555-666666666666";
const LINK = "11111111-2222-4333-8444-555555555555";
const CHECK = "33333333-4444-4555-8666-777777777777";
const SYNC = "44444444-5555-4666-8777-888888888888";
const ACCOUNT = "55555555-6666-4777-8888-999999999999";

const ENVELOPE = {
  application_id: "0b5e8d2c-1f4a-4c3b-9d6e-2a7f8c1b3e5d",
  created_at: NOW,
  environment: "sandbox",
  event_id: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  timestamp: NOW,
};

const linkData = (status: string, extra: Record<string, unknown> = {}) => ({
  data: { link_id: LINK, status, connection_id: null, check_id: null, error_code: null, ...extra },
});

/** The fields of each bank.* event besides the envelope, as the contract defines them. */
const PAYLOADS: Record<string, Record<string, unknown>> = {
  "bank.link.completed": linkData("completed", { connection_id: CONNECTION, check_id: CHECK }),
  "bank.link.cancelled": linkData("cancelled"),
  "bank.link.expired": linkData("expired"),
  "bank.link.failed": linkData("failed", { error_code: "duplicate_conflict" }),
  "bank.connection.created": { connection_id: CONNECTION, initial_status: "succeeded" },
  "bank.connection.updated": {
    connection_id: CONNECTION,
    status: "active",
    revocation_status: "pending",
  },
  "bank.connection.consent_expiring": {
    connection_id: CONNECTION,
    days_left: 7,
    consent_expires_at: "2026-11-29T10:00:00Z",
    renew_by: "2026-11-29T10:00:00Z",
  },
  "bank.connection.renewal_required": {
    connection_id: CONNECTION,
    status: "renewal_required",
    reason: "bank_requires_sign_in",
    renew_by: null,
    renewable_until: "2026-12-29T10:00:00Z",
  },
  "bank.connection.renewed": {
    connection_id: CONNECTION,
    status: "active",
    consent_version: 2,
    link_id: LINK,
    consent_expires_at: "2027-02-20T10:00:00Z",
  },
  "bank.connection.revoked": {
    connection_id: CONNECTION,
    status: "revoked",
    ended_by: "end_user",
    status_reason: "revoked_by_end_user",
    ended_at: "2026-11-22T10:00:00Z",
    retain_until: "2026-12-22T10:00:00Z",
  },
  "bank.connection.deleted": {
    connection_id: CONNECTION,
    status: "deleted",
    erasure_status: "erased",
    reason: "deleted_by_customer",
    erased_at: "2026-11-22T10:00:00Z",
  },
  "bank.connection.history_complete": { connection_id: CONNECTION, status: "partial" },
  "bank.data.updated": {
    connection_id: CONNECTION,
    sync_id: SYNC,
    trigger: "initial",
    accounts: [{ account_id: ACCOUNT, added: 2, modified: 1, removed: 0 }],
    balances_changed: true,
  },
  "bank.sync.completed": {
    connection_id: CONNECTION,
    sync_id: SYNC,
    trigger: "scheduled",
    outcome: "succeeded",
    changed: true,
  },
  "bank.sync.failed": {
    connection_id: CONNECTION,
    sync_id: SYNC,
    error_code: "bank_unavailable",
    failing_since: "2026-11-21T10:00:00Z",
  },
  "bank.sync.recovered": { connection_id: CONNECTION, sync_id: SYNC },
};

async function receive(type: string) {
  const { body, headers } = delivery({ ...ENVELOPE, webhook_type: type, ...PAYLOADS[type] });
  return webhooks.verify(body, headers, SECRET);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW * 1000);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("bank link events", () => {
  it("parses bank.link.completed", async () => {
    const event = await receive("bank.link.completed");
    if (event.webhook_type !== "bank.link.completed") throw new Error("wrong event");
    expect(event.data.connection_id).toBe(CONNECTION);
    expect(event.data.check_id).toBe(CHECK);
  });

  it("parses bank.link.cancelled", async () => {
    const event = await receive("bank.link.cancelled");
    if (event.webhook_type !== "bank.link.cancelled") throw new Error("wrong event");
    expect(event.data).toEqual(PAYLOADS["bank.link.cancelled"]!.data);
  });

  it("parses bank.link.expired", async () => {
    const event = await receive("bank.link.expired");
    if (event.webhook_type !== "bank.link.expired") throw new Error("wrong event");
    expect(event.data.status).toBe("expired");
  });

  it("parses bank.link.failed", async () => {
    const event = await receive("bank.link.failed");
    if (event.webhook_type !== "bank.link.failed") throw new Error("wrong event");
    expect(event.data.error_code).toBe("duplicate_conflict");
    expect(event.data.connection_id).toBeNull();
  });
});

describe("bank connection events", () => {
  it("parses bank.connection.created", async () => {
    const event = await receive("bank.connection.created");
    if (event.webhook_type !== "bank.connection.created") throw new Error("wrong event");
    expect(event.connection_id).toBe(CONNECTION);
    expect(event.initial_status).toBe("succeeded");
    expect(event.data).toBeUndefined();
  });

  it("parses bank.connection.updated", async () => {
    const event = await receive("bank.connection.updated");
    if (event.webhook_type !== "bank.connection.updated") throw new Error("wrong event");
    expect(event.status).toBe("active");
    expect(event.revocation_status).toBe("pending");
  });

  it("parses bank.connection.consent_expiring", async () => {
    const event = await receive("bank.connection.consent_expiring");
    if (event.webhook_type !== "bank.connection.consent_expiring") throw new Error("wrong event");
    expect(event.days_left).toBe(7);
    expect(event.consent_expires_at).toBe("2026-11-29T10:00:00Z");
    expect(event.renew_by).toBe("2026-11-29T10:00:00Z");
  });

  it("parses bank.connection.renewal_required", async () => {
    const event = await receive("bank.connection.renewal_required");
    if (event.webhook_type !== "bank.connection.renewal_required") throw new Error("wrong event");
    expect(event.reason).toBe("bank_requires_sign_in");
    expect(event.renew_by).toBeNull();
    expect(event.renewable_until).toBe("2026-12-29T10:00:00Z");
  });

  it("parses bank.connection.renewed", async () => {
    const event = await receive("bank.connection.renewed");
    if (event.webhook_type !== "bank.connection.renewed") throw new Error("wrong event");
    expect(event.consent_version).toBe(2);
    expect(event.link_id).toBe(LINK);
  });

  it("parses bank.connection.revoked", async () => {
    const event = await receive("bank.connection.revoked");
    if (event.webhook_type !== "bank.connection.revoked") throw new Error("wrong event");
    expect(event.ended_by).toBe("end_user");
    expect(event.status_reason).toBe("revoked_by_end_user");
    expect(event.retain_until).toBe("2026-12-22T10:00:00Z");
  });

  it("parses bank.connection.deleted", async () => {
    const event = await receive("bank.connection.deleted");
    if (event.webhook_type !== "bank.connection.deleted") throw new Error("wrong event");
    expect(event.erasure_status).toBe("erased");
    expect(event.reason).toBe("deleted_by_customer");
    expect(event.erased_at).toBe("2026-11-22T10:00:00Z");
  });

  it("parses bank.connection.history_complete", async () => {
    const event = await receive("bank.connection.history_complete");
    if (event.webhook_type !== "bank.connection.history_complete") throw new Error("wrong event");
    expect(event.status).toBe("partial");
  });
});

describe("bank data and sync events", () => {
  it("parses bank.data.updated", async () => {
    const event = await receive("bank.data.updated");
    if (event.webhook_type !== "bank.data.updated") throw new Error("wrong event");
    expect(event.trigger).toBe("initial");
    expect(event.accounts).toEqual([{ account_id: ACCOUNT, added: 2, modified: 1, removed: 0 }]);
    expect(event.balances_changed).toBe(true);
  });

  it("parses bank.sync.completed", async () => {
    const event = await receive("bank.sync.completed");
    if (event.webhook_type !== "bank.sync.completed") throw new Error("wrong event");
    expect(event.outcome).toBe("succeeded");
    expect(event.changed).toBe(true);
  });

  it("parses bank.sync.failed", async () => {
    const event = await receive("bank.sync.failed");
    if (event.webhook_type !== "bank.sync.failed") throw new Error("wrong event");
    expect(event.error_code).toBe("bank_unavailable");
    expect(event.failing_since).toBe("2026-11-21T10:00:00Z");
  });

  it("parses bank.sync.recovered", async () => {
    const event = await receive("bank.sync.recovered");
    if (event.webhook_type !== "bank.sync.recovered") throw new Error("wrong event");
    expect(event.sync_id).toBe(SYNC);
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
    expect(types.sort()).toEqual(Object.keys(PAYLOADS).sort());
  });

  for (const [name, schema] of eventSchemas) {
    it(`${name} has exactly its required fields`, () => {
      const typed = resolve(schema).allOf!.find((part) => part.properties?.webhook_type)!;
      const type = (typed.properties!.webhook_type as { enum: string[] }).enum[0]!;
      const payload: Record<string, unknown> = { ...ENVELOPE, webhook_type: type, ...PAYLOADS[type] };
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
