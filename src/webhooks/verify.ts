// Webhook signature verification (docs/DESIGN.md section 9.3). The behaviour
// mirrors the reference SDK (sdk-python, didit/webhooks/_verify.py): the same
// checks in the same order, with the same reasons.

import { ConfigurationError, WebhookVerificationError } from "../core/errors.js";
import { webCrypto } from "../core/runtime.js";
import {
  canonicalJson,
  encodeUtf8SurrogatePass,
  hasLoneSurrogate,
  integerLiteralString,
  pyFloatRepr,
} from "./canonical.js";
import { parseEvent, type WebhookEvent, type WebhookVerifiedBy } from "./events.js";
import {
  decodeUtf8,
  isJsonObject,
  LosslessNumber,
  parseJson,
  type JsonObject,
  type JsonValue,
} from "./json.js";

/** How far, in seconds, the signed timestamp may be from now unless `tolerance` says otherwise. */
export const DEFAULT_WEBHOOK_TOLERANCE = 300;

/**
 * The request headers: a Fetch `Headers` object, a Node.js or Express
 * `req.headers` record (any letter case, array values use their first
 * element), or an iterable of `[name, value]` pairs. Names are matched
 * case-insensitively, values are trimmed, and an empty signature header counts
 * as absent.
 */
export type WebhookHeaders =
  | Headers
  | Iterable<readonly [string, string]>
  | Readonly<Record<string, string | readonly string[] | undefined>>;

/** The destination's signing secret, or several during a secret rotation. */
export type WebhookSecret = string | readonly string[];

/** Options of {@link verifyWebhook}. */
export interface VerifyWebhookOptions {
  /**
   * How far, in seconds, the signed timestamp may be from now in either
   * direction (inclusive). Default 300.
   */
  tolerance?: number;
  /**
   * Also accept the deprecated `X-Signature-Simple` (and its `-Previous`). It
   * signs only the timestamp, session_id, status and webhook_type, so an event
   * it verifies has `bodyAuthenticated === false`: re-fetch the record from
   * the API before acting on it. Default false.
   */
  allowSimple?: boolean;
}

/** Options of {@link verifyWebhookParsed}. */
export interface VerifyWebhookParsedOptions {
  /** See {@link VerifyWebhookOptions.tolerance}. */
  tolerance?: number;
}

const RAW_HEADERS = ["x-signature", "x-signature-previous"];
const V2_HEADERS = ["x-signature-v2", "x-signature-v2-previous"];
const SIMPLE_HEADERS = ["x-signature-simple", "x-signature-simple-previous"];
const SIGNATURE = /^[0-9a-f]{64}$/;
const TIMESTAMP_HEADER = /^[0-9]{1,20}$/;
// The characters Python's str.strip() removes (the code points where str.isspace() is true).
const PY_WHITESPACE = new Set([
  0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x1c, 0x1d, 0x1e, 0x1f, 0x20, 0x85, 0xa0, 0x1680, 0x2000, 0x2001,
  0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f,
  0x205f, 0x3000,
]);

/** `s.strip()` in Python, which differs from String#trim (U+001C to U+001F, U+0085, U+FEFF). */
function pyStrip(s: string): string {
  let start = 0;
  let end = s.length;
  while (start < end && PY_WHITESPACE.has(s.charCodeAt(start))) start++;
  while (end > start && PY_WHITESPACE.has(s.charCodeAt(end - 1))) end--;
  return s.slice(start, end);
}

const encoder = new TextEncoder();

function normaliseHeaders(headers: WebhookHeaders): Map<string, string> {
  const out = new Map<string, string>();
  const add = (name: unknown, value: unknown): void => {
    if (typeof name !== "string") return;
    const key = name.toLowerCase();
    // The first occurrence of a name wins, as in the reference (dict.setdefault).
    if (out.has(key)) return;
    let first: unknown = value;
    if (Array.isArray(first)) first = first.length ? (first[0] as unknown) : "";
    if (first === undefined || first === null) return;
    if (typeof first !== "string" && typeof first !== "number") return;
    out.set(key, pyStrip(String(first)));
  };
  if (typeof headers !== "object" || (headers as unknown) === null) {
    throw new TypeError(
      "headers must be a Headers object, a record of header values or an iterable of [name, value] pairs.",
    );
  }
  if (Symbol.iterator in headers) {
    for (const pair of headers as Iterable<unknown>) {
      if (!Array.isArray(pair)) {
        throw new TypeError("headers must be an iterable of [name, value] pairs.");
      }
      add(pair[0], pair[1]);
    }
  } else {
    for (const [name, value] of Object.entries(headers)) add(name, value);
  }
  return out;
}

