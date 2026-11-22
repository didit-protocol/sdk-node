// Typed webhook events (docs/DESIGN.md section 9.4).
//
// An event is the parsed webhook body itself, so every field Didit sends is
// readable, including fields this version of the SDK does not describe. The one
// change: a session event's `decision` is the generated decision type, whose
// date-times are Date objects. Narrow it with `switch (event.webhook_type)`.
//
// How narrowing works with UnknownEvent in the union: the twenty-eight known events
// declare `webhook_type` as a string literal, and UnknownEvent reads it through
// an index signature (`webhook_type${string}`) instead of declaring it. For a
// union of ten or more object types whose discriminant is a literal in each
// member that declares it, TypeScript maps each literal to its member, so
// `case "status.updated":` narrows to exactly SessionStatusUpdatedEvent and
// UnknownEvent drops out. A declared `webhook_type: string` (or any branded
// string) on UnknownEvent would keep it in every case, because a string is
// comparable to every literal. tests/webhooks/types.test.ts proves this.

import { decodeDates } from "../core/dates.js";
import { DATE_PLANS } from "../resources/date-plans.js";
import type { SessionDecision } from "../types/components.js";

/** Which header authenticated a delivery. */
export type WebhookVerifiedBy = "signature" | "signature_v2" | "signature_simple";

/** The environment of the application that sent the webhook. */
export type WebhookEnvironment = "live" | "sandbox" | (string & {});

/** Fields on every event. */
export interface WebhookEventBase {
  /** Identifies the event; it stays the same across retries, so use it to deduplicate deliveries. */
  event_id?: string;
  /** The signed delivery time in unix seconds; verification checked it against the tolerance. */
  timestamp: number;
  /** When the event was created, in unix seconds. */
  created_at?: number;
  /** The Didit application the event belongs to. */
  application_id?: string;
  environment?: WebhookEnvironment;
  /**
   * Which header authenticated the delivery: `signature` (X-Signature, the raw
   * body), `signature_v2` (X-Signature-V2, the canonical JSON) or
   * `signature_simple` (the deprecated X-Signature-Simple). Not enumerable, so
   * it is not part of `JSON.stringify(event)`.
   */
  readonly verifiedBy: WebhookVerifiedBy;
  /**
   * `false` when only the deprecated X-Signature-Simple matched: it signs the
   * timestamp, session_id, status and webhook_type, not the body, so re-fetch
   * the record from the API before trusting anything else in the event. Not
   * enumerable.
   */
  readonly bodyAuthenticated: boolean;
  /** Fields this version of the SDK does not describe are kept as sent. */
  [key: string]: unknown;
}

/** Status of a verification session. */
type SessionStatus =
  | "Not Started"
  | "In Progress"
  | "Awaiting User"
  | "In Review"
  | "Approved"
  | "Declined"
  | "Resubmitted"
  | "Expired"
  | "Kyc Expired"
  | "Abandoned"
  | (string & {});

/** Status of a user or business entity. */
type EntityStatus = "ACTIVE" | "FLAGGED" | "BLOCKED" | (string & {});

/** Monitoring verdict of a transaction. */
type TransactionStatus = "APPROVED" | "IN_REVIEW" | "DECLINED" | "AWAITING_USER" | (string & {});

/** Risk severity of a transaction. */
type TransactionSeverity = "UNKNOWN" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | (string & {});

/** Direction of a transaction relative to its subject. */
type TransactionDirection = "INBOUND" | "OUTBOUND" | (string & {});

/** Status of a Travel Rule exchange. */
type TravelRuleStatus =
  | "AWAITING_COUNTERPARTY"
  | "ON_HOLD"
  | "COMPLETED"
  | "FINISHED"
  | "CANCELLED"
  | "EXPIRED"
  | "COUNTERPARTY_MISMATCHED_DATA"
  | "COUNTERPARTY_VASP_NOT_FOUND"
  | "COUNTERPARTY_VASP_NOT_REACHABLE"
  | "UNCONFIRMED_OWNERSHIP"
  | "COUNTERPARTY_VASP_GENERAL_DECLINE"
  | "NOT_ENOUGH_COUNTERPARTY_DATA"
  | "NOT_APPLICABLE"
  | (string & {});

