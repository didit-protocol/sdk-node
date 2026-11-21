// Didit webhook receiver for Express.
//
//   npm install @didit-protocol/sdk-node express
//   DIDIT_WEBHOOK_SECRET=... node examples/webhooks/express.ts

import express from "express";

import { webhooks, WebhookVerificationError } from "@didit-protocol/sdk-node";

const secret = process.env.DIDIT_WEBHOOK_SECRET ?? "";
const app = express();

// express.raw keeps the exact body bytes the signature covers. Register it on this
// route before any express.json() middleware sees the request.
app.post("/webhooks/didit", express.raw({ type: "application/json" }), async (req, res) => {
  // express.raw leaves req.body empty for another content type: not a Didit delivery.
  if (!Buffer.isBuffer(req.body)) {
    res.status(400).json({ error: "expected a JSON body" });
    return;
  }
  let event;
  try {
    event = await webhooks.verify(req.body, req.headers, secret);
  } catch (error) {
    if (error instanceof WebhookVerificationError) {
      res.status(400).json({ error: error.reason });
      return;
    }
    throw error;
  }
  switch (event.webhook_type) {
    case "status.updated":
      console.log("session", event.session_id, "is now", event.status);
      break;
    case "transaction.status.updated":
      console.log("transaction", event.transaction_id, "is now", event.status);
      break;
    default:
      console.log("received", event.webhook_type);
  }
  // Answer 2xx quickly; do slow work in a background job keyed by event.event_id.
  res.json({ received: true });
});

app.listen(8000, () => {
  console.log("Listening on http://localhost:8000/webhooks/didit");
});
