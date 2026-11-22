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

/** Ids and statuses of a Bank Link, in `data` of the `bank.link.*` events. No personal data. */
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
    | "renewal_not_needed"
    | "renewal_window_expired"
    | "first_sync_failed"
    | (string & {})
    | null;
}

/** Status of a bank connection. */
type BankConnectionStatus =
  | "pending"
  | "active"
  | "renewal_required"
  | "paused"
  | "revoked"
  | "deleted"
  | "failed"
  | (string & {});

/** What started a bank sync. */
type BankSyncTrigger = "initial" | "scheduled" | "requested" | (string & {});

// The connection, data and sync events send their fields at the top level of
// the body, next to the envelope fields (no `data` object). Date-times are the
// ISO 8601 strings as sent.

/** Fields of `bank.connection.created`. */
export interface BankConnectionCreatedData {
  /** The connection id. */
  connection_id: string;
  /** How the first sync ended. */
  initial_status: "succeeded" | "partial" | (string & {});
}

/** Fields of `bank.connection.updated`. */
export interface BankConnectionUpdatedData {
  /** The connection id. */
  connection_id: string;
  /** The connection status. */
  status: BankConnectionStatus;
  /** `pending`: a revocation was requested and the bank has not confirmed it yet. */
  revocation_status: "pending" | (string & {});
}

/** Fields of `bank.connection.consent_expiring`. */
export interface BankConnectionConsentExpiringData {
  /** The connection id. */
  connection_id: string;
  /** Days left before the consent ends: 14, 7 or 1. */
  days_left: number;
  /** When the consent ends. */
  consent_expires_at: string;
  /** The consent's end: renew before it for no gap. */
  renew_by: string | null;
}

/** Fields of `bank.connection.renewal_required`. */
export interface BankConnectionRenewalRequiredData {
  /** The connection id. */
  connection_id: string;
  status: "renewal_required" | (string & {});
  /** Why renewal is needed. */
  reason: "consent_expired" | "bank_requires_sign_in" | (string & {});
  /** The consent's end, when there is one. */
  renew_by: string | null;
  /** The last moment the same connection can be revived. After it the person connects again. */
  renewable_until: string | null;
}

/** Fields of `bank.connection.renewed`. */
export interface BankConnectionRenewedData {
  /** The connection id. */
  connection_id: string;
  /** The connection status. */
  status: BankConnectionStatus;
  /** The consent version the renewal created. */
  consent_version: number;
  /** The renew link that completed, when there is one. */
  link_id: string | null;
  /** When the renewed consent ends. */
  consent_expires_at: string | null;
}

/** Fields of `bank.connection.revoked`. */
export interface BankConnectionRevokedData {
  /** The connection id. */
  connection_id: string;
  /** Consent status once access is terminated. */
  status: "revoked" | (string & {});
  /** Who ended access. */
  ended_by: "end_user" | "bank" | "customer" | "unknown" | (string & {});
  /** Why the connection is in this status. */
  status_reason:
    | "revoked_by_end_user"
    | "revoked_by_bank"
    | "revoked_by_customer"
    | "consent_expired"
    | "consent_lapsed"
    | "bank_requires_sign_in"
    | "insufficient_balance"
    | "paused_by_customer"
    | "first_sync_failed"
    | "collection_complete"
    | (string & {})
    | null;
  /** When access ended. */
  ended_at: string | null;
  /** How long the stored data stays readable, set by the retention setting of your application. */
  retain_until: string | null;
}

/** Fields of `bank.connection.deleted`. */
export interface BankConnectionDeletedData {
  /** The connection id. */
  connection_id: string;
  status: "deleted" | (string & {});
  /** `erased`: the deletion finished. */
  erasure_status: "erased" | (string & {});
  /** Why the connection was deleted. */
  reason:
    | "deleted_by_customer"
    | "consent_lapsed"
    | "retention_elapsed"
    | "application_deleted"
    | "restored_after_deletion"
    | (string & {})
    | null;
  /** When the deletion finished. */
  erased_at: string;
}

/** Fields of `bank.connection.history_complete`. */
export interface BankConnectionHistoryCompleteData {
  /** The connection id. */
  connection_id: string;
  /** `partial` when the bank could not deliver every range you asked for. */
  status: "complete" | "partial" | (string & {});
}

/** Transactions changed in one account, in `bank.data.updated`. */
export interface BankDataUpdatedAccount {
  /** The account id. */
  account_id: string;
  /** Transactions added. */
  added: number;
  /** Transactions modified. */
  modified: number;
  /** Transactions removed. */
  removed: number;
}

/** Fields of `bank.data.updated`. */
export interface BankDataUpdatedData {
  /** The connection id. */
  connection_id: string;
  /** The sync run id. */
  sync_id: string;
  /** What started the sync. */
  trigger: BankSyncTrigger;
  /** The accounts whose transactions changed, with counts. */
  accounts: BankDataUpdatedAccount[];
  /** Whether any balance changed. */
  balances_changed: boolean;
}

