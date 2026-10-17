// The errors the SDK throws (docs/DESIGN.md section 7). Every one extends
// DiditError, so `err instanceof DiditError` catches all of them.

/** Base class of every error this SDK throws. */
export class DiditError extends Error {
  override name = "DiditError";

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

/**
 * The SDK is configured wrongly: no API key, no organization or application id
 * for an application-scoped method, an empty webhook secret, an invalid option.
 * Thrown before any request is sent.
 */
export class ConfigurationError extends DiditError {
  override name = "ConfigurationError";
}

/** No response arrived: DNS, TCP, TLS or the connection broke. */
export class APIConnectionError extends DiditError {
  override name = "APIConnectionError";

  constructor(message = "Connection error.", options?: { cause?: unknown }) {
    super(message, options);
  }
}

/** The request took longer than the timeout. */
export class APITimeoutError extends APIConnectionError {
  override name = "APITimeoutError";

  constructor(message = "Request timed out.", options?: { cause?: unknown }) {
    super(message, options);
  }
}

/**
 * A 2xx response the SDK cannot use: a body that is not the JSON the API
 * promises, or a pagination link to another origin.
 */
export class APIResponseValidationError extends DiditError {
  override name = "APIResponseValidationError";
  /** The HTTP status code. */
  readonly status: number;
  /** The response headers. */
  readonly headers: Headers;
  /** The request id the API returned, when it returned one. */
  readonly requestId: string | null;

  constructor(message: string, status: number, headers: Headers, options?: { cause?: unknown }) {
    super(message, options);
    this.status = status;
    this.headers = headers;
    this.requestId = requestIdOf(headers);
  }
}

/** The API answered with a status outside 2xx. */
export class APIStatusError extends DiditError {
  override name = "APIStatusError";
  /** The HTTP status code. */
  readonly status: number;
  /** The parsed JSON body when the response was JSON, else its text, else `null`. */
  readonly body: unknown;
  /** The response headers. */
  readonly headers: Headers;
  /** The request id the API returned, when it returned one. Quote it to support. */
  readonly requestId: string | null;

  constructor(message: string, status: number, body: unknown, headers: Headers) {
    const requestId = requestIdOf(headers);
    super(requestId ? `${message} (request id ${requestId})` : message);
    this.status = status;
    this.body = body;
    this.headers = headers;
    this.requestId = requestId;
  }
}

/** HTTP 400. */
export class BadRequestError extends APIStatusError {
  override name = "BadRequestError";
}

/** HTTP 401: the API key is missing, wrong, revoked or expired. */
export class AuthenticationError extends APIStatusError {
  override name = "AuthenticationError";
}

/** HTTP 403: the key has no access to this resource or action. */
export class PermissionDeniedError extends APIStatusError {
  override name = "PermissionDeniedError";
}

/** HTTP 404. */
export class NotFoundError extends APIStatusError {
  override name = "NotFoundError";
}

/** HTTP 409. */
export class ConflictError extends APIStatusError {
  override name = "ConflictError";
}

/** HTTP 422. */
export class UnprocessableEntityError extends APIStatusError {
  override name = "UnprocessableEntityError";
}

/** HTTP 429. */
export class RateLimitError extends APIStatusError {
  override name = "RateLimitError";
}

/** HTTP 5xx. */
export class InternalServerError extends APIStatusError {
  override name = "InternalServerError";
}

/** Why a webhook delivery failed verification (docs/DESIGN.md section 9.3). */
export type WebhookVerificationReason =
  | "missing_signature"
  | "invalid_signature"
  | "missing_timestamp"
  | "timestamp_mismatch"
  | "timestamp_out_of_tolerance"
  | "invalid_payload";

/**
 * A webhook delivery failed verification. Do not act on it. `reason` is machine
 * readable.
 */
export class WebhookVerificationError extends DiditError {
  override name = "WebhookVerificationError";
  readonly reason: WebhookVerificationReason;

