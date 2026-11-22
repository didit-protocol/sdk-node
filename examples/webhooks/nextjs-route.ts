// Didit webhook receiver for the Next.js App Router.
// Save as app/api/webhooks/didit/route.ts and set DIDIT_WEBHOOK_SECRET.

import { webhooks, WebhookVerificationError } from "@didit-protocol/sdk-node";

export const runtime = "nodejs"; // also works with "edge"

export async function POST(request: Request): Promise<Response> {
  const body = await request.text(); // the raw body, before any JSON parsing
  try {
    const event = await webhooks.verify(
      body,
      request.headers,
      process.env.DIDIT_WEBHOOK_SECRET ?? "",
    );
    if (event.webhook_type === "status.updated" && event.status === "Approved") {
      // Grant access for event.vendor_data ...
    }
    return Response.json({ received: true });
  } catch (error) {
    if (error instanceof WebhookVerificationError) {
      return Response.json({ error: error.reason }, { status: 400 });
    }
    throw error;
  }
}
