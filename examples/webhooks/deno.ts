// Didit webhook receiver for Deno.
//
//   DIDIT_WEBHOOK_SECRET=... deno run --allow-net --allow-env examples/webhooks/deno.ts
//   (import from "npm:@didit-protocol/sdk-node" in a Deno project)

import { webhooks, WebhookVerificationError } from "@didit-protocol/sdk-node";

// Deno's global, declared here so the file type-checks without Deno's types.
declare const Deno: {
  serve(options: { port: number }, handler: (request: Request) => Promise<Response>): unknown;
  env: { get(name: string): string | undefined };
};

Deno.serve({ port: 8000 }, async (request) => {
  if (request.method !== "POST") return new Response("Not found", { status: 404 });
  try {
    const event = await webhooks.verify(await request.arrayBuffer(), request.headers, Deno.env.get("DIDIT_WEBHOOK_SECRET") ?? "");
    console.log("received", event.webhook_type);
    return Response.json({ received: true });
  } catch (error) {
    if (error instanceof WebhookVerificationError) return Response.json({ error: error.reason }, { status: 400 });
    throw error;
  }
});
