// Requests to the issuer: headers, body encoding, the timeout, debug logging and
// the mapping of failures to the SDK's errors. Nothing is retried: codes and
// refresh tokens are single use, a revoked session no longer accepts its own
// token, and discovery and key fetches are rate limited by the cache instead.

import {
  APIConnectionError,
  APIResponseValidationError,
  APITimeoutError,
  makeStatusError,
  requestIdOf,
} from "../core/errors.js";
import { formatLogLine, type Logger } from "../core/logger.js";
import { clientHeader, userAgent } from "../core/runtime.js";

/** One request to the issuer. */
export interface IssuerRequest {
  method: "GET" | "POST" | "DELETE";
  url: string;
  /** Sent as `Authorization: Bearer <bearer>`. */
  bearer?: string;
  /** Sent form encoded (token requests). */
  form?: Record<string, string>;
  /** Sent as JSON. */
  json?: Record<string, unknown>;
  /** Values removed from error messages and bodies: tokens, codes and verifiers. */
  secrets?: readonly string[];
}

/** A 2xx answer: the parsed JSON body, or `null` for an empty body. */
export interface IssuerResponse {
  status: number;
  headers: Headers;
  data: unknown;
}

/** How requests are sent; fixed per `Authentication` instance. */
export interface Transport {
  fetch: typeof fetch | undefined;
  /** Milliseconds for the whole exchange, body included. */
  timeout: number;
  defaultHeaders: Headers;
  /** Where debug lines go, or `null` when logging is off. */
  logger: Logger | null;
}

// setTimeout fires at once for delays above 2^31 - 1 ms.
const MAX_TIMER = 2_147_483_647;

/** The path of a URL, for messages and logs: never the query, which may carry anything. */
export function pathOf(url: string): string {
  return new URL(url).pathname;
}

function bodyOf(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/**
 * Send one request. Throws `APITimeoutError` when no answer arrives within the
 * timeout, `APIConnectionError` when none arrives at all, `makeStatusError(...)`
 * for a status outside 2xx (3xx included: redirects are never followed, so a
 * token never leaves the issuer's origin) and `APIResponseValidationError` for
 * a 2xx body that is not JSON.
 */
export async function send(transport: Transport, request: IssuerRequest): Promise<IssuerResponse> {
  const headers = new Headers({
    Accept: "application/json",
    "User-Agent": userAgent(),
    "X-Didit-Client": clientHeader(),
  });
  transport.defaultHeaders.forEach((value, name) => {
    headers.set(name, value);
  });
  let body: string | undefined;
  if (request.form) {
    headers.set("Content-Type", "application/x-www-form-urlencoded");
    body = new URLSearchParams(request.form).toString();
  } else if (request.json) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(request.json);
  }
  if (request.bearer !== undefined) headers.set("Authorization", `Bearer ${request.bearer}`);

  const { method, url } = request;
  const path = pathOf(url);
  const fetchImpl = transport.fetch ?? globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(
    () => {
      controller.abort();
    },
    Math.min(transport.timeout, MAX_TIMER),
  );
  const started = Date.now();
  const log = (status: number | null, responseHeaders: Headers | null, error?: string): void => {
    transport.logger?.debug(
      formatLogLine({
        method,
        url,
        status,
        durationMs: Date.now() - started,
        requestId: responseHeaders ? requestIdOf(responseHeaders) : null,
        attempt: 0,
        ...(error === undefined ? {} : { error }),
      }),
    );
  };
  const noAnswer = (cause: unknown): APIConnectionError => {
    if (controller.signal.aborted) {
      log(null, null, "timeout");
      return new APITimeoutError(
        `The issuer did not answer ${method} ${path} within ${transport.timeout} ms.`,
        { cause },
      );
    }
    log(null, null, "connection_error");
    return new APIConnectionError(`Could not reach the issuer for ${method} ${path}.`, { cause });
  };

  let status: number;
  let responseHeaders: Headers;
  let text: string;
  try {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method,
        headers,
        body,
        redirect: "manual",
        signal: controller.signal,
      });
    } catch (error) {
      throw noAnswer(error);
    }
    status = response.status;
    responseHeaders = response.headers;
    try {
      text = await response.text();
    } catch (error) {
      throw noAnswer(error);
    }
  } finally {
    clearTimeout(timer);
  }
  log(status, responseHeaders);

  if (status < 200 || status > 299) {
    throw makeStatusError(status, bodyOf(text), responseHeaders, request.secrets ?? []);
  }
  if (status === 204 || !text) return { status, headers: responseHeaders, data: null };
  try {
    return { status, headers: responseHeaders, data: JSON.parse(text) as unknown };
  } catch (error) {
    const type = responseHeaders.get("content-type") ?? "no content type";
    throw new APIResponseValidationError(
      `Expected a JSON response from ${method} ${path}, got ${type}.`,
      status,
      responseHeaders,
      { cause: error },
    );
  }
}
