import { writeFile } from "node:fs/promises";
import Didit, { webhooks, WebhookVerificationError, fileFromPath, APIStatusError, NotFoundError, Authentication, TokenVerificationError } from "@didit-protocol/sdk-node";
import type { SessionsCreateParams, SessionsCreateResponse, TransactionDetail } from "@didit-protocol/sdk-node";
import express from "express";
declare const workflow_id: string; declare const signal: AbortSignal; declare const caseUuid: string;
declare const email: string; declare const password: string; declare const sessionId: string;
declare const accessToken: string; declare const rawBody: string; declare const headers: Headers;
declare const currentSecret: string; declare const previousSecret: string;
export async function block0() {

const didit = new Didit(); // reads DIDIT_API_KEY

// 1. Create a session and send the user to session.url.
const session = await didit.sessions.create({
  workflow_id: "11111111-2222-3333-4444-555555555555",
  vendor_data: "user-42",
  callback: "https://example.com/verification/done",
});
console.log(session.url);

// 2. Later, read the decision.
const decision = await didit.sessions.retrieveDecision(session.session_id);
console.log(decision.status, decision.created_at); // "Approved", a Date

}

export async function block1() {
const didit = new Didit();
// 3. Verify the webhook (Express). Pass the raw body, not parsed JSON.

const app = express();
app.post("/webhooks/didit", express.raw({ type: "application/json" }), async (req, res) => {
  try {
    const event = await webhooks.verify(req.body, req.headers, process.env.DIDIT_WEBHOOK_SECRET!);
    if (event.webhook_type === "status.updated") {
      console.log(event.session_id, event.status);
    }
    res.sendStatus(200);
  } catch (error) {
    if (error instanceof WebhookVerificationError) return res.status(400).send(error.reason);
    throw error;
  }
});

}

export async function block2() {
const didit = new Didit({
  apiKey: "...", // default: DIDIT_API_KEY
  organizationId: "...", // default: DIDIT_ORGANIZATION_ID
  applicationId: "...", // default: DIDIT_APPLICATION_ID
  timeout: 60_000, // milliseconds per attempt
  maxRetries: 2,
});

}

export async function block3() {
const didit = new Didit();
await didit.sessions.create(
  { workflow_id },
  { timeout: 10_000, maxRetries: 0, idempotencyKey: "order-123", headers: { "X-Trace": "abc" }, signal },
);

}

export async function block4() {
const didit = new Didit();
await didit.idVerification.verify({ front_image: await fileFromPath("id-front.jpg") });
await didit.aml.screen({ full_name: "Ada Lovelace", date_of_birth: "1815-12-10" });
await didit.users.update("user-42", { status: "ACTIVE" });
await didit.cases.notes.create(caseUuid, { comment: "Checked with the customer" });

}

export async function block5() {
const didit = new Didit();

}

export async function block6() {
const didit = new Didit();
const { access_token } = await didit.account.login({ email, password });
const account = didit.withOptions({ accountToken: access_token });
const organizations = await account.account.organizations.list();

}

export async function block7() {
const didit = new Didit();
for await (const session of didit.sessions.list({ limit: 100 })) {
  console.log(session.session_id);
}

const page = await didit.sessions.list({ limit: 100 });
if (page.hasNextPage()) {
  const next = await page.getNextPage();
}

}

export async function block8() {
const didit = new Didit();
const pdf = await didit.sessions.generatePdf(sessionId);
await writeFile("report.pdf", new Uint8Array(await pdf.arrayBuffer()));

}

export async function block9() {
const didit = new Didit();

try {
  await didit.sessions.retrieveDecision(sessionId);
} catch (error) {
  if (error instanceof NotFoundError) {
    // ...
  } else if (error instanceof APIStatusError) {
    console.error(error.status, error.body, error.requestId);
  } else {
    throw error;
  }
}

}

export async function block10() {
const didit = new Didit();
const { data, response, requestId } = await didit.sessions.create({ workflow_id }).withResponse();
const raw: Response = await didit.sessions.generatePdf(sessionId).asResponse(); // unread, for streaming

}

export async function block11() {
const didit = new Didit();
const event = await webhooks.verify(rawBody, headers, [currentSecret, previousSecret]);
switch (event.webhook_type) {
  case "status.updated":
  case "data.updated":
    console.log(event.session_id, event.status, event.decision?.status);
    break;
  case "transaction.status.updated":
    console.log(event.transaction_id, event.status, event.score);
    break;
  default:
    console.log("unhandled event", event.webhook_type);
}

}

export async function block12() {
const didit = new Didit();
const txn = await didit.transactions.create({
  transaction_id: "txn-1001",
  transaction_category: "finance",
  transaction_details: { direction: "outbound", amount: 2500, currency: "EUR" },
  subject: { vendor_data: "user-42", full_name: "Ada Lovelace" },
});
console.log(txn.status, txn.score); // "APPROVED" | "IN_REVIEW" | "DECLINED" | ...

const screening = await didit.walletScreening.screen({ wallet_address: "0x...", blockchain: "ETH" });
for await (const rule of didit.transactions.rules.list()) console.log(rule.title, rule.mode);
const settings = await didit.travelRule.retrieveSettings();
const vasps = await didit.travelRule.listVasps({ limit: 20 });

}

export async function block13() {
const didit = new Didit();

const auth = Authentication.fromPublishableKey(process.env.DIDIT_PUBLISHABLE_KEY!, {
  clientId: process.env.DIDIT_APPLICATION_ID!,
});

try {
  const claims = await auth.verifyAccessToken(accessToken);
  console.log(claims.sub, claims.org?.role);
} catch (error) {
  if (error instanceof TokenVerificationError) console.log(error.reason); // e.g. "expired"
  else throw error;
}

}