/** Protocol a Travel Rule exchange runs on. */
type TravelRuleRail = "INTERNAL" | "TRP" | "GTR" | "EMAIL" | (string & {});

/** Fields of the session events, `status.updated` and `data.updated`. */
interface SessionEventFields {
  /** The session: a user (KYC) or business (KYB) session. */
  session_id?: string;
  /** Set on business sessions, where it equals `session_id`. */
  business_session_id?: string | null;
  /** `business` on business sessions; user sessions may omit it. */
  session_kind?: "user" | "business" | (string & {}) | null;
  status?: SessionStatus | null;
  /** The workflow the session was created with. */
  workflow_id?: string | null;
  workflow_version?: number | null;
  /** The identifier you attached to the session. */
  vendor_data?: string | null;
  /** The metadata you attached to the session. */
  metadata?: Record<string, unknown> | null;
  /** The session decision, the same type `sessions.retrieveDecision` returns (date-times as `Date`). */
  decision?: SessionDecision | null;
  /** The steps the user must redo and why, when the status is `Resubmitted`. */
  resubmit_info?: unknown;
}

/** `status.updated`: a verification session changed status. */
export interface SessionStatusUpdatedEvent extends WebhookEventBase, SessionEventFields {
  webhook_type: "status.updated";
}

/** `data.updated`: the data of a verification session changed. */
export interface SessionDataUpdatedEvent extends WebhookEventBase, SessionEventFields {
  webhook_type: "data.updated";
}

/** Fields of `user.status.updated` and `user.data.updated`. */
interface UserEventFields {
  /** The user's identifier. */
  vendor_user_id?: string | null;
  /** The identifier you attached to the user. */
  vendor_data?: string | null;
  status?: EntityStatus | null;
}

/** `user.status.updated`: a user's status changed. */
export interface UserStatusUpdatedEvent extends WebhookEventBase, UserEventFields {
  webhook_type: "user.status.updated";
}

/** `user.data.updated`: a user's data changed. */
export interface UserDataUpdatedEvent extends WebhookEventBase, UserEventFields {
  webhook_type: "user.data.updated";
}

/** Fields of `business.status.updated` and `business.data.updated`. */
interface BusinessEventFields {
  /** The business's identifier. */
  vendor_business_id?: string | null;
  /** The identifier you attached to the business. */
  vendor_data?: string | null;
  status?: EntityStatus | null;
}

/** `business.status.updated`: a business's status changed. */
export interface BusinessStatusUpdatedEvent extends WebhookEventBase, BusinessEventFields {
  webhook_type: "business.status.updated";
}

/** `business.data.updated`: a business's data changed. */
export interface BusinessDataUpdatedEvent extends WebhookEventBase, BusinessEventFields {
  webhook_type: "business.data.updated";
}

/** `activity.created`. Didit has not published its payload beyond the envelope. */
export interface ActivityCreatedEvent extends WebhookEventBase {
  webhook_type: "activity.created";
}

/** Fields of `transaction.created` and `transaction.status.updated`. */
interface TransactionEventFields {
  /** Didit's transaction id. */
  transaction_id?: string;
  /** The transaction id you supplied. */
  txn_id?: string | null;
  status?: TransactionStatus | null;
  /** The risk score accumulated by rules. */
  score?: number | null;
  severity?: TransactionSeverity | null;
  /** The amount as a decimal string, exactly as sent. */
  amount?: string | null;
  /** Currency code or crypto asset symbol of `amount`. */
  currency?: string | null;
  direction?: TransactionDirection | null;
  /** The pending end-user action, if any. */
  action_required?: unknown;
}

/** `transaction.created`: a transaction was submitted for monitoring. */
export interface TransactionCreatedEvent extends WebhookEventBase, TransactionEventFields {
  webhook_type: "transaction.created";
}

/** `transaction.status.updated`: a transaction's monitoring verdict changed. */
export interface TransactionStatusUpdatedEvent extends WebhookEventBase, TransactionEventFields {
  webhook_type: "transaction.status.updated";
}

