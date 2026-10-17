// AML screening with an idempotency key, and error handling.
//
//   export DIDIT_API_KEY=...
//   node examples/aml-screening.ts

import Didit, { APIConnectionError, APIStatusError, RateLimitError } from "@didit-protocol/sdk-node";

const didit = new Didit();
try {
  const { data, requestId } = await didit.aml
    .screen(
      { full_name: "Ada Lovelace", date_of_birth: "1815-12-10", nationality: "GB", entity_type: "person" },
      { idempotencyKey: "aml-user-123-2026-10-17" },
    )
    .withResponse();
  console.log("request", requestId, JSON.stringify(data, null, 2));
} catch (error) {
  if (error instanceof RateLimitError) console.error("Slow down and retry later.");
  else if (error instanceof APIStatusError) console.error(error.status, error.body, error.requestId);
  else if (error instanceof APIConnectionError) console.error("Network problem:", error.message);
  else throw error;
}
