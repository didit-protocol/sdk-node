// The session events carry the decision as the generated
// SessionDecision type, date-times included.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { webhooks } from "../../src/index.js";
import { NOW, SECRET, sign } from "./helpers.js";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW * 1000);
});

afterEach(() => {
  vi.useRealTimers();
});

function delivery(payload: Record<string, unknown>): [string, Record<string, string>] {
  const body = JSON.stringify({ timestamp: NOW, ...payload });
  return [body, { "x-signature": sign(SECRET, body) }];
}

describe("session decision in webhook events", () => {
  it("decodes the decision's date-times like sessions.retrieveDecision", async () => {
    const [body, headers] = delivery({
      webhook_type: "status.updated",
      session_id: "s-1",
      status: "Approved",
      decision: {
        session_id: "s-1",
        status: "Approved",
        created_at: "2026-10-17T10:00:00.123456Z",
        reviews: [{ user: "a@example.com", created_at: "2026-10-17T11:00:00Z" }],
      },
    });
    const event = await webhooks.verify(body, headers, SECRET);
    if (event.webhook_type !== "status.updated") throw new Error("expected status.updated");
    expect(event.decision?.created_at).toBeInstanceOf(Date);
    expect(event.decision?.created_at?.toISOString()).toBe("2026-10-17T10:00:00.123Z");
    expect(event.decision?.status).toBe("Approved");
  });

  it("leaves a null decision and other event types alone", async () => {
    const [body, headers] = delivery({
      webhook_type: "data.updated",
      session_id: "s-1",
      decision: null,
    });
    const event = await webhooks.verify(body, headers, SECRET);
    expect(event.decision).toBeNull();
    const [other, otherHeaders] = delivery({
      webhook_type: "future.event",
      decision: { created_at: "2026-10-17T10:00:00Z" },
    });
    const unknown = await webhooks.verify(other, otherHeaders, SECRET);
    expect((unknown.decision as { created_at: unknown }).created_at).toBe("2026-10-17T10:00:00Z");
  });
});