/** `travel_rule.status.updated`: a Travel Rule exchange changed status. */
export interface TravelRuleStatusUpdatedEvent extends WebhookEventBase {
  webhook_type: "travel_rule.status.updated";
  /** Didit's transaction id. */
  transaction_id?: string;
  /** The transaction id you supplied. */
  txn_id?: string | null;
  travel_rule_status?: TravelRuleStatus | null;
  /** The protocol of the exchange; empty when none was chosen. */
  rail?: TravelRuleRail | null;
  direction?: TransactionDirection | null;
}

/** `workflow.compliance_changed`. */
export interface WorkflowComplianceChangedEvent extends WebhookEventBase {
  webhook_type: "workflow.compliance_changed";
  workflow_id?: string | null;
}

/**
 * `kyb.registry_search.resolved`: an asynchronous business registry search
 * finished. The callback names its type `event_type`; the SDK then sets
 * `webhook_type` from it (not enumerable, so the payload stays as sent).
 *
 * Didit delivers this callback unsigned today (`X-Didit-Unsigned-Callback:
 * true`), so `verify` rejects it with `missing_signature`; read the result
 * from the API by its `request_id` instead of trusting the body.
 */
export interface KybRegistrySearchResolvedEvent extends WebhookEventBase {
  webhook_type: "kyb.registry_search.resolved";
  /** The search request, as `kyb.search` returned it. */
  request_id?: string | null;
  /** The identifier you attached to the search. */
  vendor_data?: string | null;
  metadata?: Record<string, unknown> | null;
  search_status?: "pending" | "resolved" | (string & {}) | null;
  search_resolved?: boolean | null;
  /** The registry result with the candidate companies. */
  kyb_registry?: Record<string, unknown> | null;
}

/** Ids and statuses of a Bank Link. No personal data. */
export interface BankLinkEventData {
  /** The link id. */
  link_id: string;
  /** The link's final status. */
  status: "completed" | "cancelled" | "expired" | "failed" | (string & {});
  /** The connection the link created or renewed. */
  connection_id: string | null;
  /** The ownership result, when one was asked for. */
  check_id: string | null;
  /** Why the link failed, with `bank.link.failed`. */
  error_code:
    | "duplicate_conflict"
    | "renewal_login_mismatch"
    | "reduced_grant"
    | "corporate_approval_not_supported"
    | "ongoing_access_not_available"
    | "bank_unavailable"
    | "bank_cancelled"
    | "consent_declined"
    | "read_limit"
    | (string & {})
    | null;
}

/** Ids and statuses of a bank connection. No personal data. */
export interface BankConnectionEventData {
  /** The connection id. */
  connection_id: string;
  status:
    | "pending"
    | "active"
    | "renewal_required"
    | "paused"
    | "revoked"
    | "deleted"
    | "failed"
    | (string & {});
  /** Why the connection is in this status. */
  status_reason:
    | "collection_complete"
    | "consent_expired"
    | "consent_lapsed"
    | "bank_requires_sign_in"
    | "revoked_by_end_user"
    | "revoked_by_bank"
    | "revoked_by_customer"
    | "insufficient_balance"
    | "paused_by_customer"
    | "first_sync_failed"
    | (string & {})
    | null;
}

/** The approach of a connection's consent end. */
export interface BankConnectionConsentExpiringData {
  /** The connection id. */
  connection_id: string;
  /** 14, 7 or 1. */
  days_left: number;
  /** When the bank's consent ends, as sent (a date-time string). */
  expires_at: string;
  /** A ready renew link, when automatic renew links are on. It is a credential: never log it. */
  renew_url: string | null;
}

/** Who ended a connection's access, and where the consent stands. */
export interface BankConnectionRevokedData {
  /** The connection id. */
  connection_id: string;
  /** The consent status. */
  status: "revocation_pending" | "revoked" | "revocation_failed" | (string & {});
  /** Who ended access. */
  ended_by: "end_user" | "bank" | "customer" | "unknown" | (string & {});
}

/** The erased state of a deleted connection. */
export interface BankConnectionDeletedData {
  /** The connection id. */
  connection_id: string;
  /** `erased` once no stored copy and no access at the bank remain. */
  erasure_status: "erased" | (string & {});
}

