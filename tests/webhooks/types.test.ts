// Type-level tests for the webhook API. `tsc -p tsconfig.json` checks them:
// every expectTypeOf and every @ts-expect-error below is an assertion about
// the published types. The test bodies also run, on real events.

import type { IncomingHttpHeaders } from "node:http";

import { describe, expect, expectTypeOf, it, vi } from "vitest";

import type {
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
  WebhookEvent,
  WebhookHeaders,
  WorkflowComplianceChangedEvent,
} from "../../src/webhooks/index.js";
import { verifyWebhook, verifyWebhookParsed, webhooks } from "../../src/webhooks/index.js";
import { delivery, NOW, payload, SECRET } from "./helpers.js";

/** Narrows every webhook type and returns what it saw, so the test also runs. */
function describeEvent(event: WebhookEvent): string {
  switch (event.webhook_type) {
    case "status.updated":
      expectTypeOf(event).toEqualTypeOf<SessionStatusUpdatedEvent>();
      expectTypeOf(event.session_id).toEqualTypeOf<string | undefined>();
      expectTypeOf(event.workflow_version).toEqualTypeOf<number | null | undefined>();
      return `session ${event.session_id ?? ""} ${event.status ?? ""}`;
    case "data.updated":
      expectTypeOf(event).toEqualTypeOf<SessionDataUpdatedEvent>();
      return "session data";
    case "user.status.updated":
      expectTypeOf(event).toEqualTypeOf<UserStatusUpdatedEvent>();
      // @ts-expect-error a user event is not a session event
      expectTypeOf(event).toEqualTypeOf<SessionStatusUpdatedEvent>();
      return `user ${event.vendor_user_id ?? ""}`;
    case "user.data.updated":
      expectTypeOf(event).toEqualTypeOf<UserDataUpdatedEvent>();
      return "user data";
    case "business.status.updated":
      expectTypeOf(event).toEqualTypeOf<BusinessStatusUpdatedEvent>();
      return `business ${event.vendor_business_id ?? ""}`;
    case "business.data.updated":
      expectTypeOf(event).toEqualTypeOf<BusinessDataUpdatedEvent>();
      return "business data";
    case "activity.created":
      expectTypeOf(event).toEqualTypeOf<ActivityCreatedEvent>();
      return "activity";
    case "transaction.created":
      expectTypeOf(event).toEqualTypeOf<TransactionCreatedEvent>();
      return "transaction";
    case "transaction.status.updated":
      expectTypeOf(event).toEqualTypeOf<TransactionStatusUpdatedEvent>();
      expectTypeOf(event.amount).toEqualTypeOf<string | null | undefined>();
      return `transaction ${event.amount ?? ""}`;
    case "travel_rule.status.updated":
      expectTypeOf(event).toEqualTypeOf<TravelRuleStatusUpdatedEvent>();
      return `travel rule ${event.travel_rule_status ?? ""}`;
    case "workflow.compliance_changed":
      expectTypeOf(event).toEqualTypeOf<WorkflowComplianceChangedEvent>();
      return "workflow";
    case "kyb.registry_search.resolved":
      expectTypeOf(event).toEqualTypeOf<KybRegistrySearchResolvedEvent>();
      return "registry search";
    default:
      // TypeScript cannot remove the known events here (UnknownEvent's type
      // is any string), but webhook_type is still a string to log.
      expectTypeOf(event.webhook_type).toEqualTypeOf<string>();
      return `unknown ${event.webhook_type}`;
  }
}