  constructor(reason: WebhookVerificationReason, message: string) {
    super(message);
    this.reason = reason;
  }
}

/** Why an Authentication token failed verification (docs/DESIGN.md section 10). */
export type TokenVerificationReason =
  | "malformed"
  | "unsupported_algorithm"
  | "invalid_type"
  | "unknown_key"
  | "invalid_signature"
  | "invalid_issuer"
  | "invalid_audience"
  | "expired"
  | "not_yet_valid"
  | "invalid_issued_at"
  | "invalid_nonce"
  | "missing_claim";

/**
 * An access token or ID token failed verification: do not trust any of its
 * claims. `reason` is machine readable. The message never contains the token.
 */
export class TokenVerificationError extends DiditError {
  override name = "TokenVerificationError";
  readonly reason: TokenVerificationReason;

  constructor(reason: TokenVerificationReason, message: string) {
    super(message);
    this.reason = reason;
  }
}

const REQUEST_ID_HEADERS = ["x-request-id", "request-id", "x-amzn-requestid", "x-correlation-id"];

/** The request id from the first of the usual request id headers that is set. */
export function requestIdOf(headers: Headers): string | null {
  for (const name of REQUEST_ID_HEADERS) {
    const value = headers.get(name);
    if (value) return value;
  }
  return null;
}

type StatusErrorClass = new (
  message: string,
  status: number,
  body: unknown,
  headers: Headers,
) => APIStatusError;

const STATUS_ERRORS: Record<number, StatusErrorClass> = {
  400: BadRequestError,
  401: AuthenticationError,
  403: PermissionDeniedError,
  404: NotFoundError,
  409: ConflictError,
  422: UnprocessableEntityError,
  429: RateLimitError,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fieldErrors(body: Record<string, unknown>): string[] {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(body).slice(0, 5)) {
    if (Array.isArray(value) && typeof value[0] === "string") parts.push(`${key}: ${value[0]}`);
    else if (typeof value === "string") parts.push(`${key}: ${value}`);
  }
  return parts;
}

function errorDetail(body: unknown): string | null {
  if (isRecord(body)) {
    const { error, error_description: description } = body;
    if (typeof error === "string" && error && typeof description === "string" && description) {
      // OAuth 2.0 errors (RFC 6749 section 5.2): the code and what it means.
      return `${error}: ${description}`;
    }
    for (const key of ["detail", "message", "error", "error_description"]) {
      const value = body[key];
      if (typeof value === "string" && value) return value;
    }
    const parts = fieldErrors(body);
    return parts.length ? parts.join("; ") : null;
  }
  if (Array.isArray(body) && body.length && body.every((x) => typeof x === "string")) {
    return body.join("; ");
  }
  if (typeof body === "string" && body.trim() && body.length <= 500) return body.trim();
  return null;
}

/** Replace every occurrence of a secret in the strings of `value`. */
export function redact<T>(value: T, secrets: readonly string[]): T {
  const active = secrets.filter((s) => s.length > 0);
  if (!active.length) return value;
  const scrub = (input: unknown): unknown => {
    if (typeof input === "string") {
      let out = input;
      for (const secret of active) out = out.split(secret).join("[redacted]");
      return out;
    }
    if (Array.isArray(input)) return input.map(scrub);
    if (isRecord(input)) {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(input)) out[k] = scrub(v);
      return out;
    }
    return input;
  };
  return scrub(value) as T;
}

/**
 * The right APIStatusError subclass for a non-2xx response. Secrets (the API key,
 * tokens) are removed from the message and the body.
 */
export function makeStatusError(
  status: number,
  body: unknown,
  headers: Headers,
  secrets: readonly string[] = [],
): APIStatusError {
  const cleanBody = redact(body, secrets);
  const detail = errorDetail(cleanBody);
  const message = detail ? `HTTP ${status}: ${detail}` : `HTTP ${status}`;
  const ErrorClass =
    STATUS_ERRORS[status] ?? (status >= 500 ? InternalServerError : APIStatusError);
  return new ErrorClass(message, status, cleanBody, headers);
}
