// Didit webhook receiver for Fastify.
//
//   npm install @didit-protocol/sdk-node fastify
//   DIDIT_WEBHOOK_SECRET=... node examples/webhooks/fastify.ts

import Fastify from "fastify";

import { webhooks, WebhookVerificationError } from "@didit-protocol/sdk-node";

const secret = process.env.DIDIT_WEBHOOK_SECRET ?? "";
const app = Fastify();

// Keep JSON bodies as raw bytes so that the signature can be checked on them.
app.addContentTypeParser("application/json", { parseAs: "buffer" }, (_request, body, done) => {
  done(null, body);
});

app.post("/webhooks/didit", async (request, reply) => {
  try {
    const event = await webhooks.verify(request.body as Buffer, request.headers, secret);
    if (event.webhook_type === "status.updated") {
      request.log.info({ session: event.session_id, status: event.status }, "session updated");
    }
    return { received: true };
  } catch (error) {
    if (error instanceof WebhookVerificationError)
      return reply.code(400).send({ error: error.reason });
    throw error;
  }
});

await app.listen({ port: 8000 });