/** The transactions and balances a sync changed. */
export interface BankDataUpdatedData {
  /** The connection id. */
  connection_id: string;
  /** The sync that changed the data. */
  sync_id: string;
  /** Accounts whose data changed. */
  account_ids: string[];
  /** Transactions added. */
  added: number;
  /** Transactions modified. */
  modified: number;
  /** Transactions removed. */
  removed: number;
  /** Whether the balances changed. */
  balances_changed: boolean;
}

/** The result of a connection's sync. */
export interface BankSyncCompletedData {
  /** The connection id. */
  connection_id: string;
  /** The sync that completed. */
  sync_id: string;
  /** What started the sync. */
  trigger: "scheduled" | "requested" | "initial" | (string & {});
  /** How the sync ended. */
  outcome: "succeeded" | "partial" | "failed" | (string & {});
  /** Whether the sync stored changes. */
  changed: boolean;
}

/** A sync that failed. */
export interface BankSyncFailedData {
  /** The connection id. */
  connection_id: string;
  /** The latest failed sync, when one is known. */
  sync_id: string | null;
  /** The sync error code, when the bank gave one. */
  error_code: string | null;
}

/** A connection whose sync works again. */
export interface BankSyncRecoveredData {
  /** The connection id. */
  connection_id: string;
  /** The sync that succeeded. */
  sync_id: string;
}

/** Fields of the `bank.link.*` events. */
interface BankLinkEventFields {
  data: BankLinkEventData;
}

/** `bank.link.completed`: a Bank Link completed and may have created a connection. */
export interface BankLinkCompletedEvent extends WebhookEventBase, BankLinkEventFields {
  webhook_type: "bank.link.completed";
}

/** `bank.link.cancelled`: a Bank Link was cancelled before it completed. */
export interface BankLinkCancelledEvent extends WebhookEventBase, BankLinkEventFields {
  webhook_type: "bank.link.cancelled";
}

/** `bank.link.expired`: a Bank Link expired before it completed. */
export interface BankLinkExpiredEvent extends WebhookEventBase, BankLinkEventFields {
  webhook_type: "bank.link.expired";
}

/** `bank.link.failed`: a Bank Link failed. */
export interface BankLinkFailedEvent extends WebhookEventBase, BankLinkEventFields {
  webhook_type: "bank.link.failed";
}

/** Fields of the connection events that carry `BankConnectionEventData`. */
interface BankConnectionEventFields {
  data: BankConnectionEventData;
}

/** `bank.connection.created`: a connection was created. */
export interface BankConnectionCreatedEvent extends WebhookEventBase, BankConnectionEventFields {
  webhook_type: "bank.connection.created";
}

/** `bank.connection.updated`: a connection changed status. */
export interface BankConnectionUpdatedEvent extends WebhookEventBase, BankConnectionEventFields {
  webhook_type: "bank.connection.updated";
}

/** `bank.connection.renewal_required`: the person must renew the connection. */
export interface BankConnectionRenewalRequiredEvent
  extends WebhookEventBase, BankConnectionEventFields {
  webhook_type: "bank.connection.renewal_required";
}

/** `bank.connection.renewed`: the connection's consent was renewed. */
export interface BankConnectionRenewedEvent extends WebhookEventBase, BankConnectionEventFields {
  webhook_type: "bank.connection.renewed";
}

/** `bank.connection.history_complete`: the history backfill ended. */
export interface BankConnectionHistoryCompleteEvent
  extends WebhookEventBase, BankConnectionEventFields {
  webhook_type: "bank.connection.history_complete";
}

/** `bank.connection.consent_expiring`: the connection's consent is about to end. */
export interface BankConnectionConsentExpiringEvent extends WebhookEventBase {
  webhook_type: "bank.connection.consent_expiring";
  data: BankConnectionConsentExpiringData;
}

/** `bank.connection.revoked`: access to the connection ended. */
export interface BankConnectionRevokedEvent extends WebhookEventBase {
  webhook_type: "bank.connection.revoked";
  data: BankConnectionRevokedData;
}

/** `bank.connection.deleted`: the connection's stored bank data was erased. */
export interface BankConnectionDeletedEvent extends WebhookEventBase {
  webhook_type: "bank.connection.deleted";
  data: BankConnectionDeletedData;
}

