// Typed bank.* events (docs/DESIGN.md section 9.4). Payloads follow the event
// schemas of openapi-25.json on docs/bank-data-openapi-contract; ids and URLs
// are obviously fake.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { webhooks } from "../../src/webhooks/index.js";
import { delivery, NOW, SECRET } from "./helpers.js";

const CONNECTION = "22222222-3333-4444-8555-666666666666";
const LINK = "11111111-2222-4333-8444-555555555555";
const CHECK = "33333333-4444-4555-8666-777777777777";
const SYNC = "44444444-5555-4666-8777-888888888888";
const ACCOUNT = "55555555-6666-4777-8888-999999999999";

function bank(type: string, data: Record<string, unknown>) {
  return delivery({
    application_id: "0b5e8d2c-1f4a-4c3b-9d6e-2a7f8c1b3e5d",
    created_at: NOW,
    environment: "sandbox",
    event_id: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    timestamp: NOW,
    webhook_type: type,
    data,
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW * 1000);
});

afterEach(() => {
  vi.useRealTimers();
});

const link = {
  link_id: LINK,
  connection_id: CONNECTION,
  check_id: CHECK,
};

describe("bank link events", () => {
  it("parses bank.link.completed", async () => {
    const { body, headers } = bank("bank.link.completed", {
      ...link,
      status: "completed",
      error_code: null,
    });
    const event = await webhooks.verify(body, headers, SECRET);
    if (event.webhook_type !== "bank.link.completed") throw new Error("wrong event");
    expect(event.data).toEqual({ ...link, status: "completed", error_code: null });
  });

  it("parses bank.link.cancelled", async () => {
    const { body, headers } = bank("bank.link.cancelled", {
      ...link,
      status: "cancelled",
      connection_id: null,
      check_id: null,
      error_code: null,
    });
    const event = await webhooks.verify(body, headers, SECRET);
    if (event.webhook_type !== "bank.link.cancelled") throw new Error("wrong event");
    expect(event.data).toEqual({
      ...link,
      status: "cancelled",
      connection_id: null,
      check_id: null,
      error_code: null,
    });
  });

  it("parses bank.link.expired", async () => {
    const { body, headers } = bank("bank.link.expired", {
      ...link,
      status: "expired",
      connection_id: null,
      check_id: null,
      error_code: null,
    });
    const event = await webhooks.verify(body, headers, SECRET);
    if (event.webhook_type !== "bank.link.expired") throw new Error("wrong event");
    expect(event.data).toEqual({
      ...link,
      status: "expired",
      connection_id: null,
      check_id: null,
      error_code: null,
    });
  });

  it("parses bank.link.failed", async () => {
    const { body, headers } = bank("bank.link.failed", {
      ...link,
      status: "failed",
      connection_id: null,
      check_id: null,
      error_code: "reduced_grant",
    });
    const event = await webhooks.verify(body, headers, SECRET);
    if (event.webhook_type !== "bank.link.failed") throw new Error("wrong event");
    expect(event.data).toEqual({
      ...link,
      status: "failed",
      connection_id: null,
      check_id: null,
      error_code: "reduced_grant",
    });
  });
});

