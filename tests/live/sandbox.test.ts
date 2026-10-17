// Live smoke tests against a Didit sandbox application.
//
// They run only with DIDIT_SANDBOX_API_KEY set (`pnpm test:live`), never in the
// default CI, and create nothing that costs money beyond sandbox sessions.
// Optional: DIDIT_SANDBOX_WORKFLOW_ID, DIDIT_SANDBOX_BASE_URL.

import { describe, expect, it } from "vitest";

import Didit, { NotFoundError } from "../../src/index.js";

const apiKey = process.env.DIDIT_SANDBOX_API_KEY;
const workflowId = process.env.DIDIT_SANDBOX_WORKFLOW_ID;

describe.skipIf(!apiKey)("sandbox", () => {
  const didit = new Didit({ apiKey, baseURL: process.env.DIDIT_SANDBOX_BASE_URL || undefined });

  it("lists workflows", async () => {
    const page = await didit.workflows.list({ limit: 5 } as never);
    expect(page.count === null || page.count === undefined || page.count >= 0).toBe(true);
  });

  it("reads the first page of sessions", async () => {
    const page = await didit.sessions.list({ limit: 2 });
    expect((page.results ?? []).length).toBeLessThanOrEqual(2);
  });

  it.skipIf(!workflowId)("creates a session and reads its decision", async () => {
    const session = await didit.sessions.create({ workflow_id: workflowId ?? "", vendor_data: "sdk-node-smoke" });
    expect(session.url).toBeTruthy();
    const decision = await didit.sessions.retrieveDecision(session.session_id);
    expect(decision.session_id).toBe(session.session_id);
  });

  it("answers 404 for an unknown session", async () => {
    await expect(didit.sessions.retrieveDecision("00000000-0000-4000-8000-000000000000")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
