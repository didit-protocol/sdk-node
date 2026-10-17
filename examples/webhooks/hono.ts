// Didit webhook receiver for Hono (Node.js, Bun, Deno, Cloudflare Workers).
//
//   npm install @didit-protocol/sdk-node hono
//   Export `app` from your entry point, or serve it with your runtime's adapter.

import { Hono } from "hono";

import { webhooks, WebhookVerificationError } from "@didit-protocol/sdk-node";

export const app = new Hono<{ Bindings: { DIDIT_WEBHOOK_SECRET: string } }>();

app.post("/webhooks/didit", async (c) => {
  const body = await c.req.arrayBuffer(); // the raw bytes, before any JSON parsing
  try {
    const event = await webhooks.verify(body, c.req.raw.headers, c.env.DIDIT_WEBHOOK_SECRET);
    if (event.webhook_type === "user.status.updated") {
      console.log("user", event.vendor_user_id, "is now", event.status);
    }
    return c.json({ received: true });
  } catch (error) {
    if (error instanceof WebhookVerificationError) return c.json({ error: error.reason }, 400);
    throw error;
  }
});