describe("bank connection events", () => {
  it("parses bank.connection.created", async () => {
    const { body, headers } = bank("bank.connection.created", {
      connection_id: CONNECTION,
      status: "active",
      status_reason: null,
    });
    const event = await webhooks.verify(body, headers, SECRET);
    if (event.webhook_type !== "bank.connection.created") throw new Error("wrong event");
    expect(event.data).toEqual({
      connection_id: CONNECTION,
      status: "active",
      status_reason: null,
    });
  });

  it("parses bank.connection.updated", async () => {
    const { body, headers } = bank("bank.connection.updated", {
      connection_id: CONNECTION,
      status: "renewal_required",
      status_reason: "consent_expired",
    });
    const event = await webhooks.verify(body, headers, SECRET);
    if (event.webhook_type !== "bank.connection.updated") throw new Error("wrong event");
    expect(event.data.status).toBe("renewal_required");
    expect(event.data.status_reason).toBe("consent_expired");
  });

  it("parses bank.connection.consent_expiring", async () => {
    const { body, headers } = bank("bank.connection.consent_expiring", {
      connection_id: CONNECTION,
      days_left: 7,
      expires_at: "2026-11-29T10:00:00Z",
      renew_url: "https://example.test/renew/example",
    });
    const event = await webhooks.verify(body, headers, SECRET);
    if (event.webhook_type !== "bank.connection.consent_expiring") throw new Error("wrong event");
    expect(event.data.days_left).toBe(7);
    expect(event.data.expires_at).toBe("2026-11-29T10:00:00Z");
    expect(event.data.renew_url).toBe("https://example.test/renew/example");
  });

  it("parses bank.connection.renewal_required", async () => {
    const { body, headers } = bank("bank.connection.renewal_required", {
      connection_id: CONNECTION,
      status: "renewal_required",
      status_reason: "bank_requires_sign_in",
    });
    const event = await webhooks.verify(body, headers, SECRET);
    if (event.webhook_type !== "bank.connection.renewal_required") throw new Error("wrong event");
    expect(event.data.status_reason).toBe("bank_requires_sign_in");
  });

  it("parses bank.connection.renewed", async () => {
    const { body, headers } = bank("bank.connection.renewed", {
      connection_id: CONNECTION,
      status: "active",
      status_reason: null,
    });
    const event = await webhooks.verify(body, headers, SECRET);
    if (event.webhook_type !== "bank.connection.renewed") throw new Error("wrong event");
    expect(event.data.status).toBe("active");
  });

  it("parses bank.connection.revoked", async () => {
    const { body, headers } = bank("bank.connection.revoked", {
      connection_id: CONNECTION,
      status: "revoked",
      ended_by: "end_user",
    });
    const event = await webhooks.verify(body, headers, SECRET);
    if (event.webhook_type !== "bank.connection.revoked") throw new Error("wrong event");
    expect(event.data.ended_by).toBe("end_user");
  });

  it("parses bank.connection.deleted", async () => {
    const { body, headers } = bank("bank.connection.deleted", {
      connection_id: CONNECTION,
      erasure_status: "erased",
    });
    const event = await webhooks.verify(body, headers, SECRET);
    if (event.webhook_type !== "bank.connection.deleted") throw new Error("wrong event");
    expect(event.data.erasure_status).toBe("erased");
  });

  it("parses bank.connection.history_complete", async () => {
    const { body, headers } = bank("bank.connection.history_complete", {
      connection_id: CONNECTION,
      status: "active",
      status_reason: null,
    });
    const event = await webhooks.verify(body, headers, SECRET);
    if (event.webhook_type !== "bank.connection.history_complete") throw new Error("wrong event");
    expect(event.data.connection_id).toBe(CONNECTION);
  });
});

describe("bank data events", () => {
  it("parses bank.data.updated", async () => {
    const { body, headers } = bank("bank.data.updated", {
      connection_id: CONNECTION,
      sync_id: SYNC,
      account_ids: [ACCOUNT],
      added: 2,
      modified: 1,
      removed: 0,
      balances_changed: true,
    });
    const event = await webhooks.verify(body, headers, SECRET);
    if (event.webhook_type !== "bank.data.updated") throw new Error("wrong event");
    expect(event.data.account_ids).toEqual([ACCOUNT]);
    expect(event.data.added).toBe(2);
    expect(event.data.balances_changed).toBe(true);
  });

  it("parses bank.sync.completed", async () => {
    const { body, headers } = bank("bank.sync.completed", {
      connection_id: CONNECTION,
      sync_id: SYNC,
      trigger: "scheduled",
      outcome: "succeeded",
      changed: true,
    });
    const event = await webhooks.verify(body, headers, SECRET);
    if (event.webhook_type !== "bank.sync.completed") throw new Error("wrong event");
    expect(event.data.outcome).toBe("succeeded");
    expect(event.data.changed).toBe(true);
  });

  it("parses bank.sync.failed", async () => {
    const { body, headers } = bank("bank.sync.failed", {
      connection_id: CONNECTION,
      sync_id: null,
      error_code: "bank_unavailable",
    });
    const event = await webhooks.verify(body, headers, SECRET);
    if (event.webhook_type !== "bank.sync.failed") throw new Error("wrong event");
    expect(event.data.error_code).toBe("bank_unavailable");
  });

  it("parses bank.sync.recovered", async () => {
    const { body, headers } = bank("bank.sync.recovered", {
      connection_id: CONNECTION,
      sync_id: SYNC,
    });
    const event = await webhooks.verify(body, headers, SECRET);
    if (event.webhook_type !== "bank.sync.recovered") throw new Error("wrong event");
    expect(event.data.sync_id).toBe(SYNC);
  });
});
