// Shared fixtures for the webhook tests. Deliveries are signed the way
// service-didit-verification signs them (docs/DESIGN.md section 9.1).

import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

import { WebhookVerificationError, type WebhookVerificationReason } from "../../src/core/errors.js";
import { canonicalJson } from "../../src/webhooks/canonical.js";

export interface Vector {
  name: string;
  body: string;
  canonical_v2: string;
  headers: Record<string, string>;
  secret: string;
  previous_secret: string | null;
  now: number;
  expect: string;
}

export const VECTORS = (
  JSON.parse(
    readFileSync(new URL("../../openapi/webhook-vectors.json", import.meta.url), "utf-8"),
  ) as { vectors: Vector[] }
).vectors;

export const SECRET = "whsec_test_unit_secret_0001";
export const PREVIOUS = "whsec_test_unit_secret_0000";
export const NOW = 1_760_702_400;

export function sign(secret: string, message: string | Uint8Array): string {
  return createHmac("sha256", secret).update(message).digest("hex");
}

/** Python's json.dumps default ensure_ascii=True applied to canonical text. */
export function ensureAscii(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    out += c >= 0x7f ? `\\u${c.toString(16).padStart(4, "0")}` : text.charAt(i);
  }
  return out;
}

/** Python's str() of a JSON scalar, as the backend formats the simple signature. */
function pyStr(value: unknown): string {
  if (value === undefined) return "";
  if (value === null) return "None";
  if (value === true) return "True";
  if (value === false) return "False";
  if (typeof value === "string" || typeof value === "number") return String(value);
  // Python's repr of a list or dict is not rebuilt; no test checks such a simple signature.
  return JSON.stringify(value);
}

export function payload(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    application_id: "0b5e8d2c-1f4a-4c3b-9d6e-2a7f8c1b3e5d",
    created_at: NOW,
    environment: "sandbox",
    event_id: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    session_id: "11111111-2222-3333-4444-555555555555",
    status: "Approved",
    timestamp: NOW,
    webhook_type: "status.updated",
    ...extra,
  };
}

export interface Delivery {
  body: string;
  headers: Record<string, string>;
}

/** A delivery signed like the backend: body, canonical JSON, simple string, timestamp. */
export function delivery(data: Record<string, unknown>, secret = SECRET): Delivery {
  const canonical = canonicalJson(data);
  const body = ensureAscii(canonical);
  const simple = ["timestamp", "session_id", "status", "webhook_type"]
    .map((key) => pyStr(data[key]))
    .join(":");
  return {
    body,
    headers: {
      "X-Signature": sign(secret, body),
      "X-Signature-V2": sign(secret, canonical),
      "X-Signature-Simple": sign(secret, simple),
      "X-Timestamp": pyStr(data.timestamp),
    },
  };
}

/** The reason of the WebhookVerificationError a promise rejects with. */
export async function reasonOf(promise: Promise<unknown>): Promise<WebhookVerificationReason> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof WebhookVerificationError) return error.reason;
    throw error;
  }
  throw new Error("expected a WebhookVerificationError, but verification passed");
}
