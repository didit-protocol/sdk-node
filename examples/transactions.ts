// Transactions (KYT): submit one, then list them with auto-pagination.
//
//   export DIDIT_API_KEY=...
//   node examples/transactions.ts

import Didit from "@didit-protocol/sdk-node";

const didit = new Didit();

const transaction = await didit.transactions.create({
  transaction_id: `txn-${Date.now()}`,
  transaction_category: "finance",
  transaction_at: new Date(),
  transaction_details: { direction: "outbound", amount: 2500, currency: "EUR" },
  subject: { vendor_data: "user-123", full_name: "Ada Lovelace" },
});
console.log("Transaction", transaction.uuid, "is", transaction.status, "score", transaction.score);

let seen = 0;
for await (const item of didit.transactions.list({ limit: 50 })) {
  console.log(item.txn_id, item.status, item.amount, item.currency);
  if (++seen >= 200) break;
}