/** Fields of `bank.sync.completed`. */
export interface BankSyncCompletedData {
  /** The connection id. */
  connection_id: string;
  /** The sync run id. */
  sync_id: string;
  /** What started the sync. */
  trigger: BankSyncTrigger;
  /** How the sync ended. */
  outcome: "succeeded" | "partial" | "failed" | (string & {});
  /** Whether the sync stored changes. */
  changed: boolean;
}

/** Fields of `bank.sync.failed`. */
export interface BankSyncFailedData {
  /** The connection id. */
  connection_id: string;
  /** The latest failed sync. */
  sync_id: string;
  /** Didit error code of the failure. */
  error_code: string;
  /** When the syncs started to fail. */
  failing_since: string;
}

/** Fields of `bank.sync.recovered`. */
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

/** `bank.link.completed`: the person connected a bank or renewed a connection; `data.connection_id` is set. */
export interface BankLinkCompletedEvent extends WebhookEventBase, BankLinkEventFields {
  webhook_type: "bank.link.completed";
}

/** `bank.link.cancelled`: a Bank Link was cancelled, by the person or by `cancelLink`. */
export interface BankLinkCancelledEvent extends WebhookEventBase, BankLinkEventFields {
  webhook_type: "bank.link.cancelled";
}

/** `bank.link.expired`: a Bank Link expired before it was completed. */
export interface BankLinkExpiredEvent extends WebhookEventBase, BankLinkEventFields {
  webhook_type: "bank.link.expired";
}

/** `bank.link.failed`: a Bank Link failed; `data.error_code` says why. Nothing was published or charged. */
export interface BankLinkFailedEvent extends WebhookEventBase, BankLinkEventFields {
  webhook_type: "bank.link.failed";
}

/** `bank.connection.created`: the first sync finished and the accounts are readable. */
export interface BankConnectionCreatedEvent extends WebhookEventBase, BankConnectionCreatedData {
  webhook_type: "bank.connection.created";
}

/** `bank.connection.updated`: a revocation started; `bank.connection.revoked` follows. */
export interface BankConnectionUpdatedEvent extends WebhookEventBase, BankConnectionUpdatedData {
  webhook_type: "bank.connection.updated";
}

/** `bank.connection.consent_expiring`: the consent ends in 14, 7 or 1 days. */
export interface BankConnectionConsentExpiringEvent
  extends WebhookEventBase, BankConnectionConsentExpiringData {
  webhook_type: "bank.connection.consent_expiring";
}

/** `bank.connection.renewal_required`: the consent ended or the bank asks the person to sign in again. */
export interface BankConnectionRenewalRequiredEvent
  extends WebhookEventBase, BankConnectionRenewalRequiredData {
  webhook_type: "bank.connection.renewal_required";
}

/** `bank.connection.renewed`: a renew link completed; the connection and account ids are unchanged. */
export interface BankConnectionRenewedEvent extends WebhookEventBase, BankConnectionRenewedData {
  webhook_type: "bank.connection.renewed";
}

/** `bank.connection.revoked`: access ended and the bank confirmed it. */
export interface BankConnectionRevokedEvent extends WebhookEventBase, BankConnectionRevokedData {
  webhook_type: "bank.connection.revoked";
}

/** `bank.connection.deleted`: the connection's stored data was deleted. */
export interface BankConnectionDeletedEvent extends WebhookEventBase, BankConnectionDeletedData {
  webhook_type: "bank.connection.deleted";
}

/** `bank.connection.history_complete`: the history backfill ended. */
export interface BankConnectionHistoryCompleteEvent
  extends WebhookEventBase, BankConnectionHistoryCompleteData {
  webhook_type: "bank.connection.history_complete";
}

/** `bank.data.updated`: a sync stored changes, or the first read published the accounts. Read them with `syncTransactions`. */
export interface BankDataUpdatedEvent extends WebhookEventBase, BankDataUpdatedData {
  webhook_type: "bank.data.updated";
}

/** `bank.sync.completed`: a sync finished (off by default). */
export interface BankSyncCompletedEvent extends WebhookEventBase, BankSyncCompletedData {
  webhook_type: "bank.sync.completed";
}

/** `bank.sync.failed`: syncs have been failing for 24 hours; they are retried. */
export interface BankSyncFailedEvent extends WebhookEventBase, BankSyncFailedData {
  webhook_type: "bank.sync.failed";
}

/** `bank.sync.recovered`: syncs work again after `bank.sync.failed`. */
export interface BankSyncRecoveredEvent extends WebhookEventBase, BankSyncRecoveredData {
  webhook_type: "bank.sync.recovered";
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
