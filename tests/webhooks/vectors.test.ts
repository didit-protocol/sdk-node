// Every backend vector in openapi/webhook-vectors.json (docs/DESIGN.md section 9.3).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { canonicalJson } from "../../src/webhooks/canonical.js";
import { LosslessNumber, parseJson, type JsonValue } from "../../src/webhooks/json.js";
import {
  verifyWebhook,
  verifyWebhookParsed,
  type WebhookHeaders,
} from "../../src/webhooks/verify.js";
import { reasonOf, VECTORS, type Vector } from "./helpers.js";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
});

afterEach(() => {
  vi.useRealTimers();
});

const encoder = new TextEncoder();

const bodyShapes = {
  string: (body: string) => body,
  Uint8Array: (body: string) => encoder.encode(body),
} as const;

const headerShapes = {
  Headers: (headers: Record<string, string>): WebhookHeaders => new Headers(headers),
  "lowercase record": (headers: Record<string, string>): WebhookHeaders =>
    Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])),
} as const;

/** The vector's headers restricted to X-Signature-V2, its -Previous and X-Timestamp. */
function v2Only(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).filter(([k]) =>
      ["X-Signature-V2", "X-Signature-V2-Previous", "X-Timestamp"].includes(k),
    ),
  );
}

/**
 * The parsed body with every integer above 2^53 as a bigint, the way a
 * receiver that needs exact integers would parse it for verifyWebhookParsed.
 */
function parseWithBigInts(text: string): unknown {
  const convert = (value: JsonValue): unknown => {
    if (value instanceof LosslessNumber) {
      const n = Number(value.raw);
      return value.isInteger && !Number.isSafeInteger(n) ? BigInt(value.raw) : n;
    }
    if (Array.isArray(value)) return value.map(convert);
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, convert(v)]));
    }
    return value;
  };
  return convert(parseJson(text));
}

describe.each(VECTORS.map((v) => [v.name, v] as [string, Vector]))("vector %s", (_name, vector) => {
  beforeEach(() => {
    vi.setSystemTime(vector.now * 1000);
  });

  it("canonical JSON equals canonical_v2 byte for byte", () => {
    const canonical = canonicalJson(parseJson(vector.body));
    if (vector.name === "tampered_body") {
      // The vector changes the body after signing ("Approved" became
      // "Declined") and keeps the canonical string of the original body, so
      // the two must differ: that difference is why its signatures fail.
      expect(canonical).not.toBe(vector.canonical_v2);
      expect(canonical.replace('"Declined"', '"Approved"')).toBe(vector.canonical_v2);
    } else {
      expect(Buffer.from(canonical, "utf-8")).toEqual(Buffer.from(vector.canonical_v2, "utf-8"));
    }
  });

  for (const [bodyShape, toBody] of Object.entries(bodyShapes)) {
    for (const [headerShape, toHeaders] of Object.entries(headerShapes)) {
      it(`expects ${vector.expect} with a ${bodyShape} body and ${headerShape} headers`, async () => {
        const body = toBody(vector.body);
        const headers = toHeaders(vector.headers);
        if (vector.expect === "valid") {
          const event = await verifyWebhook(body, headers, vector.secret);
          expect(event.verifiedBy).toBe("signature");
          expect(event.bodyAuthenticated).toBe(true);
          expect(event.webhook_type).toBe(
            (JSON.parse(vector.body) as Record<string, unknown>).webhook_type,
          );
          expect(JSON.stringify(event)).toBe(JSON.stringify(JSON.parse(vector.body)));
        } else if (vector.expect === "valid_only_with_allow_simple") {
          expect(await reasonOf(verifyWebhook(body, headers, vector.secret))).toBe(
            "invalid_signature",
          );
          const event = await verifyWebhook(body, headers, vector.secret, { allowSimple: true });
          expect(event.verifiedBy).toBe("signature_simple");
          expect(event.bodyAuthenticated).toBe(false);
        } else {
          expect(await reasonOf(verifyWebhook(body, headers, vector.secret))).toBe(vector.expect);
        }
      });
    }
  }

  if (vector.expect === "valid") {
    it("verifies with the previous secret alone and in a list during a rotation", async () => {
      if (vector.previous_secret === null) return;
      const alone = await verifyWebhook(vector.body, vector.headers, vector.previous_secret);
      expect(alone.bodyAuthenticated).toBe(true);
      const both = await verifyWebhook(vector.body, vector.headers, [
        vector.previous_secret,
        vector.secret,
      ]);
      expect(both.bodyAuthenticated).toBe(true);
    });

    it("verifies through X-Signature-V2 alone, from the raw body", async () => {
      const event = await verifyWebhook(vector.body, v2Only(vector.headers), vector.secret);
      expect(event.verifiedBy).toBe("signature_v2");
    });

    it("verifies the parsed body with verifyWebhookParsed", async () => {
      const headers = v2Only(vector.headers);
      const parsed = JSON.parse(vector.body) as Record<string, unknown>;
      if (vector.name.startsWith("session_floats_and_numbers")) {
        // JSON.parse turns big_int 9007199254740993 into 9007199254740992, so
        // the canonical JSON differs from what was signed: the documented
        // limit of verifyWebhookParsed. Parsed with bigints, it verifies.
        expect(await reasonOf(verifyWebhookParsed(parsed, headers, vector.secret))).toBe(
          "invalid_signature",
        );
        const exact = await verifyWebhookParsed(
          parseWithBigInts(vector.body),
          headers,
          vector.secret,
        );
        expect(exact.verifiedBy).toBe("signature_v2");
        return;
      }
      expect(canonicalJson(parsed)).toBe(vector.canonical_v2);
      const event = await verifyWebhookParsed(parsed, headers, vector.secret);
      expect(event.verifiedBy).toBe("signature_v2");
      expect(event.bodyAuthenticated).toBe(true);
    });
  }
});

it("the vectors cover every outcome", () => {
  expect(new Set(VECTORS.map((v) => v.expect))).toEqual(
    new Set([
      "valid",
      "valid_only_with_allow_simple",
      "invalid_signature",
      "missing_signature",
      "timestamp_out_of_tolerance",
      "timestamp_mismatch",
    ]),
  );
  expect(VECTORS).toHaveLength(25);
});

it("the travel rule vector reads as its typed event", async () => {
  const vector = VECTORS.find((v) => v.name === "travel_rule_status_updated")!;
  vi.setSystemTime(vector.now * 1000);
  const event = await verifyWebhook(vector.body, vector.headers, vector.secret);
  if (event.webhook_type !== "travel_rule.status.updated") throw new Error(event.webhook_type);
  expect(event.travel_rule_status).toBe("COMPLETED");
  expect(event.rail).toBe("TRP");
});
