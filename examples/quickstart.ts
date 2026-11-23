// Quickstart: create a verification session, read its decision, verify a webhook.
//
//   export DIDIT_API_KEY=...       # Business Console > Developers > API keys
//   export DIDIT_WORKFLOW_ID=...   # a published workflow
//   node examples/quickstart.ts    # Node.js 22.18+ runs TypeScript directly (after pnpm build)

import { webcrypto } from "node:crypto";

import Didit, { webhooks } from "@didit-protocol/sdk-node";

const didit = new Didit({ baseURL: process.env.DIDIT_BASE_URL }); // API key from DIDIT_API_KEY

// 1. Create a session and send the user to its hosted URL.
const session = await didit.sessions.create({
  workflow_id: process.env.DIDIT_WORKFLOW_ID ?? "",
  vendor_data: "user-123",
  callback: "https://example.com/verification/done",
});
console.log("Send the user to:", session.url);

// 2. Later (or from the status.updated webhook), read the decision.
const decision = await didit.sessions.retrieveDecision(session.session_id);
console.log("Status:", decision.status, "created at", decision.created_at?.toISOString());

// 3. Verify a webhook delivery. Here we sign a sample body ourselves; in your app the
//    body and headers come from the request (see examples/webhooks/).
const secret = process.env.DIDIT_WEBHOOK_SECRET ?? "whsec_test_quickstart_example";
const body = JSON.stringify({
  session_id: session.session_id,
  status: "Approved",
  timestamp: Math.floor(Date.now() / 1000),
  webhook_type: "status.updated",
});
const key = await webcrypto.subtle.importKey(
  "raw",
  new TextEncoder().encode(secret),
  { name: "HMAC", hash: "SHA-256" },
  false,
  ["sign"],
);
const mac = await webcrypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
const signature = Buffer.from(mac).toString("hex");

const event = await webhooks.verify(body, { "x-signature": signature }, secret);
if (event.webhook_type === "status.updated") {
  console.log("Webhook verified:", event.session_id, event.status);
}
