// Didit webhook receiver for Bun.
//
//   bun add @didit-protocol/sdk-node
//   DIDIT_WEBHOOK_SECRET=... bun examples/webhooks/bun.ts

import { webhooks, WebhookVerificationError } from "@didit-protocol/sdk-node";

// Bun's global, declared here so the file type-checks without Bun's types.
declare const Bun: {
  serve(options: { port: number; fetch(request: Request): Promise<Response> }): { port: number };
  env: Record<string, string | undefined>;
};

const server = Bun.serve({
  port: 8000,
  async fetch(request) {
    if (request.method !== "POST") return new Response("Not found", { status: 404 });
    try {
      const event = await webhooks.verify(await request.arrayBuffer(), request.headers, Bun.env.DIDIT_WEBHOOK_SECRET ?? "");
      console.log("received", event.webhook_type);
      return Response.json({ received: true });
    } catch (error) {
      if (error instanceof WebhookVerificationError) return Response.json({ error: error.reason }, { status: 400 });
      throw error;
    }
  },
});
console.log(`Listening on http://localhost:${server.port}/`);