describe("WebhookEvent", () => {
  it("narrows on webhook_type in a switch, with UnknownEvent in the union", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW * 1000);
    try {
      const known = delivery(payload({ status: "Declined" }));
      expect(describeEvent(await verifyWebhook(known.body, known.headers, SECRET))).toBe(
        "session 11111111-2222-3333-4444-555555555555 Declined",
      );
      const unknown = delivery(payload({ webhook_type: "something.new" }));
      expect(describeEvent(await verifyWebhook(unknown.body, unknown.headers, SECRET))).toBe(
        "unknown something.new",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("narrows on webhook_type with === and !==", () => {
    const check = (event: WebhookEvent) => {
      if (event.webhook_type === "transaction.created") {
        expectTypeOf(event).toEqualTypeOf<TransactionCreatedEvent>();
      }
      if (event.webhook_type !== "status.updated") return;
      expectTypeOf(event).toEqualTypeOf<SessionStatusUpdatedEvent>();
    };
    expect(check).toBeTypeOf("function");
  });

  it("types the shared fields on the whole union", () => {
    const check = (event: WebhookEvent) => {
      expectTypeOf(event.webhook_type).toEqualTypeOf<string>();
      expectTypeOf(event.timestamp).toEqualTypeOf<number>();
      expectTypeOf(event.event_id).toEqualTypeOf<string | undefined>();
      expectTypeOf(event.verifiedBy).toEqualTypeOf<
        "signature" | "signature_v2" | "signature_simple"
      >();
      expectTypeOf(event.bodyAuthenticated).toEqualTypeOf<boolean>();
      // Fields the SDK does not describe are readable, as unknown.
      expectTypeOf(event.some_future_field).toEqualTypeOf<unknown>();
      // Comparing with a type this SDK version does not know compiles.
      if (event.webhook_type === "transaction_rule_suggestions.created") return;
      // @ts-expect-error session fields need narrowing first
      const sessionId: string | undefined = event.session_id;
      // @ts-expect-error verifiedBy is read-only
      event.verifiedBy = "signature";
      return sessionId;
    };
    expect(check).toBeTypeOf("function");
  });

  it("keeps UnknownEvent's webhook_type a string", () => {
    expectTypeOf<UnknownEvent["webhook_type"]>().toEqualTypeOf<string>();
    expectTypeOf<KnownWebhookEvent["webhook_type"]>().toEqualTypeOf<
      | "status.updated"
      | "data.updated"
      | "user.status.updated"
      | "user.data.updated"
      | "business.status.updated"
      | "business.data.updated"
      | "activity.created"
      | "transaction.created"
      | "transaction.status.updated"
      | "travel_rule.status.updated"
      | "workflow.compliance_changed"
      | "kyb.registry_search.resolved"
    >();
    expectTypeOf<Extract<WebhookEvent, { webhook_type: "data.updated" }>>().toEqualTypeOf<SessionDataUpdatedEvent>();
  });

  it("keeps open enums open", () => {
    const check = (event: SessionStatusUpdatedEvent, txn: TransactionStatusUpdatedEvent) => {
      const known: typeof event.status = "Approved";
      const unknown: typeof event.status = "Some Future Status";
      const severity: typeof txn.severity = "LOW";
      return [known, unknown, severity];
    };
    expect(check).toBeTypeOf("function");
  });

  it("would not narrow with a declared or branded string on UnknownEvent (why the design is as it is)", () => {
    // A copy of the union where UnknownEvent declares webhook_type as a
    // branded string: TypeScript then keeps every member in every case,
    // because the brand's string part is comparable to every literal.
    interface Base {
      timestamp: number;
      [key: string]: unknown;
    }
    type Branded = string & { readonly __unknownWebhookType: true };
    interface Session extends Base {
      webhook_type: "status.updated";
      session_id?: string;
    }
    interface User extends Base {
      webhook_type: "user.status.updated";
    }
    interface Unknown extends Base {
      webhook_type: Branded;
    }
    const check = (event: Session | User | Unknown) => {
      if (event.webhook_type === "status.updated") {
        expectTypeOf(event).not.toEqualTypeOf<Session>();
      }
    };
    expect(check).toBeTypeOf("function");
  });
});

describe("entry points", () => {
  it("accepts every header shape and returns a WebhookEvent", () => {
    expectTypeOf(verifyWebhook).returns.resolves.toEqualTypeOf<WebhookEvent>();
    expectTypeOf(verifyWebhookParsed).returns.resolves.toEqualTypeOf<WebhookEvent>();
    expectTypeOf(webhooks.verify).toEqualTypeOf(verifyWebhook);
    expectTypeOf<Headers>().toExtend<WebhookHeaders>();
    expectTypeOf<IncomingHttpHeaders>().toExtend<WebhookHeaders>();
    expectTypeOf<Map<string, string>>().toExtend<WebhookHeaders>();
    expectTypeOf<[string, string][]>().toExtend<WebhookHeaders>();
    expectTypeOf<Record<string, string>>().toExtend<WebhookHeaders>();
    expectTypeOf<Buffer>().toExtend<Parameters<typeof verifyWebhook>[0]>();
    expectTypeOf<ArrayBuffer>().toExtend<Parameters<typeof verifyWebhook>[0]>();
    expectTypeOf<readonly string[]>().toExtend<Parameters<typeof verifyWebhook>[2]>();
    const misuse = () => {
      // @ts-expect-error the raw body is text or bytes, not a parsed object
      void verifyWebhook({ timestamp: 1 }, {}, SECRET);
      // @ts-expect-error headers are not a string
      void verifyWebhook("{}", "x-signature: 00", SECRET);
      // @ts-expect-error allowSimple is a boolean
      void verifyWebhook("{}", {}, SECRET, { allowSimple: "yes" });
      // @ts-expect-error verifyWebhookParsed only checks X-Signature-V2
      void verifyWebhookParsed({}, {}, SECRET, { allowSimple: true });
    };
    expect(misuse).toBeTypeOf("function");
  });
});