function normaliseSecrets(secret: unknown): string[] {
  if (secret === undefined || secret === null) {
    throw new ConfigurationError(
      `No webhook secret (${String(secret)}); copy it from the webhook destination in the console, for example into DIDIT_WEBHOOK_SECRET.`,
    );
  }
  if (secret instanceof ArrayBuffer || ArrayBuffer.isView(secret)) {
    throw new ConfigurationError("The webhook secret must be a string, not bytes.");
  }
  let items: unknown[];
  if (typeof secret === "string") {
    items = [secret];
  } else if (typeof secret === "object" && Symbol.iterator in secret) {
    items = Array.from(secret as Iterable<unknown>);
  } else {
    throw new ConfigurationError("The webhook secret must be a string or an array of strings.");
  }
  if (items.some((s) => typeof s !== "string")) {
    throw new ConfigurationError("Every webhook secret must be a string.");
  }
  const secrets = items as string[];
  if (!secrets.length || secrets.some((s) => !s)) {
    throw new ConfigurationError(
      "The webhook secret is empty; copy it from the webhook destination in the console.",
    );
  }
  if (secrets.some(hasLoneSurrogate)) {
    throw new ConfigurationError("The webhook secret is not valid Unicode text.");
  }
  return secrets;
}

function checkTolerance(tolerance: unknown): number {
  if (tolerance === undefined) return DEFAULT_WEBHOOK_TOLERANCE;
  // `!(x >= 0)` also refuses NaN, which would otherwise switch the replay check off.
  if (typeof tolerance !== "number" || !(tolerance >= 0)) {
    throw new ConfigurationError("tolerance must be 0 or more seconds.");
  }
  return tolerance;
}

/** A body timestamp: its exact integer value and a double for the tolerance check. */
interface Timestamp {
  exact: bigint;
  approx: number;
}

function checkTimestamp(
  timestamp: Timestamp | null,
  headers: Map<string, string>,
  tolerance: number,
): void {
  // Didit writes the timestamp as a JSON integer (integral floats are
  // shortened before signing), so anything else is not a Didit delivery.
  if (!timestamp) {
    throw new WebhookVerificationError(
      "missing_timestamp",
      "The webhook body has no integer timestamp.",
    );
  }
  const header = headers.get("x-timestamp");
  // Present but empty is a mismatch, not absent, as in the reference.
  if (
    header !== undefined &&
    (!TIMESTAMP_HEADER.test(header) || BigInt(header) !== timestamp.exact)
  ) {
    throw new WebhookVerificationError(
      "timestamp_mismatch",
      "X-Timestamp does not match the timestamp in the webhook body.",
    );
  }
  const skew = Math.abs(Date.now() / 1000 - timestamp.approx);
  if (skew > tolerance) {
    throw new WebhookVerificationError(
      "timestamp_out_of_tolerance",
      `The webhook timestamp is more than ${tolerance} seconds away from now; it may be a replay.`,
    );
  }
}

function present(headers: Map<string, string>, names: readonly string[]): string[] {
  const values: string[] = [];
  for (const name of names) {
    const value = headers.get(name);
    if (value) values.push(value);
  }
  return values;
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return bytes;
}

/** HMAC keys for the secrets, imported once and only when a well-formed signature needs them. */
class Keys {
  private keys: Promise<CryptoKey[]> | undefined;

  constructor(private readonly secrets: readonly string[]) {}

  get(): Promise<CryptoKey[]> {
    this.keys ??= (async () => {
      const { subtle } = await webCrypto();
      return Promise.all(
        this.secrets.map((secret) =>
          subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
            "verify",
          ]),
        ),
      );
    })();
    return this.keys;
  }
}

/**
 * Whether one of `candidates` is the HMAC-SHA256 of `message` under one of the
 * keys. Only 64-character lowercase hex values are compared, and
 * `crypto.subtle.verify` compares in constant time.
 */
