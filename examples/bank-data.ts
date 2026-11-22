// Bank data: create a Bank Link, wait for bank.connection.created, read accounts.
//
//   export DIDIT_API_KEY=...
//   export DIDIT_WEBHOOK_SECRET=...
//   node examples/bank-data.ts
//
// Open the printed URL, connect the sandbox Test Bank, and the webhook receiver
// below reads the first page of the new connection's accounts. Point the webhook
// destination at a public URL that forwards to port 4242.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import Didit, { webhooks, WebhookVerificationError } from "@didit-protocol/sdk-node";

const didit = new Didit();
const webhookSecret = process.env.DIDIT_WEBHOOK_SECRET;
if (!webhookSecret)
  throw new Error("Set DIDIT_WEBHOOK_SECRET to the webhook destination's secret.");
const secret: string = webhookSecret;

const link = await didit.bank.createLink({
  country: "ESP",
  access: "one_time",
  data: ["accounts"],
  vendor_data: "bank-data-example",
});
console.log("Open", link.url);

async function handle(request: IncomingMessage, response: ServerResponse) {
  if (request.method !== "POST" || request.url !== "/webhooks/didit") {
    response.writeHead(404).end();
    return;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);

  let event;
  try {
    event = await webhooks.verify(Buffer.concat(chunks), request.headers, secret);
  } catch (error) {
    if (!(error instanceof WebhookVerificationError)) throw error;
    console.error("Webhook rejected:", error.reason);
    response.writeHead(400).end();
    return;
  }
  response.writeHead(204).end();

  // bank.connection.* events carry their fields next to the envelope fields.
  if (event.webhook_type === "bank.connection.created") {
    const accounts = await didit.bank.listAccounts(event.connection_id, { limit: 10 });
    console.log("Connection", event.connection_id, "has", accounts.items.length, "accounts");
    for (const account of accounts.items) {
      console.log(account.id, account.currency);
    }
    server.close();
  }
}

const server = createServer((request, response) => {
  handle(request, response).catch((error: unknown) => {
    console.error(error);
    if (!response.headersSent) response.writeHead(500).end();
  });
});

server.listen(4242, "127.0.0.1", () => {
  console.log("Listening for webhooks on http://127.0.0.1:4242/webhooks/didit");
});