/** `bank.data.updated`: a sync changed the connection's transactions or balances. */
export interface BankDataUpdatedEvent extends WebhookEventBase {
  webhook_type: "bank.data.updated";
  data: BankDataUpdatedData;
}

/** `bank.sync.completed`: a connection's sync ended. */
export interface BankSyncCompletedEvent extends WebhookEventBase {
  webhook_type: "bank.sync.completed";
  data: BankSyncCompletedData;
}

/** `bank.sync.failed`: a connection's sync failed. */
export interface BankSyncFailedEvent extends WebhookEventBase {
  webhook_type: "bank.sync.failed";
  data: BankSyncFailedData;
}

/** `bank.sync.recovered`: a connection's sync works again. */
export interface BankSyncRecoveredEvent extends WebhookEventBase {
  webhook_type: "bank.sync.recovered";
  data: BankSyncRecoveredData;
}

/**
 * An event type this version of the SDK has no typed event for. Every field of
 * the body is there as sent; `webhook_type` holds its type.
 */
// A Record type would not be the interface member the narrowing relies on.
// eslint-disable-next-line @typescript-eslint/consistent-indexed-object-style
export interface UnknownEvent extends WebhookEventBase {
  /** `webhook_type`: read through an index signature on purpose (see the top of this file). */
  [key: `webhook_type${string}`]: string;
}

/** Every event type this version of the SDK knows. */
export type KnownWebhookEvent =
  | SessionStatusUpdatedEvent
  | SessionDataUpdatedEvent
  | UserStatusUpdatedEvent
  | UserDataUpdatedEvent
  | BusinessStatusUpdatedEvent
  | BusinessDataUpdatedEvent
  | ActivityCreatedEvent
  | TransactionCreatedEvent
  | TransactionStatusUpdatedEvent
  | TravelRuleStatusUpdatedEvent
  | WorkflowComplianceChangedEvent
  | KybRegistrySearchResolvedEvent
  | BankLinkCompletedEvent
  | BankLinkCancelledEvent
  | BankLinkExpiredEvent
  | BankLinkFailedEvent
  | BankConnectionCreatedEvent
  | BankConnectionUpdatedEvent
  | BankConnectionRenewalRequiredEvent
  | BankConnectionRenewedEvent
  | BankConnectionHistoryCompleteEvent
  | BankConnectionConsentExpiringEvent
  | BankConnectionRevokedEvent
  | BankConnectionDeletedEvent
  | BankDataUpdatedEvent
  | BankSyncCompletedEvent
  | BankSyncFailedEvent
  | BankSyncRecoveredEvent;

/** A verified webhook event; narrow it with `switch (event.webhook_type)`. */
export type WebhookEvent = KnownWebhookEvent | UnknownEvent;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function defineHidden(target: object, name: string, value: unknown): void {
  Object.defineProperty(target, name, {
    value,
    enumerable: false,
    writable: false,
    configurable: false,
  });
}

/**
 * Turn a verified body into its event, in place: `payload` must be a fresh
 * object the caller owns. Never throws on unknown data.
 *
 * `payload` is the `JSON.parse` view of the body, so integers above 2^53 in it
 * have lost precision (the signature itself is checked on the exact digits).
 */
export function parseEvent(
  payload: Record<string, unknown>,
  verifiedBy: WebhookVerifiedBy,
): WebhookEvent {
  // The kyb.registry_search.resolved callback names its type event_type.
  if (!Object.hasOwn(payload, "webhook_type") && typeof payload.event_type === "string") {
    defineHidden(payload, "webhook_type", payload.event_type);
  }
  // Defined over any body field of the same name: with allowSimple the body is
  // not authenticated, so it must not be able to claim that it is.
  defineHidden(payload, "verifiedBy", verifiedBy);
  defineHidden(payload, "bodyAuthenticated", verifiedBy !== "signature_simple");
  // The decision is the generated response type, whose date-times are Date objects.
  const type = payload.webhook_type;
  if ((type === "status.updated" || type === "data.updated") && isRecord(payload.decision)) {
    decodeDates(payload.decision, "SessionDecision", DATE_PLANS);
  }
  return payload as WebhookEvent;
}