async function matches(
  message: Uint8Array<ArrayBuffer>,
  keys: Keys,
  candidates: readonly string[],
): Promise<boolean> {
  const signatures = candidates.filter((c) => SIGNATURE.test(c)).map(hexToBytes);
  if (!signatures.length) return false;
  const { subtle } = await webCrypto();
  for (const key of await keys.get()) {
    for (const signature of signatures) {
      if (await subtle.verify("HMAC", key, signature, message)) return true;
    }
  }
  return false;
}

/**
 * Python's `str()` of a body field, as the backend formats it for
 * X-Signature-Simple: absent is "", null is "None", booleans "True" and
 * "False", integers in decimal, floats in `repr` form, strings as they are.
 * `undefined` means the field cannot be reproduced (an object or array, whose
 * Python repr is not rebuilt here), so no simple signature can match.
 */
function pyStr(value: JsonValue | undefined): string | undefined {
  if (value === undefined) return "";
  if (value === null) return "None";
  if (typeof value === "boolean") return value ? "True" : "False";
  if (typeof value === "string") return value;
  if (value instanceof LosslessNumber) {
    return value.isInteger ? integerLiteralString(value.raw) : pyFloatRepr(Number(value.raw));
  }
  return undefined;
}

/** What X-Signature-Simple signs: `{timestamp}:{session_id}:{status}:{webhook_type}`. */
function simpleMessage(body: JsonObject): Uint8Array<ArrayBuffer> | undefined {
  const parts: string[] = [];
  for (const key of ["timestamp", "session_id", "status", "webhook_type"]) {
    const part = pyStr(body[key]);
    if (part === undefined) return undefined;
    parts.push(part);
  }
  const message = parts.join(":");
  // The backend encodes this strictly, so it never signs a lone surrogate.
  return hasLoneSurrogate(message) ? undefined : encoder.encode(message);
}

function bodyBytes(rawBody: unknown): { bytes: Uint8Array<ArrayBuffer>; text: string } {
  if (typeof rawBody === "string") {
    // Python's str.encode("utf-8") refuses a lone surrogate.
    if (hasLoneSurrogate(rawBody)) {
      throw new WebhookVerificationError(
        "invalid_payload",
        "The webhook body is not valid UTF-8 text.",
      );
    }
    return { bytes: encoder.encode(rawBody), text: rawBody };
  }
  let bytes: Uint8Array<ArrayBuffer>;
  if (rawBody instanceof ArrayBuffer) {
    bytes = new Uint8Array(rawBody.slice(0));
  } else if (ArrayBuffer.isView(rawBody)) {
    // A copy, so the caller cannot change the bytes while they are verified.
    bytes = new Uint8Array(rawBody.byteLength);
    bytes.set(new Uint8Array(rawBody.buffer, rawBody.byteOffset, rawBody.byteLength));
  } else {
    throw new TypeError(
      "verifyWebhook needs the raw request body as a string, Uint8Array or ArrayBuffer; for a body your framework already parsed, use verifyWebhookParsed.",
    );
  }
  return { bytes, text: decodeUtf8(bytes) };
}

/**
 * Verify a webhook delivery and return its typed event.
 *
 * Pass the exact request body (a string, `Uint8Array` or `ArrayBuffer`), the
 * request headers and the destination's secret (an array of secrets during a
 * rotation). The delivery is accepted when `X-Signature` matches the body, or
 * `X-Signature-V2` matches its canonical JSON, or one of their `-Previous`
 * variants matches; signatures are compared in constant time. The body's
 * `timestamp` must be an integer, equal to `X-Timestamp` when that header is
 * present, and within `tolerance` seconds of now.
 *
 * The event is the parsed body (`JSON.parse`, so integers above 2^53 lose
 * precision in it; the signature is checked on the exact text) with two
 * non-enumerable properties, `verifiedBy` and `bodyAuthenticated`.
 *
 * Throws a `WebhookVerificationError` (see its `reason`) for anything the
 * request carries, and a `ConfigurationError` for a missing or empty secret or
 * an invalid tolerance.
 */
