// Verify Didit webhook deliveries and read them as typed events
// (docs/DESIGN.md section 9).
//
//   import { webhooks, WebhookVerificationError } from "@didit-protocol/sdk-node";
//
//   const event = await webhooks.verify(rawBody, req.headers, process.env.DIDIT_WEBHOOK_SECRET!);
//   switch (event.webhook_type) {
//     case "status.updated":
//       event.session_id; // SessionStatusUpdatedEvent
//   }
//
// The same functions are on the client as `didit.webhooks.verify` and
// `didit.webhooks.verifyParsed`. Nothing here depends on a framework.

import { verifyWebhook, verifyWebhookParsed } from "./verify.js";

export { canonicalJson } from "./canonical.js";
export type {
  ActivityCreatedEvent,
  BusinessDataUpdatedEvent,
  BusinessStatusUpdatedEvent,
  KnownWebhookEvent,
  KybRegistrySearchResolvedEvent,
  SessionDataUpdatedEvent,
  SessionStatusUpdatedEvent,
  TransactionCreatedEvent,
  TransactionStatusUpdatedEvent,
  TravelRuleStatusUpdatedEvent,
  UnknownEvent,
  UserDataUpdatedEvent,
  UserStatusUpdatedEvent,
  WebhookEnvironment,
  WebhookEvent,
  WebhookEventBase,
  WebhookVerifiedBy,
  WorkflowComplianceChangedEvent,
} from "./events.js";
export {
  DEFAULT_WEBHOOK_TOLERANCE,
  verifyWebhook,
  verifyWebhookParsed,
  type VerifyWebhookOptions,
  type VerifyWebhookParsedOptions,
  type WebhookHeaders,
  type WebhookSecret,
} from "./verify.js";

/**
 * The webhook verifier without a client:
 * `await webhooks.verify(rawBody, req.headers, secret)`.
 */
export const webhooks = {
  /** See {@link verifyWebhook}. */
  verify: verifyWebhook,
  /** See {@link verifyWebhookParsed}. */
  verifyParsed: verifyWebhookParsed,
} as const;
