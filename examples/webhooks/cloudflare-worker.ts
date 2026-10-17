// Didit webhook receiver for Cloudflare Workers.
// Deploy with wrangler and add the secret: wrangler secret put DIDIT_WEBHOOK_SECRET

import { webhooks, WebhookVerificationError } from "@didit-protocol/sdk-node";

interface Env {
  DIDIT_WEBHOOK_SECRET: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/webhooks/didit") {
      return new Response("Not found", { status: 404 });
    }
    try {
      const event = await webhooks.verify(await request.arrayBuffer(), request.headers, env.DIDIT_WEBHOOK_SECRET);
      console.log("received", event.webhook_type, event.event_id);
      return Response.json({ received: true });
    } catch (error) {
      if (error instanceof WebhookVerificationError) {
        return Response.json({ error: error.reason }, { status: 400 });
      }
      throw error;
    }
  },
};