export async function verifyWebhook(
  rawBody: string | Uint8Array | ArrayBuffer,
  headers: WebhookHeaders,
  secret: WebhookSecret,
  options: VerifyWebhookOptions = {},
): Promise<WebhookEvent> {
  const keys = new Keys(normaliseSecrets(secret));
  const tolerance = checkTolerance(options.tolerance);
  const { bytes, text } = bodyBytes(rawBody);
  const body = parseJson(text);
  if (!isJsonObject(body)) {
    throw new WebhookVerificationError("invalid_payload", "The webhook body is not a JSON object.");
  }
  const normalised = normaliseHeaders(headers);
  const timestamp = body.timestamp;
  checkTimestamp(
    timestamp instanceof LosslessNumber && timestamp.isInteger
      ? { exact: BigInt(timestamp.raw), approx: Number(timestamp.raw) }
      : null,
    normalised,
    tolerance,
  );

  const raw = present(normalised, RAW_HEADERS);
  const v2 = present(normalised, V2_HEADERS);
  const simple = present(normalised, SIMPLE_HEADERS);
  if (!raw.length && !v2.length && !simple.length) {
    throw new WebhookVerificationError("missing_signature", "The delivery has no X-Signature header.");
  }
  let verifiedBy: WebhookVerifiedBy | undefined;
  if (raw.length && (await matches(bytes, keys, raw))) {
    verifiedBy = "signature";
  } else if (v2.length && (await matches(encodeUtf8SurrogatePass(canonicalJson(body)), keys, v2))) {
    verifiedBy = "signature_v2";
  } else if (options.allowSimple === true && simple.length) {
    const message = simpleMessage(body);
    if (message && (await matches(message, keys, simple))) verifiedBy = "signature_simple";
  }
  if (!verifiedBy) {
    throw new WebhookVerificationError(
      "invalid_signature",
      !raw.length && !v2.length && options.allowSimple !== true
        ? "Only X-Signature-Simple is present, and it counts only with allowSimple."
        : "No webhook signature matches the secret.",
    );
  }
  return parseEvent(JSON.parse(text) as Record<string, unknown>, verifiedBy);
}

/**
 * Verify a delivery when the framework only gives you the parsed JSON body.
 *
 * Only `X-Signature-V2` (and `X-Signature-V2-Previous`) can be checked, because
 * the other signatures cover the exact body bytes; prefer {@link verifyWebhook}
 * with the raw body whenever you can get it. Numbers from `JSON.parse` lose
 * precision above 2^53, so a body with such an integer fails with
 * `invalid_signature` here unless it was parsed into a bigint.
 *
 * Returns a shallow copy of `payload` with the non-enumerable `verifiedBy`
 * and `bodyAuthenticated`; `payload` itself is not changed.
 */
export async function verifyWebhookParsed(
  payload: unknown,
  headers: WebhookHeaders,
  secret: WebhookSecret,
  options: VerifyWebhookParsedOptions = {},
): Promise<WebhookEvent> {
  const keys = new Keys(normaliseSecrets(secret));
  const tolerance = checkTolerance(options.tolerance);
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new WebhookVerificationError(
      "invalid_payload",
      typeof payload === "string" || payload instanceof ArrayBuffer || ArrayBuffer.isView(payload)
        ? "verifyWebhookParsed needs the parsed JSON object; pass the raw body to verifyWebhook."
        : "The webhook payload is not a JSON object.",
    );
  }
  const body = { ...(payload as Record<string, unknown>) };
  const normalised = normaliseHeaders(headers);
  const timestamp = body.timestamp;
  checkTimestamp(
    (typeof timestamp === "number" && Number.isInteger(timestamp)) || typeof timestamp === "bigint"
      ? { exact: BigInt(timestamp), approx: Number(timestamp) }
      : null,
    normalised,
    tolerance,
  );
  const v2 = present(normalised, V2_HEADERS);
  if (!v2.length) {
    throw new WebhookVerificationError(
      "missing_signature",
      "verifyWebhookParsed needs X-Signature-V2; pass the raw body to verifyWebhook to check X-Signature.",
    );
  }
  if (!(await matches(encodeUtf8SurrogatePass(canonicalJson(body)), keys, v2))) {
    throw new WebhookVerificationError("invalid_signature", "No webhook signature matches the secret.");
  }
  return parseEvent(body, "signature_v2");
}
